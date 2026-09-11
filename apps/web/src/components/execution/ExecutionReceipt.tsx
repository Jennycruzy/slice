import type { SessionGrant } from "@slice/core";
import { strategyLabel, triggerLabel } from "../../lib/format.js";
import { RESUMABLE_FAILURES, type AuthorisationRecord, type Health, type PublicExecution } from "../../lib/types.js";
import { SnapshotBook } from "../market/SnapshotBook.js";
import { DataBadge } from "../ui/DataBadge.js";
import { ExplorerLink } from "../ui/ExplorerLink.js";
import { GrantScope } from "../wallet/GrantScope.js";
import { ChildTransactions } from "./ChildTransactions.js";
import { EngineConsole } from "./EngineConsole.js";
import { ExitRulePanel } from "./ExitRulePanel.js";
import { ReceiptMetrics } from "./ReceiptMetrics.js";

interface ExecutionReceiptProps {
  execution: PublicExecution;
  authorisation: AuthorisationRecord | null;
  health: Health | null;
  onRevoke: () => void;
  revokePending: boolean;
  onExitRule: (execution: PublicExecution) => void;
  onResume: () => void;
  resumePending: boolean;
  onNewExecution: () => void;
}

/** The flagship screen: verified savings, every child transaction, the frozen snapshot, and the exact authorisation. */
export function ExecutionReceipt(props: ExecutionReceiptProps) {
  const { execution, authorisation, health, onRevoke, revokePending, onExitRule, onResume, resumePending, onNewExecution } = props;
  const metrics = execution.metrics;
  const finished = execution.state === "completed" || execution.state === "cancelled";
  const canResume = (RESUMABLE_FAILURES as readonly string[]).includes(execution.failureCode ?? "") && !finished;
  const verified = execution.children.some((child) => child.transactionHash !== null);

  return (
    <main className="after-state">
      <div className="receipt-heading">
        <div>
          <p className="section-kicker">Execution receipt · {execution.state}</p>
          <h1>{execution.request.marketName}</h1>
          <p>{metrics?.filledQuantity ?? "0"} contracts · {execution.request.outcome} · {strategyLabel(execution.request.strategy)}</p>
        </div>
        <div className="receipt-actions">
          <DataBadge kind={verified ? "VERIFIED" : "SNAPSHOT"} detail={`block ${execution.snapshot.blockNumber}`} />
          {execution.receiptUrl && (
            <a className="secondary-button link-button" href={execution.receiptUrl} target="_blank" rel="noreferrer">Open public receipt</a>
          )}
          <button className="secondary-button" onClick={onNewExecution}>New execution</button>
        </div>
      </div>

      {execution.failureMessage && <p className="error-banner" role="alert">{execution.failureMessage}</p>}
      {canResume && (
        <button className="secondary-button" disabled={resumePending} onClick={onResume}>
          {resumePending ? "Waiting for authorisation…" : "Re-authorise and resume"}
        </button>
      )}

      <section className="receipt-panel">
        <ReceiptMetrics metrics={metrics} state={execution.state} />
        <SnapshotBook snapshot={execution.snapshot} />
      </section>

      <section className="child-panel receipt-children">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">Evidence</span>
            <h2>Child-order transactions</h2>
          </div>
        </div>
        <ChildTransactions orders={execution.children} explorerUrl={health?.explorerUrl} />
        <EngineConsole execution={execution} />
      </section>

      <ExitRulePanel execution={execution} health={health} onRegistered={onExitRule} />

      {execution.exitRule && (
        <section className="grant-panel">
          <div>
            <span className="section-kicker">On-chain reactivity</span>
            <h2>{triggerLabel(execution.exitRule.kind)}{execution.exitRule.triggerPrice ? ` at ${execution.exitRule.triggerPrice}¢` : ""}</h2>
          </div>
          <p>
            Somnia Reactivity · <strong className="grant-status grant-active">{execution.exitRule.status.toUpperCase()}</strong> · {execution.exitRule.quantity} contracts · closes with a {execution.exitRule.side} order
          </p>
          <p className="inline-note">
            Can execute even if the Slice API is offline. Rule transaction: <ExplorerLink explorerUrl={health?.explorerUrl} hash={execution.exitRule.transactionHash} />
          </p>
        </section>
      )}

      {authorisation && health?.sessionPolicyAddress && (
        <AuthorisationPanel grant={authorisation.grant} registrationHash={authorisation.registrationHash} execution={execution} health={health} onRevoke={onRevoke} revokePending={revokePending} />
      )}
    </main>
  );
}

interface AuthorisationPanelProps {
  grant: SessionGrant;
  registrationHash: `0x${string}` | null;
  execution: PublicExecution;
  health: Health;
  onRevoke: () => void;
  revokePending: boolean;
}

function AuthorisationPanel({ grant, registrationHash, execution, health, onRevoke, revokePending }: AuthorisationPanelProps) {
  return (
    <section className="grant-panel">
      <div>
        <span className="section-kicker">Authorisation</span>
        <h2>Session scope</h2>
      </div>
      <GrantScope grant={grant} marketName={execution.request.marketName} decimals={execution.request.marketDecimals ?? 6} />
      {registrationHash && (
        <p className="inline-note">Registered on-chain: <ExplorerLink explorerUrl={health.explorerUrl} hash={registrationHash} /></p>
      )}
      <button className="secondary-button" disabled={revokePending} onClick={onRevoke}>
        {revokePending ? "Revoking…" : "Revoke on-chain authorisation"}
      </button>
    </section>
  );
}
