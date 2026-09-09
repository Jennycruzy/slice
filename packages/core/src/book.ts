import { Decimal } from "decimal.js/decimal";
import type { BookLevel, BookSnapshot, BookWalk, Fill, OrderBook, TradeSide } from "./types.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_DOWN });

function decimalString(value: Decimal): string {
  return value.toFixed();
}

function parseLevel(value: unknown, side: "bid" | "ask", index: number): BookLevel {
  let price: unknown;
  let quantity: unknown;

  if (Array.isArray(value)) {
    [price, quantity] = value;
  } else if (typeof value === "object" && value !== null) {
    const row = value as Record<string, unknown>;
    price = row.price ?? row.rate ?? row["0"];
    quantity = row.quantity ?? row.amount ?? row.size ?? row["1"];
  }

  if ((typeof price !== "string" && typeof price !== "number") || (typeof quantity !== "string" && typeof quantity !== "number")) {
    throw new Error(`DreamDEX returned an invalid ${side} level at index ${index}`);
  }

  const parsedPrice = new Decimal(String(price));
  const parsedQuantity = new Decimal(String(quantity));
  if (!parsedPrice.isFinite() || !parsedQuantity.isFinite() || parsedPrice.isNegative() || parsedQuantity.isNegative()) {
    throw new Error(`DreamDEX returned a non-positive ${side} level at index ${index}`);
  }

  return { price: decimalString(parsedPrice), quantity: decimalString(parsedQuantity) };
}

export function normalizeOrderBook(raw: unknown, capturedAt: string, blockNumber: bigint | number | string): OrderBook {
  if (typeof raw !== "object" || raw === null) throw new Error("DreamDEX returned no order book");
  const source = raw as Record<string, unknown>;
  const rawBids = source.bids;
  const rawAsks = source.asks;
  if (!Array.isArray(rawBids) || !Array.isArray(rawAsks)) throw new Error("DreamDEX order book has no bid or ask levels");

  const bids = rawBids.map((level, index) => parseLevel(level, "bid", index)).sort((left, right) => new Decimal(right.price).cmp(left.price));
  const asks = rawAsks.map((level, index) => parseLevel(level, "ask", index)).sort((left, right) => new Decimal(left.price).cmp(right.price));

  return {
    bids,
    asks,
    capturedAt,
    blockNumber: String(blockNumber),
    source: "dreamdex-live",
  };
}

export function walkBook(book: Pick<OrderBook, "bids" | "asks">, side: TradeSide, requestedQuantity: string): BookWalk {
  const requested = new Decimal(requestedQuantity);
  if (!requested.isFinite() || requested.lte(0)) throw new Error("Requested quantity must be positive");

  const levels = side === "buy" ? book.asks : book.bids;
  let remaining = requested;
  let quote = new Decimal(0);
  const walked: BookWalk["levels"] = [];

  for (const level of levels) {
    if (remaining.lte(0)) break;
    const available = new Decimal(level.quantity);
    if (available.lte(0)) continue;
    const quantity = Decimal.min(remaining, available);
    const levelQuote = quantity.mul(level.price);
    walked.push({ price: level.price, quantity: decimalString(quantity), quote: decimalString(levelQuote) });
    remaining = remaining.sub(quantity);
    quote = quote.add(levelQuote);
  }

  const filled = requested.sub(remaining);
  return {
    requestedQuantity: decimalString(requested),
    filledQuantity: decimalString(filled),
    quote: decimalString(quote),
    averagePrice: filled.gt(0) ? decimalString(quote.div(filled)) : null,
    levels: walked,
    depthExhausted: remaining.gt(0),
  };
}

export function midPrice(book: Pick<OrderBook, "bids" | "asks">): string | null {
  const bid = book.bids[0]?.price;
  const ask = book.asks[0]?.price;
  if (bid === undefined || ask === undefined) return null;
  return decimalString(new Decimal(bid).add(ask).div(2));
}

export function createSnapshot(params: {
  id: string;
  marketId: string;
  symbol: string;
  side: TradeSide;
  requestedQuantity: string;
  book: OrderBook;
}): BookSnapshot {
  return {
    ...params,
    capturedAt: params.book.capturedAt,
    blockNumber: params.book.blockNumber,
    naiveWalk: walkBook(params.book, params.side, params.requestedQuantity),
    submissionMidPrice: midPrice(params.book),
  };
}

export function fillsAverage(fills: Pick<Fill, "quantity" | "price">[]): { quantity: string; quote: string; averagePrice: string | null } {
  let quantity = new Decimal(0);
  let quote = new Decimal(0);
  for (const fill of fills) {
    const fillQuantity = new Decimal(fill.quantity);
    quantity = quantity.add(fillQuantity);
    quote = quote.add(fillQuantity.mul(fill.price));
  }
  return {
    quantity: decimalString(quantity),
    quote: decimalString(quote),
    averagePrice: quantity.gt(0) ? decimalString(quote.div(quantity)) : null,
  };
}

export function executionMetrics(params: {
  snapshot: BookSnapshot;
  fills: Pick<Fill, "quantity" | "price">[];
  completionMidPrice: string | null;
}): {
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
} {
  const actual = fillsAverage(params.fills);
  if (actual.averagePrice === null || new Decimal(actual.quantity).lte(0)) {
    return {
      requestedQuantity: params.snapshot.requestedQuantity,
      filledQuantity: actual.quantity,
      naiveAveragePrice: null,
      actualAveragePrice: null,
      rawSavings: null,
      submissionMidPrice: params.snapshot.submissionMidPrice,
      completionMidPrice: params.completionMidPrice,
      midPriceMove: null,
      driftAdjustment: null,
      netSavings: null,
      depthExhaustedAtPreview: params.snapshot.naiveWalk.depthExhausted,
    };
  }

  const comparableNaive = walkBook(params.snapshot.book, params.snapshot.side, actual.quantity);
  if (comparableNaive.averagePrice === null) throw new Error("Snapshot cannot price the filled quantity");
  const filled = new Decimal(actual.quantity);
  const raw = params.snapshot.side === "buy"
    ? new Decimal(comparableNaive.quote).sub(actual.quote)
    : new Decimal(actual.quote).sub(comparableNaive.quote);
  const midMove = params.snapshot.submissionMidPrice !== null && params.completionMidPrice !== null
    ? new Decimal(params.completionMidPrice).sub(params.snapshot.submissionMidPrice)
    : null;
  const drift = midMove === null ? null : (params.snapshot.side === "buy" ? midMove.mul(filled) : midMove.neg().mul(filled));
  const net = drift === null ? null : raw.add(drift);

  return {
    requestedQuantity: params.snapshot.requestedQuantity,
    filledQuantity: actual.quantity,
    naiveAveragePrice: comparableNaive.averagePrice,
    actualAveragePrice: actual.averagePrice,
    rawSavings: decimalString(raw),
    submissionMidPrice: params.snapshot.submissionMidPrice,
    completionMidPrice: params.completionMidPrice,
    midPriceMove: midMove === null ? null : decimalString(midMove),
    driftAdjustment: drift === null ? null : decimalString(drift),
    netSavings: net === null ? null : decimalString(net),
    depthExhaustedAtPreview: params.snapshot.naiveWalk.depthExhausted,
  };
}
