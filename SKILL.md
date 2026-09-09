---
name: slice-execution
description: Execute and verify worked orders on live DreamDEX Event Contracts through Slice.
---

# Slice execution skill

Use the Slice MCP surface for live event-contract execution.

> **Prediction markets have order books but no execution tools. Every serious trader silently overpays on entry. Slice is the first product that fixes it.**

## Safety boundary

Never request or transmit a user's private key. A user signs the scoped EIP-712 grant in their wallet. The Slice server may hold only its configured delegated executor key, and the venue keeps orders owned by the user.

## Workflow

- Discover a live market with `list_markets`.
- Inspect current depth with `preview_impact`.
- Confirm the market, side, size, strategy, and grant expiry with the user.
- Start an order with `execute_order`.
- Monitor `get_execution_status`.
- Fetch `get_receipt` and surface every child transaction link.

If a response reports a thin book, expired grant, venue rejection, reconnect, or server liveness issue, explain the state and offer the supported next action. Do not claim a fill from a requested amount.
