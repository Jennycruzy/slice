import type { Receipt } from "@slice/core";

/**
 * Picks the receipt that best shows how Slice works: completed first, then the one with the most
 * filled child orders, then the largest fill, then the newest. Savings are deliberately not a
 * ranking key so the showcase cannot drift toward flattering runs.
 */
export function showcaseReceipt(receipts: Receipt[]): Receipt | null {
  if (receipts.length === 0) return null;
  const score = (receipt: Receipt) => [
    receipt.status === "completed" ? 1 : 0,
    receipt.childOrders.filter((child) => Number(child.filledQuantity) > 0).length,
    Number(receipt.metrics.filledQuantity),
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
