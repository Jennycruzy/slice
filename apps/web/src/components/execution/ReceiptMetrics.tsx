import type { ExecutionMetrics } from "@slice/core";
import { cents, dollars } from "../../lib/format.js";

interface ReceiptMetricsProps {
  metrics: ExecutionMetrics | null;
  state: string;
}

export function ReceiptMetrics({ metrics, state }: ReceiptMetricsProps) {
  const filled = metrics?.filledQuantity ?? "0";
  return (
    <>
      <div className="saving-block">
        <span>Saved vs naive sweep, net of observed drift</span>
        <strong>{dollars(metrics?.netSavings ?? metrics?.rawSavings ?? null)}</strong>
      </div>
      <div className="comparison-grid">
        <div>
          <span>Naive market order would have cost</span>
          <strong>{cents(metrics?.naiveAveragePrice ?? null)}</strong>
          <small>{filled} contracts at the submission snapshot</small>
        </div>
        <div>
          <span>Slice filled at</span>
          <strong>{cents(metrics?.actualAveragePrice ?? null)}</strong>
          <small>{filled} contracts across real fills</small>
        </div>
      </div>
      <dl className="receipt-facts">
        <div><dt>Raw savings</dt><dd>{dollars(metrics?.rawSavings ?? null)}</dd></div>
        <div><dt>Mid-price move</dt><dd>{cents(metrics?.midPriceMove ?? null)}</dd></div>
        <div><dt>Drift adjustment</dt><dd>{dollars(metrics?.driftAdjustment ?? null)}</dd></div>
        <div><dt>Receipt status</dt><dd>{state}</dd></div>
      </dl>
    </>
  );
}
