import { cents, contracts, dollars } from "../../lib/format.js";
import type { ImpactPreview } from "../../lib/types.js";
import { DataBadge } from "../ui/DataBadge.js";
import { ImpactVisualization } from "./ImpactVisualization.js";

interface ExecutionEdgeProps {
  preview: ImpactPreview;
}

/** The product in one card: what a market sweep would cost against what the Slice plan projects. */
export function ExecutionEdge({ preview }: ExecutionEdgeProps) {
  const naive = preview.snapshot.naiveWalk.averagePrice;
  const projected = preview.strategy.projectedAveragePrice;
  const naiveNumber = naive === null ? null : Number(naive);
  const projectedNumber = projected === null ? null : Number(projected);
  const improvement = naiveNumber === null || projectedNumber === null
    ? null
    : preview.snapshot.side === "buy" ? naiveNumber - projectedNumber : projectedNumber - naiveNumber;
  const basisPoints = improvement === null || naiveNumber === null || naiveNumber === 0 ? null : improvement / naiveNumber * 10_000;
  const relevantDepth = preview.snapshot.side === "buy" ? preview.snapshot.book.asks : preview.snapshot.book.bids;
  const availableDepth = relevantDepth.reduce((sum, level) => sum + Number(level.quantity), 0);
  const walkLevels = preview.snapshot.naiveWalk.levels;

  if (!preview.canSubmit) {
    return (
      <section className="execution-edge is-refused" aria-live="polite">
        <div className="edge-heading">
          <div>
            <span className="terminal-label">Execution refused</span>
            <h2>Live depth cannot safely support this order</h2>
          </div>
          <DataBadge kind="SNAPSHOT" detail={`block ${preview.snapshot.blockNumber}`} />
        </div>
        <div className="refusal-panel">
          <strong>{preview.refusalReason}</strong>
          <span>Requested {preview.snapshot.requestedQuantity} contracts · available {preview.snapshot.naiveWalk.filledQuantity}</span>
          <p>Reduce size or choose another live market. Slice does not extrapolate beyond resting orders.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="execution-edge" aria-live="polite">
      <div className="edge-heading">
        <div>
          <span className="terminal-label">Projected execution edge</span>
          <h2>Naive sweep vs. Slice plan</h2>
        </div>
        <DataBadge kind="PROJECTED" detail={`block ${preview.snapshot.blockNumber}`} />
      </div>

      <div className="edge-comparison">
        <div><span>Naive market sweep</span><strong>{cents(naive)}</strong></div>
        <div className="edge-arrow" aria-hidden="true">→</div>
        <div><span>Slice plan</span><strong>{cents(projected)}</strong></div>
        <div className="edge-saving">
          <span>Estimated cost avoided</span>
          <strong>{dollars(preview.strategy.projectedSavings)}</strong>
          <small>{basisPoints === null ? "—" : `${basisPoints.toFixed(1)} bps improvement`}</small>
        </div>
      </div>

      <div className="edge-detail-grid">
        <ImpactVisualization levels={walkLevels} estimatedSlices={preview.strategy.estimatedSlices} displayQuantity={preview.strategy.displayQuantity} />
        <dl className="plan-metrics">
          <div><dt>Estimated children</dt><dd>{preview.strategy.estimatedSlices ?? "—"}</dd></div>
          <div><dt>Visible slice</dt><dd>{preview.strategy.displayQuantity ?? "Live depth"}</dd></div>
          <div><dt>Book levels crossed</dt><dd>{walkLevels.length}</dd></div>
          <div><dt>Available depth</dt><dd>{contracts(availableDepth, preview.market.decimals)}</dd></div>
        </dl>
      </div>

      <p className="projection-note">
        Projection uses the live submission book. Realised receipt figures come only from confirmed child-order fills.
      </p>
    </section>
  );
}
