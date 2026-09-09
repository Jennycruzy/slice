# Slice agent interface

Slice is an execution service for live DreamDEX Event Contracts on Somnia Shannon.

Before acting:

1. Call `list_markets` and choose a currently trading market. Do not invent a market identifier.
2. Call `preview_impact` with the requested market, side, and size. A preview that cannot walk the requested size is a refusal, not a projected fill.
3. Call `execute_order` only after the user has reviewed the live snapshot, strategy, scope, and expiry. The server requires a verified browser grant for user-owned execution.
4. Poll `get_execution_status` until it reaches a terminal state, then call `get_receipt`.

Every receipt is public and wallet-free. Treat its snapshot, fill list, block numbers, and transaction links as the source of truth.

The one-liner for the product is:

> **Prediction markets have order books but no execution tools. Every serious trader silently overpays on entry. Slice is the first product that fixes it.**
