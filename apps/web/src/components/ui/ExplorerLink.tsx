import { explorerAddress, explorerTx } from "../../lib/api.js";
import { shortAddress } from "../../lib/format.js";

interface ExplorerLinkProps {
  explorerUrl: string | undefined;
  hash: string;
  kind?: "tx" | "address";
  full?: boolean;
  className?: string;
}

/** Links a hash or address to the public Somnia explorer; falls back to plain text when the explorer URL is unknown. */
export function ExplorerLink({ explorerUrl, hash, kind = "tx", full = false, className }: ExplorerLinkProps) {
  const label = full ? hash : shortAddress(hash);
  if (explorerUrl === undefined) return <span className={className}>{label}</span>;
  const href = kind === "tx" ? explorerTx(explorerUrl, hash) : explorerAddress(explorerUrl, hash);
  return <a className={className} href={href} target="_blank" rel="noreferrer">{label} ↗</a>;
}
