import { useState } from "react";
import type { Receipt } from "@slice/core";
import { SkeletonRows } from "../components/ui/Skeleton.js";
import { DataBadge } from "../components/ui/DataBadge.js";
import { receiptUrl } from "../lib/api.js";
import { cents, dollars } from "../lib/format.js";

interface ExecutionsViewProps {
  receipts: Receipt[];
  loading: boolean;
}

type Filter = "all" | Receipt["status"];
const FILTERS: Filter[] = ["all", "completed", "partial", "cancelled"];

/** Public history. No wallet needed; partial and cancelled outcomes stay visible. */
export function ExecutionsView({ receipts, loading }: ExecutionsViewProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const visible = filter === "all" ? receipts : receipts.filter((receipt) => receipt.status === filter);
  return (
    <main className="page-view">
      <div className="page-heading">
        <span className="terminal-label">Verified on Somnia</span>
        <h1>Executions</h1>
        <p>Real Slice executions reconciled from confirmed child-order transactions. Partial and cancelled outcomes remain visible.</p>
      </div>
      <div className="filter-tabs" role="group" aria-label="Receipt status filter">
        {FILTERS.map((item) => (
          <button key={item} className={filter === item ? "active" : ""} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>
        ))}
      </div>
      {loading ? (
        <div className="execution-list"><article><SkeletonRows rows={4} height="18px" /></article><article><SkeletonRows rows={4} height="18px" /></article></div>
      ) : visible.length === 0 ? (
        <div className="empty-panel">
          <h2>No verified executions in this view</h2>
          <p>Receipts appear only after Somnia fills are reconciled. Slice does not populate this page with fixtures.</p>
        </div>
      ) : (
        <div className="execution-list">
          {visible.map((receipt) => <ExecutionRow key={receipt.id} receipt={receipt} />)}
        </div>
      )}
    </main>
  );
}

function ExecutionRow({ receipt }: { receipt: Receipt }) {
  return (
    <article>
      <div className="execution-row-title">
        <div>
          <DataBadge kind="VERIFIED" />
          <h2>{receipt.marketName}</h2>
          <p>{receipt.metrics.filledQuantity} contracts · {receipt.childOrders.length} child orders · {new Date(receipt.completedAt).toLocaleString()}</p>
        </div>
        <span className={`receipt-status ${receipt.status}`}>{receipt.status}</span>
      </div>
      <div className="execution-row-metrics">
        <div><span>Naive</span><strong>{cents(receipt.metrics.naiveAveragePrice)}</strong></div>
        <div><span>Slice</span><strong>{cents(receipt.metrics.actualAveragePrice)}</strong></div>
        <div><span>Net saved</span><strong>{dollars(receipt.metrics.netSavings ?? receipt.metrics.rawSavings)}</strong></div>
        <div><span>Block</span><strong>{receipt.snapshot.blockNumber}</strong></div>
      </div>
      <a href={receiptUrl(receipt)} target="_blank" rel="noreferrer">View public receipt ↗</a>
    </article>
  );
}
