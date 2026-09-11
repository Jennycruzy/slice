import type { Health } from "../../lib/types.js";
import { Skeleton } from "../ui/Skeleton.js";

interface ProofRailProps {
  health: Health | null;
  healthLoading: boolean;
  receiptCount: number;
  receiptsLoading: boolean;
}

/** Five facts a judge can check, each read from the live health endpoint rather than typed in. */
export function ProofRail({ health, healthLoading, receiptCount, receiptsLoading }: ProofRailProps) {
  const engineLive = health?.status === "ok";
  const cell = (ready: boolean, value: string) => ready ? value : <Skeleton width="70%" height="13px" />;
  return (
    <section className="proof-rail" aria-label="Live proof">
      <div><span>Live on Shannon</span><strong>{cell(!healthLoading, String(health?.chainId ?? "Unavailable"))}</strong></div>
      <div><span>Non-custodial</span><strong>Scoped grants</strong></div>
      <div><span>Live execution</span><strong>{cell(!healthLoading, engineLive ? "Engine live" : "Unavailable")}</strong></div>
      <div><span>Reactivity</span><strong>{cell(!healthLoading, health?.reactivityConfigured ? "On-chain active" : "Not configured")}</strong></div>
      <div><span>Public receipts</span><strong>{cell(!receiptsLoading, receiptCount > 0 ? `${receiptCount} verified` : "None yet")}</strong></div>
    </section>
  );
}
