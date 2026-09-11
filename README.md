# Slice

**Slice is an execution tool for DreamDEX event contracts on Somnia.** You give it a large order. It works that order into smaller child orders against the live order book, records what a single market order would have cost at the same moment, and publishes a receipt that proves the difference from real on-chain fills.

> **Work size without sweeping the book.**

## About

Slice is built for the Somnia Event Contracts Hackathon. It is a non-custodial execution layer: you keep your wallet, sign one scoped grant, and Slice works the order through its own router while every fill stays owned by you. Exits are registered on-chain and fired by Somnia Reactivity, so they keep working even if the Slice server is down. Traders use the web terminal; scripts and agents use the same engine through REST, CCXT and MCP. Every receipt is public and links to the transactions behind it.

## The problem

Event-contract order books are thin. A trader who wants real size and sends one market order walks straight through every resting level, pays a worse price on each one, and shows the whole book what they are doing. Prediction markets have order books but no execution tools, so every serious trader silently overpays on entry. Slice fixes that.

## See it live

**Web app:** <https://slice-app-brown.vercel.app>

The same build is also served next to the API at <https://slice.54-154-121-30.sslip.io>.

| What to check | Where |
| --- | --- |
| Open the terminal, pick a market, preview a size (no wallet needed) | [Open the terminal](https://slice-app-brown.vercel.app/trade) |
| Every verified execution, including cancelled ones | [Executions](https://slice-app-brown.vercel.app/executions) |
| Engine status, deployed contracts, execution path | [Proof page](https://slice-app-brown.vercel.app/proof) |
| A 333-contract scale-in: 3 children filled at 79.1¢, 70.9¢ and 63.9¢ | [Receipt](https://slice.54-154-121-30.sslip.io/r/8bf6c3ae-a05c-4212-a7b8-047823da29e4) |
| One of those child transactions on the Somnia explorer | [Explorer](https://shannon-explorer.somnia.network/tx/0xb723405873d6865eb7df162d5c5e02fe229894dbc84154bd9251cded688fab5b) |
| Live engine health as JSON | [Health JSON](https://slice.54-154-121-30.sslip.io/health) |
| Reactivity firing with the Slice server stopped: this fill… | [Fill tx](https://shannon-explorer.somnia.network/tx/0x24620dd5952560a311bb89ba04f8da6a6a62e440e29f255f5ad3fdb4a8e34070) |
| …triggered this handler transaction on its own | [Handler tx](https://shannon-explorer.somnia.network/tx/0xd7aae2ac7b2f840ad31b05741b21374771fcbbe1acf90c825afc830521904790) |
| A receipt produced through the CCXT surface | [CCXT receipt](https://slice.54-154-121-30.sslip.io/r/e4317259-80bb-4a2a-bb66-4906cd6147e6) |
| A receipt produced by an agent through MCP | [MCP receipt](https://slice.54-154-121-30.sslip.io/r/dd39958f-0c4c-4339-9941-968c9aeb905b) |
| Session policy contract (checks every grant) | [Session policy](https://shannon-explorer.somnia.network/address/0x09113669c5D6E4f343966bDdF893Ad8Cb1f16c5A) |
| Execution router contract (places orders the user still owns) | [Execution router](https://shannon-explorer.somnia.network/address/0xd67788012397291490A88657fB99e59b84a74A11) |
| Reactivity exit handler (runs exits even if Slice is offline) | [Exit handler](https://shannon-explorer.somnia.network/address/0x3B6F62b77f98B04170354D3AA68DF8038de27B07) |

The site runs on Somnia Shannon (chain 50312). Executing needs a wallet on Shannon with test collateral; previewing and reading receipts need nothing.

## What you see in 60 seconds

1. **Trade** shows the live DreamDEX book with depth bars, and an order ticket.
2. **Preview** walks the live book and shows two prices side by side: what one market order would pay, and what the Slice plan projects. The card is labelled PROJECTED and pinned to the block it read.
3. **Start Slice** asks the wallet for one signature that authorises exactly this market, this side, this many contracts, and an expiry. The server never holds your key.
4. **Working order** shows each child order as it fills, with its transaction link, and an engine log.
5. **Receipt** shows the verified average price, the savings against the market-order price, every child transaction, the book snapshot it was measured against, and the authorisation that was used.
6. **Set my exit** arms a take-profit, stop-loss, or "exit if the book thins" rule on-chain. Somnia Reactivity runs it whether or not the Slice server is up.

Every number on screen is marked LIVE, SNAPSHOT, PROJECTED, or VERIFIED, so a reader always knows whether they are looking at a forecast or a fact.

## How it works

1. **Read the book.** Before the first child order, Slice stores the full order book at a fixed block.
2. **Plan.** It walks that book to price a single market order, then builds a child-order plan. *Hide my size* shows the book only a small visible slice at a time; *Scale in* spreads the order across the market's remaining window.
3. **Execute.** Child orders go through the execution router under the user's signed grant. Orders stay owned by the user; the router can place them but cannot withdraw anything.
4. **Prove.** Fills are read back from on-chain `OrderFilled` events and transaction receipts, never from a local counter. The receipt compares those real fills with the stored snapshot.

If the live book cannot fill the requested size inside resting orders, the preview refuses. Slice does not guess at depth that is not there.

## What is on-chain

| Piece | Address |
| --- | --- |
| Session policy | `0x09113669c5D6E4f343966bDdF893Ad8Cb1f16c5A` |
| Execution router | `0xd67788012397291490A88657fB99e59b84a74A11` |
| Reactivity exit handler | `0x3B6F62b77f98B04170354D3AA68DF8038de27B07` |
| Reactivity emitter | `0xC5Fa5aA238977bcC7C05290De2F1714b11559027` |
| Reactivity subscription | `18329865` |
| Delegated executor (the only key the server holds) | `0x69eb1bAA26BffCD0fA9089aa2187F6Ca3e2A54f6` |

The browser signs an EIP-712 grant scoped to one market, one side, a contract cap, an expiry, and the executor address. The server checks that grant before every child order and honours on-chain revocation. For buys the wallet also approves collateral to the router; for sells it approves the outcome token. Both approvals are shown before signing.

**Quoting account.** The server can run a small, bounded two-sided quoting account so that there is a real book to measure against on testnet. It is on only when `QUOTER_ENABLED=true` and every size, spread, and refresh value is set. Its address is shown on the Proof page. That depth is disclosed, not presented as organic volume.

**If the server dies.** Child orders already on DreamDEX stay there and settle by the venue's rules; each carries its own expiry. Any registered exit rule keeps running through Somnia Reactivity. When the server returns it rebuilds the execution from chain receipts before continuing.

## What has actually run

The clearest receipt is a [333-contract scale-in](https://slice.54-154-121-30.sslip.io/r/8bf6c3ae-a05c-4212-a7b8-047823da29e4) on the ETH 4h market, run on 11 September 2026 against another participant's resting ladder, not against Slice's own quoter. Three children of 111 filled at 79.1¢, 70.9¢ and 63.9¢ across a six-minute window; the venue rejected the third child's first attempt and the retry filled. The snapshot priced a single sweep at 79.46¢ and Slice filled at 71.30¢, a raw saving of $27.17. The receipt then subtracts the mid-price move during the window (15.35¢ down, or $51.12 across the order) and reports net savings of **−$23.94**: most of the improvement came from the market falling, not from execution, and the receipt says so rather than claiming the raw number.

That run also surfaced a real bug. The first attempt at 500 contracts split into tranches of 166.666…, the venue lot grid rounded the first child to 166.666, and the engine tried to submit the 0.000666 remainder as its own child, which the venue rejects as below minimum. It ended `partial` and is published as such ([receipt](https://slice.54-154-121-30.sslip.io/r/6d9d2241-954b-4688-84fa-43dfc4266875)). Children are now snapped to the lot grid and dust is carried forward.

Before that, the store held six deliberately tiny test executions (0.011 contracts in total, savings rounding to zero): a [three-child hide-my-size run](https://slice.54-154-121-30.sslip.io/r/fcefedb5-6fcf-4668-a058-a95c57973b23), a [cancelled partial receipt](https://slice.54-154-121-30.sslip.io/r/a20af704-e084-4236-b867-d0ee90995e81), and a [three-tranche scale-in](https://slice.54-154-121-30.sslip.io/r/06160223-277d-4f2e-93ea-bfdcefe5ddbc). All of them stay visible. Every number is measured, none is extrapolated.

**The hard part was exits that keep working when the server is down.** Registering a Reactivity rule was easy; delivering it reliably was not. A subscription with no priority could be skipped, and once guaranteed delivery was on, a single expired rule could revert inside the router and take every other valid rule for that pool down with it. Slice now pays an explicit validator priority, uses a guaranteed subscription, and wraps each router attempt so a stale, revoked, expired or underfunded rule emits a failure event and evaluation continues. That handler was contract-tested, redeployed with verified source, and then proven with the API process stopped: fill [`0x2462…4070`](https://shannon-explorer.somnia.network/tx/0x24620dd5952560a311bb89ba04f8da6a6a62e440e29f255f5ad3fdb4a8e34070) caused the handler to send [`0xd7aa…4790`](https://shannon-explorer.somnia.network/tx/0xd7aae2ac7b2f840ad31b05741b21374771fcbbe1acf90c825afc830521904790) on its own. The capture is in [`evidence/reactivity-offline-2026-09-11.json`](evidence/reactivity-offline-2026-09-11.json).

## For scripts and agents

- **REST:** `POST /api/preview-impact`, `POST /api/executions`, `GET /api/executions/:id`, `GET /api/executions/:id/events`, `GET /api/receipts/:id`.
- **CCXT:** [`docs/ccxt.md`](docs/ccxt.md), with a working example in [`examples/ccxt-order.mjs`](examples/ccxt-order.mjs).
- **MCP:** [`docs/mcp.md`](docs/mcp.md). Discovery files for agents: [`AGENTS.md`](AGENTS.md) and [`SKILL.md`](SKILL.md).

## Run it yourself

Needs Node 20+, a PostgreSQL database, and network access to Somnia Shannon.

```sh
cp .env.example .env      # set DATABASE_URL; set EXECUTOR_PRIVATE_KEY only on a server you control
npm install
npm run build
npm test
npm run audit:integrity
npm run dev               # API on :8787, web app on :5173
```

The executor key is a delegated trading key for the server. It must never be a user's key.

`npm run audit:integrity` scans every production source file and fails on test doubles, placeholder controls, swallowed errors, hard-coded venue values, or buttons that do nothing.

## Repository map

```text
apps/web        React app: landing, trade terminal, executions, proof, integrations
apps/api        Execution engine, receipts, progress stream, CCXT and MCP surfaces
packages/core   Book walking, strategy planning, grant types shared by both
packages/mcp    MCP server exposing the five agent tools
contracts       Session policy, execution router, reactivity exit handler
deploy          systemd unit and Nginx config for the server
docs            Live venue findings, CCXT and MCP references
evidence        Captured live market, book, and Reactivity-offline responses
```

## Deployment

The engine, PostgreSQL, Nginx, and the delegated executor run on one server. The web app is a static build. Vercel hosts it at <https://slice-app-brown.vercel.app> using [`vercel.json`](vercel.json) with `VITE_API_URL` set to the API's public URL; the same Nginx host also serves it next to the API. See [`deploy/`](deploy/). Never put `DATABASE_URL`, `EXECUTOR_PRIVATE_KEY`, or any wallet key in a frontend host.

## Live venue notes

Recorded in [`docs/live-findings.md`](docs/live-findings.md). In short: Shannon is chain 50312; the event-contract surface is `@somnia-chain/markets-sdk` 0.29.0 or newer; markets are keyed by id and their pool address is resolved from the current on-chain record because pool addresses are reused across windows; the indexer is used for discovery but every write is gated by the live on-chain status.

## References

- DreamDEX event contracts: <https://app.dreamdex.io/docs/developers/event-contracts>
- Somnia on-chain Reactivity: <https://docs.somnia.network/developer/reactivity/reactivity-onchain.md>
- Somnia Shannon explorer: <https://shannon-explorer.somnia.network>
