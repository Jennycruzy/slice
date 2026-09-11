import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { Decimal } from "decimal.js/decimal";
import {
  previewImpact,
  verifyGrant,
  type ExecutionRequest,
  type ExitRule,
  type SessionGrant,
  type StrategyName,
  type TradeSide,
} from "@slice/core";
import { formatUnits, keccak256, parseAbi, parseEventLogs, toBytes, type Address, type Hash } from "viem";
import { z } from "zod";
import type { AppEnv } from "./env.js";
import { ExecutionEngine } from "./execution-engine.js";
import type { QuotingBot } from "./quoting-bot.js";
import { PostgresStore, type ExecutionRecord } from "./store.js";
import { DreamDexVenue, type VenueMarket } from "./venue.js";

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((value) => value as Address);
const marketIdSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const grantSchema = z.object({
  grantId: z.string().min(1),
  owner: addressSchema,
  executor: addressSchema,
  marketId: marketIdSchema,
  marketPool: addressSchema,
  marketCollateral: addressSchema,
  marketOutcomeToken: addressSchema,
  outcomeTokenId: z.string().regex(/^\d+$/),
  oneCollateral: z.string().regex(/^\d+$/),
  outcome: z.enum(["YES", "NO"]),
  side: z.enum(["buy", "sell"]),
  maxContracts: z.string().regex(/^\d+$/),
  issuedAt: z.number().int(),
  expiresAt: z.number().int(),
  nonce: z.string().regex(/^\d+$/),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).transform((value) => value as `0x${string}`),
});

const executionBodySchema = z.object({
  owner: addressSchema,
  marketId: marketIdSchema,
  outcome: z.enum(["YES", "NO"]),
  side: z.enum(["buy", "sell"]),
  quantity: z.string().regex(/^\d+(?:\.\d+)?$/),
  strategy: z.enum(["iceberg", "scale-in"]),
  displayQuantity: z.string().regex(/^\d+(?:\.\d+)?$/).optional(),
  windowStart: z.string().datetime().optional(),
  windowEnd: z.string().datetime().optional(),
  sessionGrant: grantSchema,
});

const previewBodySchema = z.object({
  marketId: marketIdSchema,
  outcome: z.enum(["YES", "NO"]),
  side: z.enum(["buy", "sell"]),
  quantity: z.string().regex(/^\d+(?:\.\d+)?$/),
  strategy: z.enum(["iceberg", "scale-in"]),
  displayQuantity: z.string().regex(/^\d+(?:\.\d+)?$/).optional(),
  windowStart: z.string().datetime().optional(),
  windowEnd: z.string().datetime().optional(),
});

const authorizationBodySchema = z.object({
  grant: grantSchema,
  quantity: z.string().regex(/^\d+(?:\.\d+)?$/),
});

const resumeBodySchema = z.object({ sessionGrant: grantSchema });

const ccxtParamsSchema = z.object({
  marketId: marketIdSchema.optional(),
  outcome: z.enum(["YES", "NO"]).optional(),
  strategy: z.enum(["iceberg", "scale-in"]).default("iceberg"),
  displayQuantity: z.string().regex(/^\d+(?:\.\d+)?$/).optional(),
  windowStart: z.string().datetime().optional(),
  windowEnd: z.string().datetime().optional(),
  sessionGrant: grantSchema,
});

const ccxtOrderBodySchema = z.object({
  symbol: z.string().min(1),
  type: z.enum(["market", "limit"]),
  side: z.enum(["buy", "sell"]),
  amount: z.union([z.string(), z.number()]).transform((value) => String(value)).pipe(z.string().regex(/^\d+(?:\.\d+)?$/)),
  price: z.union([z.string(), z.number()]).transform((value) => String(value)).pipe(z.string().regex(/^\d+(?:\.\d+)?$/)).optional(),
  params: z.record(z.unknown()).default({}),
});

const exitRuleBodySchema = z.object({
  ruleId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  kind: z.enum(["take-profit", "stop-loss", "book-thins"]),
  triggerPrice: z.string().regex(/^\d+(?:\.\d+)?$/).nullable(),
  minimumBestLevelQuantity: z.string().regex(/^\d+(?:\.\d+)?$/).nullable(),
  side: z.enum(["buy", "sell"]),
  quantity: z.string().regex(/^\d+(?:\.\d+)?$/),
  handlerAddress: addressSchema,
  subscriptionId: z.string().min(1),
  transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((value) => value as Hash),
});

const exitHandlerAbi = parseAbi([
  "event RuleRegistered(bytes32 indexed ruleId,address indexed owner,address indexed pool,uint8 exitKind,uint8 trigger,uint256 quantity)",
  "function rules(bytes32 ruleId) view returns (address owner,address pool,uint8 exitKind,uint8 trigger,uint256 oneCollateral,uint256 triggerPrice,uint256 minimumBestLevelQuantity,uint256 quantity,uint64 expireTimestampNs,bool active)",
]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asMarketSummary(market: VenueMarket) {
  return {
    id: market.row.marketId,
    name: market.marketName,
    question: market.row.question,
    asset: market.row.asset,
    interval: market.row.interval,
    expiry: market.row.expiry,
    tradingStart: market.row.tradingStart,
    pool: market.onchain.pool,
    decimals: market.onchain.decimals,
    collateral: market.onchain.collateral,
    outcomeToken: market.onchain.outcomeToken,
    yesTokenId: market.onchain.yesId.toString(),
    noTokenId: market.onchain.noId.toString(),
    outcomes: [
      { label: "YES", symbol: market.yesSymbol },
      { label: "NO", symbol: market.noSymbol },
    ],
  };
}

function publicExecution(execution: ExecutionRecord, env: AppEnv, receiptId: string | null) {
  const { sessionGrant: _sessionGrant, ...publicRequest } = execution.request;
  return {
    id: execution.id,
    request: publicRequest,
    snapshot: execution.snapshot,
    state: execution.state,
    children: execution.children,
    fills: execution.fills,
    metrics: execution.metrics,
    exitRule: execution.exitRule,
    completionMidPrice: execution.completionMidPrice,
    failureCode: execution.failureCode,
    failureMessage: execution.failureMessage,
    cancelRequested: execution.cancelRequested,
    heartbeatAt: execution.heartbeatAt,
    createdAt: execution.createdAt,
    updatedAt: execution.updatedAt,
    completedAt: execution.completedAt,
    receiptUrl: receiptId === null ? null : `${env.publicAppUrl}/r/${receiptId}`,
  };
}

function responseError(reply: FastifyReply, error: unknown, statusCode = 400) {
  return reply.code(statusCode).send({ error: errorMessage(error), action: "Review the live state and try again." });
}

function ccxtSymbol(market: VenueMarket, outcome: "YES" | "NO"): string {
  return `${market.row.asset}/${market.row.collateral}#${outcome}`;
}

function ccxtStatus(state: string): "open" | "closed" | "canceled" | "rejected" {
  if (["completed", "partial", "cancelled"].includes(state)) return state === "cancelled" ? "canceled" : "closed";
  if (state === "failed") return "rejected";
  return "open";
}

function ccxtOrder(execution: ExecutionRecord, symbol: string, env: AppEnv, receiptId: string | null) {
  const requested = new Decimal(execution.request.quantity);
  const filled = new Decimal(execution.metrics?.filledQuantity ?? "0");
  const remaining = Decimal.max(requested.sub(filled), 0);
  const average = execution.metrics?.actualAveragePrice;
  return {
    id: execution.id,
    clientOrderId: execution.id,
    timestamp: Date.parse(execution.createdAt),
    datetime: execution.createdAt,
    symbol,
    type: "market",
    side: execution.request.side,
    amount: Number(requested.toFixed()),
    price: null,
    average: average === null || average === undefined ? null : Number(average),
    filled: Number(filled.toFixed()),
    remaining: Number(remaining.toFixed()),
    cost: execution.metrics?.actualAveragePrice === null || execution.metrics?.actualAveragePrice === undefined
      ? 0
      : Number(new Decimal(execution.metrics.actualAveragePrice).mul(filled).toFixed()),
    status: ccxtStatus(execution.state),
    info: publicExecution(execution, env, receiptId),
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character] ?? character);
}

function money(value: string | null): string {
  if (value === null) return "—";
  return `$${new Decimal(value).toFixed(2)}`;
}

function receiptCardSvg(receipt: Awaited<ReturnType<PostgresStore["getReceipt"]>>, env: AppEnv): string {
  if (receipt === null) throw new Error("Receipt not found");
  const safe = (value: string) => escapeHtml(value);
  const naive = receipt.metrics.naiveAveragePrice === null ? "—" : `${new Decimal(receipt.metrics.naiveAveragePrice).mul(100).toFixed(2)}¢`;
  const actual = receipt.metrics.actualAveragePrice === null ? "—" : `${new Decimal(receipt.metrics.actualAveragePrice).mul(100).toFixed(2)}¢`;
  const saved = money(receipt.metrics.netSavings ?? receipt.metrics.rawSavings);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title desc">
  <title id="title">Slice execution receipt</title><desc id="desc">${safe(receipt.marketName)}. Slice fill ${safe(actual)}. Savings ${safe(saved)}.</desc>
  <rect width="1200" height="630" fill="#0c1117"/><rect x="42" y="42" width="1116" height="546" rx="20" fill="#111923" stroke="#253445"/>
  <text x="86" y="112" fill="#f3f6f8" font-family="Arial, sans-serif" font-size="28" font-weight="700">SLICE / EXECUTION RECEIPT</text>
  <text x="86" y="170" fill="#c8d2dc" font-family="Arial, sans-serif" font-size="30">${safe(receipt.marketName)}</text>
  <text x="86" y="224" fill="#8798aa" font-family="Arial, sans-serif" font-size="22">${safe(receipt.metrics.filledQuantity)} contracts · ${safe(receipt.side)} · ${safe(receipt.status)}</text>
  <text x="86" y="318" fill="#8798aa" font-family="Arial, sans-serif" font-size="22">MARKET ORDER</text><text x="86" y="360" fill="#f3f6f8" font-family="monospace" font-size="42">${safe(naive)}</text>
  <text x="460" y="318" fill="#8798aa" font-family="Arial, sans-serif" font-size="22">SLICE FILL</text><text x="460" y="360" fill="#f3f6f8" font-family="monospace" font-size="42">${safe(actual)}</text>
  <text x="86" y="470" fill="#60e6bb" font-family="monospace" font-size="74" font-weight="700">${safe(saved)}</text><text x="86" y="514" fill="#60e6bb" font-family="Arial, sans-serif" font-size="20">net of observed mid-price drift</text>
  <text x="86" y="558" fill="#5f7184" font-family="Arial, sans-serif" font-size="16">${safe(env.network.name)} · live snapshot block ${safe(receipt.snapshot.blockNumber)}</text>
</svg>`;
}

export async function buildApp(params: { env: AppEnv; store: PostgresStore; venue: DreamDexVenue; engine: ExecutionEngine; quoter?: QuotingBot }): Promise<FastifyInstance> {
  const app = Fastify({ logger: params.env.nodeEnv !== "test" });
  await app.register(cors, { origin: true });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    return responseError(reply, error, (error as { statusCode?: number }).statusCode ?? 500);
  });

  app.get("/health", async (_request, reply) => reply.send({
    status: params.engine.executorAddress !== null && params.env.sessionPolicyAddress !== null && params.env.executionRouterAddress !== null ? "ok" : "degraded",
    network: params.env.network.name,
    chainId: params.env.network.chainId,
    executorConfigured: params.engine.executorAddress !== null,
    sessionPolicyConfigured: params.env.sessionPolicyAddress !== null,
    executionRouterConfigured: params.env.executionRouterAddress !== null,
    executorAddress: params.engine.executorAddress,
    sessionPolicyAddress: params.env.sessionPolicyAddress,
    executionRouterAddress: params.env.executionRouterAddress,
    explorerUrl: params.env.network.explorerUrl,
    reactivityConfigured: params.env.reactivityHandlerAddress !== null && params.env.reactivityEmitterAddress !== null && params.env.reactivitySubscriptionId !== null,
    reactivityHandlerAddress: params.env.reactivityHandlerAddress,
    reactivityEmitterAddress: params.env.reactivityEmitterAddress,
    reactivitySubscriptionId: params.env.reactivitySubscriptionId,
    quoter: params.quoter?.status() ?? { enabled: false, running: false, lastError: null, lastRunAt: null, lastMarketId: null, openQuotes: 0 },
    lastHeartbeatAt: params.engine.lastHeartbeatAt,
    checkedAt: new Date().toISOString(),
  }));

  app.get("/api/markets", async (_request, reply) => {
    const markets = await params.venue.listLiveMarkets();
    return reply.send({ markets: markets.map(asMarketSummary), source: "dreamdex-live" });
  });

  app.get("/api/markets/:marketId/book", async (request, reply) => {
    const { marketId } = request.params as { marketId: string };
    const outcome = z.enum(["YES", "NO"]).parse((request.query as { outcome?: string }).outcome ?? "YES");
    const market = await params.venue.resolveMarket(marketId);
    const { book, block } = await params.venue.readBook(market, outcome);
    if (block.number === null) return responseError(reply, new Error("Somnia returned a block without a block number"), 502);
    return reply.send({ market: asMarketSummary(market), outcome, book, blockNumber: block.number.toString() });
  });

  app.post("/api/preview-impact", async (request, reply) => {
    const body = previewBodySchema.parse(request.body);
    const market = await params.venue.resolveMarket(body.marketId);
    const snapshot = await params.venue.captureSnapshot({
      market,
      outcome: body.outcome,
      side: body.side,
      quantity: body.quantity,
      snapshotId: randomUUID(),
    });
    const windowStart = body.windowStart === undefined ? new Date() : new Date(body.windowStart);
    const marketSafetyCutoff = new Date((Number(market.onchain.expiry) - params.env.slice.minExpiryHeadroomSeconds) * 1000);
    const windowEnd = body.windowEnd === undefined ? marketSafetyCutoff : new Date(body.windowEnd);
    const impact = previewImpact(snapshot, body.strategy, body.displayQuantity, windowStart, windowEnd);
    return reply.send({ ...impact, market: asMarketSummary(market), live: true });
  });

  app.post("/api/session/grants/verify", async (request, reply) => {
    const body = authorizationBodySchema.parse(request.body);
    const grant = body.grant as SessionGrant;
    try {
      const authorization = await params.engine.authorize(grant, {
        owner: grant.owner,
        marketId: grant.marketId,
        outcome: grant.outcome,
        side: grant.side,
        quantity: body.quantity,
      });
      return reply.send({ verified: true, digest: authorization.digest, registrationHash: authorization.registrationHash, executor: params.engine.executorAddress, expiresAt: grant.expiresAt });
    } catch (error) {
      return responseError(reply, error, 403);
    }
  });

  app.post("/api/executions", async (request, reply) => {
    const body = executionBodySchema.parse(request.body);
    const executionRequest: ExecutionRequest = {
      owner: body.owner,
      marketId: body.marketId,
      symbol: body.marketId,
      outcome: body.outcome,
      marketName: body.marketId,
      side: body.side,
      quantity: body.quantity,
      strategy: body.strategy,
      sessionGrant: body.sessionGrant,
      ...(body.displayQuantity === undefined ? {} : { displayQuantity: body.displayQuantity }),
      ...(body.windowStart === undefined ? {} : { windowStart: body.windowStart }),
      ...(body.windowEnd === undefined ? {} : { windowEnd: body.windowEnd }),
    };
    try {
      const execution = await params.engine.start(executionRequest);
      const receipt = await params.store.getReceiptForExecution(execution.id);
      return reply.code(202).send(publicExecution(execution, params.env, receipt?.id ?? null));
    } catch (error) {
      return responseError(reply, error, 422);
    }
  });

  app.get("/api/executions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const execution = await params.engine.status(id);
    const receipt = await params.store.getReceiptForExecution(id);
    return reply.send(publicExecution(execution, params.env, receipt?.id ?? null));
  });

  app.post("/api/executions/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const execution = await params.engine.cancel(id);
      const receipt = await params.store.getReceiptForExecution(id);
      return reply.send(publicExecution(execution, params.env, receipt?.id ?? null));
    } catch (error) {
      return responseError(reply, error, 409);
    }
  });

  app.post("/api/executions/:id/resume", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = resumeBodySchema.parse(request.body);
    try {
      const resumed = await params.engine.resume(id, body.sessionGrant as SessionGrant);
      const receipt = await params.store.getReceiptForExecution(id);
      return reply.code(202).send({ ...publicExecution(resumed.execution, params.env, receipt?.id ?? null), digest: resumed.authorization.digest, registrationHash: resumed.authorization.registrationHash });
    } catch (error) {
      return responseError(reply, error, 409);
    }
  });

  app.get("/api/executions/:id/events", async (request, reply) => {
    const { id } = request.params as { id: string };
    await params.engine.status(id);
    const response = reply.raw;
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    let closed = false;
    const close = () => {
      closed = true;
      clearInterval(timer);
    };
    request.raw.on("close", close);
    const publish = async () => {
      if (closed) return;
      try {
        const execution = await params.engine.status(id);
        const receipt = await params.store.getReceiptForExecution(id);
        response.write(`event: execution\ndata: ${JSON.stringify(publicExecution(execution, params.env, receipt?.id ?? null))}\n\n`);
        if (["completed", "partial", "cancelled", "failed"].includes(execution.state)) {
          clearInterval(timer);
          response.end();
        }
      } catch (error) {
        response.write(`event: error\ndata: ${JSON.stringify({ error: errorMessage(error), action: "Reload the execution status." })}\n\n`);
        clearInterval(timer);
        response.end();
      }
    };
    const timer = setInterval(() => { void publish(); }, 1_000);
    await publish();
    return reply;
  });

  app.get("/api/receipts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const receipt = await params.store.getReceipt(id);
    if (receipt === null) return reply.code(404).send({ error: "Receipt not found", action: "Check the public receipt URL." });
    return reply.send(receipt);
  });

  app.get("/r/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const receipt = await params.store.getReceipt(id);
    if (receipt === null) return reply.code(404).type("text/html").send("<h1>Receipt not found</h1>");
    const naive = receipt.metrics.naiveAveragePrice === null ? "—" : `${new Decimal(receipt.metrics.naiveAveragePrice).mul(100).toFixed(2)}¢ avg`;
    const actual = receipt.metrics.actualAveragePrice === null ? "—" : `${new Decimal(receipt.metrics.actualAveragePrice).mul(100).toFixed(2)}¢ avg`;
    const childLinks = receipt.childOrders.filter((child) => child.transactionHash !== null).map((child) => `<li><a href="${escapeHtml(params.env.network.explorerUrl)}/tx/${escapeHtml(child.transactionHash ?? "")}">${escapeHtml(child.transactionHash ?? "")}</a></li>`).join("");
    const exitRule = receipt.exitRule === null
      ? "<p>No on-chain exit rule was attached to this execution.</p>"
      : `<h2>On-chain exit rule</h2><p>${escapeHtml(receipt.exitRule.kind)} · closes with a ${escapeHtml(receipt.exitRule.side)} order · ${escapeHtml(receipt.exitRule.quantity)} contracts · ${escapeHtml(receipt.exitRule.status)}</p><p>Handler <a href="${escapeHtml(params.env.network.explorerUrl)}/address/${escapeHtml(receipt.exitRule.handlerAddress)}">${escapeHtml(receipt.exitRule.handlerAddress)}</a> · rule transaction <a href="${escapeHtml(params.env.network.explorerUrl)}/tx/${escapeHtml(receipt.exitRule.transactionHash)}">${escapeHtml(receipt.exitRule.transactionHash)}</a></p>`;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta property="og:image" content="${escapeHtml(params.env.publicAppUrl)}/r/${escapeHtml(id)}/card.svg"><title>Slice receipt · ${escapeHtml(receipt.marketName)}</title><style>body{background:#0c1117;color:#f3f6f8;font:16px system-ui;margin:0;padding:48px}main{max-width:760px;margin:auto}section{border:1px solid #253445;border-radius:16px;padding:28px;background:#111923}dt{color:#8798aa;margin-top:18px}dd{font:24px ui-monospace,monospace;margin:4px 0}a{color:#60e6bb;overflow-wrap:anywhere}.saving{font:64px ui-monospace,monospace;color:#60e6bb;margin:16px 0}</style></head><body><main><p>SLICE / EXECUTION RECEIPT</p><section><h1>${escapeHtml(receipt.marketName)}</h1><p>${escapeHtml(receipt.metrics.filledQuantity)} contracts · ${escapeHtml(receipt.side)} · ${escapeHtml(receipt.status)}</p><dl><dt>Market order would have cost</dt><dd>${escapeHtml(naive)}</dd><dt>Slice filled at</dt><dd>${escapeHtml(actual)}</dd></dl><p class="saving">${escapeHtml(money(receipt.metrics.netSavings ?? receipt.metrics.rawSavings))}</p><p>net of observed mid-price drift</p><p>Snapshot block ${escapeHtml(receipt.snapshot.blockNumber)} · ${escapeHtml(receipt.snapshot.capturedAt)}</p><h2>Child transactions</h2><ul>${childLinks || "<li>No child transaction was recorded.</li>"}</ul>${exitRule}<p><a href="${escapeHtml(params.env.publicAppUrl)}/r/${escapeHtml(id)}/card.svg">Share card image</a></p></section></main></body></html>`;
    return reply.type("text/html").send(html);
  });

  app.get("/r/:id/card.svg", async (request, reply) => {
    const { id } = request.params as { id: string };
    const receipt = await params.store.getReceipt(id);
    if (receipt === null) return reply.code(404).type("text/plain").send("Receipt not found");
    return reply.type("image/svg+xml").send(receiptCardSvg(receipt, params.env));
  });

  app.post("/api/executions/:id/exit-rule", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = exitRuleBodySchema.parse(request.body);
    if (params.env.reactivityHandlerAddress === null || params.env.reactivityEmitterAddress === null || params.env.reactivitySubscriptionId === null) {
      return responseError(reply, new Error("On-chain exits are not configured for this deployment"), 409);
    }
    const execution = await params.engine.status(id);
    if (execution.fills.length === 0) return responseError(reply, new Error("An exit rule needs a filled position"), 422);
    if (body.handlerAddress.toLowerCase() !== params.env.reactivityHandlerAddress.toLowerCase()) return responseError(reply, new Error("Exit rule handler does not match the configured on-chain handler"), 403);
    if (body.subscriptionId !== params.env.reactivitySubscriptionId) return responseError(reply, new Error("Exit rule subscription does not match the configured on-chain subscription"), 403);
    if (execution.request.marketPool === undefined || execution.request.marketDecimals === undefined || execution.request.marketExpiry === undefined) return responseError(reply, new Error("Execution is missing its live market binding"), 422);
    if (params.env.reactivityEmitterAddress.toLowerCase() !== execution.request.marketPool.toLowerCase()) return responseError(reply, new Error("The configured Reactivity subscription listens to a different live pool"), 409);
    const subscription = await params.venue.getReactivitySubscription(params.env.reactivitySubscriptionId);
    if (subscription.handler.toLowerCase() !== body.handlerAddress.toLowerCase() || subscription.emitter.toLowerCase() !== execution.request.marketPool.toLowerCase()) return responseError(reply, new Error("The configured Reactivity subscription does not match the handler and live pool"), 409);
    if (subscription.eventTopic.toLowerCase() !== keccak256(toBytes("OrderFilled(uint128,uint128,uint256,uint256,uint256,uint256)")).toLowerCase()) return responseError(reply, new Error("The configured Reactivity subscription does not listen for DreamDEX fills"), 409);
    const receipt = await params.venue.publicClient.getTransactionReceipt({ hash: body.transactionHash });
    if (receipt.status !== "success") return responseError(reply, new Error("The exit-rule transaction did not succeed on-chain"), 422);
    if (receipt.to === null || receipt.to.toLowerCase() !== body.handlerAddress.toLowerCase()) return responseError(reply, new Error("The exit-rule transaction was not sent to the configured handler"), 422);
    if (receipt.from.toLowerCase() !== execution.request.owner.toLowerCase()) return responseError(reply, new Error("The exit-rule transaction was not signed by the execution owner"), 403);
    const registeredEvents = parseEventLogs({
      abi: exitHandlerAbi,
      eventName: "RuleRegistered",
      logs: receipt.logs.filter((log) => log.address.toLowerCase() === body.handlerAddress.toLowerCase()),
      strict: false,
    });
    const registered = registeredEvents.find((event) => event.args.ruleId !== undefined && event.args.ruleId.toLowerCase() === body.ruleId.toLowerCase());
    if (registered === undefined) return responseError(reply, new Error("The exit-rule transaction has no matching RuleRegistered event"), 422);
    const rawRule = await params.venue.publicClient.readContract({
      address: body.handlerAddress,
      abi: exitHandlerAbi,
      functionName: "rules",
      args: [body.ruleId as `0x${string}`],
    });
    const rule = rawRule as readonly [Address, Address, number, number, bigint, bigint, bigint, bigint, bigint, boolean];
    const chainOwner = rule[0];
    const chainPool = rule[1];
    const chainTrigger = Number(rule[3]);
    const chainQuantity = formatUnits(rule[7], execution.request.marketDecimals);
    const expectedTrigger = body.kind === "take-profit" ? 0 : body.kind === "stop-loss" ? 1 : 2;
    const expectedExitSide = execution.request.side === "buy" ? "sell" : "buy";
    const expectedExitKind = execution.request.outcome === "YES"
      ? expectedExitSide === "sell" ? 1 : 0
      : expectedExitSide === "sell" ? 3 : 2;
    const oneCollateral = 10n ** BigInt(execution.request.marketDecimals);
    const expectedExpiry = BigInt(execution.request.marketExpiry) * 1_000_000_000n;
    const chainTriggerPrice = formatUnits(rule[5], execution.request.marketDecimals);
    const chainMinimumBestLevelQuantity = formatUnits(rule[6], execution.request.marketDecimals);
    if (chainOwner.toLowerCase() !== execution.request.owner.toLowerCase()) return responseError(reply, new Error("Exit rule owner does not match the execution owner"), 403);
    if (chainPool.toLowerCase() !== execution.request.marketPool.toLowerCase()) return responseError(reply, new Error("Exit rule pool does not match the execution market"), 403);
    if (registered.args.owner === undefined || registered.args.pool === undefined || registered.args.owner.toLowerCase() !== execution.request.owner.toLowerCase() || registered.args.pool.toLowerCase() !== execution.request.marketPool.toLowerCase()) return responseError(reply, new Error("RuleRegistered does not match the execution owner and market"), 422);
    if (chainTrigger !== expectedTrigger || Number(rule[2]) !== expectedExitKind || !rule[9]) return responseError(reply, new Error("Exit rule is not active with the requested trigger and position side"), 422);
    if (!new Decimal(chainQuantity).eq(new Decimal(body.quantity))) return responseError(reply, new Error("Exit rule quantity does not match its on-chain quantity"), 422);
    if (body.side !== expectedExitSide) return responseError(reply, new Error("Exit rule side must close the filled position"), 422);
    if (rule[4] !== oneCollateral || rule[8] !== expectedExpiry) return responseError(reply, new Error("Exit rule collateral unit or expiry does not match the live market"), 422);
    if (body.kind === "book-thins") {
      if (body.triggerPrice !== null || body.minimumBestLevelQuantity === null || !new Decimal(chainMinimumBestLevelQuantity).eq(new Decimal(body.minimumBestLevelQuantity))) return responseError(reply, new Error("Book-thinning threshold does not match its on-chain rule"), 422);
    } else if (body.triggerPrice === null || body.minimumBestLevelQuantity !== null || !new Decimal(chainTriggerPrice).eq(new Decimal(body.triggerPrice))) {
      return responseError(reply, new Error("Exit trigger price does not match its on-chain rule"), 422);
    }
    const exitRule: ExitRule = {
      id: body.ruleId,
      marketId: execution.request.marketId,
      owner: execution.request.owner,
      kind: body.kind,
      triggerPrice: body.triggerPrice,
      minimumBestLevelQuantity: body.minimumBestLevelQuantity,
      side: body.side,
      quantity: body.quantity,
      handlerAddress: body.handlerAddress,
      subscriptionId: body.subscriptionId,
      transactionHash: body.transactionHash,
      status: "active",
    };
    await params.store.setExitRule(id, exitRule);
    const updated = await params.engine.status(id);
    const publicReceipt = await params.store.getReceiptForExecution(id);
    return reply.send(publicExecution(updated, params.env, publicReceipt?.id ?? null));
  });

  app.get("/ccxt/markets", async (_request, reply) => {
    const markets = await params.venue.listLiveMarkets();
    return reply.send(markets.flatMap((market) => (["YES", "NO"] as const).map((outcome) => ({
      id: `${market.row.marketId}#${outcome}`,
      symbol: ccxtSymbol(market, outcome),
      base: `${market.row.asset}#${outcome}`,
      quote: market.row.collateral,
      active: true,
      type: "binary",
      info: asMarketSummary(market),
    }))));
  });

  app.get("/ccxt/orderbook", async (request, reply) => {
    const query = request.query as { marketId?: string; outcome?: string };
    const marketId = marketIdSchema.parse(query.marketId);
    const outcome = z.enum(["YES", "NO"]).parse(query.outcome ?? "YES");
    const market = await params.venue.resolveMarket(marketId);
    const { book } = await params.venue.readBook(market, outcome);
    return reply.send({ bids: book.bids.map((level) => [Number(level.price), Number(level.quantity)]), asks: book.asks.map((level) => [Number(level.price), Number(level.quantity)]), timestamp: Date.parse(book.capturedAt), datetime: book.capturedAt, nonce: book.blockNumber });
  });

  app.post("/ccxt/order", async (request, reply) => {
    const body = ccxtOrderBodySchema.parse(request.body);
    if (body.type !== "market") return responseError(reply, new Error("Slice accepts CCXT market orders; choose an execution strategy for the worked order"), 422);
    const paramsBody = ccxtParamsSchema.parse(body.params);
    const markets = await params.venue.listLiveMarkets();
    const explicitMarketId = paramsBody.marketId;
    const outcome = paramsBody.outcome ?? (body.symbol.endsWith("#NO") ? "NO" : body.symbol.endsWith("#YES") ? "YES" : undefined);
    const market = explicitMarketId === undefined
      ? markets.find((candidate) => outcome !== undefined && ccxtSymbol(candidate, outcome) === body.symbol)
      : markets.find((candidate) => candidate.row.marketId.toLowerCase() === explicitMarketId.toLowerCase());
    if (market === undefined || outcome === undefined) return responseError(reply, new Error("CCXT symbol must identify a live market and outcome, for example the symbol returned by GET /ccxt/markets"), 422);
    if (paramsBody.sessionGrant.marketId.toLowerCase() !== market.row.marketId.toLowerCase() || paramsBody.sessionGrant.outcome !== outcome || paramsBody.sessionGrant.side !== body.side) {
      return responseError(reply, new Error(`CCXT session grant mismatch: market=${paramsBody.sessionGrant.marketId} expected=${market.row.marketId}; outcome=${paramsBody.sessionGrant.outcome} expected=${outcome}; side=${paramsBody.sessionGrant.side} request=${body.side}`), 403);
    }
    const executionRequest: ExecutionRequest = {
      owner: paramsBody.sessionGrant.owner,
      marketId: market.row.marketId,
      symbol: body.symbol,
      outcome,
      marketName: market.marketName,
      side: body.side,
      quantity: body.amount,
      strategy: paramsBody.strategy,
      sessionGrant: paramsBody.sessionGrant,
      ...(paramsBody.displayQuantity === undefined ? {} : { displayQuantity: paramsBody.displayQuantity }),
      ...(paramsBody.windowStart === undefined ? {} : { windowStart: paramsBody.windowStart }),
      ...(paramsBody.windowEnd === undefined ? {} : { windowEnd: paramsBody.windowEnd }),
    };
    try {
      const execution = await params.engine.start(executionRequest);
      const receipt = await params.store.getReceiptForExecution(execution.id);
      return reply.code(202).send(ccxtOrder(execution, body.symbol, params.env, receipt?.id ?? null));
    } catch (error) {
      return responseError(reply, error, 422);
    }
  });

  app.get("/ccxt/order/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const execution = await params.engine.status(id);
      const receipt = await params.store.getReceiptForExecution(id);
      return reply.send(ccxtOrder(execution, execution.request.symbol, params.env, receipt?.id ?? null));
    } catch (error) {
      return responseError(reply, error, 404);
    }
  });

  return app;
}
