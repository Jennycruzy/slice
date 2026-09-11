const CARDS = [
  {
    badge: "REST",
    title: "Execution API",
    copy: "Preview live impact, start scoped execution, stream status, and retrieve a verified receipt.",
    code: "POST /api/preview-impact\nPOST /api/executions\nGET  /api/executions/:id\nGET  /api/executions/:id/events\nGET  /api/receipts/:id",
  },
  {
    badge: "CCXT",
    title: "Existing trading scripts",
    copy: "Route market-order intent through Slice while keeping CCXT order semantics and execution status.",
    code: "exchange.createOrder(\n  symbol, 'market', 'buy', amount,\n  { strategy: 'iceberg', sessionGrant }\n)",
  },
  {
    badge: "MCP",
    title: "Agent-native execution",
    copy: "Agents inspect live markets, preview impact, execute orders, follow progress, and retrieve receipts through five focused tools.",
    code: "list_markets\npreview_impact\nexecute_order\nget_execution_status\nget_receipt",
  },
] as const;

export function IntegrationsView() {
  return (
    <main className="page-view">
      <div className="page-heading">
        <span className="terminal-label">Machine execution</span>
        <h1>Integrations</h1>
        <p>Slice is an execution layer for traders, scripts, and autonomous agents — not only a browser interface. Every path ends in the same public receipt.</p>
      </div>
      <div className="integration-grid">
        {CARDS.map((card) => (
          <article key={card.badge}>
            <span className="data-badge">{card.badge}</span>
            <h2>{card.title}</h2>
            <p>{card.copy}</p>
            <pre>{card.code}</pre>
          </article>
        ))}
      </div>
    </main>
  );
}
