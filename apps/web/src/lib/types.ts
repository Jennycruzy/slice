import type { Address, Hex } from "viem";
import type { BookSnapshot, ExecutionMetrics, ExitRule, SessionGrant, StrategyName } from "@slice/core";

export type Outcome = "YES" | "NO";
export type Side = "buy" | "sell";

export interface MarketSummary {
  id: string;
  name: string;
  question: string | null;
  asset: string;
  interval: string | null;
  expiry: string;
  tradingStart: string;
  pool: Address;
  decimals: number;
  collateral: Address;
  outcomeToken: Address;
  yesTokenId: string;
  noTokenId: string;
  outcomes: Array<{ label: Outcome; symbol: string }>;
}

export interface ImpactPreview {
  market: MarketSummary;
  snapshot: BookSnapshot;
  strategy: {
    displayQuantity: string | null;
    estimatedSlices: number | null;
    projectedAveragePrice: string | null;
    projectedSavings: string | null;
  };
  canSubmit: boolean;
  refusalReason: string | null;
}

export interface QuoterHealth {
  enabled: boolean;
  running: boolean;
  lastError: string | null;
  openQuotes: number;
  lastMarketId?: string | null;
  quoterAddress?: Address | null;
}

export interface Health {
  status: string;
  network: string;
  chainId: number;
  executorConfigured: boolean;
  sessionPolicyConfigured: boolean;
  executionRouterConfigured: boolean;
  executorAddress: Address | null;
  sessionPolicyAddress: Address | null;
  executionRouterAddress: Address | null;
  explorerUrl: string;
  reactivityConfigured: boolean;
  reactivityHandlerAddress: Address | null;
  reactivityEmitterAddress: Address | null;
  reactivitySubscriptionId: string | null;
  quoter?: QuoterHealth;
  lastHeartbeatAt: string;
}

export interface ExecutionRequestForUi {
  owner: Address;
  marketId: string;
  symbol: string;
  outcome: Outcome;
  marketName: string;
  marketPool?: Address;
  marketDecimals?: number;
  marketExpiry?: string;
  marketCollateral?: Address;
  marketOutcomeToken?: Address;
  marketYesTokenId?: string;
  marketNoTokenId?: string;
  side: Side;
  quantity: string;
  strategy: StrategyName;
  displayQuantity?: string;
  windowStart?: string;
  windowEnd?: string;
  sessionGrant: SessionGrant;
}

export interface ChildForUi {
  id: string;
  sequence: number;
  requestedQuantity: string;
  filledQuantity: string;
  averagePrice: string | null;
  status: string;
  orderId: string | null;
  transactionHash: Hex | null;
  rejectionReason: string | null;
  placedAt?: string;
  updatedAt?: string;
}

export interface FillForUi {
  id: string;
  quantity: string;
  price: string;
  quote: string;
  transactionHash: Hex;
}

export interface PublicExecution {
  id: string;
  request: Omit<ExecutionRequestForUi, "sessionGrant">;
  snapshot: BookSnapshot;
  state: string;
  children: ChildForUi[];
  fills: FillForUi[];
  metrics: ExecutionMetrics | null;
  completionMidPrice: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  cancelRequested: boolean;
  heartbeatAt: string;
  completedAt: string | null;
  receiptUrl: string | null;
  exitRule: ExitRule | null;
}

/** The three states the trade screen moves through for one order. */
export type TradePhase = "before" | "during" | "after";

/** Signed authorisation details kept in the browser for the current order. */
export interface AuthorisationRecord {
  grant: SessionGrant;
  digest: Hex;
  registrationHash: Hex | null;
}

export const TERMINAL_STATES = ["completed", "partial", "cancelled", "failed"] as const;
export const RESUMABLE_FAILURES = ["authorisation_expired", "venue_rejected", "engine_error"] as const;
