import { Decimal } from "decimal.js/decimal";
import { hashTypedData, parseUnits, verifyTypedData, type Address, type Hex } from "viem";
import { SESSION_GRANT_DOMAIN } from "./config.js";
import type { SessionGrant, TradeSide } from "./types.js";

export const SESSION_GRANT_TYPES = {
  ExecutionGrant: [
    { name: "owner", type: "address" },
    { name: "executor", type: "address" },
    { name: "marketId", type: "bytes32" },
    { name: "outcome", type: "uint8" },
    { name: "side", type: "uint8" },
    { name: "maxContracts", type: "uint256" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export interface GrantDomainConfig {
  chainId: number;
  verifyingContract: Address;
}

export function grantMessage(grant: Omit<SessionGrant, "grantId" | "signature">) {
  return {
    owner: grant.owner,
    executor: grant.executor,
    marketId: grant.marketId as `0x${string}`,
    outcome: grant.outcome === "YES" ? 0 : 1,
    side: grant.side === "buy" ? 0 : 1,
    maxContracts: BigInt(grant.maxContracts),
    issuedAt: BigInt(grant.issuedAt),
    expiresAt: BigInt(grant.expiresAt),
    nonce: BigInt(grant.nonce),
  } as const;
}

export function grantDomain(config: GrantDomainConfig) {
  return { ...SESSION_GRANT_DOMAIN, chainId: config.chainId, verifyingContract: config.verifyingContract } as const;
}

export function grantDigest(grant: Omit<SessionGrant, "grantId" | "signature">, domain: GrantDomainConfig): Hex {
  return hashTypedData({
    domain: grantDomain(domain),
    types: SESSION_GRANT_TYPES,
    primaryType: "ExecutionGrant",
    message: grantMessage(grant),
  });
}

export async function verifyGrant(grant: SessionGrant, domain: GrantDomainConfig, nowSeconds = Math.floor(Date.now() / 1000)): Promise<{ digest: Hex; owner: Address }> {
  const digest = grantDigest(grant, domain);
  const owner = grant.owner as Address;
  const valid = await verifyTypedData({
    address: owner,
    domain: grantDomain(domain),
    types: SESSION_GRANT_TYPES,
    primaryType: "ExecutionGrant",
    message: grantMessage(grant),
    signature: grant.signature as Hex,
  });
  if (!valid) throw new Error("Session grant signature is invalid");
  if (grant.issuedAt > nowSeconds + 60) throw new Error("Session grant is not active yet");
  if (grant.expiresAt <= nowSeconds) throw new Error("Authorisation expired. Re-authorise to continue.");
  if (grant.expiresAt <= grant.issuedAt) throw new Error("Session grant expiry must be after issue time");
  if (grant.marketId.length !== 66) throw new Error("Session grant market scope is invalid");
  if (grant.outcome !== "YES" && grant.outcome !== "NO") throw new Error("Session grant outcome scope is invalid");
  if (grant.side !== "buy" && grant.side !== "sell") throw new Error("Session grant side scope is invalid");
  if (BigInt(grant.maxContracts) <= 0n) throw new Error("Session grant cap must be positive");
  return { digest, owner };
}

export function assertGrantCovers(grant: SessionGrant, params: { owner: Address; marketId: string; outcome: "YES" | "NO"; side: TradeSide; quantity: string; decimals: number; executor: Address }) {
  if (grant.owner.toLowerCase() !== params.owner.toLowerCase()) throw new Error("Session grant owner does not match the connected wallet");
  if (grant.executor.toLowerCase() !== params.executor.toLowerCase()) throw new Error("Session grant executor does not match the configured executor");
  if (grant.marketId.toLowerCase() !== params.marketId.toLowerCase()) throw new Error("Session grant is scoped to a different market");
  if (grant.outcome !== params.outcome) throw new Error("Session grant is scoped to a different outcome");
  if (grant.side !== params.side) throw new Error("Session grant is scoped to a different side");
  const quantity = new Decimal(params.quantity);
  if (!quantity.isFinite() || quantity.lte(0)) throw new Error("Order quantity must be positive");
  const quantityRaw = parseUnits(params.quantity, params.decimals);
  const capRaw = BigInt(grant.maxContracts);
  if (quantityRaw > capRaw) throw new Error("Order exceeds the session contract cap");
}
