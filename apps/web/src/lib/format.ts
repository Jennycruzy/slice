import { formatUnits, parseUnits } from "viem";
import type { ExitRule, StrategyName } from "@slice/core";

export function shortAddress(address: string | null | undefined): string {
  return address === undefined || address === null ? "—" : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Turns an on-chain integer amount into a human decimal string; passes decimals through untouched. */
export function human(value: bigint | string | number, decimals: number): string {
  if (typeof value === "bigint") return formatUnits(value, decimals);
  if (typeof value === "number" && !Number.isInteger(value)) return String(value);
  if (typeof value === "string" && /[.eE]/.test(value)) return value;
  return formatUnits(BigInt(value), decimals);
}

export function cents(value: string | null | undefined): string {
  return value === null || value === undefined ? "—" : `${(Number(value) * 100).toFixed(2)}¢`;
}

export function dollars(value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  if (amount !== 0 && Math.abs(amount) < 0.01) return `$${amount.toFixed(6).replace(/0+$/, "")}`;
  return `$${amount.toFixed(2)}`;
}

export function contracts(value: number, maximumFractionDigits = 4): string {
  return value.toLocaleString(undefined, { maximumFractionDigits });
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isoOrUndefined(value: string): string | undefined {
  if (value.trim() === "") return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Use a valid execution window date and time");
  return parsed.toISOString();
}

export function strategyLabel(strategy: StrategyName): string {
  return strategy === "iceberg" ? "Hide my size" : "Scale in";
}

export function triggerLabel(kind: ExitRule["kind"]): string {
  if (kind === "take-profit") return "Take profit";
  if (kind === "stop-loss") return "Stop loss";
  return "Exit if book thins";
}

export function centsToRaw(value: string, decimals: number): bigint {
  const asCents = parseUnits(value, 2);
  const scale = 10n ** BigInt(decimals);
  return asCents * scale / 100n;
}

export function timeRemaining(expiry: string): string {
  const seconds = Math.max(0, Number(expiry) - Math.floor(Date.now() / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function clockTime(iso: string | undefined): string {
  if (iso === undefined) return "—";
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString() : "—";
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function isPositiveDecimal(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value) && Number(value) > 0;
}

export function trimZeros(value: number): string {
  return value.toFixed(4).replace(/\.?0+$/, "");
}
