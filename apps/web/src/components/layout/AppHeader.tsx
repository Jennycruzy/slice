import type { Address } from "viem";
import { shortAddress } from "../../lib/format.js";
import { NAV_VIEWS, type AppView } from "../../lib/routes.js";
import type { Health } from "../../lib/types.js";
import { StatusDot } from "../ui/StatusDot.js";
import { BrandMark } from "./BrandMark.js";

interface AppHeaderProps {
  view: AppView;
  health: Health | null;
  address: Address | undefined;
  onNavigate: (view: AppView) => void;
  onWallet: () => void;
}

export function AppHeader({ view, health, address, onNavigate, onWallet }: AppHeaderProps) {
  const engineLive = health?.status === "ok";
  return (
    <header className="app-header">
      <button className="brand" onClick={() => onNavigate("landing")} aria-label="Slice home">
        <BrandMark />
        <span>SLICE/</span>
      </button>
      <nav aria-label="Primary navigation">
        {NAV_VIEWS.map((item) => (
          <button
            key={item.view}
            className={view === item.view ? "active" : ""}
            aria-current={view === item.view ? "page" : undefined}
            onClick={() => onNavigate(item.view)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="header-status">
        <StatusDot live={engineLive}>{engineLive ? "Engine live" : "Engine offline"}</StatusDot>
        <span className="network-tag">Shannon · {health?.chainId ?? 50312}</span>
        <button className="wallet-compact" onClick={onWallet}>
          {address ? shortAddress(address) : "Connect wallet"}
        </button>
      </div>
    </header>
  );
}
