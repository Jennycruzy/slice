import { describe, expect, it } from "vitest";
import type { Receipt } from "@slice/core";
import { showcaseReceipt } from "../src/lib/receipts.js";

function receipt(overrides: Partial<Receipt> & { id: string; netSavings: string; children: number; status?: Receipt["status"]; completedAt?: string }): Receipt {
  return {
    id: overrides.id,
    executionId: overrides.id,
    marketId: "0x1",
    marketName: "Market",
    symbol: "M",
    side: "buy",
    strategy: "iceberg",
    status: overrides.status ?? "completed",
    createdAt: "2026-09-11T00:00:00Z",
    completedAt: overrides.completedAt ?? "2026-09-11T00:00:00Z",
    snapshot: {} as Receipt["snapshot"],
    childOrders: Array.from({ length: overrides.children }, () => ({} as Receipt["childOrders"][number])),
    fills: [],
    metrics: { netSavings: overrides.netSavings, rawSavings: overrides.netSavings } as Receipt["metrics"],
    exitRule: null,
  };
}

describe("showcaseReceipt", () => {
  it("returns null when there is nothing verified to show", () => {
    expect(showcaseReceipt([])).toBeNull();
  });
  it("prefers completed receipts over cancelled ones regardless of savings", () => {
    const chosen = showcaseReceipt([
      receipt({ id: "cancelled", status: "cancelled", netSavings: "9", children: 5 }),
      receipt({ id: "done", netSavings: "0", children: 1 }),
    ]);
    expect(chosen?.id).toBe("done");
  });
  it("then prefers the highest savings, then the most child orders, then the newest", () => {
    const chosen = showcaseReceipt([
      receipt({ id: "small", netSavings: "0.000001", children: 3 }),
      receipt({ id: "big", netSavings: "0.000003", children: 1 }),
    ]);
    expect(chosen?.id).toBe("big");
    const tie = showcaseReceipt([
      receipt({ id: "fewer", netSavings: "1", children: 1, completedAt: "2026-09-11T02:00:00Z" }),
      receipt({ id: "more", netSavings: "1", children: 3, completedAt: "2026-09-11T01:00:00Z" }),
    ]);
    expect(tie?.id).toBe("more");
  });
});
