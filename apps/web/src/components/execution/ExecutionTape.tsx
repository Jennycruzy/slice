import { cents } from "../../lib/format.js";
import type { ChildForUi } from "../../lib/types.js";
import { ExplorerLink } from "../ui/ExplorerLink.js";

interface ExecutionTapeProps {
  orders: ChildForUi[];
  explorerUrl: string | undefined;
}

/** Every child order in sequence with its fill and transaction. */
export function ExecutionTape({ orders, explorerUrl }: ExecutionTapeProps) {
  if (orders.length === 0) return <p className="inline-note">Waiting for the first child order…</p>;
  return (
    <ol className="child-list">
      {orders.map((child) => (
        <li key={child.id} className={`child-${child.status}`}>
          <div>
            <strong>#{child.sequence} · {child.status}</strong>
            <span>{child.filledQuantity} / {child.requestedQuantity}{child.averagePrice ? ` @ ${cents(child.averagePrice)}` : ""}</span>
            {child.rejectionReason && <small>{child.rejectionReason}</small>}
          </div>
          {child.transactionHash
            ? <ExplorerLink explorerUrl={explorerUrl} hash={child.transactionHash} />
            : <span className="muted">pending</span>}
        </li>
      ))}
    </ol>
  );
}
