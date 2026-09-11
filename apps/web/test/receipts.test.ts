import { describe, expect, it } from "vitest";
import type { Receipt } from "@slice/core";
import { showcaseReceipt } from "../src/lib/receipts.js";

function receipt(overrides: { id: string; netSavings: string; children: number; filled?: string; status?: Receipt["status"]; completedAt?: string }): Receipt {
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
    childOrders: Array.from({ length: overrides.children }, () => ({ filledQuantity: "1" } as Receipt["childOrders"][number])),
    fills: [],
    metrics: { netSavings: overrides.netSavings, rawSavings: overrides.netSavings, filledQuantity: overrides.filled ?? "1" } as Receipt["metrics"],
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
  it("then prefers more filled children, then size, then the newest, and ignores savings", () => {
    const chosen = showcaseReceipt([
      receipt({ id: "flattering", netSavings: "9", children: 1, filled: "0.001" }),
      receipt({ id: "informative", netSavings: "-23.9", children: 3, filled: "333" }),
    ]);
    expect(chosen?.id).toBe("informative");
    const tie = showcaseReceipt([
      receipt({ id: "older", netSavings: "0", children: 3, filled: "333", completedAt: "2026-09-11T01:00:00Z" }),
      receipt({ id: "newer", netSavings: "0", children: 3, filled: "333", completedAt: "2026-09-11T02:00:00Z" }),
    ]);
    expect(tie?.id).toBe("newer");
  });
});
