import type { BookLevel, BookSnapshot } from "@slice/core";
import { cents, dateTime } from "../../lib/format.js";

const SNAPSHOT_LEVELS = 8;

/** The book exactly as it was captured before the first child order. Receipt prices trace back to this. */
export function SnapshotBook({ snapshot }: { snapshot: BookSnapshot }) {
  return (
    <details className="snapshot-details">
      <summary>SNAPSHOT · block {snapshot.blockNumber} · {dateTime(snapshot.capturedAt)}</summary>
      <div className="snapshot-grid">
        <div><h3>Asks at submission</h3><SnapshotLevels levels={snapshot.book.asks.slice(0, SNAPSHOT_LEVELS)} /></div>
        <div><h3>Bids at submission</h3><SnapshotLevels levels={snapshot.book.bids.slice(0, SNAPSHOT_LEVELS)} /></div>
      </div>
    </details>
  );
}

function SnapshotLevels({ levels }: { levels: BookLevel[] }) {
  if (levels.length === 0) return <p className="inline-note">No resting levels on this side at capture.</p>;
  return (
    <table className="mini-table">
      <thead><tr><th scope="col">Price</th><th scope="col">Contracts</th></tr></thead>
      <tbody>
        {levels.map((level) => (
          <tr key={`${level.price}-${level.quantity}`}><td>{cents(level.price)}</td><td>{level.quantity}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
