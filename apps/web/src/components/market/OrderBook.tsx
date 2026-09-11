import { useLiveBinaryOrderBook, useLiveStatus, useWatchMarket } from "@somnia-chain/markets-sdk/react";
import { cents, contracts, human } from "../../lib/format.js";
import type { MarketSummary, Outcome } from "../../lib/types.js";
import { EmptyState } from "../ui/EmptyState.js";
import { DepthLevel } from "./DepthLevel.js";

interface OrderBookProps {
  market: MarketSummary;
  outcome: Outcome;
  /** Drops the top margin when the book sits inside a grid. */
  compact?: boolean;
}

const VISIBLE_LEVELS = 10;

/** The live DreamDEX book for one outcome, with depth bars so liquidity reads before the numbers do. */
export function OrderBook({ market, outcome, compact = false }: OrderBookProps) {
  const watchStatus = useWatchMarket(market.pool);
  const tail = useLiveStatus();
  const binaryBook = useLiveBinaryOrderBook(market.pool, VISIBLE_LEVELS);
  const bids = outcome === "YES" ? binaryBook.yesBids : binaryBook.noBids;
  const asks = outcome === "YES" ? binaryBook.yesAsks : binaryBook.noAsks;
  const rows = Math.max(bids.length, asks.length);
  const size = (quantity: bigint) => Number(human(quantity, market.decimals));
  const maximumSize = Math.max(1, ...bids.map((level) => size(level.quantity)), ...asks.map((level) => size(level.quantity)));
  const bestBid = bids[0] ? Number(human(bids[0].price, market.decimals)) : null;
  const bestAsk = asks[0] ? Number(human(asks[0].price, market.decimals)) : null;
  const spread = bestBid !== null && bestAsk !== null ? (bestAsk - bestBid) * 100 : null;
  const visibleDepth = [...bids, ...asks].reduce((sum, level) => sum + size(level.quantity), 0);
  const streaming = watchStatus === "live" && tail.wsConnected;
  const indicator = streaming ? "Streaming" : watchStatus === "hydrating" ? "Connecting" : "Waiting";

  return (
    <section className={`book-panel ${compact ? "book-panel-compact" : ""}`.trim()} aria-label={`${outcome} live order book`}>
      <div className="panel-heading">
        <div>
          <span className="section-kicker">Live book</span>
          <h2>{outcome} depth</h2>
        </div>
        <span className={`live-indicator ${streaming ? "is-live" : "is-waiting"}`}>
          <span aria-hidden="true" /> {indicator}
        </span>
      </div>

      {watchStatus === "hydrating" && <p className="inline-note">Reading the live book over the Somnia WebSocket…</p>}

      {watchStatus === "live" && rows === 0 && (
        <EmptyState title="No resting depth">
          The current DreamDEX window has no executable {outcome} levels. Slice will not invent liquidity.
        </EmptyState>
      )}

      {rows > 0 && (
        <>
          <div className="book-stats">
            <span>Spread <strong>{spread === null ? "—" : `${spread.toFixed(2)}¢`}</strong></span>
            <span>Best bid <strong>{bestBid === null ? "—" : `${(bestBid * 100).toFixed(2)}¢`}</strong></span>
            <span>Best ask <strong>{bestAsk === null ? "—" : `${(bestAsk * 100).toFixed(2)}¢`}</strong></span>
            <span>Visible depth <strong>{contracts(visibleDepth, 3)}</strong></span>
          </div>
          <div className="book-table-wrap">
            <table className="book-table">
              <thead>
                <tr>
                  <th scope="col">Bid size</th>
                  <th scope="col">Bid</th>
                  <th scope="col">Ask</th>
                  <th scope="col">Ask size</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: rows }, (_, index) => {
                  const bid = bids[index];
                  const ask = asks[index];
                  return (
                    <tr key={`${bid?.price ?? "none"}-${ask?.price ?? "none"}`}>
                      <DepthLevel side="bid" level={bid} decimals={market.decimals} maximumSize={maximumSize} />
                      <td className="bid-number">{bid ? cents(human(bid.price, market.decimals)) : ""}</td>
                      <td className="ask-number">{ask ? cents(human(ask.price, market.decimals)) : ""}</td>
                      <DepthLevel side="ask" level={ask} decimals={market.decimals} maximumSize={maximumSize} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="source-note">LIVE · DreamDEX order book · block {tail.lastBlock > 0 ? tail.lastBlock : "pending"}</p>
    </section>
  );
}
