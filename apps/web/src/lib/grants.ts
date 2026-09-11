import type { Address, Hex } from "viem";
import { SESSION_GRANT_TYPES, grantDomain, grantMessage, type SessionGrant } from "@slice/core";
import type { Outcome, Side } from "./types.js";

export type UnsignedGrant = Omit<SessionGrant, "grantId" | "signature">;

export interface GrantScopeInput {
  owner: Address;
  executor: Address;
  marketId: string;
  marketPool: Address;
  marketCollateral: Address;
  marketOutcomeToken: Address;
  outcomeTokenId: string;
  decimals: number;
  outcome: Outcome;
  side: Side;
  /** Contract cap in raw on-chain units. */
  maxContracts: bigint;
  issuedAt: number;
  expiresAt: number;
}

export function randomNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return BigInt(`0x${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`).toString();
}

export function oneCollateral(decimals: number): bigint {
  return 10n ** BigInt(decimals);
}

/** Builds the unsigned grant exactly as the server and the session policy expect it. */
export function unsignedGrant(scope: GrantScopeInput): UnsignedGrant {
  return {
    owner: scope.owner,
    executor: scope.executor,
    marketId: scope.marketId,
    marketPool: scope.marketPool,
    marketCollateral: scope.marketCollateral,
    marketOutcomeToken: scope.marketOutcomeToken,
    outcomeTokenId: scope.outcomeTokenId,
    oneCollateral: oneCollateral(scope.decimals).toString(),
    outcome: scope.outcome,
    side: scope.side,
    maxContracts: scope.maxContracts.toString(),
    issuedAt: scope.issuedAt,
    expiresAt: scope.expiresAt,
    nonce: randomNonce(),
  };
}

export type TypedDataSigner = (args: {
  domain: ReturnType<typeof grantDomain>;
  types: typeof SESSION_GRANT_TYPES;
  primaryType: "ExecutionGrant";
  message: ReturnType<typeof grantMessage>;
}) => Promise<Hex>;

export async function signGrant(
  grant: UnsignedGrant,
  domain: { chainId: number; verifyingContract: Address },
  sign: TypedDataSigner,
): Promise<{ grant: SessionGrant; signature: Hex }> {
  const signature = await sign({
    domain: grantDomain(domain),
    types: SESSION_GRANT_TYPES,
    primaryType: "ExecutionGrant",
    message: grantMessage(grant),
  });
  return { grant: { ...grant, grantId: crypto.randomUUID(), signature }, signature };
}

/** The tuple shape the exit handler contract reads on-chain. */
export function grantTuple(grant: UnsignedGrant) {
  return {
    owner: grant.owner,
    executor: grant.executor,
    marketId: grant.marketId as Hex,
    pool: grant.marketPool,
    collateral: grant.marketCollateral,
    outcomeToken: grant.marketOutcomeToken,
    outcomeTokenId: BigInt(grant.outcomeTokenId),
    oneCollateral: BigInt(grant.oneCollateral),
    outcome: grant.outcome === "YES" ? 0 : 1,
    side: grant.side === "buy" ? 0 : 1,
    maxContracts: BigInt(grant.maxContracts),
    issuedAt: BigInt(grant.issuedAt),
    expiresAt: BigInt(grant.expiresAt),
    nonce: BigInt(grant.nonce),
  } as const;
}
