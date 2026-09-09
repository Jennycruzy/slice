import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = (process.env.SLICE_API_URL ?? "http://localhost:8787").replace(/\/$/, "");

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const marketId = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const quantity = z.string().regex(/^\d+(?:\.\d+)?$/);
const grant = z.object({
  grantId: z.string().min(1),
  owner: address,
  executor: address,
  marketId,
  outcome: z.enum(["YES", "NO"]),
  side: z.enum(["buy", "sell"]),
  maxContracts: quantity,
  issuedAt: z.number().int(),
  expiresAt: z.number().int(),
  nonce: z.string().regex(/^\d+$/),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

async function callApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new Error(`Slice API returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body ? String(body.error) : `Slice API request failed (${response.status})`;
    throw new Error(message);
  }
  return body as T;
}

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

const server = new McpServer({ name: "slice-execution", version: "0.1.0" });

server.registerTool("list_markets", {
  title: "List live event markets",
  description: "Return only active DreamDEX binary event markets from the live venue.",
}, async () => result(await callApi("/api/markets")));

server.registerTool("preview_impact", {
  title: "Preview execution impact",
  description: "Walk the current live book and compare a naive market fill with a worked strategy. This does not submit a transaction.",
  inputSchema: {
    marketId,
    outcome: z.enum(["YES", "NO"]),
    side: z.enum(["buy", "sell"]),
    quantity,
    strategy: z.enum(["iceberg", "scale-in"]),
  },
}, async (input) => result(await callApi("/api/preview-impact", { method: "POST", body: JSON.stringify(input) })));

server.registerTool("execute_order", {
  title: "Execute a worked order",
  description: "Start a live Slice execution. The sessionGrant must be EIP-712 signed by the owner; this tool never accepts or requests a private key.",
  inputSchema: {
    owner: address,
    marketId,
    outcome: z.enum(["YES", "NO"]),
    side: z.enum(["buy", "sell"]),
    quantity,
    strategy: z.enum(["iceberg", "scale-in"]),
    sessionGrant: grant,
  },
}, async (input) => result(await callApi("/api/executions", { method: "POST", body: JSON.stringify(input) })));

server.registerTool("get_execution_status", {
  title: "Get execution status",
  description: "Read chain-reconciled progress, children, fills, and heartbeat for an execution.",
  inputSchema: { executionId: z.string().uuid() },
}, async ({ executionId }) => result(await callApi(`/api/executions/${encodeURIComponent(executionId)}`)));

server.registerTool("get_receipt", {
  title: "Get execution receipt",
  description: "Return the public receipt with its exact submission snapshot, walked comparison, fills, and transaction hashes.",
  inputSchema: { receiptId: z.string().uuid() },
}, async ({ receiptId }) => result(await callApi(`/api/receipts/${encodeURIComponent(receiptId)}`)));

const transport = new StdioServerTransport();
await server.connect(transport);
