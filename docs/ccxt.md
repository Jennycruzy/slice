# CCXT integration

> **Prediction markets have order books but no execution tools. Every serious trader silently overpays on entry. Slice is the first product that fixes it.**

Slice exposes the live DreamDEX event-contract book through a small HTTP surface and a working `ccxt.Exchange` client. It is intentionally narrow: market discovery and order-book reads are available without credentials; execution still requires an owner-signed Slice session grant.

Base URL: `SLICE_API_URL`.

- `GET /ccxt/markets` returns active binary markets with `id`, `symbol`, `base`, `quote`, and the live market metadata in `info`.
- `GET /ccxt/orderbook?marketId=<bytes32>&outcome=YES` returns `bids`, `asks`, `timestamp`, `datetime`, and `nonce` in the familiar CCXT shape.
- `POST /ccxt/order` accepts the standard CCXT order envelope `{ symbol, type, side, amount, params }`. `type` is `market`; `params` carries `marketId`, `outcome`, `strategy`, and the signed `sessionGrant`.
- `GET /ccxt/order/:id` returns the live execution status in a CCXT order shape, including filled amount, average, and the public receipt when available.

The adapter does not mislabel an event market as an ordinary CCXT spot symbol. Event contracts remain binary; `outcome` is explicit so a caller cannot accidentally trade the wrong leg.

## Example

See [`examples/ccxt-order.mjs`](../examples/ccxt-order.mjs). It subclasses `ccxt.Exchange`, calls `loadMarkets`, `fetchOrderBook`, and `createOrder`, and uses only public reads unless a signed `SLICE_SESSION_GRANT` plus `SLICE_ORDER_AMOUNT` are supplied. A third-party client must obtain that grant in its own wallet-signing flow; no private key is sent to Slice.

The example chooses the first market returned by the live venue unless `SLICE_SYMBOL` is set. It never embeds a market id, price, or size.
