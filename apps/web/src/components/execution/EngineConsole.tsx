import { useMemo, useState } from "react";
import { cents, clockTime, shortAddress } from "../../lib/format.js";
import type { PublicExecution } from "../../lib/types.js";

type LogChannel = "execution" | "chain" | "reactivity";
type LogFilter = "all" | LogChannel;

interface LogEntry {
  at: string | undefined;
  channel: LogChannel;
  message: string;
  detail: string;
}

const FILTERS: LogFilter[] = ["all", "execution", "chain", "reactivity"];

/** A compact trace of what the engine did, built from the execution record itself. */
export function EngineConsole({ execution }: { execution: PublicExecution }) {
  const [filter, setFilter] = useState<LogFilter>("all");
  const entries = useMemo(() => buildLog(execution), [execution]);
  const visible = filter === "all" ? entries : entries.filter((entry) => entry.channel === filter);
  return (
    <details className="engine-log">
      <summary>Engine log</summary>
      <div className="filter-tabs log-tabs" role="group" aria-label="Log filter">
        {FILTERS.map((item) => (
          <button key={item} className={filter === item ? "active" : ""} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>
        ))}
      </div>
      <ol>
        {visible.map((entry, index) => (
          <li key={index}>
            <time>{clockTime(entry.at)}</time>
            <span>{entry.message}</span>
            <code>{entry.detail}</code>
          </li>
        ))}
        {visible.length === 0 && <li><time>—</time><span>nothing on this channel yet</span><code /></li>}
      </ol>
    </details>
  );
}

function buildLog(execution: PublicExecution): LogEntry[] {
  const log: LogEntry[] = [{
    at: execution.snapshot.capturedAt,
    channel: "execution",
    message: "snapshot captured",
    detail: `block ${execution.snapshot.blockNumber}`,
  }];
  for (const child of execution.children) {
    log.push({
      at: child.placedAt ?? child.updatedAt,
      channel: "execution",
      message: `child #${child.sequence} ${child.status}`,
      detail: child.filledQuantity !== "0" && child.averagePrice ? `${child.filledQuantity} @ ${cents(child.averagePrice)}` : `${child.requestedQuantity} requested`,
    });
    if (child.transactionHash) {
      log.push({ at: child.updatedAt, channel: "chain", message: `child #${child.sequence} confirmed`, detail: `tx ${shortAddress(child.transactionHash)}` });
    }
    if (child.rejectionReason) {
      log.push({ at: child.updatedAt, channel: "chain", message: `child #${child.sequence} rejected`, detail: child.rejectionReason });
    }
  }
  if (execution.exitRule) {
    log.push({
      at: execution.completedAt ?? undefined,
      channel: "reactivity",
      message: `exit rule ${execution.exitRule.status}`,
      detail: `tx ${shortAddress(execution.exitRule.transactionHash)}`,
    });
  }
  if (execution.completedAt) {
    log.push({ at: execution.completedAt, channel: "execution", message: `execution ${execution.state}`, detail: execution.metrics ? `${execution.metrics.filledQuantity} filled` : "" });
  }
  return log;
}
