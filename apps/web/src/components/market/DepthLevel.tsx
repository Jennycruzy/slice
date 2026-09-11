import { human } from "../../lib/format.js";

interface DepthLevelProps {
  side: "bid" | "ask";
  level: { price: bigint; quantity: bigint } | undefined;
  decimals: number;
  maximumSize: number;
}

const MINIMUM_BAR_PERCENT = 2;

/** One size cell with a translucent bar proportional to the largest visible level. */
export function DepthLevel({ side, level, decimals, maximumSize }: DepthLevelProps) {
  if (level === undefined) return <td className={`${side}-number depth-cell`} />;
  const quantity = human(level.quantity, decimals);
  const percent = Math.max(MINIMUM_BAR_PERCENT, Number(quantity) / maximumSize * 100);
  return (
    <td className={`${side}-number depth-cell`}>
      <span className={`depth-fill ${side}-fill`} style={{ width: `${percent}%` }} aria-hidden="true" />
      <span className="depth-value">{quantity}</span>
    </td>
  );
}
