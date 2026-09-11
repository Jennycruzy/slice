import { cents, trimZeros } from "../../lib/format.js";
import type { PublicExecution } from "../../lib/types.js";
import { Metric } from "../ui/Metric.js";

/** Filled, remaining, children, and average price — all from reconciled fills, never from a local counter. */
export function ExecutionProgress({ execution }: { execution: PublicExecution }) {
  const liveFilled = execution.fills.reduce((sum, fill) => sum + Number(fill.quantity), 0);
  const requested = Number(execution.request.quantity);
  const filled = execution.metrics?.filledQuantity ?? (Number.isFinite(liveFilled) ? String(liveFilled) : "0");
  const remaining = Math.max(0, requested - Number(filled));
  const weightedQuote = execution.fills.reduce((sum, fill) => sum + Number(fill.price) * Number(fill.quantity), 0);
  const averageFill = liveFilled > 0 ? weightedQuote / liveFilled : null;
  const confirmedChildren = execution.children.filter((child) => child.status === "filled" || child.status === "partial").length;
  return (
    <div className="progress-grid">
      <Metric className="progress-number" label="Filled" value={filled} note="contracts" />
      <Metric className="progress-number" label="Remaining" value={trimZeros(remaining)} note="contracts" />
      <Metric className="progress-number" label="Children" value={`${confirmedChildren} / ${execution.children.length}`} note="confirmed / attempts" />
      <Metric className="progress-number" label="Average fill" value={averageFill === null ? "—" : cents(String(averageFill))} note="verified fills" />
    </div>
  );
}
