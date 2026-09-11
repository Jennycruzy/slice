import { useEffect } from "react";
import { executionEventsUrl } from "../lib/api.js";
import { TERMINAL_STATES, type PublicExecution } from "../lib/types.js";

interface StreamHandlers {
  onExecution: (execution: PublicExecution) => void;
  onFinished: () => void;
  onError: (message: string) => void;
}

/** Follows one working order over the engine's server-sent event stream while it is active. */
export function useExecutionStream(executionId: string | null, active: boolean, handlers: StreamHandlers): void {
  const { onExecution, onFinished, onError } = handlers;
  useEffect(() => {
    if (executionId === null || !active) return;
    const stream = new EventSource(executionEventsUrl(executionId));
    stream.addEventListener("execution", (event) => {
      const next = JSON.parse((event as MessageEvent<string>).data) as PublicExecution;
      onExecution(next);
      if ((TERMINAL_STATES as readonly string[]).includes(next.state)) onFinished();
    });
    stream.addEventListener("error", (event) => {
      const data = (event as MessageEvent<{ error?: string } | undefined>).data;
      onError(data?.error ?? "Execution progress stream disconnected. Reload status to reconcile from chain state.");
    });
    return () => stream.close();
    // Handlers are stable setters from the parent; the stream must only restart per execution.
  }, [executionId, active]);
}
