import type { Receipt } from "@slice/core";
import { errorText } from "./format.js";

export const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
export const SESSION_DURATION_SECONDS = Number(import.meta.env.VITE_SESSION_DURATION_SECONDS ?? "3600");

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers ?? {}),
    },
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new Error(`Slice API returned invalid JSON: ${errorText(error)}`);
  }
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body
      ? String(body.error)
      : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body as T;
}

export function receiptUrl(receipt: Pick<Receipt, "id">): string {
  return `${API_URL}/r/${receipt.id}`;
}

export function executionEventsUrl(executionId: string): string {
  return `${API_URL}/api/executions/${executionId}/events`;
}

export function explorerTx(explorerUrl: string, hash: string): string {
  return `${explorerUrl.replace(/\/$/, "")}/tx/${hash}`;
}

export function explorerAddress(explorerUrl: string, address: string): string {
  return `${explorerUrl.replace(/\/$/, "")}/address/${address}`;
}

export function assertSessionDuration(): number {
  if (!Number.isFinite(SESSION_DURATION_SECONDS) || SESSION_DURATION_SECONDS <= 0) {
    throw new Error("Browser session duration is not configured");
  }
  return SESSION_DURATION_SECONDS;
}
