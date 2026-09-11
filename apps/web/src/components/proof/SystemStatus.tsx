import { useLiveStatus, useWatchMarket } from "@somnia-chain/markets-sdk/react";
import type { Address } from "viem";
import type { Health } from "../../lib/types.js";
import { StatusDot } from "../ui/StatusDot.js";
import { Skeleton } from "../ui/Skeleton.js";

interface SystemStatusProps {
  health: Health | null;
  loading: boolean;
  /** A live pool to tail so the WebSocket card reflects a real connection. */
  watchPool: Address | null;
}

/** Each card reflects the live health endpoint or the browser's own Somnia WebSocket, never a hard-coded "LIVE". */
export function SystemStatus({ health, loading, watchPool }: SystemStatusProps) {
  const tail = useLiveStatus();
  const watch = useWatchMarket(watchPool ?? undefined);
  const streaming = tail.wsConnected && (watchPool === null || watch === "live");
  const cards: Array<[string, boolean, string]> = [
    ["Execution engine", health?.status === "ok", health?.status === "ok" ? "Live" : "Unavailable"],
    ["DreamDEX quoter", Boolean(health?.quoter?.running), health?.quoter?.running ? `${health.quoter.openQuotes} live quotes` : "Stopped"],
    ["Somnia RPC", health !== null, health ? "Connected" : "Unavailable"],
    ["WebSocket tail", streaming, streaming ? `Streaming · block ${tail.lastBlock}` : watchPool === null ? "No live market to tail" : "Connecting"],
    ["Reactivity", Boolean(health?.reactivityConfigured), health?.reactivityConfigured ? "Active" : "Not configured"],
  ];
  return (
    <section className="system-grid" aria-label="System status">
      {cards.map(([label, live, text]) => (
        <div key={label}>
          <span>{label}</span>
          {loading ? <Skeleton width="60%" height="14px" /> : <StatusDot live={live}>{text}</StatusDot>}
        </div>
      ))}
    </section>
  );
}
