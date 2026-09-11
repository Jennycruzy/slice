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

The first clean funded testnet run completed execution `ee9ac872-8f49-48ba-af44-28b49d3c1eb0` for a live BTC market. The child fill was recorded in transaction [`0x2fc7ea6322148b3b517c6e32510b56fbbca0e9e6119b9dd6256d1b0d7f6c4604`](https://shannon-explorer.somnia.network/tx/0x2fc7ea6322148b3b517c6e32510b56fbbca0e9e6119b9dd6256d1b0d7f6c4604). The non-custodial router used for that run was [`0x359E4Ed4bC31f324771461b5659Ef786913D4C71`](https://shannon-explorer.somnia.network/address/0x359E4Ed4bC31f324771461b5659Ef786913D4C71), deployed in [`0x28bcb9e541f755403e41d93b04000f87de91481a049647f57a69dbfe29e50c64`](https://shannon-explorer.somnia.network/tx/0x28bcb9e541f755403e41d93b04000f87de91481a049647f57a69dbfe29e50c64). The router has since been redeployed; the current address, `0xd67788012397291490A88657fB99e59b84a74A11`, is the one reported by `/health` and linked from the README. No private key is stored in this findings file.

## Reactivity decision and live proof

DreamDEX emits `OrderFilled(uint128,uint128,uint256,uint256,uint256,uint256)`, which the handler consumes directly; no adapter or server listener is involved. The hardened handler is [`0x3B6F62b77f98B04170354D3AA68DF8038de27B07`](https://shannon-explorer.somnia.network/address/0x3B6F62b77f98B04170354D3AA68DF8038de27B07), deployed in [`0x4b4c3198d550bf4b22c4568d560879c902062542d17f1abaa3f152d9ca871911`](https://shannon-explorer.somnia.network/tx/0x4b4c3198d550bf4b22c4568d560879c902062542d17f1abaa3f152d9ca871911) and verified on the explorer. Guaranteed subscription `18329865` was created in [`0x8e3f55776b38cf0016a527658a000654de43ee2c2226dfc4daf314b4e91b89ba`](https://shannon-explorer.somnia.network/tx/0x8e3f55776b38cf0016a527658a000654de43ee2c2226dfc4daf314b4e91b89ba).

The server-offline gate passed on 2026-09-11. Rule registration [`0xce96334efcae8ec72b2e3e47bb0cf3c239fd144bd22858320bf70c2336b4d896`](https://shannon-explorer.somnia.network/tx/0xce96334efcae8ec72b2e3e47bb0cf3c239fd144bd22858320bf70c2336b4d896) created rule `0x9d1d…37f2`. With `slice-api.service` confirmed `inactive`, source fill [`0x24620dd5952560a311bb89ba04f8da6a6a62e440e29f255f5ad3fdb4a8e34070`](https://shannon-explorer.somnia.network/tx/0x24620dd5952560a311bb89ba04f8da6a6a62e440e29f255f5ad3fdb4a8e34070) caused the autonomous callback [`0xd7aae2ac7b2f840ad31b05741b21374771fcbbe1acf90c825afc830521904790`](https://shannon-explorer.somnia.network/tx/0xd7aae2ac7b2f840ad31b05741b21374771fcbbe1acf90c825afc830521904790). The rule became inactive and emitted no failure attempt. The API was restarted and returned healthy afterward.

## Sized execution on organic depth

On 2026-09-11 a 333-contract YES buy was worked as a three-tranche scale-in on the ETH 4h market (`…01a520`) against another participant's resting ask ladder (200 / 330 / 460 contracts at three prices). Owner `0x39Dd…be96`, grant registered in [`0x6de8…4f9a`](https://shannon-explorer.somnia.network/tx/0x6de89d14910c36e94dfb45b6065d19c8492f164aca805c16c6810cc3636c4f9a). Children: 111 @ 0.791 ([`0xd2d7…b997`](https://shannon-explorer.somnia.network/tx/0xd2d7d7c563250d22d6d02477d26579cae379bae417c558673cf2b79cce46b997)), 111 @ 0.709 ([`0xb723…ab5b`](https://shannon-explorer.somnia.network/tx/0xb723405873d6865eb7df162d5c5e02fe229894dbc84154bd9251cded688fab5b)), and 111 @ 0.639 ([`0x46f2…f2af`](https://shannon-explorer.somnia.network/tx/0x46f2fa1dab5afd0e806f567ebbb02b5a8390775cd9a73f3207c7d3ac55dcf2af)) after the venue rejected the first attempt in [`0x2cfc…e2ca`](https://shannon-explorer.somnia.network/tx/0x2cfce5f459811420d0c04bf26cfee43e3b591fbc41df8d1b0791fc32aab7e2ca) and the retry path recovered it. Receipt [`8bf6c3ae`](https://slice.54-154-121-30.sslip.io/r/8bf6c3ae-a05c-4212-a7b8-047823da29e4): naive 0.7946, actual 0.7130, raw savings $27.17, mid move −0.1535, drift adjustment −$51.12, net −$23.94.

The preceding 500-contract attempt ([`6d9d2241`](https://slice.54-154-121-30.sslip.io/r/6d9d2241-954b-4688-84fa-43dfc4266875)) filled one child of 166.666 @ 0.73 and then ended `partial` because the engine submitted the lot-grid remainder (0.000666) as a child below the venue minimum. The engine now snaps every child to the lot grid, carries dust into the next tranche, and treats a remainder below the minimum as filled.

## Additional live execution evidence

- Three-child iceberg: [`fcefedb5`](https://slice.54-154-121-30.sslip.io/r/fcefedb5-6fcf-4668-a058-a95c57973b23).
- Cancelled partial execution: [`a20af704`](https://slice.54-154-121-30.sslip.io/r/a20af704-e084-4236-b867-d0ee90995e81).
- Tightening scale-in schedule: [`06160223`](https://slice.54-154-121-30.sslip.io/r/06160223-277d-4f2e-93ea-bfdcefe5ddbc).
- CCXT real write: [`e4317259`](https://slice.54-154-121-30.sslip.io/r/e4317259-80bb-4a2a-bb66-4906cd6147e6).
- MCP real write: [`dd39958f`](https://slice.54-154-121-30.sslip.io/r/dd39958f-0c4c-4339-9941-968c9aeb905b).
- The separate quoter address is `0x5e45e1749E1559ABAA6552d8B9908A08D20998F2`; production health reported it running with two open quotes.

Expired and revoked session grants were deliberately refused by the API with HTTP 403 before child placement. The router test suite independently covers wrong assets, revoked and expired grants, executor mismatch, cap exhaustion, partial fills, unfilled orders, and collateral refunds.

## Known limitations

- Reactivity entry rules have contract and live-path support; the exit path is the one proven with the server offline above.

## Future validation

- Capture the autonomous trigger for a Reactivity entry rule and link it here.
- Record the failure-state screenshot set (thin book, expired grant, engine offline, WebSocket drop) alongside the demo video.
