import { strategyLabel } from "../../lib/format.js";
import type { Health, MarketSummary, PublicExecution } from "../../lib/types.js";
import { OrderBook } from "../market/OrderBook.js";
import { SnapshotBook } from "../market/SnapshotBook.js";
import { EngineConsole } from "./EngineConsole.js";
import { ExecutionProgress } from "./ExecutionProgress.js";
import { ExecutionTape } from "./ExecutionTape.js";
import { Heartbeat } from "./Heartbeat.js";

interface WorkingOrderProps {
  execution: PublicExecution;
  health: Health | null;
  market: MarketSummary | null;
  onCancel: () => void;
}

/** The live execution console while children are being worked. */
export function WorkingOrder({ execution, health, market, onCancel }: WorkingOrderProps) {
  const filled = execution.metrics?.filledQuantity ?? execution.fills.reduce((sum, fill) => sum + Number(fill.quantity), 0);
  const reconnecting = execution.state === "reconnecting" || execution.state === "paused";
  return (
    <main className="during-state">
      <div className="state-heading">
        <div>
          <p className="section-kicker">Working order</p>
          <h1>{execution.request.marketName}</h1>
          <p>{execution.request.quantity} contracts · {execution.request.outcome} · {execution.request.side} · {strategyLabel(execution.request.strategy)}</p>
        </div>
        <Heartbeat execution={execution} />
      </div>

      {reconnecting && (
        <p className="reconnect-banner" role="status">Reconnecting — {filled} of {execution.request.quantity} filled, nothing at risk</p>
      )}
      {execution.failureMessage && !reconnecting && <p className="error-banner" role="alert">{execution.failureMessage}</p>}

      <ExecutionProgress execution={execution} />

      <div className="working-grid">
        <section className="child-panel">
          <div className="panel-heading">
            <div>
              <span className="section-kicker">Execution tape</span>
              <h2>Child orders</h2>
            </div>
            <span className="state-pill">{execution.state}</span>
          </div>
          <ExecutionTape orders={execution.children} explorerUrl={health?.explorerUrl} />
          {execution.cancelRequested
            ? <p className="inline-note">Cancel requested. The engine will settle the filled portion from chain state.</p>
            : <button className="secondary-button" onClick={onCancel}>Cancel execution</button>}
          <EngineConsole execution={execution} />
        </section>
        {market
          ? <OrderBook market={market} outcome={execution.request.outcome} compact />
          : <SnapshotBook snapshot={execution.snapshot} />}
      </div>
    </main>
  );
}
