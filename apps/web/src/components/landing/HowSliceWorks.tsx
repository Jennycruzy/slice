const STEPS = [
  ["01", "Read the book", "Capture executable DreamDEX depth at a fixed block."],
  ["02", "Plan", "Walk the book and build a controlled child-order plan."],
  ["03", "Execute", "Route scoped orders without custodying the position."],
  ["04", "Prove", "Reconcile confirmed fills and publish the receipt."],
] as const;

export function HowSliceWorks() {
  return (
    <section className="how-section">
      <div>
        <span className="terminal-label">How Slice works</span>
        <h2>One book. Four inspectable steps.</h2>
      </div>
      <div className="how-flow">
        {STEPS.map(([number, title, copy]) => (
          <article key={number}>
            <span>{number}</span>
            <h3>{title}</h3>
            <p>{copy}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
