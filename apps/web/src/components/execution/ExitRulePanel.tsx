import { useState } from "react";
import { parseEventLogs, parseUnits, type Address } from "viem";
import { useAccount, usePublicClient, useSignTypedData, useWriteContract } from "wagmi";
import type { ExitRule } from "@slice/core";
import { api, assertSessionDuration } from "../../lib/api.js";
import { EXIT_HANDLER_ABI } from "../../lib/contracts.js";
import { ensureEscrowApproval } from "../../lib/escrow.js";
import { centsToRaw, errorText, triggerLabel } from "../../lib/format.js";
import { grantTuple, oneCollateral, signGrant, unsignedGrant } from "../../lib/grants.js";
import type { Health, PublicExecution } from "../../lib/types.js";

interface ExitRulePanelProps {
  execution: PublicExecution;
  health: Health | null;
  onRegistered: (execution: PublicExecution) => void;
}

const RULE_KINDS: ExitRule["kind"][] = ["take-profit", "stop-loss", "book-thins"];

/** Contract enum values for the exit handler: which token to sell/buy and what triggers it. */
function exitKindCode(outcome: "YES" | "NO", exitSide: "buy" | "sell"): number {
  if (outcome === "YES") return exitSide === "sell" ? 1 : 0;
  return exitSide === "sell" ? 3 : 2;
}

function triggerCode(kind: ExitRule["kind"]): number {
  return kind === "take-profit" ? 0 : kind === "stop-loss" ? 1 : 2;
}

interface ExitScope {
  health: Health;
  handler: Address;
  pool: Address;
  decimals: number;
  marketExpiry: string;
  collateral: Address;
  outcomeToken: Address;
  filledQuantity: string;
}

/** Everything an exit rule needs; null when the execution or the engine cannot support one. */
function exitScope(execution: PublicExecution, health: Health | null): ExitScope | null {
  const request = execution.request;
  const filledQuantity = execution.metrics?.filledQuantity;
  if (
    health === null || !health.reactivityConfigured || health.reactivityHandlerAddress === null
    || execution.exitRule !== null
    || request.marketPool === undefined || request.marketDecimals === undefined || request.marketExpiry === undefined
    || request.marketCollateral === undefined || request.marketOutcomeToken === undefined
    || filledQuantity === undefined || Number(filledQuantity) <= 0
  ) return null;
  return {
    health,
    handler: health.reactivityHandlerAddress,
    pool: request.marketPool,
    decimals: request.marketDecimals,
    marketExpiry: request.marketExpiry,
    collateral: request.marketCollateral,
    outcomeToken: request.marketOutcomeToken,
    filledQuantity,
  };
}

/** Arms an on-chain exit for the filled position. The handler fires from Somnia Reactivity, with or without the Slice server. */
export function ExitRulePanel({ execution, health, onRegistered }: ExitRulePanelProps) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const [kind, setKind] = useState<ExitRule["kind"]>("take-profit");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [minimumQuantity, setMinimumQuantity] = useState("");
  const [error, setError] = useState<string | null>(null);

  const request = execution.request;
  const scope = exitScope(execution, health);
  if (scope === null) return null;
  const { health: engine, handler, pool, decimals, marketExpiry, collateral, outcomeToken, filledQuantity } = scope;

  async function setExit() {
    if (address === undefined || publicClient === undefined) {
      setError("Connect the wallet that owns this filled position before setting an exit");
      return;
    }
    try {
      setError(null);
      const router = engine.executionRouterAddress;
      const sessionPolicy = engine.sessionPolicyAddress;
      if (router === null || sessionPolicy === null) throw new Error("The non-custodial exit router is not configured");
      const one = oneCollateral(decimals);
      const quantity = parseUnits(filledQuantity, decimals);
      const exitSide = request.side === "buy" ? "sell" : "buy";

      await ensureEscrowApproval({
        owner: address,
        spender: router,
        side: exitSide,
        collateral,
        outcomeToken,
        maximumCollateral: quantity,
        publicClient,
        writeContract: writeContractAsync,
        purpose: "Exit collateral",
      });

      const rawTrigger = kind === "book-thins" ? 0n : centsToRaw(triggerPrice, decimals);
      const rawMinimum = kind === "book-thins" ? parseUnits(minimumQuantity, decimals) : 0n;
      if (kind !== "book-thins" && (rawTrigger <= 0n || rawTrigger >= one)) throw new Error("Trigger price must be between 0¢ and 100¢");
      if (kind === "book-thins" && rawMinimum <= 0n) throw new Error("Minimum best-level quantity must be positive");

      const issuedAt = Math.floor(Date.now() / 1000);
      const expiresAt = Math.min(issuedAt + assertSessionDuration(), Number(marketExpiry));
      if (!Number.isFinite(expiresAt) || expiresAt <= issuedAt) throw new Error("The filled market is too close to expiry for an on-chain exit");
      const outcomeTokenId = request.outcome === "YES" ? request.marketYesTokenId : request.marketNoTokenId;
      if (outcomeTokenId === undefined) throw new Error("Execution is missing its live outcome-token id");

      const grant = unsignedGrant({
        owner: address,
        executor: handler,
        marketId: request.marketId,
        marketPool: pool,
        marketCollateral: collateral,
        marketOutcomeToken: outcomeToken,
        outcomeTokenId,
        decimals,
        outcome: request.outcome,
        side: exitSide,
        maxContracts: quantity,
        issuedAt,
        expiresAt,
      });
      const { signature } = await signGrant(grant, { chainId: engine.chainId, verifyingContract: sessionPolicy }, signTypedDataAsync);

      const hash = await writeContractAsync({
        address: handler,
        abi: EXIT_HANDLER_ABI,
        functionName: "registerRule",
        args: [
          pool,
          exitKindCode(request.outcome, exitSide),
          triggerCode(kind),
          one,
          rawTrigger,
          rawMinimum,
          quantity,
          BigInt(marketExpiry) * 1_000_000_000n,
          collateral,
          outcomeToken,
          BigInt(outcomeTokenId),
          grantTuple(grant),
          signature,
        ],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Exit rule transaction did not confirm on Somnia");
      const events = parseEventLogs({ abi: EXIT_HANDLER_ABI, eventName: "RuleRegistered", logs: receipt.logs, strict: false });
      const registered = events[0];
      if (registered === undefined) throw new Error("Exit rule confirmed without a RuleRegistered event");

      const rule: ExitRule = {
        id: registered.args.ruleId!,
        marketId: request.marketId,
        owner: address,
        kind,
        triggerPrice: kind === "book-thins" ? null : triggerPrice,
        minimumBestLevelQuantity: kind === "book-thins" ? minimumQuantity : null,
        side: exitSide,
        quantity: filledQuantity,
        handlerAddress: handler,
        subscriptionId: engine.reactivitySubscriptionId ?? "",
        transactionHash: hash,
        status: "active",
      };
      const updated = await api<PublicExecution>(`/api/executions/${execution.id}/exit-rule`, { method: "POST", body: JSON.stringify(rule) });
      onRegistered(updated);
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  return (
    <section className="grant-panel exit-panel">
      <div>
        <span className="section-kicker">On-chain reactivity</span>
        <h2>Set my exit</h2>
        <p className="inline-note">The handler listens to the live pool event. It can fire after this server is offline.</p>
      </div>
      <div className="field-row">
        <label>
          Rule
          <select value={kind} onChange={(event) => setKind(event.target.value as ExitRule["kind"])}>
            {RULE_KINDS.map((item) => <option key={item} value={item}>{triggerLabel(item)}</option>)}
          </select>
        </label>
        {kind === "book-thins" ? (
          <label>
            Minimum best level
            <input inputMode="decimal" value={minimumQuantity} onChange={(event) => setMinimumQuantity(event.target.value)} placeholder="Contracts" />
          </label>
        ) : (
          <label>
            Trigger price
            <input inputMode="decimal" value={triggerPrice} onChange={(event) => setTriggerPrice(event.target.value)} placeholder="Cents, e.g. 72.5" />
          </label>
        )}
      </div>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <button className="secondary-button" disabled={isPending} onClick={() => void setExit()}>
        {isPending ? "Waiting for wallet…" : `Set ${triggerLabel(kind).toLowerCase()}`}
      </button>
    </section>
  );
}
