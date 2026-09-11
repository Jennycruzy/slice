import { useEffect, useState } from "react";
import type { StrategyName } from "@slice/core";
import { ExecutionEdge } from "../components/execution/ExecutionEdge.js";
import { ExecutionReceipt } from "../components/execution/ExecutionReceipt.js";
import { ExecutionTicket } from "../components/execution/ExecutionTicket.js";
import { WorkingOrder } from "../components/execution/WorkingOrder.js";
import { MarketHeader } from "../components/market/MarketHeader.js";
import { OrderBook } from "../components/market/OrderBook.js";
import { SnapshotBook } from "../components/market/SnapshotBook.js";
import { Skeleton, SkeletonRows } from "../components/ui/Skeleton.js";
import { WalletBar } from "../components/wallet/WalletBar.js";
import type { ExecutionSession } from "../hooks/useExecutionSession.js";
import { useOrderEntry, type OrderDraft } from "../hooks/useOrderEntry.js";
import type { SliceData } from "../hooks/useSliceData.js";
import type { WalletControls } from "../hooks/useWallet.js";
import type { ImpactPreview, MarketSummary } from "../lib/types.js";

interface TradeViewProps {
  data: SliceData;
  wallet: WalletControls;
  session: ExecutionSession;
  onError: (message: string) => void;
}

const DEFAULT_QUANTITY = "0.001";
const DEFAULT_STRATEGY: StrategyName = "iceberg";

export function TradeView({ data, wallet, session, onError }: TradeViewProps) {
  const { markets, setMarkets, marketsLoading, health } = data;
  const [draft, setDraft] = useState<OrderDraft>({
    market: null,
    outcome: "YES",
    side: "buy",
    quantity: DEFAULT_QUANTITY,
    strategy: DEFAULT_STRATEGY,
    displayQuantity: "",
    windowStart: "",
    windowEnd: "",
  });
  const [preview, setPreview] = useState<ImpactPreview | null>(null);
  const [exitPlanned, setExitPlanned] = useState(false);

  // Any edit to the order invalidates the previous projection.
  const patchDraft = (patch: Partial<OrderDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setPreview(null);
  };
  const setMarket = (market: MarketSummary) => patchDraft({ market });

  // Follow the live market list: keep the chosen market if it still trades, prefer the quoted one, else the first.
  useEffect(() => {
    setDraft((current) => {
      if (current.market !== null && markets.some((market) => market.id === current.market!.id)) return current;
      const quotedId = health?.quoter?.lastMarketId?.toLowerCase();
      const quoted = quotedId === undefined ? undefined : markets.find((market) => market.id.toLowerCase() === quotedId);
      return { ...current, market: quoted ?? markets[0] ?? null };
    });
  }, [markets, health?.quoter?.lastMarketId]);

  const entry = useOrderEntry({
    draft,
    markets,
    setMarkets,
    setMarket,
    preview,
    setPreview,
    health,
    wallet,
    onStarted: session.start,
    onError,
  });

  if (session.phase === "during" && session.execution) {
    return <WorkingOrder execution={session.execution} health={health} market={draft.market} onCancel={session.cancel} />;
  }

  if (session.phase === "after" && session.execution) {
    return (
      <ExecutionReceipt
        execution={session.execution}
        authorisation={session.authorisation}
        health={health}
        onRevoke={session.revoke}
        revokePending={session.revokePending}
        onExitRule={session.setExecution}
        onResume={() => void session.resume()}
        resumePending={session.resumePending}
        onNewExecution={() => { session.reset(); setPreview(null); }}
      />
    );
  }

  return (
    <main className="before-state terminal-view">
      {marketsLoading ? (
        <TradeSkeleton />
      ) : markets.length === 0 ? (
        <div className="empty-panel">
          <h2>No live event market returned</h2>
          <p>Refresh when DreamDEX has an active binary market. Slice does not invent a market or a quote.</p>
        </div>
      ) : (
        <>
          {draft.market && <MarketHeader market={draft.market} health={health} />}
          <div className="terminal-grid">
            {draft.market && <OrderBook market={draft.market} outcome={draft.outcome} compact />}
            <ExecutionTicket
              markets={markets}
              draft={draft}
              onDraft={patchDraft}
              entry={entry}
              hasPreview={preview !== null}
              exitPlanned={exitPlanned}
              onExitPlanned={setExitPlanned}
              wallet={wallet}
            />
          </div>
          {entry.previewing && !preview && <PreviewSkeleton />}
          {preview && <ExecutionEdge preview={preview} />}
          {preview && <SnapshotBook snapshot={preview.snapshot} />}
        </>
      )}
      <WalletBar wallet={wallet} />
    </main>
  );
}

function TradeSkeleton() {
  return (
    <div className="trade-skeleton" role="status" aria-label="Loading live markets">
      <div className="market-header">
        <div><Skeleton width="140px" height="10px" /><Skeleton width="60%" height="30px" className="skeleton-gap" /><Skeleton width="30%" height="12px" /></div>
        <div className="market-prices"><Skeleton width="112px" height="58px" /><Skeleton width="112px" height="58px" /></div>
        <div className="market-meta"><Skeleton width="120px" height="12px" /><Skeleton width="90px" height="12px" /></div>
      </div>
      <div className="terminal-grid">
        <section className="book-panel book-panel-compact"><SkeletonRows rows={9} height="18px" /></section>
        <section className="order-panel execution-ticket"><SkeletonRows rows={7} height="40px" /></section>
      </div>
    </div>
  );
}

function PreviewSkeleton() {
  return (
    <section className="execution-edge" role="status" aria-label="Reading the live book">
      <div className="edge-heading"><div><Skeleton width="160px" height="10px" /><Skeleton width="280px" height="22px" className="skeleton-gap" /></div></div>
      <div className="edge-comparison"><Skeleton height="48px" /><span /><Skeleton height="48px" /><Skeleton height="48px" /></div>
    </section>
  );
}
