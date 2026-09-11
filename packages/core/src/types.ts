export type TradeSide = "buy" | "sell";

export type StrategyName = "iceberg" | "scale-in";

export type ExecutionState =
  | "preview"
  | "awaiting_authorization"
  | "running"
  | "reconnecting"
  | "paused"
  | "completed"
  | "partial"
  | "cancelled"
  | "failed";

export interface BookLevel {
  price: string;
  quantity: string;
}

export interface OrderBook {
  bids: BookLevel[];
  asks: BookLevel[];
  capturedAt: string;
  blockNumber: string;
  source: "dreamdex-live";
}

export interface WalkFill {
  price: string;
  quantity: string;
  quote: string;
}

export interface BookWalk {
  requestedQuantity: string;
  filledQuantity: string;
  quote: string;
  averagePrice: string | null;
  levels: WalkFill[];
  depthExhausted: boolean;
}

export interface BookSnapshot {
  id: string;
  marketId: string;
  symbol: string;
  side: TradeSide;
  requestedQuantity: string;
  capturedAt: string;
  blockNumber: string;
  book: OrderBook;
  naiveWalk: BookWalk;
  submissionMidPrice: string | null;
}

export interface ChildOrder {
  id: string;
  executionId: string;
  sequence: number;
  requestedQuantity: string;
  filledQuantity: string;
  averagePrice: string | null;
  status: "planned" | "submitted" | "open" | "filled" | "partial" | "cancelled" | "rejected" | "expired";
  orderId: string | null;
  transactionHash: string | null;
  placedAt: string | null;
  updatedAt: string;
  rejectionReason: string | null;
}

export interface Fill {
  id: string;
  childOrderId: string;
  transactionHash: string;
  blockNumber: string;
  logIndex: number;
  orderId: string;
  quantity: string;
  price: string;
  quote: string;
  side: TradeSide;
  observedAt: string;
}

export interface ExecutionMetrics {
  requestedQuantity: string;
  filledQuantity: string;
  naiveAveragePrice: string | null;
  actualAveragePrice: string | null;
  rawSavings: string | null;
  submissionMidPrice: string | null;
  completionMidPrice: string | null;
  midPriceMove: string | null;
  driftAdjustment: string | null;
  netSavings: string | null;
  depthExhaustedAtPreview: boolean;
}

export interface Receipt {
  id: string;
  executionId: string;
  marketId: string;
  marketName: string;
  symbol: string;
  side: TradeSide;
  strategy: StrategyName;
  status: "completed" | "partial" | "cancelled";
  createdAt: string;
  completedAt: string;
  snapshot: BookSnapshot;
  childOrders: ChildOrder[];
  fills: Fill[];
  metrics: ExecutionMetrics;
  exitRule: ExitRule | null;
}

export type ExitRuleKind = "take-profit" | "stop-loss" | "book-thins";

export interface ExitRule {
  id: string;
  marketId: string;
  owner: `0x${string}`;
  kind: ExitRuleKind;
  triggerPrice: string | null;
  minimumBestLevelQuantity: string | null;
  side: TradeSide;
  quantity: string;
  handlerAddress: `0x${string}`;
  subscriptionId: string;
  transactionHash: string;
  status: "active" | "triggered" | "cancelled";
}

export interface ExecutionRequest {
  owner: `0x${string}`;
  marketId: string;
  symbol: string;
  outcome: "YES" | "NO";
  marketName: string;
  marketPool?: `0x${string}`;
  marketDecimals?: number;
  marketExpiry?: string;
  marketCollateral?: `0x${string}`;
  marketOutcomeToken?: `0x${string}`;
  marketYesTokenId?: string;
  marketNoTokenId?: string;
  side: TradeSide;
  quantity: string;
  strategy: StrategyName;
  displayQuantity?: string;
  windowStart?: string;
  windowEnd?: string;
  sessionGrant: SessionGrant;
}

export interface SessionGrant {
  grantId: string;
  owner: `0x${string}`;
  executor: `0x${string}`;
  marketId: string;
  outcome: "YES" | "NO";
  side: TradeSide;
  maxContracts: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  signature: `0x${string}`;
}

export interface StrategyPreview {
  strategy: StrategyName;
  displayQuantity: string | null;
  estimatedSlices: number | null;
  schedule: Array<{ sequence: number; quantity: string; startsAt: string }>;
  projectedAveragePrice: string | null;
  projectedSavings: string | null;
  projectionBasis: "live-touch-and-current-depth" | "schedule-not-started" | "unavailable";
}

export interface ImpactPreview {
  marketId: string;
  symbol: string;
  side: TradeSide;
  quantity: string;
  snapshot: BookSnapshot;
  strategy: StrategyPreview;
  canSubmit: boolean;
  refusalReason: string | null;
}
