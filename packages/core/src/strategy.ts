import { Decimal } from "decimal.js/decimal";
import { defaultSliceConfig } from "./config.js";
import type { BookSnapshot, ImpactPreview, OrderBook, StrategyName, StrategyPreview, TradeSide } from "./types.js";
import { midPrice, walkBook } from "./book.js";

function fixed(value: Decimal): string {
  return value.toFixed();
}

export function defaultDisplayQuantity(book: Pick<OrderBook, "bids" | "asks">, side: TradeSide, totalQuantity: string): string | null {
  const total = new Decimal(totalQuantity);
  if (!total.isFinite() || total.lte(0)) return null;
  const top = side === "buy" ? book.asks[0]?.quantity : book.bids[0]?.quantity;
  if (top === undefined) return null;
  const topQuantity = new Decimal(top);
  if (topQuantity.lte(0)) return null;
  return fixed(Decimal.min(total, topQuantity));
}

export function buildScaleInSchedule(params: {
  totalQuantity: string;
  windowStart: Date;
  windowEnd: Date;
  tranches: number;
  curvePower?: number;
}): Array<{ sequence: number; quantity: string; startsAt: string }> {
  const total = new Decimal(params.totalQuantity);
  if (!total.isFinite() || total.lte(0)) throw new Error("Scale-in quantity must be positive");
  if (params.tranches < 1 || !Number.isInteger(params.tranches)) throw new Error("Scale-in tranches must be a positive integer");
  const start = params.windowStart.getTime();
  const end = params.windowEnd.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("Scale-in window must end after it starts");

  const power = params.curvePower ?? defaultSliceConfig.scaleInCurvePower;
  if (!Number.isFinite(power) || power <= 0) throw new Error("Scale-in curve power must be positive");
  const trancheSize = total.div(params.tranches);
  const schedule: Array<{ sequence: number; quantity: string; startsAt: string }> = [];
  for (let index = 0; index < params.tranches; index += 1) {
    const normalized = new Decimal(index).div(Math.max(params.tranches - 1, 1));
    const timeWeight = new Decimal(1).sub(new Decimal(1).sub(normalized).pow(power));
    const timestamp = start + (end - start) * timeWeight.toNumber();
    schedule.push({ sequence: index + 1, quantity: fixed(trancheSize), startsAt: new Date(timestamp).toISOString() });
  }
  const allocated = trancheSize.mul(params.tranches);
  const residual = total.sub(allocated);
  if (residual.gt(0)) {
    const last = schedule[schedule.length - 1];
    if (last !== undefined) last.quantity = fixed(new Decimal(last.quantity).add(residual));
  }
  return schedule;
}

export function strategyPreview(params: {
  strategy: StrategyName;
  snapshot: BookSnapshot;
  displayQuantity?: string;
  windowStart?: Date;
  windowEnd?: Date;
}): StrategyPreview {
  const { snapshot } = params;
  const liveTouch = snapshot.side === "buy" ? snapshot.book.asks[0]?.price : snapshot.book.bids[0]?.price;
  const displayQuantity = params.displayQuantity ?? defaultDisplayQuantity(snapshot.book, snapshot.side, snapshot.requestedQuantity);
  if (params.strategy === "scale-in") {
    const windowStart = params.windowStart ?? new Date();
    const windowEnd = params.windowEnd ?? new Date(windowStart.getTime() + defaultSliceConfig.childOrderExpirySeconds * 1000);
    const tranches = displayQuantity === null ? 0 : Math.max(1, new Decimal(snapshot.requestedQuantity).div(displayQuantity).ceil().toNumber());
    const schedule = tranches > 0 ? buildScaleInSchedule({
      totalQuantity: snapshot.requestedQuantity,
      windowStart,
      windowEnd,
      tranches,
    }) : [];
    return {
      strategy: params.strategy,
      displayQuantity,
      estimatedSlices: tranches || null,
      schedule,
      projectedAveragePrice: liveTouch ?? null,
      projectedSavings: liveTouch === undefined || snapshot.naiveWalk.averagePrice === null
        ? null
        : fixed((snapshot.side === "buy"
          ? new Decimal(snapshot.naiveWalk.averagePrice).sub(liveTouch)
          : new Decimal(liveTouch).sub(snapshot.naiveWalk.averagePrice)).mul(snapshot.naiveWalk.filledQuantity)),
      projectionBasis: liveTouch === undefined ? "unavailable" : "live-touch-and-current-depth",
    };
  }

  if (displayQuantity === null || liveTouch === undefined) {
    return {
      strategy: params.strategy,
      displayQuantity,
      estimatedSlices: null,
      schedule: [],
      projectedAveragePrice: null,
      projectedSavings: null,
      projectionBasis: "unavailable",
    };
  }

  const slices = Math.max(1, new Decimal(snapshot.requestedQuantity).div(displayQuantity).ceil().toNumber());
  return {
    strategy: params.strategy,
    displayQuantity,
    estimatedSlices: slices,
    schedule: [{ sequence: 1, quantity: snapshot.requestedQuantity, startsAt: new Date().toISOString() }],
    projectedAveragePrice: liveTouch,
    projectedSavings: snapshot.naiveWalk.averagePrice === null
      ? null
      : fixed((snapshot.side === "buy"
        ? new Decimal(snapshot.naiveWalk.averagePrice).sub(liveTouch)
        : new Decimal(liveTouch).sub(snapshot.naiveWalk.averagePrice)).mul(snapshot.naiveWalk.filledQuantity)),
    projectionBasis: "live-touch-and-current-depth",
  };
}

export function buildIcebergSlices(totalQuantity: string, displayQuantity: string): string[] {
  const total = new Decimal(totalQuantity);
  const display = new Decimal(displayQuantity);
  if (!total.isFinite() || total.lte(0) || !display.isFinite() || display.lte(0)) throw new Error("Iceberg quantities must be positive");
  const slices: string[] = [];
  let remaining = total;
  while (remaining.gt(0)) {
    const next = Decimal.min(remaining, display);
    slices.push(fixed(next));
    remaining = remaining.sub(next);
  }
  return slices;
}

export function previewImpact(snapshot: BookSnapshot, strategy: StrategyName, displayQuantity?: string, windowStart?: Date, windowEnd?: Date): ImpactPreview {
  const projected = strategyPreview(displayQuantity === undefined
    ? { snapshot, strategy, ...(windowStart === undefined ? {} : { windowStart }), ...(windowEnd === undefined ? {} : { windowEnd }) }
    : { snapshot, strategy, displayQuantity, ...(windowStart === undefined ? {} : { windowStart }), ...(windowEnd === undefined ? {} : { windowEnd }) });
  const refusal = snapshot.naiveWalk.depthExhausted
    ? `Book holds ${snapshot.naiveWalk.filledQuantity} at current levels. Reduce size or widen your limit.`
    : null;
  return {
    marketId: snapshot.marketId,
    symbol: snapshot.symbol,
    side: snapshot.side,
    quantity: snapshot.requestedQuantity,
    snapshot,
    strategy: projected,
    canSubmit: refusal === null,
    refusalReason: refusal,
  };
}

export function currentMid(book: Pick<OrderBook, "bids" | "asks">): string | null {
  return midPrice(book);
}

export function previewNaive(book: Pick<OrderBook, "bids" | "asks">, side: TradeSide, quantity: string) {
  return walkBook(book, side, quantity);
}
