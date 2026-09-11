import type { WalkFill } from "@slice/core";
import { cents } from "../../lib/format.js";

interface ImpactVisualizationProps {
  levels: WalkFill[];
  estimatedSlices: number | null;
  displayQuantity: string | null;
}

const MINIMUM_BAR_PERCENT = 5;
const MAXIMUM_CHILD_BARS = 8;

/** Left: the levels a single sweep would consume. Right: the same size as evenly worked child orders. */
export function ImpactVisualization({ levels, estimatedSlices, displayQuantity }: ImpactVisualizationProps) {
  const maximumWalk = Math.max(1, ...levels.map((level) => Number(level.quantity)));
  const childCount = estimatedSlices ?? 0;
  // Only the engine's own visible-slice figure is drawn; nothing is inferred from the requested size.
  const childSize = displayQuantity !== null ? Number(displayQuantity) : null;
  const shownChildren = Math.min(childCount, MAXIMUM_CHILD_BARS);
  const childPercent = childSize === null ? 0 : Math.max(MINIMUM_BAR_PERCENT, childSize / maximumWalk * 100);

  return (
    <div className="impact-visual">
      <div className="impact-walk">
        <span>Naive book consumption</span>
        {levels.map((level, index) => (
          <div className="impact-level" key={`${level.price}-${index}`}>
            <b>{cents(level.price)}</b>
            <i style={{ width: `${Math.max(MINIMUM_BAR_PERCENT, Number(level.quantity) / maximumWalk * 100)}%` }} aria-hidden="true" />
            <em>{level.quantity}</em>
          </div>
        ))}
      </div>
      <div className="impact-walk impact-plan">
        <span>Slice plan</span>
        {childCount === 0 || childSize === null ? (
          <p className="inline-note">Child sizing is derived from live depth once the order starts.</p>
        ) : (
          <>
            {Array.from({ length: shownChildren }, (_, index) => (
              <div className="impact-level" key={index}>
                <b>child {String(index + 1).padStart(2, "0")}</b>
                <i className="plan-bar" style={{ width: `${Math.min(100, childPercent)}%` }} aria-hidden="true" />
                <em>{childSize.toLocaleString(undefined, { maximumFractionDigits: 4 })}</em>
              </div>
            ))}
            {childCount > shownChildren && <p className="inline-note">… {childCount - shownChildren} more children</p>}
          </>
        )}
      </div>
    </div>
  );
}
