import { useEffect, useState } from "react";
import { AppHeader } from "./components/layout/AppHeader.js";
import { Footer } from "./components/layout/Footer.js";
import { LayerErrors } from "./components/layout/LayerErrors.js";
import { useExecutionSession } from "./hooks/useExecutionSession.js";
import { useSliceData } from "./hooks/useSliceData.js";
import { useWallet } from "./hooks/useWallet.js";
import { VIEW_PATHS, viewFromPath, type AppView } from "./lib/routes.js";
import { ExecutionsView } from "./views/Executions.js";
import { IntegrationsView } from "./views/Integrations.js";
import { LandingView } from "./views/Landing.js";
import { ProofView } from "./views/Proof.js";
import { TradeView } from "./views/Trade.js";

export default function App() {
  const [view, setView] = useState<AppView>(() => viewFromPath(window.location.pathname));
  const [error, setError] = useState<string | null>(null);
  const data = useSliceData();
  const wallet = useWallet();
  const session = useExecutionSession({ health: data.health, wallet, onError: setError });

  const navigate = (next: AppView) => {
    window.history.pushState({}, "", VIEW_PATHS[next]);
    setView(next);
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  useEffect(() => {
    const onPopState = () => setView(viewFromPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return (
    <div className="app-shell">
      <AppHeader view={view} health={data.health} address={wallet.address} onNavigate={navigate} onWallet={wallet.toggle} />
      <LayerErrors errors={data.layerErrors} onRetry={data.reload} />
      {error && (
        <div className="global-error" role="alert">
          <strong>{error}</strong>
          <button onClick={() => setError(null)} aria-label="Dismiss error">Dismiss</button>
        </div>
      )}
      {view === "landing" && <LandingView data={data} onNavigate={navigate} />}
      {view === "trade" && <TradeView data={data} wallet={wallet} session={session} onError={setError} />}
      {view === "executions" && <ExecutionsView receipts={data.receipts} loading={data.receiptsLoading} />}
      {view === "proof" && <ProofView health={data.health} loading={data.healthLoading} markets={data.markets} />}
      {view === "integrations" && <IntegrationsView />}
      <Footer />
    </div>
  );
}
