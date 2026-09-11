import { useCallback, useState } from "react";
import { formatUnits, parseUnits, type Hex } from "viem";
import { useSignTypedData, useWriteContract } from "wagmi";
import { api, assertSessionDuration } from "../lib/api.js";
import { SESSION_POLICY_ABI } from "../lib/contracts.js";
import { errorText } from "../lib/format.js";
import { signGrant, unsignedGrant } from "../lib/grants.js";
import type { AuthorisationRecord, Health, PublicExecution, TradePhase } from "../lib/types.js";
import { useExecutionStream } from "./useExecutionStream.js";
import type { WalletControls } from "./useWallet.js";

export interface ExecutionSession {
  execution: PublicExecution | null;
  authorisation: AuthorisationRecord | null;
  phase: TradePhase;
  resumePending: boolean;
  revokePending: boolean;
  setExecution: (execution: PublicExecution) => void;
  start: (execution: PublicExecution, authorisation: AuthorisationRecord) => void;
  cancel: () => void;
  resume: () => Promise<void>;
  revoke: () => void;
  reset: () => void;
}

interface SessionInput {
  health: Health | null;
  wallet: WalletControls;
  onError: (message: string | null) => void;
}

/** Owns one order from start to receipt: streaming progress, cancel, resume after a failure, and revoking the grant. */
export function useExecutionSession({ health, wallet, onError }: SessionInput): ExecutionSession {
  const [execution, setExecutionState] = useState<PublicExecution | null>(null);
  const [authorisation, setAuthorisation] = useState<AuthorisationRecord | null>(null);
  const [phase, setPhase] = useState<TradePhase>("before");
  const [resumePending, setResumePending] = useState(false);
  const { writeContractAsync, isPending: revokePending } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();

  const setExecution = useCallback((next: PublicExecution) => setExecutionState(next), []);
  const finish = useCallback(() => setPhase("after"), []);

  useExecutionStream(execution?.id ?? null, phase === "during", { onExecution: setExecution, onFinished: finish, onError });

  const start = (next: PublicExecution, record: AuthorisationRecord) => {
    setExecutionState(next);
    setAuthorisation(record);
    setPhase("during");
    onError(null);
  };

  const reset = () => {
    setExecutionState(null);
    setAuthorisation(null);
    setPhase("before");
    onError(null);
  };

  const cancel = () => {
    if (execution === null) return;
    void api<PublicExecution>(`/api/executions/${execution.id}/cancel`, { method: "POST" })
      .then(setExecution)
      .catch((reason: unknown) => onError(errorText(reason)));
  };

  const revoke = () => {
    if (authorisation === null || health?.sessionPolicyAddress === null || health?.sessionPolicyAddress === undefined) return;
    void writeContractAsync({
      address: health.sessionPolicyAddress,
      abi: SESSION_POLICY_ABI,
      functionName: "revoke",
      args: [authorisation.digest],
    }).catch((reason: unknown) => onError(errorText(reason)));
  };

  const resume = async () => {
    const owner = wallet.address;
    const request = execution?.request;
    if (
      execution === null || request === undefined || owner === undefined
      || health?.sessionPolicyAddress === null || health?.sessionPolicyAddress === undefined || health.executorAddress === null
      || request.marketDecimals === undefined || request.marketPool === undefined
      || request.marketCollateral === undefined || request.marketOutcomeToken === undefined
    ) {
      onError("Connect the execution owner wallet before re-authorising");
      return;
    }
    if (owner.toLowerCase() !== request.owner.toLowerCase()) {
      onError("Connect the wallet that owns this execution before re-authorising");
      return;
    }
    try {
      setResumePending(true);
      const duration = assertSessionDuration();
      const decimals = request.marketDecimals;
      const filled = parseUnits(execution.metrics?.filledQuantity ?? "0", decimals);
      const requested = parseUnits(request.quantity, decimals);
      if (requested <= filled) throw new Error("This execution has no remaining contracts");
      const remaining = formatUnits(requested - filled, decimals);
      const outcomeTokenId = request.outcome === "YES" ? request.marketYesTokenId : request.marketNoTokenId;
      if (outcomeTokenId === undefined) throw new Error("Execution is missing its live outcome-token id");
      const issuedAt = Math.floor(Date.now() / 1000);
      const { grant } = await signGrant(
        unsignedGrant({
          owner,
          executor: health.executorAddress,
          marketId: request.marketId,
          marketPool: request.marketPool,
          marketCollateral: request.marketCollateral,
          marketOutcomeToken: request.marketOutcomeToken,
          outcomeTokenId,
          decimals,
          outcome: request.outcome,
          side: request.side,
          maxContracts: parseUnits(remaining, decimals),
          issuedAt,
          expiresAt: issuedAt + duration,
        }),
        { chainId: health.chainId, verifyingContract: health.sessionPolicyAddress },
        signTypedDataAsync,
      );
      const response = await api<PublicExecution & { digest: Hex; registrationHash: Hex | null }>(`/api/executions/${execution.id}/resume`, {
        method: "POST",
        body: JSON.stringify({ sessionGrant: grant }),
      });
      setAuthorisation({ grant, digest: response.digest, registrationHash: response.registrationHash });
      setExecutionState(response);
      setPhase("during");
      onError(null);
    } catch (reason) {
      onError(errorText(reason));
    } finally {
      setResumePending(false);
    }
  };

  return { execution, authorisation, phase, resumePending, revokePending, setExecution, start, cancel, resume, revoke, reset };
}
