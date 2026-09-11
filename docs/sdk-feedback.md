# Feedback on the DreamDEX and Somnia developer surface

Notes from building Slice against the live Shannon testnet, 9–11 September 2026. Each point cost real time and would help the next builder if it were in the docs or the SDK.

## DreamDEX event contracts

1. **Pool addresses are reused across market windows.** A pool address is not a stable key for a market; the market id is. Slice resolves the pool from the current on-chain market record on every write. The docs should say this plainly on the event-contracts page.
2. **The indexer and the chain can disagree on whether a market is trading.** Discovery through the GraphQL indexer is fine, but every write must be gated on the on-chain status. A one-line warning in the SDK reference would save a wasted rejected transaction.
3. **`placeBinaryOrderFor` is allow-listed.** Third-party non-custodial execution therefore needs its own router contract that calls the public placement function. Documenting the allow-list, and how to apply for it, would remove a whole contract from most integrations.
4. **Empty books are common on testnet.** The SDK returns them correctly, but an example showing how to distinguish "no depth" from "not loaded yet" would help; several early UI bugs came from treating the two the same.
5. **Grid parameters (tick, lot, minimum) are exposed but easy to miss.** A helper that rounds a price and quantity to the live grid in one call would prevent silent rejections.

## Somnia Reactivity

6. **A zero-priority subscription can be skipped.** This is by design, but the getting-started example does not set a priority, so the first "it never fired" is confusing. The example should pay an explicit priority and say why.
7. **One reverting rule reverts the whole callback.** If a handler evaluates several rules and one of them reverts inside a downstream call, every other rule for that event is lost. The docs should recommend isolating each downstream attempt and emitting a failure event, which is what Slice now does. A worked example would be valuable.
8. **Replacing a subscription is hard to verify.** Slice added its own check that the new subscription id is live before retiring the old one; a documented way to read subscription state would make this unnecessary.

## What worked well

- `@somnia-chain/markets-sdk` 0.29 React hooks (`useLiveBinaryOrderBook`, `useWatchMarket`, `useLiveStatus`) gave a streaming book with very little code.
- Guaranteed Reactivity delivery, once configured with a priority, fired the exit handler with the Slice server stopped. That proof is linked in [`live-findings.md`](live-findings.md).
