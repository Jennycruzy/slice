import { clockTime } from "../../lib/format.js";
import type { PublicExecution } from "../../lib/types.js";

const STALE_AFTER_MS = 30_000;

export function Heartbeat({ execution }: { execution: PublicExecution }) {
  const age = Date.now() - Date.parse(execution.heartbeatAt);
  const healthy = Number.isFinite(age) && age < STALE_AFTER_MS && !["reconnecting", "paused"].includes(execution.state);
  const label = healthy ? "Engine live" : execution.state === "reconnecting" ? "Reconnecting" : "Engine needs attention";
  return (
    <div className={`heartbeat ${healthy ? "healthy" : "unhealthy"}`} role="status">
      <span aria-hidden="true" />
      {label}
      <small>beat {clockTime(execution.heartbeatAt)}</small>
    </div>
  );
}
