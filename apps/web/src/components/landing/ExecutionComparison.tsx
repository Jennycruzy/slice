import type { Receipt } from "@slice/core";
import { cents, dollars } from "../../lib/format.js";
import { Skeleton } from "../ui/Skeleton.js";

interface ExecutionComparisonProps {
  receipt: Receipt | null;
  loading: boolean;
}

const SHOWN_LEVELS = 5;
const MINIMUM_BAR_PERCENT = 8;

/** The product in one picture: a sweep on the left, the same size worked as children on the right, from a real receipt. */
export function ExecutionComparison({ receipt, loading }: ExecutionComparisonProps) {
  const levels = receipt?.snapshot.naiveWalk.levels ?? [];
  const maximum = Math.max(1, ...levels.map((level) => Number(level.quantity)));
  const title = loading ? "LOADING VERIFIED EXECUTION" : receipt ? "VERIFIED EXECUTION" : "WAITING FOR VERIFIED EXECUTION";
  return (
    <div className="hero-comparison" aria-label="Verified execution comparison">
      <div className="comparison-title">
        <span>{title}</span>
        <strong>{loading ? <Skeleton width="60%" height="15px" /> : receipt?.marketName ?? "Live receipts appear here"}</strong>
      </div>
      <div className="comparison-columns">
        <div>
          <span>Naive sweep</span>
          <strong>{loading ? <Skeleton width="90px" height="30px" /> : cents(receipt?.metrics.naiveAveragePrice ?? null)}</strong>
          <div className="sweep-levels">
            {levels.slice(0, SHOWN_LEVELS).map((level, index) => (
              <div key={`${level.price}-${index}`}>
                <b>{cents(level.price)}</b>
                <i style={{ width: `${Math.max(MINIMUM_BAR_PERCENT, Number(level.quantity) / maximum * 100)}%` }} aria-hidden="true" />
              </div>
            ))}
          </div>
        </div>
        <div>
          <span>Slice execution</span>
          <strong>{loading ? <Skeleton width="90px" height="30px" /> : cents(receipt?.metrics.actualAveragePrice ?? null)}</strong>
          <ol>
            {receipt?.childOrders.slice(0, SHOWN_LEVELS).map((child) => (
              <li key={child.id}>
                <span>child {String(child.sequence).padStart(2, "0")}</span>
                <b>{cents(child.averagePrice)}</b>
                <em>{child.status}</em>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="hero-saving">
        <span>Verified net savings</span>
        <strong>{loading ? <Skeleton width="140px" height="44px" /> : dollars(receipt?.metrics.netSavings ?? receipt?.metrics.rawSavings ?? null)}</strong>
        <small>{receipt ? `${receipt.metrics.filledQuantity} contracts · ${receipt.childOrders.length} child transactions` : "No placeholder metrics"}</small>
      </div>
    </div>
  );
}
