import { randomUUID } from "node:crypto";
import { Decimal } from "decimal.js/decimal";
import {
  assertGrantCovers,
  buildIcebergSlices,
  buildScaleInSchedule,
  defaultDisplayQuantity,
  executionMetrics,
  verifyGrant,
  type ChildOrder,
  type ExecutionRequest,
  type ExecutionState,
  type Fill,
  type Receipt,
  type SessionGrant,
  type TradeSide,
} from "@slice/core";
import { parseUnits, type Address, type Hex } from "viem";
import type { AppEnv } from "./env.js";
import { PostgresStore, type ExecutionRecord } from "./store.js";
import { DreamDexVenue, type PlacedChild, type VenueMarket } from "./venue.js";

export class ExecutionEngine {
  private readonly activeMarkets = new Set<string>();
  private heartbeatAt = new Date().toISOString();

  constructor(
    private readonly venue: DreamDexVenue,
    private readonly store: PostgresStore,
    private readonly env: AppEnv,
  ) {}

  get executorAddress(): Address | null {
    return this.venue.executorAddress;
  }

  get lastHeartbeatAt(): string {
    return this.heartbeatAt;
  }

  touch(): void {
    this.heartbeatAt = new Date().toISOString();
  }

  async authorize(grant: SessionGrant, params: { owner: Address; marketId: string; outcome: "YES" | "NO"; side: TradeSide; quantity: string }): Promise<{ digest: Hex; registrationHash: Hex | null }> {
    if (this.env.sessionPolicyAddress === null) throw new Error("Session authorization is not configured on this deployment");
    if (this.venue.executorAddress === null) throw new Error("Slice execution is not configured with a delegated executor key");
    if (this.venue.executionRouterAddress === null) throw new Error("Slice execution is not configured with the non-custodial binary execution router");
    const verified = await verifyGrant(grant, {
      chainId: this.env.network.chainId,
      verifyingContract: this.env.sessionPolicyAddress,
    });
    const market = await this.venue.resolveMarket(grant.marketId);
    const marketDecimals = market.onchain.decimals;
    const outcomeTokenId = params.outcome === "YES" ? market.onchain.yesId : market.onchain.noId;
    assertGrantCovers(grant, {
      owner: params.owner,
      marketId: params.marketId,
      marketPool: market.onchain.pool,
      marketCollateral: market.onchain.collateral,
      marketOutcomeToken: market.onchain.outcomeToken,
      outcomeTokenId: outcomeTokenId.toString(),
      oneCollateral: (10n ** BigInt(marketDecimals)).toString(),
      outcome: params.outcome,
      side: params.side,
      quantity: params.quantity,
      decimals: marketDecimals,
      executor: this.venue.executorAddress,
    });
    if (await this.venue.isSessionDigestRevoked(verified.digest)) throw new Error("This authorisation was revoked on-chain");
    let registrationHash: Hex | null = null;
    if (!(await this.venue.isSessionDigestRegistered(verified.digest))) {
      registrationHash = await this.venue.registerSessionGrant(grant);
    }
    await this.store.saveGrant({ ...grant, digest: verified.digest, revokedAt: null });
    return { digest: verified.digest, registrationHash };
  }

  async start(request: ExecutionRequest): Promise<ExecutionRecord> {
    const marketKey = request.marketId.toLowerCase();
    if (this.activeMarkets.has(marketKey)) throw new Error("An execution is already active for this market in this Slice process");
    const market = await this.venue.resolveMarket(request.marketId);
    const authorization = await this.authorize(request.sessionGrant, {
      owner: request.owner,
      marketId: market.row.marketId,
      outcome: request.outcome,
      side: request.side,
      quantity: request.quantity,
    });
    const snapshot = await this.venue.captureSnapshot({
      market,
      outcome: request.outcome,
      side: request.side,
      quantity: request.quantity,
      snapshotId: randomUUID(),
    });
    if (snapshot.naiveWalk.depthExhausted) {
      throw new Error(`Book holds ${snapshot.naiveWalk.filledQuantity} at reasonable prices. Reduce size or widen your limit`);
    }
    const displayQuantity = request.displayQuantity ?? defaultDisplayQuantity(snapshot.book, request.side, request.quantity);
    if (displayQuantity === null) throw new Error("The live book has no visible depth from which to size an iceberg");
    await this.store.reserveGrant(request.sessionGrant.grantId, parseUnits(request.quantity, market.onchain.decimals).toString());
    const canonicalRequest: ExecutionRequest = {
      ...request,
      marketId: market.row.marketId,
      symbol: request.outcome === "YES" ? market.yesSymbol : market.noSymbol,
      marketName: market.marketName,
      displayQuantity,
      sessionGrant: { ...request.sessionGrant, grantId: request.sessionGrant.grantId },
      marketPool: market.onchain.pool,
      marketDecimals: market.onchain.decimals,
      marketExpiry: market.onchain.expiry.toString(),
      marketCollateral: market.onchain.collateral,
      marketOutcomeToken: market.onchain.outcomeToken,
      marketYesTokenId: market.onchain.yesId.toString(),
      marketNoTokenId: market.onchain.noId.toString(),
    };
    const execution = await this.store.createExecution(randomUUID(), canonicalRequest, snapshot);
    await this.store.setGrantDigest(canonicalRequest.sessionGrant.grantId, authorization.digest);
    this.activeMarkets.add(marketKey);
    this.touch();
    void this.run(execution.id, market).catch((error: unknown) => this.handleRunError(execution.id, market, error));
    return execution;
  }

  async resumeActive(): Promise<void> {
    const executions = await this.store.listActiveExecutions();
    for (const execution of executions) {
      const marketKey = execution.request.marketId.toLowerCase();
      if (this.activeMarkets.has(marketKey)) continue;
      try {
        const market = await this.venue.resolveMarket(execution.request.marketId);
        this.activeMarkets.add(marketKey);
        void this.run(execution.id, market).catch((error: unknown) => this.handleRunError(execution.id, market, error));
      } catch (error) {
        await this.handleRunError(execution.id, null, error);
      }
    }
  }

  async cancel(executionId: string): Promise<ExecutionRecord> {
    const execution = await this.store.getExecution(executionId);
    if (execution === null) throw new Error("Execution not found");
    if (["completed", "partial", "cancelled", "failed"].includes(execution.state)) return execution;
    await this.store.requestCancel(executionId);
    this.touch();
    const updated = await this.store.getExecution(executionId);
    if (updated === null) throw new Error("Execution disappeared while cancelling");
    return updated;
  }

  async resume(executionId: string, grant: SessionGrant): Promise<{ execution: ExecutionRecord; authorization: { digest: Hex; registrationHash: Hex | null } }> {
    const execution = await this.store.getExecution(executionId);
    if (execution === null) throw new Error("Execution not found");
    if (["completed", "cancelled"].includes(execution.state)) throw new Error("This execution cannot be resumed from its current state");
    const marketKey = execution.request.marketId.toLowerCase();
    if (this.activeMarkets.has(marketKey)) throw new Error("This execution is already running");
    const filled = execution.fills.reduce((sum, fill) => sum.add(fill.quantity), new Decimal(0));
    const remaining = Decimal.max(new Decimal(execution.request.quantity).sub(filled), 0);
    if (remaining.lte(0)) throw new Error("This execution has no remaining contracts");
    const market = await this.venue.resolveMarket(execution.request.marketId);
    const authorization = await this.authorize(grant, {
      owner: execution.request.owner,
      marketId: market.row.marketId,
      outcome: execution.request.outcome,
      side: execution.request.side,
      quantity: remaining.toFixed(),
    });
    await this.store.reserveGrant(grant.grantId, parseUnits(remaining.toFixed(), market.onchain.decimals).toString());
    const request: ExecutionRequest = {
      ...execution.request,
      sessionGrant: grant,
      marketName: market.marketName,
      symbol: execution.request.outcome === "YES" ? market.yesSymbol : market.noSymbol,
      marketPool: market.onchain.pool,
      marketDecimals: market.onchain.decimals,
      marketExpiry: market.onchain.expiry.toString(),
      marketCollateral: market.onchain.collateral,
      marketOutcomeToken: market.onchain.outcomeToken,
      marketYesTokenId: market.onchain.yesId.toString(),
      marketNoTokenId: market.onchain.noId.toString(),
    };
    await this.store.replaceRequest(executionId, request);
    await this.store.setState(executionId, "running");
    this.activeMarkets.add(marketKey);
    this.touch();
    void this.run(executionId, market).catch((error: unknown) => this.handleRunError(executionId, market, error));
    return { execution: await this.status(executionId), authorization };
  }

  async status(executionId: string): Promise<ExecutionRecord> {
    const execution = await this.store.getExecution(executionId);
    if (execution === null) throw new Error("Execution not found");
    return execution;
  }

  private async run(executionId: string, market: VenueMarket): Promise<void> {
    try {
      const initial = await this.status(executionId);
      const { request, snapshot } = initial;
      const displayQuantity = request.displayQuantity;
      if (displayQuantity === undefined) throw new Error("Execution has no live-derived display quantity");
      const alreadyFilled = initial.fills.reduce((sum, fill) => sum.add(fill.quantity), new Decimal(0));
      let remaining = Decimal.max(new Decimal(request.quantity).sub(alreadyFilled), 0);
      const plans = this.planSlices({ ...request, quantity: remaining.toFixed() }, snapshot, displayQuantity, market);
      let sequence = initial.children.reduce((max, child) => Math.max(max, child.sequence), 0);

      for (let index = 0; index < plans.length; index += 1) {
        const plan = plans[index];
        if (plan === undefined) break;
        if (remaining.lte(0)) break;
        await this.waitUntil(plan.startsAt, executionId);
        const current = await this.status(executionId);
        if (current.cancelRequested) {
          await this.finish(executionId, market, "cancelled", "user_cancelled");
          return;
        }
        const plannedQuantity = Decimal.min(remaining, plan.quantity).toFixed();
        const result = await this.placeWithRetry({ executionId, request, market, quantity: plannedQuantity, sequence: sequence + 1 });
        sequence += 1;
        const filled = Decimal.min(new Decimal(result.filledQuantity), new Decimal(plannedQuantity));
        remaining = Decimal.max(remaining.sub(filled), 0);
        if (result.status === "partial" && filled.gt(0) && remaining.gt(0)) {
          plans.splice(index + 1, 0, { quantity: new Decimal(plannedQuantity).sub(filled), startsAt: new Date() });
        }
        this.touch();
        if (result.status === "rejected") {
          const originalQuantity = new Decimal(request.quantity);
          await this.finish(executionId, market, remaining.lt(originalQuantity) ? "partial" : "failed", "venue_rejected", result.rejectionReason ?? "The venue rejected the child order");
          return;
        }
      }

      const endState = await this.status(executionId);
      if (endState.cancelRequested) {
        await this.finish(executionId, market, "cancelled", "user_cancelled");
      } else if (remaining.lte(0)) {
        await this.finish(executionId, market, "completed");
      } else {
        await this.finish(executionId, market, "partial", "window_complete");
      }
    } finally {
      const execution = await this.store.getExecution(executionId);
      if (execution !== null) this.activeMarkets.delete(execution.request.marketId.toLowerCase());
      this.touch();
    }
  }

  private planSlices(request: ExecutionRequest, snapshot: ExecutionRecord["snapshot"], displayQuantity: string, market: VenueMarket): Array<{ quantity: Decimal; startsAt: Date }> {
    if (request.strategy === "scale-in") {
      const start = request.windowStart === undefined ? new Date() : new Date(request.windowStart);
      const latestEnd = new Date((Number(market.row.expiry) - this.env.slice.minExpiryHeadroomSeconds) * 1000);
      const end = request.windowEnd === undefined ? latestEnd : new Date(request.windowEnd);
      if (end.getTime() > latestEnd.getTime()) throw new Error("Scale-in window must end before the market's safety cutoff");
      const trancheCount = Math.max(1, new Decimal(request.quantity).div(displayQuantity).ceil().toNumber());
      return buildScaleInSchedule({
        totalQuantity: request.quantity,
        windowStart: start,
        windowEnd: end,
        tranches: trancheCount,
        curvePower: this.env.slice.scaleInCurvePower,
      }).map((item) => ({ quantity: new Decimal(item.quantity), startsAt: new Date(item.startsAt) }));
    }
    return buildIcebergSlices(request.quantity, displayQuantity).map((quantity, index) => ({
      quantity: new Decimal(quantity),
      startsAt: index === 0 ? new Date() : new Date(),
    }));
  }

  private async waitUntil(startsAt: Date, executionId: string): Promise<void> {
    let target = startsAt.getTime();
    if (!Number.isFinite(target)) throw new Error("Execution schedule contains an invalid timestamp");
    while (target > Date.now()) {
      const execution = await this.status(executionId);
      if (execution.cancelRequested) return;
      const delay = Math.min(target - Date.now(), 1_000);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      this.touch();
      target = startsAt.getTime();
    }
  }

  private async placeWithRetry(params: { executionId: string; request: ExecutionRequest; market: VenueMarket; quantity: string; sequence: number }): Promise<PlacedChild> {
    let lastResult: PlacedChild | null = null;
    for (let attempt = 0; attempt <= this.env.slice.executionRetryLimit; attempt += 1) {
      const childId = randomUUID();
      const now = new Date().toISOString();
      const child: ChildOrder = {
        id: childId,
        executionId: params.executionId,
        sequence: params.sequence,
        requestedQuantity: params.quantity,
        filledQuantity: "0",
        averagePrice: null,
        status: "planned",
        orderId: null,
        transactionHash: null,
        placedAt: null,
        updatedAt: now,
        rejectionReason: null,
      };
      await this.store.appendChild(params.executionId, child);
      try {
        await this.ensureGrantStillValid(params.request);
        await this.store.replaceChild(params.executionId, { ...child, status: "submitted", updatedAt: new Date().toISOString() });
        const result = await this.venue.placeChild({
          market: params.market,
          owner: params.request.owner,
          outcome: params.request.outcome,
          side: params.request.side,
          quantity: params.quantity,
          sequence: params.sequence + attempt,
          sessionGrant: params.request.sessionGrant,
        });
        lastResult = result;
        const status = result.status === "filled" ? "filled" : result.status === "partial" ? "partial" : "rejected";
        await this.store.replaceChild(params.executionId, {
          ...child,
          status,
          filledQuantity: result.filledQuantity,
          averagePrice: result.averagePrice,
          orderId: result.orderId,
          transactionHash: result.hash,
          placedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          rejectionReason: result.rejectionReason,
        });
        const fills = result.fills.map((fill, index): Fill => ({
          id: `${result.hash}-${fill.logIndex}-${index}`,
          childOrderId: childId,
          transactionHash: result.hash,
          blockNumber: result.receipt.blockNumber.toString(),
          logIndex: fill.logIndex,
          orderId: result.orderId ?? "0",
          quantity: fill.quantity,
          price: fill.outcomePrice,
          quote: fill.quote,
          side: params.request.side,
          observedAt: new Date().toISOString(),
        }));
        await this.store.appendFills(params.executionId, fills);
        if (result.status !== "rejected") return result;
        if (attempt >= this.env.slice.executionRetryLimit) return result;
        await this.store.setState(params.executionId, "reconnecting", { failureCode: "retrying_child", failureMessage: result.rejectionReason ?? "The venue returned no fill for the child order" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.store.replaceChild(params.executionId, { ...child, status: "rejected", updatedAt: new Date().toISOString(), rejectionReason: message });
        if (/authori[sz]ation|session grant|grant/i.test(message)) throw error;
        if (/OnlyApprovedContracts|0x3fb0ba2e|execution router|placeBinaryOrderFor/i.test(message)) {
          throw new Error(`DreamDEX does not permit delegated binary placement: ${message}`);
        }
        if (attempt >= this.env.slice.executionRetryLimit) throw new Error(`Venue rejected the child order after ${attempt + 1} attempts: ${message}`);
        await this.store.setState(params.executionId, "reconnecting", { failureCode: "retrying_child", failureMessage: message });
      }
      if (attempt < this.env.slice.executionRetryLimit) {
        await new Promise<void>((resolve) => setTimeout(resolve, this.env.slice.executionRetryBaseMs * 2 ** attempt));
        await this.store.setState(params.executionId, "running");
      }
    }
    if (lastResult === null) throw new Error("The execution engine could not obtain a child result");
    return lastResult;
  }

  private async ensureGrantStillValid(request: ExecutionRequest): Promise<void> {
    if (this.env.sessionPolicyAddress === null || this.venue.executorAddress === null) throw new Error("Session authorization is not configured");
    const verified = await verifyGrant(request.sessionGrant, {
      chainId: this.env.network.chainId,
      verifyingContract: this.env.sessionPolicyAddress,
    });
    assertGrantCovers(request.sessionGrant, {
      owner: request.owner,
      marketId: request.marketId,
      marketPool: request.marketPool ?? (() => { throw new Error("Execution is missing its live market pool"); })(),
      marketCollateral: request.marketCollateral ?? (() => { throw new Error("Execution is missing its live collateral"); })(),
      marketOutcomeToken: request.marketOutcomeToken ?? (() => { throw new Error("Execution is missing its live outcome token"); })(),
      outcomeTokenId: request.outcome === "YES"
        ? request.marketYesTokenId ?? (() => { throw new Error("Execution is missing its live YES token id"); })()
        : request.marketNoTokenId ?? (() => { throw new Error("Execution is missing its live NO token id"); })(),
      oneCollateral: (10n ** BigInt(request.marketDecimals ?? (() => { throw new Error("Execution is missing market decimals"); })())).toString(),
      outcome: request.outcome,
      side: request.side,
      quantity: request.quantity,
      decimals: request.marketDecimals ?? (() => { throw new Error("Execution is missing market decimals"); })(),
      executor: this.venue.executorAddress,
    });
    if (await this.venue.isSessionDigestRevoked(verified.digest)) throw new Error("Authorisation revoked. The filled portion is untouched.");
    if (!(await this.venue.isSessionDigestRegistered(verified.digest))) throw new Error("Session grant is not registered on-chain. Re-authorise to continue.");
  }

  private async finish(executionId: string, market: VenueMarket | null, state: Extract<ExecutionState, "completed" | "partial" | "cancelled" | "failed">, failureCode?: string, failureMessage?: string): Promise<void> {
    const execution = await this.status(executionId);
    let completionMidPrice: string | null = null;
    let completionFailure: string | null = null;
    if (market !== null) {
      try {
        completionMidPrice = await this.venue.currentMid(market, execution.request.outcome);
      } catch (error) {
        completionFailure = `Completion book unavailable: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    const metrics = executionMetrics({ snapshot: execution.snapshot, fills: execution.fills, completionMidPrice });
    await this.store.setState(executionId, state, {
      metrics,
      completionMidPrice,
      failureCode: failureCode ?? (completionFailure === null ? null : "completion_book_unavailable"),
      failureMessage: failureMessage ?? completionFailure,
    });
    const completed = await this.status(executionId);
    if (state === "failed" && completed.fills.length === 0) return;
    if (completed.completedAt === null) throw new Error("Execution finished without a completion timestamp");
    const receipt: Receipt = {
      id: randomUUID(),
      executionId,
      marketId: completed.request.marketId,
      marketName: completed.request.marketName,
      symbol: completed.request.symbol,
      side: completed.request.side,
      strategy: completed.request.strategy,
      status: state === "completed" ? "completed" : "cancelled" === state ? "cancelled" : "partial",
      createdAt: completed.createdAt,
      completedAt: completed.completedAt,
      snapshot: completed.snapshot,
      childOrders: completed.children,
      fills: completed.fills,
      metrics: metrics,
      exitRule: completed.exitRule,
    };
    await this.store.saveReceipt(receipt);
  }

  private async handleRunError(executionId: string, market: VenueMarket | null, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const execution = await this.store.getExecution(executionId);
      if (execution === null || ["completed", "partial", "cancelled", "failed"].includes(execution.state)) return;
      if (execution.fills.length > 0 || execution.cancelRequested) {
        await this.finish(executionId, market, execution.fills.length > 0 ? "partial" : "cancelled", /authori[sz]ation|session grant|grant/i.test(message) ? "authorisation_expired" : "engine_error", message);
      } else {
        await this.store.setState(executionId, "failed", { failureCode: "engine_error", failureMessage: message });
      }
    } finally {
      const execution = await this.store.getExecution(executionId);
      if (execution !== null) this.activeMarkets.delete(execution.request.marketId.toLowerCase());
      this.touch();
    }
  }
}
