import { cents } from "../../lib/format.js";
import type { ChildForUi } from "../../lib/types.js";
import { ExplorerLink } from "../ui/ExplorerLink.js";

interface ChildTransactionsProps {
  orders: ChildForUi[];
  explorerUrl: string | undefined;
}

/** Real transactions behind the receipt. Each row can be opened on the public explorer. */
export function ChildTransactions({ orders, explorerUrl }: ChildTransactionsProps) {
  const withHash = orders.filter((child) => child.transactionHash !== null);
  if (withHash.length === 0) return <p className="inline-note">No child order reached the chain for this execution.</p>;
  return (
    <div className="book-table-wrap">
      <table className="child-table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Filled</th>
            <th scope="col">Avg price</th>
            <th scope="col">Status</th>
            <th scope="col">Transaction</th>
          </tr>
        </thead>
        <tbody>
          {withHash.map((child) => (
            <tr key={child.id}>
              <td>{child.sequence}</td>
              <td>{child.filledQuantity} / {child.requestedQuantity}</td>
              <td>{cents(child.averagePrice)}</td>
              <td className={`child-${child.status}`}>{child.status}</td>
              <td><ExplorerLink explorerUrl={explorerUrl} hash={child.transactionHash!} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
