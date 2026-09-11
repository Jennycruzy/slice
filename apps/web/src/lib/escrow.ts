import { erc20WriteAbi, erc6909Abi } from "@somnia-chain/markets-sdk";
import type { Address, PublicClient } from "viem";
import type { Config } from "wagmi";
import type { WriteContractMutateAsync } from "wagmi/query";
import type { Side } from "./types.js";

export interface EscrowInput {
  owner: Address;
  spender: Address;
  side: Side;
  collateral: Address;
  outcomeToken: Address;
  /** Raw collateral amount a buy may need; ignored for sells. */
  maximumCollateral: bigint;
  publicClient: PublicClient;
  writeContract: WriteContractMutateAsync<Config, unknown>;
  /** Wording used in the confirmation error, e.g. "Collateral" or "Exit collateral". */
  purpose: string;
}

/**
 * Makes sure the execution router may move the user's escrow for one side of the market.
 * Buys need a collateral allowance; sells need the outcome-token operator approval.
 * Orders stay owned by the user; the router can only place them.
 */
export async function ensureEscrowApproval(input: EscrowInput): Promise<void> {
  const { owner, spender, publicClient, writeContract } = input;
  if (input.side === "buy") {
    const allowance = await publicClient.readContract({
      address: input.collateral,
      abi: erc20WriteAbi,
      functionName: "allowance",
      args: [owner, spender],
    });
    if (allowance >= input.maximumCollateral) return;
    const hash = await writeContract({
      address: input.collateral,
      abi: erc20WriteAbi,
      functionName: "approve",
      args: [spender, input.maximumCollateral],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${input.purpose} approval did not confirm on Somnia`);
    return;
  }
  const operatorApproved = await publicClient.readContract({
    address: input.outcomeToken,
    abi: erc6909Abi,
    functionName: "isOperator",
    args: [owner, spender],
  });
  if (operatorApproved) return;
  const hash = await writeContract({
    address: input.outcomeToken,
    abi: erc6909Abi,
    functionName: "setOperator",
    args: [spender, true],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${input.purpose} outcome-token approval did not confirm on Somnia`);
}
