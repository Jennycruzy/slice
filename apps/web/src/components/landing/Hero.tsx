import type { Receipt } from "@slice/core";
import type { AppView } from "../../lib/routes.js";
import type { Health } from "../../lib/types.js";
import { StatusDot } from "../ui/StatusDot.js";
import { ExecutionComparison } from "./ExecutionComparison.js";

interface HeroProps {
  health: Health | null;
  receipt: Receipt | null;
  receiptsLoading: boolean;
  onNavigate: (view: AppView) => void;
}

export function Hero({ health, receipt, receiptsLoading, onNavigate }: HeroProps) {
  const engineLive = health?.status === "ok";
  return (
    <section className="landing-hero">
      <div className="hero-message">
        <span className="terminal-label">Execution infrastructure for DreamDEX event contracts</span>
        <h1>Work size without<br />sweeping the book.</h1>
        <p className="product-line">
          Prediction markets have order books but no execution tools. Every serious trader silently overpays on entry. Slice is the first product that fixes it.
        </p>
        <p className="lede">
          Slice breaks large positions into controlled child executions, measures what a naive order would have cost, and proves the difference from real on-chain fills.
        </p>
        <div className="hero-actions">
          <button className="gold-button" onClick={() => onNavigate("trade")}>Open terminal</button>
          <button className="secondary-button" onClick={() => onNavigate("executions")}>View verified executions</button>
        </div>
        <div className="hero-trust">
          <StatusDot live={engineLive}>{engineLive ? "Live on Somnia Shannon" : "Engine status unavailable"}</StatusDot>
          <span>Non-custodial</span>
          <span>On-chain fills</span>
          <span>Reactive exits</span>
        </div>
      </div>
      <ExecutionComparison receipt={receipt} loading={receiptsLoading} />
    </section>
  );
}
