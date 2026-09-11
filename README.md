# Slice

> **Prediction markets have order books but no execution tools. Every serious trader silently overpays on entry. Slice is the first product that fixes it.**

Slice is an execution layer for DreamDEX Event Contracts on Somnia Shannon. It snapshots a live binary-market book before an execution, works the order as visible child orders, reconciles fills from chain state, and publishes a receipt whose prices are traceable to that snapshot and those transactions.

## Current status

The execution API is live on Somnia Shannon at [`slice.54-154-121-30.sslip.io`](https://slice.54-154-121-30.sslip.io/health). It runs on an isolated Lightsail service with a local-only PostgreSQL database; existing services on that VPS are separate. The static frontend is configured for Vercel but still requires the repository owner to import the GitHub project and set `VITE_API_URL` to that API URL.

The production UI only exposes capabilities that have passed a live venue check. The remaining acceptance evidence is listed honestly below rather than presented as complete.

## Run locally

Requirements: Node 20+, a Postgres database, and network access to Somnia Shannon. Copy `.env.example` to `.env`, set `DATABASE_URL`, and set `EXECUTOR_PRIVATE_KEY` only for a server that you control. The executor key is a delegated trading key; it must never be a user key.

```sh
npm install
npm run build
npm run dev
```

The frontend reads the live event-contract market list and order book through `@somnia-chain/markets-sdk`. Event-contract data does not use the DreamDEX spot REST API. The server exposes health, market, preview, execution, SSE progress, receipt, CCXT, and MCP surfaces only when their required live configuration exists.

## Deployment

The long-lived execution engine, PostgreSQL store, Nginx HTTPS boundary, and
delegated executor run on the VPS. The static React build runs on Vercel. In
the Vercel project settings, set:

```text
VITE_API_URL=https://slice.54-154-121-30.sslip.io
```

The repository's [`vercel.json`](vercel.json) supplies the build and output
settings. Never put `DATABASE_URL`, `EXECUTOR_PRIVATE_KEY`, or a wallet-owner
key in Vercel. The VPS deployment layout and service unit are in
[`deploy/`](deploy/).

## Live venue findings

The findings are recorded in [`docs/live-findings.md`](docs/live-findings.md). The important constraints are:

- Shannon is chain `50312`; the live event-contract surface is `@somnia-chain/markets-sdk` `0.29.0` or newer.
- A market is keyed by `marketId` and a pool address is resolved from the current on-chain market record; pool addresses are recycled across windows.
- The indexer is used for discovery, but every write is gated by the live on-chain status.
- A full book snapshot is persisted before the first child order. The receipt calculator walks that exact snapshot and never extrapolates depth exhaustion.
- Fills are reconciled from on-chain `OrderFilled` events and transaction receipts, not from an optimistic local counter.

## Session-key model

The browser creates an EIP-712 grant scoped to one market, one side, a contract cap, an expiry, and the executor address. The server verifies that grant before every child placement and checks revocation. For binary orders, the browser also authorises the live pool's escrow path: collateral allowance to the pool for buys, or ERC-6909 pool-operator approval for sells. Those approvals are separate from the Slice grant; orders remain owned by the user and the executor cannot withdraw.

This split-key shape borrows the proven Somnia pattern documented in the Mirra and Wagerverse hackathon write-up, and the current DreamDEX delegated-operator model. The grant policy is narrower than a venue-wide approval because the application still enforces market, side, cap, expiry, and revocation. The binary-pool escrow approvals are shown before signing so the user can inspect exactly which pool receives authority.

## Server failure

If the Slice process dies, already-placed child orders remain on DreamDEX and settle according to the venue. Each order carries its own expiry, so abandoned liquidity ages off the book. A configured Somnia Reactivity subscription continues to execute an on-chain exit independently of Slice's server; the handler and subscription must be deployed and configured for that guarantee. When the process returns, it reconciles the execution from chain receipts before resuming. The UI exposes engine liveness and gives the user cancel controls.

## Liquidity disclosure

The server contains a bounded two-sided quoting account so that a comparison can be measured against a real order book. It is disabled unless `QUOTER_ENABLED=true` and all live quantity, spread, and refresh values are configured. The quoting account reuses the delegated executor key, and its account and orders must be disclosed in the UI and demo video; seeded depth is not presented as organic volume. The quoting-bot live gate is still pending in this repository.

## Integrators

The CCXT API is documented in [`docs/ccxt.md`](docs/ccxt.md), with a real `ccxt.Exchange` example in [`examples/ccxt-order.mjs`](examples/ccxt-order.mjs). The MCP tools are documented in [`docs/mcp.md`](docs/mcp.md). Agent discovery files are [`AGENTS.md`](AGENTS.md) and [`SKILL.md`](SKILL.md).

Deploy contracts with a funded deployer, verify both addresses on the explorer, then create the pool-filtered subscription with `npm run reactivity:subscribe`. The subscription command prints the verified subscription id and transaction hash; copy the handler, emitter, and id into the API environment.

## Evidence and release gate

No testnet execution is described as complete until the evidence is stored under `evidence/`: a captured live response or screenshot, the block number, the transaction hash, the public explorer URL, and the receipt snapshot. Run `npm run audit:integrity` before a release. The audit rejects production paths containing test doubles, placeholder controls, swallowed errors, hardcoded venue values, or incomplete claims.

## References

- DreamDEX Event Contracts: <https://app.dreamdex.io/docs/developers/event-contracts>
- DreamDEX Event-Contract Recipes: <https://app.dreamdex.io/docs/developers/event-contracts/recipes>
- Somnia on-chain Reactivity: <https://docs.somnia.network/developer/reactivity/reactivity-onchain.md>
- Somnia Shannon: <https://shannon-explorer.somnia.network>
