import type { Receipt } from "@slice/core";
import { receiptUrl } from "../../lib/api.js";
import { cents, dollars } from "../../lib/format.js";

/** A real execution, not a testimonial. Rendered only when a reconciled receipt exists. */
export function VerifiedReceiptShowcase({ receipt }: { receipt: Receipt }) {
  return (
    <section className="receipt-showcase">
      <div>
        <span className="terminal-label">A real execution</span>
        <h2>{receipt.marketName}</h2>
        <p>{receipt.metrics.filledQuantity} contracts · {receipt.childOrders.length} child orders · {receipt.status} · snapshot block {receipt.snapshot.blockNumber}</p>
      </div>
      <div><span>Naive average</span><strong>{cents(receipt.metrics.naiveAveragePrice)}</strong></div>
      <div><span>Slice average</span><strong>{cents(receipt.metrics.actualAveragePrice)}</strong></div>
      <div className="showcase-saving"><span>Net savings</span><strong>{dollars(receipt.metrics.netSavings ?? receipt.metrics.rawSavings)}</strong></div>
      <a className="secondary-button link-button" href={receiptUrl(receipt)} target="_blank" rel="noreferrer">Inspect receipt ↗</a>
    </section>
  );
}
