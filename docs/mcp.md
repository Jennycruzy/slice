# MCP integration

> **Prediction markets have order books but no execution tools. Every serious trader silently overpays on entry. Slice is the first product that fixes it.**

Run the stdio server from the repository root:

```sh
SLICE_API_URL=http://localhost:8787 npm --workspace @slice/mcp run start
```

The server exposes five tools:

- `list_markets` — active DreamDEX binary markets.
- `preview_impact` — exact live-book walk and a strategy projection; no write.
- `execute_order` — starts `iceberg` or `scale-in` after validating an owner-signed EIP-712 `sessionGrant`.
- `get_execution_status` — chain-reconciled progress and heartbeat.
- `get_receipt` — the public, snapshot-backed receipt.

The MCP process is an API client, not a custodian. It never accepts a private key. The owner creates the scoped grant in a wallet, including market, outcome, side, cap, expiry, and nonce, then passes the signed grant to `execute_order`.
