const MAIN_PATH = [
  ["User wallet", "signs a scoped grant"],
  ["Session policy", "verifies scope and revocation"],
  ["Slice engine", "plans and works child orders"],
  ["Execution router", "places orders the user still owns"],
  ["DreamDEX pool", "emits OrderFilled"],
  ["Receipt", "reconciled from confirmed transactions"],
] as const;

const POOL_ROW = 5;

/** The execution path, with the Reactivity branch that keeps running when the server is off. */
export function ArchitectureDiagram() {
  return (
    <div className="architecture-diagram">
      {MAIN_PATH.map(([title, copy], index) => (
        <div className="architecture-step" key={title} style={{ gridRow: index + 1 }}>
          <div className="architecture-node">
            <strong>{title}</strong>
            <span>{copy}</span>
          </div>
          {index < MAIN_PATH.length - 1 && <i className="architecture-arrow" aria-hidden="true" />}
        </div>
      ))}
      <div className="architecture-branch" style={{ gridRow: POOL_ROW }}>
        <i className="architecture-branch-line" aria-hidden="true" />
        <div className="architecture-node architecture-reactive">
          <strong>Somnia Reactivity → Exit handler</strong>
          <span>Subscribed to the pool's OrderFilled event. Fires the registered exit rule on-chain even if the Slice API is offline.</span>
        </div>
      </div>
    </div>
  );
}
