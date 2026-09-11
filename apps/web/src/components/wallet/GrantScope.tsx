import type { SessionGrant } from "@slice/core";
import { dateTime, human, shortAddress } from "../../lib/format.js";

interface GrantScopeProps {
  grant: SessionGrant;
  marketName: string;
  decimals?: number;
  status?: "active" | "revoked" | "expired";
}

/** Exactly what the wallet authorised: one market, one side, a cap, an expiry, and one executor. */
export function GrantScope({ grant, marketName, decimals = 6, status }: GrantScopeProps) {
  const expired = grant.expiresAt * 1000 < Date.now();
  const shown = status ?? (expired ? "expired" : "active");
  return (
    <div className="grant-scope" aria-label="Session authorisation scope">
      <div><span>Owner</span><strong>{shortAddress(grant.owner)}</strong></div>
      <div><span>Executor</span><strong>{shortAddress(grant.executor)}</strong></div>
      <div><span>Market</span><strong>{marketName}</strong></div>
      <div><span>Outcome / side</span><strong>{grant.outcome} · {grant.side}</strong></div>
      <div><span>Maximum</span><strong>{human(grant.maxContracts, decimals)} contracts</strong></div>
      <div><span>Expires</span><strong>{dateTime(new Date(grant.expiresAt * 1000).toISOString())}</strong></div>
      <div><span>Status</span><strong className={`grant-status grant-${shown}`}>{shown.toUpperCase()}</strong></div>
    </div>
  );
}
