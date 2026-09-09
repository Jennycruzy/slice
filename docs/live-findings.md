# Live venue findings

Captured 2026-09-09 against Somnia Shannon (`50312`). These findings are read from the live DreamDEX Event Contract surface; they are not generated from a local fixture.

## Read path: verified

- `@somnia-chain/markets-sdk` `0.29.0` constructs with `SOMNIA_TESTNET_ADDRESSES` and discovers binary markets from `https://dev.smk.somnia.host/v1/graphql`.
- `listLiveBinaryMarkets` followed by `getMarketOnchain` returned live markets with on-chain status `1` (Trading).
- The SDK resolves a pool for each market. The captured BTC market and grid are in [`../evidence/live-markets-2026-09-09.json`](../evidence/live-markets-2026-09-09.json).
- The server pins `getAllOpenOrdersOffChain` calls to one latest block, paginates both bid and ask sides, removes expired orders using that block timestamp, and aggregates the remaining levels.
- A current RPC capture is in [`../evidence/live-book-2026-09-09.json`](../evidence/live-book-2026-09-09.json). It is an empty book, so no fabricated price is displayed and a non-zero preview is refused.
- The SDK exposes binary grid parameters. The observed testnet grid was tick size `1000`, minimum quantity `1000`, and lot size `1000` at six decimals.

## Binary write shape: implementation target, live write gate pending

The SDK and DreamDEX event-contract documentation expose `placeBinaryOrderFor(owner, kind, price, quantity, expireTimestampNs, orderType, selfMatchingOption, builder, builderFeeBpsTimes1k, userData)`. Slice uses the live pool's current executable touch, converts NO prices into the shared YES-price book, rounds to the live tick and lot grid, submits IOC orders, waits for the receipt, and records only decoded `OrderFilled` events.

The repository does not claim this write path is live-complete until a funded testnet run produces a real child-order transaction hash and a receipt. No private key is stored in this findings file.

## Reactivity decision

DreamDEX emits `OrderFilled(uint128,uint128,uint256,uint256,uint256,uint256)`, which is the event the handler is written to filter. The handler also reads the pool book and submits the owner-scoped binary exit. The subscription itself must be created with the deployed handler and the live pool emitter; the minimum reactivity owner balance and the deployment addresses are environment-specific. Until that subscription has been created and a real handler invocation has been observed, the stop-loss gate remains pending.

## Constraints still requiring a funded venue run

- Confirm `placeBinaryOrderFor` succeeds for a server executor with the owner-scoped escrow approvals and the exact testnet pool.
- Capture venue behaviour for no-fill and partial IOC results, rate limits, transaction replacement, and any order-cancel path exposed by the deployed pool.
- Run the session-policy registration and verify that an expired or revoked digest is rejected before the next child.
- Deploy and verify `SliceSessionPolicy` and `SliceExitHandler`, create the subscription, and test the server-offline stop-loss.

Until those checks have evidence, the product is not done.
