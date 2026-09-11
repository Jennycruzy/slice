import { useState } from "react";
import type { StrategyName } from "@slice/core";
import type { OrderDraft, OrderEntry } from "../../hooks/useOrderEntry.js";
import type { WalletControls } from "../../hooks/useWallet.js";
import { shortAddress } from "../../lib/format.js";
import type { MarketSummary, Outcome, Side } from "../../lib/types.js";
import { StrategyPicker } from "./StrategyPicker.js";

interface ExecutionTicketProps {
  markets: MarketSummary[];
  draft: OrderDraft;
  onDraft: (patch: Partial<OrderDraft>) => void;
  entry: OrderEntry;
  hasPreview: boolean;
  exitPlanned: boolean;
  onExitPlanned: (planned: boolean) => void;
  wallet: WalletControls;
}

const OUTCOMES: Outcome[] = ["YES", "NO"];
const SIDES: Side[] = ["buy", "sell"];

/** Order entry. Preview is public; the wallet is only needed when execution starts. */
export function ExecutionTicket({ markets, draft, onDraft, entry, hasPreview, exitPlanned, onExitPlanned, wallet }: ExecutionTicketProps) {
  const [advanced, setAdvanced] = useState(false);
  const startLabel = entry.starting ? "Authorising…" : entry.engineReady ? "Start Slice" : "Execution unavailable";

  return (
    <section className="order-panel execution-ticket" aria-label="Execution ticket">
      <div className="ticket-heading">
        <span className="terminal-label">Execution ticket</span>
        <strong>Make size quiet.</strong>
      </div>

      <div className="field-row">
        <label>
          Market
          <select
            value={draft.market?.id ?? ""}
            onChange={(event) => {
              const market = markets.find((item) => item.id === event.target.value);
              if (market) onDraft({ market });
            }}
          >
            {markets.map((market) => (
              <option key={market.id} value={market.id}>{market.name} · {market.asset} · {market.interval ?? "live"}</option>
            ))}
          </select>
        </label>
        <label>
          Contracts
          <input
            inputMode="decimal"
            value={draft.quantity}
            onChange={(event) => onDraft({ quantity: event.target.value })}
            placeholder="Enter size"
            aria-invalid={draft.quantity !== "" && !entry.validQuantity}
          />
        </label>
      </div>

      <div className="control-line">
        <div className="segmented" role="group" aria-label="Outcome">
          {OUTCOMES.map((item) => (
            <button key={item} className={draft.outcome === item ? "selected" : ""} aria-pressed={draft.outcome === item} onClick={() => onDraft({ outcome: item })}>
              {item}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Side">
          {SIDES.map((item) => (
            <button key={item} className={draft.side === item ? "selected" : ""} aria-pressed={draft.side === item} onClick={() => onDraft({ side: item })}>
              {item}
            </button>
          ))}
        </div>
      </div>

      <StrategyPicker
        strategy={draft.strategy}
        onStrategy={(strategy: StrategyName) => onDraft({ strategy })}
        exitPlanned={exitPlanned}
        onExitPlanned={onExitPlanned}
      />

      <button className="text-button" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
        {advanced ? "Hide advanced controls" : "Show advanced controls"}
      </button>

      {advanced && (
        <div className="advanced-controls">
          <label>
            Visible slice
            <input
              inputMode="decimal"
              value={draft.displayQuantity}
              onChange={(event) => onDraft({ displayQuantity: event.target.value })}
              placeholder="Use live touch size"
              aria-invalid={!entry.validDisplayQuantity}
            />
          </label>
          {draft.strategy === "scale-in" && (
            <>
              <label>Window start<input type="datetime-local" value={draft.windowStart} onChange={(event) => onDraft({ windowStart: event.target.value })} /></label>
              <label>Window end<input type="datetime-local" value={draft.windowEnd} onChange={(event) => onDraft({ windowEnd: event.target.value })} /></label>
            </>
          )}
          <p className="inline-note">
            Leave visible slice blank to derive it from current live depth. Leave the scale-in window blank to use the market's live trading window.
          </p>
        </div>
      )}

      <div className="action-row">
        <button className="primary-button" onClick={() => void entry.requestPreview()} disabled={entry.previewing}>
          {entry.previewing ? "Reading live book…" : "Preview execution"}
        </button>
        {hasPreview && (
          <button className="secondary-button" onClick={() => void entry.startExecution()} disabled={entry.starting || !entry.engineReady}>
            {startLabel}
          </button>
        )}
      </div>

      <div className="ticket-wallet">
        <span>{wallet.isConnected ? shortAddress(wallet.address) : "Preview is public"}</span>
        <strong>{wallet.isConnected ? "Somnia wallet connected" : "Wallet required only to execute"}</strong>
      </div>
    </section>
  );
}
