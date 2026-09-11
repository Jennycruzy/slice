import { ArchitectureDiagram } from "../components/proof/ArchitectureDiagram.js";
import { DeploymentCard } from "../components/proof/DeploymentCard.js";
import { SystemStatus } from "../components/proof/SystemStatus.js";
import type { Health, MarketSummary } from "../lib/types.js";

interface ProofViewProps {
  health: Health | null;
  loading: boolean;
  markets: MarketSummary[];
}

const DEFAULT_EXPLORER = "https://shannon-explorer.somnia.network";

export function ProofView({ health, loading, markets }: ProofViewProps) {
  const explorer = health?.explorerUrl ?? DEFAULT_EXPLORER;
  return (
    <main className="page-view proof-view">
      <div className="page-heading">
        <span className="terminal-label">Machine room</span>
        <h1>Proof</h1>
        <p>Everything Slice claims is independently inspectable — from the live engine to each child fill.</p>
      </div>

      <SystemStatus health={health} loading={loading} watchPool={markets[0]?.pool ?? null} />

      <section className="deployment-section">
        <div>
          <span className="terminal-label">On-chain infrastructure</span>
          <h2>Deployed contracts and operators</h2>
        </div>
        <div className="deployment-grid">
          <DeploymentCard label="Session policy" address={health?.sessionPolicyAddress} explorerUrl={explorer} note="Verifies every grant before a child order is placed." />
          <DeploymentCard label="Execution router" address={health?.executionRouterAddress} explorerUrl={explorer} note="Places orders on the pool; the user keeps ownership." />
          <DeploymentCard label="Reactivity handler" address={health?.reactivityHandlerAddress} explorerUrl={explorer} note="Executes registered exit rules from on-chain events." />
          <DeploymentCard label="Reactivity emitter" address={health?.reactivityEmitterAddress} explorerUrl={explorer} />
          <DeploymentCard label="Delegated executor" address={health?.executorAddress} explorerUrl={explorer} note="The only key the server holds. It cannot withdraw." />
          <DeploymentCard label="Quoting account" address={health?.quoter?.quoterAddress} explorerUrl={explorer} note="Bounded two-sided quotes so a comparison can be measured. Disclosed, not organic volume." />
          <article>
            <span>Reactivity subscription</span>
            <strong>{health?.reactivitySubscriptionId ?? "Unavailable"}</strong>
          </article>
          <article>
            <span>Network</span>
            <strong>{health ? `${health.network} · chain ${health.chainId}` : "Unavailable"}</strong>
          </article>
        </div>
      </section>

      <section className="architecture">
        <span className="terminal-label">Execution path</span>
        <ArchitectureDiagram />
      </section>
    </main>
  );
}
