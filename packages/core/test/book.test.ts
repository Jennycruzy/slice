import { describe, expect, it } from "vitest";
import { createSnapshot, executionMetrics, normalizeOrderBook, walkBook } from "../src/index.js";

describe("live book accounting", () => {
  const book = normalizeOrderBook({
    bids: [["0.640", "700"], ["0.630", "900"]],
    asks: [["0.660", "800"], ["0.670", "1000"]],
  }, "2026-09-09T10:00:00.000Z", 42n);

  it("walks levels in price order and records exhaustion", () => {
    expect(walkBook(book, "buy", "1500")).toEqual({
      requestedQuantity: "1500",
      filledQuantity: "1500",
      quote: "997",
      averagePrice: "0.6646666666666666666666666666666666666666",
      levels: [
        { price: "0.66", quantity: "800", quote: "528" },
        { price: "0.67", quantity: "700", quote: "469" },
      ],
      depthExhausted: false,
    });
    expect(walkBook(book, "buy", "3000").depthExhausted).toBe(true);
  });

  it("computes raw and drift-adjusted savings from snapshot plus fills", () => {
    const snapshot = createSnapshot({ id: "snap-1", marketId: "0x01", symbol: "live", side: "buy", requestedQuantity: "1500", book });
    const metrics = executionMetrics({
      snapshot,
      fills: [
        { quantity: "800", price: "0.660" },
        { quantity: "700", price: "0.662" },
      ],
      completionMidPrice: "0.650",
    });
    expect(metrics.filledQuantity).toBe("1500");
    expect(metrics.naiveAveragePrice).toBe("0.6646666666666666666666666666666666666666");
    expect(metrics.actualAveragePrice).toBe("0.6609333333333333333333333333333333333333");
    expect(metrics.rawSavings).toBe("5.6");
    expect(metrics.netSavings).toBe("5.6");
  });
});
