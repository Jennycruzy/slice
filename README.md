# Slice

> **Prediction markets have order books but no execution tools. Every serious trader silently overpays on entry. Slice is the first product that fixes it.**

Slice is an execution layer for DreamDEX Event Contracts on Somnia Shannon. It snapshots a live binary-market book before an execution, works the order as visible child orders, reconciles fills from chain state, and publishes a receipt whose prices are traceable to that snapshot and those transactions.

## Current status

The product is live at [slice-app-brown.vercel.app](https://slice-app-brown.vercel.app), backed by the [production health endpoint](https://slice.54-154-121-30.sslip.io/health) on Somnia Shannon. The execution engine runs as an auto-restarting Lightsail service with PostgreSQL durability; the static frontend runs on Vercel.

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

This split-key shape borrows the session/delegated-wallet pattern highlighted for Mirra and Wagerverse in [Somnia's hackathon coverage](https://somnia.network/blog). The grant policy is narrower than a venue-wide approval because the contracts enforce the exact pool and assets, market, side, cap, expiry, executor, and revocation. The binary-pool escrow approvals are shown before signing so the user can inspect exactly which pool receives authority.

## Server failure

If the Slice process dies, already-placed child orders remain on DreamDEX and settle according to the venue. Each order carries its own expiry, so abandoned liquidity ages off the book. A configured Somnia Reactivity subscription continues to execute an on-chain exit independently of Slice's server; the handler and subscription must be deployed and configured for that guarantee. When the process returns, it reconciles the execution from chain receipts before resuming. The UI exposes engine liveness and gives the user cancel controls.

## Liquidity disclosure

The server runs a bounded two-sided quoter so the comparison can be measured against a real order book. Seeded depth is explicitly not presented as organic volume. The quoter uses its own key and address, `0x5e45e1749E1559ABAA6552d8B9908A08D20998F2`, separate from the delegated executor. Its live status and resting-order count are exposed by `/health`; at the latest evidence capture it was running with two open quotes.

## Integrators

The CCXT API is documented in [`docs/ccxt.md`](docs/ccxt.md), with a real `ccxt.Exchange` example in [`examples/ccxt-order.mjs`](examples/ccxt-order.mjs). The MCP tools are documented in [`docs/mcp.md`](docs/mcp.md). Agent discovery files are [`AGENTS.md`](AGENTS.md) and [`SKILL.md`](SKILL.md).

Deploy contracts with a funded deployer, verify both addresses on the explorer, then create the pool-filtered subscription with `npm run reactivity:subscribe`. The subscription command prints the verified subscription id and transaction hash; copy the handler, emitter, and id into the API environment.

## Deployed infrastructure

- Session policy: [`0x0911…6c5A`](https://shannon-explorer.somnia.network/address/0x09113669c5D6E4f343966bDdF893Ad8Cb1f16c5A)
- Execution router: [`0xd677…4A11`](https://shannon-explorer.somnia.network/address/0xd67788012397291490A88657fB99e59b84a74A11)
- Reactivity handler: [`0x3B6F…7B07`](https://shannon-explorer.somnia.network/address/0x3B6F62b77f98B04170354D3AA68DF8038de27B07), verified source
- Guaranteed Reactivity subscription: `18329865`, filtered to the live demonstration pool
- Delegated executor: `0x69eb1bAA26BffCD0fA9089aa2187F6Ca3e2A54f6`

## Measured usage

As of 2026-09-11, the durable public receipt store contains 6 executions, 11 confirmed child fills, and 0.011 contracts filled. The volume-weighted improvement across these deliberately tiny test transactions is 0 bps; raw savings are $0.00 and drift-adjusted savings total $0.000009. These are real measured values, not extrapolations. The strongest execution evidence is the [three-child iceberg](https://slice.54-154-121-30.sslip.io/r/fcefedb5-6fcf-4668-a058-a95c57973b23), [cancelled partial receipt](https://slice.54-154-121-30.sslip.io/r/a20af704-e084-4236-b867-d0ee90995e81), and [three-tranche scale-in](https://slice.54-154-121-30.sslip.io/r/06160223-277d-4f2e-93ea-bfdcefe5ddbc).

CCXT and MCP also reached the real write path: [CCXT receipt](https://slice.54-154-121-30.sslip.io/r/e4317259-80bb-4a2a-bb66-4906cd6147e6) and [MCP receipt](https://slice.54-154-121-30.sslip.io/r/dd39958f-0c4c-4339-9941-968c9aeb905b).

## Hard problem: callback isolation

The difficult failure was not registering a Reactivity rule; it was reliable delivery under real chain state. A zero-priority subscription could be skipped, and after enabling guaranteed delivery an expired rule could revert inside the execution router, reverting the entire handler callback and blocking unrelated valid rules for the same pool. Slice now pays an explicit validator priority, uses a guaranteed subscription, and isolates every router attempt with `try/catch`. Failed stale, revoked, expired, or underfunded rules emit an on-chain failure event while evaluation continues. The new handler was contract-tested, redeployed, source-verified, then proved with the API process stopped: fill [`0x2462…4070`](https://shannon-explorer.somnia.network/tx/0x24620dd5952560a311bb89ba04f8da6a6a62e440e29f255f5ad3fdb4a8e34070) caused autonomous handler transaction [`0xd7aa…4790`](https://shannon-explorer.somnia.network/tx/0xd7aae2ac7b2f840ad31b05741b21374771fcbbe1acf90c825afc830521904790).

## Evidence and release gate

Live evidence is linked above and summarized in [`docs/live-findings.md`](docs/live-findings.md). Run `npm run audit:integrity` before a release. The audit rejects production paths containing test doubles, placeholder controls, swallowed errors, hardcoded venue values, or incomplete claims.

## References

- DreamDEX Event Contracts: <https://app.dreamdex.io/docs/developers/event-contracts>
- DreamDEX Event-Contract Recipes: <https://app.dreamdex.io/docs/developers/event-contracts/recipes>
- Somnia on-chain Reactivity: <https://docs.somnia.network/developer/reactivity/reactivity-onchain.md>
- Somnia Shannon: <https://shannon-explorer.somnia.network>
