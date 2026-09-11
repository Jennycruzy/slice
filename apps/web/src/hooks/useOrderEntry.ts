import { useState } from "react";
import { parseUnits, type Hex } from "viem";
import { usePublicClient, useSignTypedData, useSwitchChain, useWriteContract } from "wagmi";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import type { StrategyName } from "@slice/core";
import { api, assertSessionDuration } from "../lib/api.js";
import { ensureEscrowApproval } from "../lib/escrow.js";
import { errorText, isoOrUndefined, isPositiveDecimal } from "../lib/format.js";
import { signGrant, unsignedGrant } from "../lib/grants.js";
import type { AuthorisationRecord, Health, ImpactPreview, MarketSummary, Outcome, PublicExecution, Side } from "../lib/types.js";
import type { WalletControls } from "./useWallet.js";

export interface OrderDraft {
  market: MarketSummary | null;
  outcome: Outcome;
  side: Side;
  quantity: string;
  strategy: StrategyName;
  displayQuantity: string;
  windowStart: string;
  windowEnd: string;
}

export interface OrderEntryInput {
  draft: OrderDraft;
  markets: MarketSummary[];
  setMarkets: (markets: MarketSummary[]) => void;
  setMarket: (market: MarketSummary) => void;
  preview: ImpactPreview | null;
  setPreview: (preview: ImpactPreview | null) => void;
  health: Health | null;
  wallet: WalletControls;
  onStarted: (execution: PublicExecution, authorisation: AuthorisationRecord) => void;
  onError: (message: string) => void;
}

export interface OrderEntry {
  previewing: boolean;
  starting: boolean;
  engineReady: boolean;
  validQuantity: boolean;
  validDisplayQuantity: boolean;
  requestPreview: () => Promise<void>;
  startExecution: () => Promise<void>;
}

const MARKET_ROLLED_OVER = /no longer trading|too close to expiry|not present in the live venue/i;

/** Preview and start logic for the execution ticket. Every write goes through the user's own scoped grant. */
export function useOrderEntry(input: OrderEntryInput): OrderEntry {
  const { draft, health, wallet, preview, setPreview, onStarted, onError } = input;
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync, isPending: signing } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);

  const engineReady = health?.status === "ok"
    && health.executorConfigured
    && health.sessionPolicyAddress !== null
    && health.executionRouterAddress !== null;
  const validQuantity = isPositiveDecimal(draft.quantity);
  const validDisplayQuantity = draft.displayQuantity.trim() === "" || isPositiveDecimal(draft.displayQuantity);

  function executionControls() {
    if (!validDisplayQuantity) throw new Error("Visible slice must be a positive contract size");
    const start = isoOrUndefined(draft.windowStart);
    const end = isoOrUndefined(draft.windowEnd);
    if ((start === undefined) !== (end === undefined)) throw new Error("Set both window start and window end, or leave both blank");
    if (start !== undefined && end !== undefined && Date.parse(end) <= Date.parse(start)) throw new Error("Execution window end must be after its start");
    return {
      ...(draft.displayQuantity.trim() === "" ? {} : { displayQuantity: draft.displayQuantity }),
      ...(start === undefined ? {} : { windowStart: start }),
      ...(end === undefined ? {} : { windowEnd: end }),
    };
  }

  async function requestPreview() {
    if (draft.market === null || !validQuantity) {
      onError("Choose a live market and enter a positive contract size before previewing impact.");
      return;
    }
    setPreviewing(true);
    try {
      const controls = executionControls();
      const previewMarket = (market: MarketSummary) => api<ImpactPreview>("/api/preview-impact", {
        method: "POST",
        body: JSON.stringify({ marketId: market.id, outcome: draft.outcome, side: draft.side, quantity: draft.quantity, strategy: draft.strategy, ...controls }),
      });
      let next: ImpactPreview;
      try {
        next = await previewMarket(draft.market);
      } catch (error) {
        // The chosen window may have closed while the page was open; move to the current one.
        if (!MARKET_ROLLED_OVER.test(errorText(error))) throw error;
        const refreshed = await api<{ markets: MarketSummary[] }>("/api/markets");
        input.setMarkets(refreshed.markets);
        const replacement = refreshed.markets[0];
        if (replacement === undefined) throw new Error("No eligible live event market is available right now.");
        input.setMarket(replacement);
        next = await previewMarket(replacement);
      }
      setPreview(next);
      if (!next.canSubmit) onError(next.refusalReason ?? "The live book cannot fill that size.");
    } catch (error) {
      onError(errorText(error));
    } finally {
      setPreviewing(false);
    }
  }

  async function startExecution() {
    const market = draft.market;
    if (market === null) {
      onError("Choose a live market before starting Slice.");
      return;
    }
    if (preview === null) {
      onError("Preview the live impact before starting Slice.");
      return;
    }
    if (!preview.canSubmit) {
      onError(preview.refusalReason ?? "The live book cannot fill that size.");
      return;
    }
    const owner = wallet.address;
    if (owner === undefined || health?.sessionPolicyAddress === null || health?.sessionPolicyAddress === undefined || health.executorAddress === null || health.executionRouterAddress === null) {
      onError("Connect a wallet and wait for the live execution engine to report its delegated executor.");
      return;
    }
    try {
      setBusy(true);
      const duration = assertSessionDuration();
      if (wallet.chainId !== somniaShannon.id) {
        if (switchChainAsync === undefined) throw new Error("Your wallet cannot switch to Somnia Shannon automatically");
        await switchChainAsync({ chainId: somniaShannon.id });
      }
      if (publicClient === undefined) throw new Error("The connected wallet did not expose a Somnia read client");
      await ensureEscrowApproval({
        owner,
        spender: health.executionRouterAddress,
        side: draft.side,
        collateral: market.collateral,
        outcomeToken: market.outcomeToken,
        maximumCollateral: parseUnits(draft.quantity, market.decimals),
        publicClient,
        writeContract: writeContractAsync,
        purpose: "Collateral",
      });
      const issuedAt = Math.floor(Date.now() / 1000);
      const { grant } = await signGrant(
        unsignedGrant({
          owner,
          executor: health.executorAddress,
          marketId: market.id,
          marketPool: market.pool,
          marketCollateral: market.collateral,
          marketOutcomeToken: market.outcomeToken,
          outcomeTokenId: draft.outcome === "YES" ? market.yesTokenId : market.noTokenId,
          decimals: market.decimals,
          outcome: draft.outcome,
          side: draft.side,
          maxContracts: parseUnits(draft.quantity, market.decimals),
          issuedAt,
          expiresAt: issuedAt + duration,
        }),
        { chainId: health.chainId, verifyingContract: health.sessionPolicyAddress },
        signTypedDataAsync,
      );
      const verified = await api<{ digest: Hex; registrationHash: Hex | null }>("/api/session/grants/verify", {
        method: "POST",
        body: JSON.stringify({ grant, quantity: draft.quantity }),
      });
      const execution = await api<PublicExecution>("/api/executions", {
        method: "POST",
        body: JSON.stringify({
          owner,
          marketId: market.id,
          outcome: draft.outcome,
          side: draft.side,
          quantity: draft.quantity,
          strategy: draft.strategy,
          ...executionControls(),
          sessionGrant: grant,
        }),
      });
      onStarted(execution, { grant, digest: verified.digest, registrationHash: verified.registrationHash });
    } catch (error) {
      onError(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return { previewing, starting: busy || signing, engineReady, validQuantity, validDisplayQuantity, requestPreview, startExecution };
}
