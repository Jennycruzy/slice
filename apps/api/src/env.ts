import { z } from "zod";
import type { Hex } from "viem";
import { networkConfig, sliceConfigSchema, type NetworkName, type SliceConfig } from "@slice/core";

const optionalUrl = z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional());
const optionalText = z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional());
const optionalHex = z.preprocess((value) => value === "" ? undefined : value, z.string().optional());
const optionalQuantity = z.preprocess((value) => value === "" ? undefined : value, z.string().regex(/^\d+(?:\.\d+)?$/).optional());
const optionalMarketId = z.preprocess((value) => value === "" ? undefined : value, z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional());
// Blank lines in .env mean "not set", the same as a missing variable.
const optionalNumber = (schema: z.ZodTypeAny) => z.preprocess((value) => value === "" ? undefined : value, schema.optional());

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8787),
  PUBLIC_APP_URL: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().min(1),
  NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  SOMNIA_RPC_URL: optionalUrl,
  SOMNIA_WS_RPC_URL: optionalUrl,
  MARKETS_INDEXER_URL: optionalUrl,
  EXECUTOR_PRIVATE_KEY: optionalHex.refine((value) => value === undefined || /^0x[0-9a-fA-F]{64}$/.test(value), "must be a 32-byte hex key"),
  QUOTER_PRIVATE_KEY: optionalHex.refine((value) => value === undefined || /^0x[0-9a-fA-F]{64}$/.test(value), "must be a 32-byte hex key"),
  SESSION_POLICY_ADDRESS: optionalHex.refine((value) => value === undefined || /^0x[0-9a-fA-F]{40}$/.test(value), "must be an EVM address"),
  EXECUTION_ROUTER_ADDRESS: optionalHex.refine((value) => value === undefined || /^0x[0-9a-fA-F]{40}$/.test(value), "must be an EVM address"),
  REACTIVITY_HANDLER_ADDRESS: optionalHex.refine((value) => value === undefined || /^0x[0-9a-fA-F]{40}$/.test(value), "must be an EVM address"),
  REACTIVITY_EMITTER_ADDRESS: optionalHex.refine((value) => value === undefined || /^0x[0-9a-fA-F]{40}$/.test(value), "must be an EVM address"),
  REACTIVITY_SUBSCRIPTION_ID: optionalText,
  QUOTER_ENABLED: z.enum(["true", "false"]).default("false"),
  QUOTER_MARKET_ID: optionalMarketId,
  QUOTER_OUTCOME: z.enum(["YES", "NO"]).default("YES"),
  QUOTER_QUANTITY: optionalQuantity,
  QUOTER_SPREAD_TICKS: optionalNumber(z.coerce.bigint().positive()),
  QUOTER_REFRESH_SECONDS: optionalNumber(z.coerce.number().int().positive()),
  SLICE_SCALE_IN_CURVE_POWER: optionalNumber(z.coerce.number().positive()),
  SLICE_MAX_BOOK_LEVELS: optionalNumber(z.coerce.number().int().positive()),
  SLICE_MIN_EXPIRY_HEADROOM_SECONDS: optionalNumber(z.coerce.number().int().positive()),
  SLICE_CHILD_ORDER_EXPIRY_SECONDS: optionalNumber(z.coerce.number().int().positive()),
  SLICE_EXECUTION_RETRY_LIMIT: optionalNumber(z.coerce.number().int().nonnegative()),
  SLICE_EXECUTION_RETRY_BASE_MS: optionalNumber(z.coerce.number().int().positive()),
  SLICE_HEARTBEAT_INTERVAL_MS: optionalNumber(z.coerce.number().int().positive()),
});

export interface AppEnv {
  nodeEnv: "development" | "test" | "production";
  port: number;
  publicAppUrl: string;
  databaseUrl: string;
  networkName: NetworkName;
  network: ReturnType<typeof networkConfig>;
  rpcUrl: string;
  wsRpcUrl: string;
  indexerUrl: string;
  executorPrivateKey: Hex | null;
  quoterPrivateKey: Hex | null;
  sessionPolicyAddress: `0x${string}` | null;
  executionRouterAddress: `0x${string}` | null;
  reactivityHandlerAddress: `0x${string}` | null;
  reactivityEmitterAddress: `0x${string}` | null;
  reactivitySubscriptionId: string | null;
  quoter: {
    enabled: boolean;
    marketId: string | null;
    outcome: "YES" | "NO";
    quantity: string | null;
    spreadTicks: bigint | null;
    refreshSeconds: number | null;
  };
  slice: SliceConfig;
}

function asHex(value: string | undefined): Hex | null {
  return value === undefined ? null : value as `0x${string}`;
}

function asAddress(value: string | undefined): `0x${string}` | null {
  return value === undefined ? null : value as `0x${string}`;
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const raw = environmentSchema.parse(source);
  const network = networkConfig(raw.NETWORK);
  const slice = sliceConfigSchema.parse({
    scaleInCurvePower: raw.SLICE_SCALE_IN_CURVE_POWER,
    maxBookLevels: raw.SLICE_MAX_BOOK_LEVELS,
    minExpiryHeadroomSeconds: raw.SLICE_MIN_EXPIRY_HEADROOM_SECONDS,
    childOrderExpirySeconds: raw.SLICE_CHILD_ORDER_EXPIRY_SECONDS,
    executionRetryLimit: raw.SLICE_EXECUTION_RETRY_LIMIT,
    executionRetryBaseMs: raw.SLICE_EXECUTION_RETRY_BASE_MS,
    heartbeatIntervalMs: raw.SLICE_HEARTBEAT_INTERVAL_MS,
  });
  const quoter = {
    enabled: raw.QUOTER_ENABLED === "true",
    marketId: raw.QUOTER_MARKET_ID ?? null,
    outcome: raw.QUOTER_OUTCOME,
    quantity: raw.QUOTER_QUANTITY ?? null,
    spreadTicks: raw.QUOTER_SPREAD_TICKS ?? null,
    refreshSeconds: raw.QUOTER_REFRESH_SECONDS ?? null,
  };
  if (quoter.enabled && (quoter.quantity === null || quoter.spreadTicks === null || quoter.refreshSeconds === null)) {
    throw new Error("QUOTER_ENABLED requires QUOTER_QUANTITY, QUOTER_SPREAD_TICKS, and QUOTER_REFRESH_SECONDS");
  }
  if (quoter.enabled && raw.QUOTER_PRIVATE_KEY === undefined) {
    throw new Error("QUOTER_ENABLED requires a separate QUOTER_PRIVATE_KEY");
  }
  return {
    nodeEnv: raw.NODE_ENV,
    port: raw.PORT,
    publicAppUrl: raw.PUBLIC_APP_URL,
    databaseUrl: raw.DATABASE_URL,
    networkName: raw.NETWORK,
    network,
    rpcUrl: raw.SOMNIA_RPC_URL ?? network.rpcUrl,
    wsRpcUrl: raw.SOMNIA_WS_RPC_URL ?? network.wsRpcUrl,
    indexerUrl: raw.MARKETS_INDEXER_URL ?? network.indexerUrl,
    executorPrivateKey: asHex(raw.EXECUTOR_PRIVATE_KEY),
    quoterPrivateKey: asHex(raw.QUOTER_PRIVATE_KEY),
    sessionPolicyAddress: asAddress(raw.SESSION_POLICY_ADDRESS),
    executionRouterAddress: asAddress(raw.EXECUTION_ROUTER_ADDRESS),
    reactivityHandlerAddress: asAddress(raw.REACTIVITY_HANDLER_ADDRESS),
    reactivityEmitterAddress: asAddress(raw.REACTIVITY_EMITTER_ADDRESS),
    reactivitySubscriptionId: raw.REACTIVITY_SUBSCRIPTION_ID ?? null,
    quoter,
    slice,
  };
}
