import type { Receipt } from "@slice/core";

/** Picks the receipt that best shows what Slice does: completed first, then most savings, then most child orders, then newest. */
export function showcaseReceipt(receipts: Receipt[]): Receipt | null {
  if (receipts.length === 0) return null;
  const score = (receipt: Receipt) => [
    receipt.status === "completed" ? 1 : 0,
    Number(receipt.metrics.netSavings ?? receipt.metrics.rawSavings ?? 0),
    receipt.childOrders.length,
    Date.parse(receipt.completedAt),
  ];
  return [...receipts].sort((a, b) => {
    const left = score(a);
    const right = score(b);
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return right[index]! - left[index]!;
    }
    return 0;
  })[0] ?? null;
}
