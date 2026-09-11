# Live venue findings

Captured 2026-09-09 against Somnia Shannon (`50312`). These findings are read from the live DreamDEX Event Contract surface; they are not generated from a local fixture.

## Read path: verified

- `@somnia-chain/markets-sdk` `0.29.0` constructs with `SOMNIA_TESTNET_ADDRESSES` and discovers binary markets from `https://dev.smk.somnia.host/v1/graphql`.
- `listLiveBinaryMarkets` followed by `getMarketOnchain` returned live markets with on-chain status `1` (Trading).
- The SDK resolves a pool for each market. The captured BTC market and grid are in [`../evidence/live-markets-2026-09-09.json`](../evidence/live-markets-2026-09-09.json).
- The server pins `getAllOpenOrdersOffChain` calls to one latest block, paginates both bid and ask sides, removes expired orders using that block timestamp, and aggregates the remaining levels.
- A current RPC capture is in [`../evidence/live-book-2026-09-09.json`](../evidence/live-book-2026-09-09.json). It is an empty book, so no fabricated price is displayed and a non-zero preview is refused.
- The SDK exposes binary grid parameters. The observed testnet grid was tick size `1000`, minimum quantity `1000`, and lot size `1000` at six decimals.

## Binary write shape: verified live

The SDK and DreamDEX event-contract documentation expose `placeBinaryOrderFor(owner, kind, price, quantity, expireTimestampNs, orderType, selfMatchingOption, builder, builderFeeBpsTimes1k, userData)`. Slice uses the live pool's current executable touch, converts NO prices into the shared YES-price book, rounds to the live tick and lot grid, submits IOC orders, waits for the receipt, and records only decoded `OrderFilled` events.

The first clean funded testnet run completed execution `ee9ac872-8f49-48ba-af44-28b49d3c1eb0` for a live BTC market. The child fill was recorded in transaction [`0x2fc7ea6322148b3b517c6e32510b56fbbca0e9e6119b9dd6256d1b0d7f6c4604`](https://shannon-explorer.somnia.network/tx/0x2fc7ea6322148b3b517c6e32510b56fbbca0e9e6119b9dd6256d1b0d7f6c4604). The corrected non-custodial router is [`0x359E4Ed4bC31f324771461b5659Ef786913D4C71`](https://shannon-explorer.somnia.network/address/0x359E4Ed4bC31f324771461b5659Ef786913D4C71), deployed in [`0x28bcb9e541f755403e41d93b04000f87de91481a049647f57a69dbfe29e50c64`](https://shannon-explorer.somnia.network/tx/0x28bcb9e541f755403e41d93b04000f87de91481a049647f57a69dbfe29e50c64). No private key is stored in this findings file.

## Reactivity decision

DreamDEX emits `OrderFilled(uint128,uint128,uint256,uint256,uint256,uint256)`, which is the event the handler filters. The corrected handler is [`0xBd806E88fD6eF654707560A8db656CA7542f8A63`](https://shannon-explorer.somnia.network/address/0xBd806E88fD6eF654707560A8db656CA7542f8A63), deployed in [`0x3639a7a242fd6939e81bf3cec02259f7f626f832b7568185571801b964f4bfbc`](https://shannon-explorer.somnia.network/tx/0x3639a7a242fd6939e81bf3cec02259f7f626f832b7568185571801b964f4bfbc). Subscription `18195808` was created for the live BTC pool and is configured in the deployed API; its creation transaction is [`0xcafeccb81a22370b18e10936289b119985d3a5fd7bd02abcbc98ac2c7c40296e`](https://shannon-explorer.somnia.network/tx/0xcafeccb81a22370b18e10936289b119985d3a5fd7bd02abcbc98ac2c7c40296e). A real rule registration is active, but the server-offline invocation gate still needs a captured trigger.

## Constraints still requiring evidence

- Capture a real multi-child fill and a deliberate partial execution/cancel receipt.
- Capture venue behaviour for no-fill and partial IOC results, rate limits, transaction replacement, and any order-cancel path exposed by the deployed pool.
- Run the session-policy registration and verify that an expired or revoked digest is rejected before the next child.
- Trigger the active Reactivity rule with the server stopped and save the transaction evidence.
- Run and evidence the disclosed quoting bot, CCXT write example, and MCP write path.

Until those checks have evidence, the product is not done.
