/**
 * Runs one owner-signed execution against the live API from the server.
 * Reads DEMO_OWNER_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) from .env; never prints it.
 *
 *   npx tsx scripts/run-demo-execution.ts <marketId> <outcome> <side> <quantity> <displayQuantity> <windowMinutes>
 */
import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { erc20WriteAbi } from "@somnia-chain/markets-sdk";
import { SESSION_GRANT_TYPES, grantDomain, grantMessage, type SessionGrant } from "@slice/core";

const API = process.env.SLICE_API_URL ?? "https://slice.54-154-121-30.sslip.io";
const [marketId, outcome, side, quantity, displayQuantity, windowMinutes] = process.argv.slice(2);
if (!marketId || !outcome || !side || !quantity || !displayQuantity || !windowMinutes) throw new Error("usage: marketId outcome side quantity displayQuantity windowMinutes");
const key = (process.env.DEMO_OWNER_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY) as Hex | undefined;
if (!key) throw new Error("No owner key configured");

const account = privateKeyToAccount(key);
const rpc = http(process.env.SOMNIA_RPC_URL ?? "https://dream-rpc.somnia.network");
const publicClient = createPublicClient({ chain: somniaShannon, transport: rpc });
const walletClient = createWalletClient({ chain: somniaShannon, transport: rpc, account });

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(body)}`);
  return body as T;
}

const health = await api<{ chainId: number; executorAddress: Address; sessionPolicyAddress: Address; executionRouterAddress: Address }>("/health");
const { markets } = await api<{ markets: Array<{ id: string; name: string; pool: Address; decimals: number; collateral: Address; outcomeToken: Address; yesTokenId: string; noTokenId: string }> }>("/api/markets");
const market = markets.find((item) => item.id.toLowerCase() === marketId.toLowerCase());
if (!market) throw new Error("Market is not live");
console.log("owner", account.address, "market", market.name);

const preview = await api<{ canSubmit: boolean; refusalReason: string | null; snapshot: { naiveWalk: { averagePrice: string; levels: unknown[] } }; strategy: { estimatedSlices: number | null; projectedAveragePrice: string | null } }>("/api/preview-impact", {
  method: "POST",
  body: JSON.stringify({ marketId, outcome, side, quantity, strategy: "scale-in", displayQuantity, windowStart: new Date().toISOString(), windowEnd: new Date(Date.now() + Number(windowMinutes) * 60_000).toISOString() }),
});
console.log("preview", { canSubmit: preview.canSubmit, refusal: preview.refusalReason, naive: preview.snapshot.naiveWalk.averagePrice, levels: preview.snapshot.naiveWalk.levels.length, children: preview.strategy.estimatedSlices, projected: preview.strategy.projectedAveragePrice });
if (!preview.canSubmit) process.exit(1);

// Collateral approval to the router for buys.
const needed = parseUnits(quantity, market.decimals);
const allowance = await publicClient.readContract({ address: market.collateral, abi: erc20WriteAbi, functionName: "allowance", args: [account.address, health.executionRouterAddress] });
if (side === "buy" && allowance < needed) {
  const hash = await walletClient.writeContract({ address: market.collateral, abi: erc20WriteAbi, functionName: "approve", args: [health.executionRouterAddress, needed] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("approval", hash, receipt.status);
}

const issuedAt = Math.floor(Date.now() / 1000);
const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
const base = {
  owner: account.address,
  executor: health.executorAddress,
  marketId: market.id,
  marketPool: market.pool,
  marketCollateral: market.collateral,
  marketOutcomeToken: market.outcomeToken,
  outcomeTokenId: outcome === "YES" ? market.yesTokenId : market.noTokenId,
  oneCollateral: (10n ** BigInt(market.decimals)).toString(),
  outcome: outcome as "YES" | "NO",
  side: side as "buy" | "sell",
  maxContracts: needed.toString(),
  issuedAt,
  expiresAt: issuedAt + 3600,
  nonce: BigInt(`0x${Array.from(nonceBytes, (b) => b.toString(16).padStart(2, "0")).join("")}`).toString(),
};
const signature = await walletClient.signTypedData({ domain: grantDomain({ chainId: health.chainId, verifyingContract: health.sessionPolicyAddress }), types: SESSION_GRANT_TYPES, primaryType: "ExecutionGrant", message: grantMessage(base) });
const grant: SessionGrant = { ...base, grantId: crypto.randomUUID(), signature };
const verified = await api<{ digest: Hex; registrationHash: Hex | null }>("/api/session/grants/verify", { method: "POST", body: JSON.stringify({ grant, quantity }) });
console.log("grant verified", verified.digest, "registration", verified.registrationHash);

const windowStart = new Date().toISOString();
const windowEnd = new Date(Date.now() + Number(windowMinutes) * 60_000).toISOString();
const execution = await api<{ id: string; state: string }>("/api/executions", {
  method: "POST",
  body: JSON.stringify({ owner: account.address, marketId, outcome, side, quantity, strategy: "scale-in", displayQuantity, windowStart, windowEnd, sessionGrant: grant }),
});
console.log("execution", execution.id, execution.state);

for (;;) {
  await new Promise((resolve) => setTimeout(resolve, 15_000));
  const status = await api<{ state: string; children: Array<{ sequence: number; status: string; filledQuantity: string; averagePrice: string | null; transactionHash: string | null }>; metrics: Record<string, string> | null; receiptUrl: string | null; failureMessage: string | null }>(`/api/executions/${execution.id}`);
  console.log(new Date().toISOString().slice(11, 19), status.state, status.children.map((c) => `#${c.sequence} ${c.status} ${c.filledQuantity}@${c.averagePrice ?? "-"} ${c.transactionHash ?? ""}`).join(" | "));
  if (["completed", "partial", "cancelled", "failed"].includes(status.state)) {
    console.log("metrics", status.metrics, "receipt", status.receiptUrl, status.failureMessage ?? "");
    break;
  }
}
