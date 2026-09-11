import { useLiveBinaryOrderBook, useLiveStatus, useWatchMarket } from "@somnia-chain/markets-sdk/react";
import { cents, human, timeRemaining } from "../../lib/format.js";
import type { Health, MarketSummary } from "../../lib/types.js";
import { StatusDot } from "../ui/StatusDot.js";

interface MarketHeaderProps {
  market: MarketSummary;
  health: Health | null;
}

export function MarketHeader({ market, health }: MarketHeaderProps) {
  const status = useWatchMarket(market.pool);
  const tail = useLiveStatus();
  const book = useLiveBinaryOrderBook(market.pool, 2);
  const yes = book.yesAsks[0] ?? book.yesBids[0];
  const no = book.noAsks[0] ?? book.noBids[0];
  const streaming = status === "live" && tail.wsConnected;
  return (
    <section className="market-header">
      <div>
        <span className="terminal-label">Live DreamDEX market</span>
        <h1>{market.name}</h1>
        <p>{market.asset} · {market.interval ?? "event contract"}</p>
      </div>
      <div className="market-prices">
        <div><span>YES</span><strong>{yes ? cents(human(yes.price, market.decimals)) : "—"}</strong></div>
        <div><span>NO</span><strong>{no ? cents(human(no.price, market.decimals)) : "—"}</strong></div>
      </div>
      <div className="market-meta">
        <span>Expires in <strong>{timeRemaining(market.expiry)}</strong></span>
        <StatusDot live={streaming}>{streaming ? "Streaming" : "Connecting"}</StatusDot>
        <span>{health?.network ?? "Somnia Shannon"}</span>
      </div>
    </section>
  );
}
