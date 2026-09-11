import { useCallback, useEffect, useState } from "react";
import type { Receipt } from "@slice/core";
import { api } from "../lib/api.js";
import { errorText } from "../lib/format.js";
import type { Health, MarketSummary } from "../lib/types.js";

/** Which backend layer failed, so the UI can say what is affected. */
export interface LayerError {
  layer: "markets" | "engine" | "receipts";
  title: string;
  detail: string;
}

export interface SliceData {
  markets: MarketSummary[];
  setMarkets: (markets: MarketSummary[]) => void;
  marketsLoading: boolean;
  health: Health | null;
  healthLoading: boolean;
  receipts: Receipt[];
  receiptsLoading: boolean;
  layerErrors: LayerError[];
  reload: () => void;
}

const HEALTH_REFRESH_MS = 20_000;

export function useSliceData(): SliceData {
  const [markets, setMarkets] = useState<MarketSummary[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [receiptsLoading, setReceiptsLoading] = useState(true);
  const [layerErrors, setLayerErrors] = useState<LayerError[]>([]);
  const [generation, setGeneration] = useState(0);

  const reload = useCallback(() => setGeneration((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    setMarketsLoading(true);
    setHealthLoading(true);
    setReceiptsLoading(true);
    void Promise.allSettled([
      api<{ markets: MarketSummary[] }>("/api/markets"),
      api<Health>("/health"),
      api<{ receipts: Receipt[] }>("/api/receipts?limit=20"),
    ]).then(([marketResult, healthResult, receiptResult]) => {
      if (cancelled) return;
      const errors: LayerError[] = [];
      if (marketResult.status === "fulfilled") {
        setMarkets(marketResult.value.markets);
      } else {
        errors.push({
          layer: "markets",
          title: "DreamDEX market discovery unavailable",
          detail: `${errorText(marketResult.reason)}. Live chain execution is unaffected; retry market discovery.`,
        });
      }
      if (healthResult.status === "fulfilled") {
        setHealth(healthResult.value);
      } else {
        errors.push({
          layer: "engine",
          title: "Execution engine unreachable",
          detail: `${errorText(healthResult.reason)}. No new child orders will be submitted until the engine reconnects.`,
        });
      }
      if (receiptResult.status === "fulfilled") {
        setReceipts(receiptResult.value.receipts);
      } else {
        errors.push({
          layer: "receipts",
          title: "Verified execution history unavailable",
          detail: `${errorText(receiptResult.reason)}. Receipts are read from the engine's reconciled store.`,
        });
      }
      setLayerErrors(errors);
      setMarketsLoading(false);
      setHealthLoading(false);
      setReceiptsLoading(false);
    });
    return () => { cancelled = true; };
  }, [generation]);

  // Keep the engine status in the header honest without reloading the whole page.
  useEffect(() => {
    const timer = window.setInterval(() => {
      void api<Health>("/health").then(setHealth).catch(() => {
        setHealth((current) => current === null ? null : { ...current, status: "unreachable" });
      });
    }, HEALTH_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  return { markets, setMarkets, marketsLoading, health, healthLoading, receipts, receiptsLoading, layerErrors, reload };
}
