import { useEffect, useMemo, useState } from "react";
import { useLiveBinaryOrderBook, useLiveStatus, useWatchMarket } from "@somnia-chain/markets-sdk/react";
import { erc20WriteAbi, erc6909Abi } from "@somnia-chain/markets-sdk";
import { formatUnits, parseEventLogs, parseUnits, type Address, type Hex } from "viem";
import { useAccount, useConnect, useDisconnect, usePublicClient, useSignTypedData, useSwitchChain, useWriteContract } from "wagmi";
import {
  SESSION_GRANT_TYPES,
  grantDomain,
  grantMessage,
  type BookLevel,
  type BookSnapshot,
  type ExecutionMetrics,
  type ExitRule,
  type Receipt,
  type SessionGrant,
  type StrategyName,
} from "@slice/core";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const SESSION_DURATION_SECONDS = Number(import.meta.env.VITE_SESSION_DURATION_SECONDS ?? "3600");
const SESSION_POLICY_ABI = [{
  type: "function",
  name: "revoke",
  stateMutability: "nonpayable",
  inputs: [{ name: "digest", type: "bytes32" }],
  outputs: [],
}] as const;
const EXIT_HANDLER_ABI = [{
  type: "function",
  name: "registerRule",
  stateMutability: "nonpayable",
  inputs: [
    { name: "pool", type: "address" },
    { name: "exitKind", type: "uint8" },
    { name: "trigger", type: "uint8" },
    { name: "oneCollateral", type: "uint256" },
    { name: "triggerPrice", type: "uint256" },
    { name: "minimumBestLevelQuantity", type: "uint256" },
    { name: "quantity", type: "uint256" },
    { name: "expireTimestampNs", type: "uint64" },
    { name: "collateral", type: "address" },
    { name: "outcomeToken", type: "address" },
    { name: "outcomeTokenId", type: "uint256" },
    {
      name: "grant",
      type: "tuple",
      components: [
        { name: "owner", type: "address" },
        { name: "executor", type: "address" },
        { name: "marketId", type: "bytes32" },
        { name: "pool", type: "address" },
        { name: "collateral", type: "address" },
        { name: "outcomeToken", type: "address" },
        { name: "outcomeTokenId", type: "uint256" },
        { name: "oneCollateral", type: "uint256" },
        { name: "outcome", type: "uint8" },
        { name: "side", type: "uint8" },
        { name: "maxContracts", type: "uint256" },
        { name: "issuedAt", type: "uint64" },
        { name: "expiresAt", type: "uint64" },
        { name: "nonce", type: "uint256" },
      ],
    },
    { name: "signature", type: "bytes" },
  ],
  outputs: [{ name: "ruleId", type: "bytes32" }],
}, {
  type: "event",
  name: "RuleRegistered",
  inputs: [
    { name: "ruleId", type: "bytes32", indexed: true },
    { name: "owner", type: "address", indexed: true },
    { name: "pool", type: "address", indexed: true },
    { name: "exitKind", type: "uint8", indexed: false },
    { name: "trigger", type: "uint8", indexed: false },
    { name: "quantity", type: "uint256", indexed: false },
  ],
}] as const;

interface MarketSummary {
  id: string;
  name: string;
  question: string | null;
  asset: string;
  interval: string | null;
  expiry: string;
  tradingStart: string;
  pool: Address;
  decimals: number;
  collateral: Address;
  outcomeToken: Address;
  yesTokenId: string;
  noTokenId: string;
  outcomes: Array<{ label: "YES" | "NO"; symbol: string }>;
}

interface ImpactPreview {
  market: MarketSummary;
  snapshot: BookSnapshot;
  strategy: {
    displayQuantity: string | null;
    estimatedSlices: number | null;
    projectedAveragePrice: string | null;
    projectedSavings: string | null;
  };
  canSubmit: boolean;
  refusalReason: string | null;
}

interface Health {
  status: string;
  network: string;
  chainId: number;
  executorConfigured: boolean;
  sessionPolicyConfigured: boolean;
  executionRouterConfigured: boolean;
  executorAddress: Address | null;
  sessionPolicyAddress: Address | null;
  executionRouterAddress: Address | null;
  explorerUrl: string;
  reactivityConfigured: boolean;
  reactivityHandlerAddress: Address | null;
  reactivityEmitterAddress: Address | null;
  reactivitySubscriptionId: string | null;
  quoter?: { enabled: boolean; running: boolean; lastError: string | null; openQuotes: number; lastMarketId?: string | null };
  lastHeartbeatAt: string;
}

type AppView = "landing" | "trade" | "executions" | "proof" | "integrations";

const VIEW_PATHS: Record<AppView, string> = {
  landing: "/",
  trade: "/trade",
  executions: "/executions",
  proof: "/proof",
  integrations: "/integrations",
};

function viewFromPath(pathname: string): AppView {
  if (pathname.startsWith("/trade")) return "trade";
  if (pathname.startsWith("/executions")) return "executions";
  if (pathname.startsWith("/proof")) return "proof";
  if (pathname.startsWith("/integrations")) return "integrations";
  return "landing";
}

interface PublicExecution {
  id: string;
  request: Omit<ExecutionRequestForUi, "sessionGrant">;
  snapshot: BookSnapshot;
  state: string;
  children: ChildForUi[];
  fills: FillForUi[];
  metrics: ExecutionMetrics | null;
  completionMidPrice: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  cancelRequested: boolean;
  heartbeatAt: string;
  completedAt: string | null;
  receiptUrl: string | null;
  exitRule: ExitRule | null;
}

interface ExecutionRequestForUi {
  owner: Address;
  marketId: string;
  symbol: string;
  outcome: "YES" | "NO";
  marketName: string;
  marketPool?: Address;
  marketDecimals?: number;
  marketExpiry?: string;
  marketCollateral?: Address;
  marketOutcomeToken?: Address;
  marketYesTokenId?: string;
  marketNoTokenId?: string;
  side: "buy" | "sell";
  quantity: string;
  strategy: StrategyName;
  displayQuantity?: string;
  windowStart?: string;
  windowEnd?: string;
  sessionGrant: SessionGrant;
}

interface ChildForUi {
  id: string;
  sequence: number;
  requestedQuantity: string;
  filledQuantity: string;
  averagePrice: string | null;
  status: string;
  orderId: string | null;
  transactionHash: Hex | null;
  rejectionReason: string | null;
  placedAt?: string;
  updatedAt?: string;
}

interface FillForUi {
  id: string;
  quantity: string;
  price: string;
  quote: string;
  transactionHash: Hex;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }), ...(init?.headers ?? {}) },
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new Error(`Slice API returned invalid JSON: ${errorText(error)}`);
  }
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body ? String(body.error) : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body as T;
}

function shortAddress(address: string | null | undefined): string {
  return address === undefined || address === null ? "—" : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function human(value: bigint | string | number, decimals: number): string {
  if (typeof value === "bigint") return formatUnits(value, decimals);
  if (typeof value === "number" && !Number.isInteger(value)) return String(value);
  if (typeof value === "string" && /[.eE]/.test(value)) return value;
  return formatUnits(BigInt(value), decimals);
}

function cents(value: string | null): string {
  return value === null ? "—" : `${(Number(value) * 100).toFixed(2)}¢`;
}

function dollars(value: string | null): string {
  if (value === null) return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  const precision = amount !== 0 && Math.abs(amount) < 0.01 ? 4 : 2;
  return `$${amount.toFixed(precision)}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isoOrUndefined(value: string): string | undefined {
  if (value.trim() === "") return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Use a valid execution window date and time");
  return parsed.toISOString();
}

function strategyLabel(strategy: StrategyName): string {
  return strategy === "iceberg" ? "Hide my size" : "Scale in";
}

function explorerTx(explorerUrl: string, hash: string): string {
  return `${explorerUrl.replace(/\/$/, "")}/tx/${hash}`;
}

function centsToRaw(value: string, decimals: number): bigint {
  const cents = parseUnits(value, 2);
  const scale = 10n ** BigInt(decimals);
  return cents * scale / 100n;
}

function triggerLabel(kind: ExitRule["kind"]): string {
  return kind === "take-profit" ? "Take profit" : kind === "stop-loss" ? "Stop loss" : "Exit if book thins";
}

function receiptUrl(receipt: Receipt): string {
  return `${API_URL}/r/${receipt.id}`;
}

function timeRemaining(expiry: string): string {
  const seconds = Math.max(0, Number(expiry) - Math.floor(Date.now() / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function statusClass(live: boolean): string {
  return live ? "status-live" : "status-down";
}

function MarketHeader({ market, health }: { market: MarketSummary; health: Health | null }) {
  const status = useWatchMarket(market.pool);
  const tail = useLiveStatus();
  const book = useLiveBinaryOrderBook(market.pool, 2);
  const yes = book.yesAsks[0] ?? book.yesBids[0];
  const no = book.noAsks[0] ?? book.noBids[0];
  const streaming = status === "live" && tail.wsConnected;
  return <section className="market-header">
    <div><span className="terminal-label">Live DreamDEX market</span><h1>{market.name}</h1><p>{market.asset} · {market.interval ?? "event contract"}</p></div>
    <div className="market-prices"><div><span>YES</span><strong>{yes ? cents(human(yes.price, market.decimals)) : "—"}</strong></div><div><span>NO</span><strong>{no ? cents(human(no.price, market.decimals)) : "—"}</strong></div></div>
    <div className="market-meta"><span>Expires in <strong>{timeRemaining(market.expiry)}</strong></span><span className={statusClass(streaming)}><i />{streaming ? "Streaming" : "Connecting"}</span><span>{health?.network ?? "Somnia Shannon"}</span></div>
  </section>;
}

function LiveLadder({ market, outcome }: { market: MarketSummary; outcome: "YES" | "NO" }) {
  const watchStatus = useWatchMarket(market.pool);
  const tail = useLiveStatus();
  const binaryBook = useLiveBinaryOrderBook(market.pool, 10);
  const bids = outcome === "YES" ? binaryBook.yesBids : binaryBook.noBids;
  const asks = outcome === "YES" ? binaryBook.yesAsks : binaryBook.noAsks;
  const rows = Math.max(bids.length, asks.length);
  const maximumSize = Math.max(1, ...bids.map((level) => Number(human(level.quantity, market.decimals))), ...asks.map((level) => Number(human(level.quantity, market.decimals))));
  const bidPercent = (index: number) => bids[index] ? Math.max(2, Number(human(bids[index]!.quantity, market.decimals)) / maximumSize * 100) : 0;
  const askPercent = (index: number) => asks[index] ? Math.max(2, Number(human(asks[index]!.quantity, market.decimals)) / maximumSize * 100) : 0;
  const bestBid = bids[0] ? Number(human(bids[0].price, market.decimals)) : null;
  const bestAsk = asks[0] ? Number(human(asks[0].price, market.decimals)) : null;
  const spread = bestBid !== null && bestAsk !== null ? (bestAsk - bestBid) * 100 : null;
  const visibleDepth = [...bids, ...asks].reduce((sum, level) => sum + Number(human(level.quantity, market.decimals)), 0);

  return (
    <section className="book-panel" aria-label={`${outcome} live order book`}>
      <div className="panel-heading">
        <div>
          <span className="section-kicker">Live book</span>
          <h2>{outcome} depth</h2>
        </div>
        <span className={`live-indicator ${watchStatus === "live" && tail.wsConnected ? "is-live" : "is-waiting"}`}>
          <span aria-hidden="true" /> {watchStatus === "live" && tail.wsConnected ? "Streaming" : watchStatus === "hydrating" ? "Connecting" : "Waiting"}
        </span>
      </div>
      {watchStatus === "hydrating" && <p className="inline-note">Hydrating the live book over Somnia WebSocket…</p>}
      {watchStatus === "live" && rows === 0 && <div className="empty-state terminal-empty"><strong>No resting depth</strong><span>The current DreamDEX window has no executable {outcome} levels. Slice will not invent liquidity.</span></div>}
      {rows > 0 && <div className="book-stats"><span>Spread <strong>{spread === null ? "—" : `${spread.toFixed(2)}¢`}</strong></span><span>Best bid <strong>{bestBid === null ? "—" : `${(bestBid * 100).toFixed(2)}¢`}</strong></span><span>Best ask <strong>{bestAsk === null ? "—" : `${(bestAsk * 100).toFixed(2)}¢`}</strong></span><span>Visible depth <strong>{visibleDepth.toLocaleString(undefined, { maximumFractionDigits: 3 })}</strong></span></div>}
      {rows > 0 && (
        <div className="book-table-wrap">
          <table className="book-table">
            <thead><tr><th scope="col">Bid size</th><th scope="col">Bid</th><th scope="col">Ask</th><th scope="col">Ask size</th></tr></thead>
            <tbody>
              {Array.from({ length: rows }, (_, index) => {
                const bid = bids[index];
                const ask = asks[index];
                return <tr key={`${bid?.price ?? "none"}-${ask?.price ?? "none"}`}>
                  <td className="bid-number depth-cell">{bid && <><span className="depth-fill bid-fill" style={{ width: `${bidPercent(index)}%` }} /><span className="depth-value">{human(bid.quantity, market.decimals)}</span></>}</td>
                  <td className="bid-number">{bid ? cents(human(bid.price, market.decimals)) : ""}</td>
                  <td className="ask-number">{ask ? cents(human(ask.price, market.decimals)) : ""}</td>
                  <td className="ask-number depth-cell">{ask && <><span className="depth-fill ask-fill" style={{ width: `${askPercent(index)}%` }} /><span className="depth-value">{human(ask.quantity, market.decimals)}</span></>}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="source-note">LIVE · DreamDEX order book · block {tail.lastBlock > 0 ? tail.lastBlock : "pending"}</p>
    </section>
  );
}

function SnapshotLadder({ snapshot }: { snapshot: BookSnapshot }) {
  const asks = snapshot.book.asks.slice(0, 8);
  const bids = snapshot.book.bids.slice(0, 8);
  return <details className="snapshot-details">
    <summary>Book snapshot · block {snapshot.blockNumber} · {new Date(snapshot.capturedAt).toLocaleString()}</summary>
    <div className="snapshot-grid">
      <div><h3>Asks at submission</h3><SnapshotLevels levels={asks} /></div>
      <div><h3>Bids at submission</h3><SnapshotLevels levels={bids} /></div>
    </div>
  </details>;
}

function SnapshotLevels({ levels }: { levels: BookLevel[] }) {
  return <table className="mini-table"><thead><tr><th>Price</th><th>Contracts</th></tr></thead><tbody>{levels.map((level) => <tr key={`${level.price}-${level.quantity}`}><td>{cents(level.price)}</td><td>{level.quantity}</td></tr>)}</tbody></table>;
}

function GrantScope({ grant, marketName, decimals = 6 }: { grant: SessionGrant; marketName: string; decimals?: number }) {
  return <div className="grant-scope" aria-label="Session authorisation scope">
    <div><span>Market</span><strong>{marketName}</strong></div>
    <div><span>Outcome / side</span><strong>{grant.outcome} · {grant.side}</strong></div>
    <div><span>Maximum</span><strong>{human(grant.maxContracts, decimals)} contracts</strong></div>
    <div><span>Expires</span><strong>{new Date(grant.expiresAt * 1000).toLocaleString()}</strong></div>
  </div>;
}

function BeforeState({
  markets,
  setMarkets,
  marketsLoading,
  selected,
  setSelected,
  outcome,
  setOutcome,
  side,
  setSide,
  quantity,
  setQuantity,
  strategy,
  setStrategy,
  preview,
  setPreview,
  health,
  onStarted,
  onError,
}: {
  markets: MarketSummary[];
  setMarkets: (markets: MarketSummary[]) => void;
  marketsLoading: boolean;
  selected: MarketSummary | null;
  setSelected: (market: MarketSummary) => void;
  outcome: "YES" | "NO";
  setOutcome: (outcome: "YES" | "NO") => void;
  side: "buy" | "sell";
  setSide: (side: "buy" | "sell") => void;
  quantity: string;
  setQuantity: (quantity: string) => void;
  strategy: StrategyName;
  setStrategy: (strategy: StrategyName) => void;
  preview: ImpactPreview | null;
  setPreview: (preview: ImpactPreview | null) => void;
  health: Health | null;
  onStarted: (execution: PublicExecution, digest: Hex, grant: SessionGrant, registrationHash: Hex | null) => void;
  onError: (message: string) => void;
}) {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync, isPending: signing } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [exitPlanned, setExitPlanned] = useState(false);
  const [displayQuantity, setDisplayQuantity] = useState("");
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const canUseEngine = health?.status === "ok" && health.executorConfigured && health.sessionPolicyAddress !== null && health.executionRouterAddress !== null;
  const validQuantity = /^\d+(?:\.\d+)?$/.test(quantity) && Number(quantity) > 0;
  const validDisplayQuantity = displayQuantity.trim() === "" || (/^\d+(?:\.\d+)?$/.test(displayQuantity) && Number(displayQuantity) > 0);

  function executionControls() {
    if (!validDisplayQuantity) throw new Error("Visible slice must be a positive contract size");
    const start = isoOrUndefined(windowStart);
    const end = isoOrUndefined(windowEnd);
    if ((start === undefined) !== (end === undefined)) throw new Error("Set both window start and window end, or leave both blank");
    if (start !== undefined && end !== undefined && Date.parse(end) <= Date.parse(start)) throw new Error("Execution window end must be after its start");
    return {
      ...(displayQuantity.trim() === "" ? {} : { displayQuantity }),
      ...(start === undefined ? {} : { windowStart: start }),
      ...(end === undefined ? {} : { windowEnd: end }),
    };
  }

  async function requestPreview() {
    if (selected === null || !validQuantity) {
      onError("Choose a live market and enter a positive contract size before previewing impact.");
      return;
    }
    setPreviewing(true);
    try {
      const controls = executionControls();
      const previewMarket = async (market: MarketSummary) => api<ImpactPreview>("/api/preview-impact", {
        method: "POST",
        body: JSON.stringify({ marketId: market.id, outcome, side, quantity, strategy, ...controls }),
      });
      let next: ImpactPreview;
      try {
        next = await previewMarket(selected);
      } catch (error) {
        const message = errorText(error);
        if (!/no longer trading|too close to expiry|not present in the live venue/i.test(message)) throw error;
        const refreshed = await api<{ markets: MarketSummary[] }>("/api/markets");
        setMarkets(refreshed.markets);
        const replacement = refreshed.markets[0];
        if (replacement === undefined) throw new Error("No eligible live event market is available right now.");
        setSelected(replacement);
        next = await previewMarket(replacement);
      }
      setPreview(next);
      if (!next.canSubmit) onError(next.refusalReason ?? "The live book cannot fill that size.");
    } catch (error) {
      onError(errorText(error));
    } finally {
      setPreviewing(false);
    }
  }

  async function prepareEscrow() {
    if (selected === null || address === undefined || publicClient === undefined) throw new Error("Connect a wallet before preparing the live venue escrow");
    if (health?.executionRouterAddress === null || health?.executionRouterAddress === undefined) throw new Error("The live execution router is not configured");
    const spender = health.executionRouterAddress;
    const maximumCollateral = parseUnits(quantity, selected.decimals);
    if (side === "buy") {
      const allowance = await publicClient.readContract({
        address: selected.collateral,
        abi: erc20WriteAbi,
        functionName: "allowance",
        args: [address, spender],
      });
      if (allowance < maximumCollateral) {
        const hash = await writeContractAsync({
          address: selected.collateral,
          abi: erc20WriteAbi,
          functionName: "approve",
          args: [spender, maximumCollateral],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Collateral approval did not confirm on Somnia");
      }
      return;
    }
    const operatorApproved = await publicClient.readContract({
      address: selected.outcomeToken,
      abi: erc6909Abi,
      functionName: "isOperator",
      args: [address, spender],
    });
    if (!operatorApproved) {
      const hash = await writeContractAsync({
        address: selected.outcomeToken,
        abi: erc6909Abi,
        functionName: "setOperator",
        args: [spender, true],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Outcome-token approval did not confirm on Somnia");
    }
  }

  async function startExecution() {
    if (selected === null) {
      onError("Choose a live market before starting Slice.");
      return;
    }
    if (preview === null) {
      onError("Preview the live impact before starting Slice.");
      return;
    }
    if (!preview.canSubmit) {
      onError(preview.refusalReason ?? "The live book cannot fill that size.");
      return;
    }
    if (address === undefined || health?.sessionPolicyAddress === null || health?.sessionPolicyAddress === undefined || health.executorAddress === null) {
      onError("Connect a wallet and wait for the live execution engine to report its delegated executor.");
      return;
    }
    try {
      setBusy(true);
      if (!Number.isFinite(SESSION_DURATION_SECONDS) || SESSION_DURATION_SECONDS <= 0) throw new Error("Browser session duration is not configured");
      if (chainId !== somniaShannon.id) {
        if (switchChainAsync === undefined) throw new Error("Your wallet cannot switch to Somnia Shannon automatically");
        await switchChainAsync({ chainId: somniaShannon.id });
      }
      if (publicClient === undefined) throw new Error("The connected wallet did not expose a Somnia read client");
      await prepareEscrow();
      const issuedAt = Math.floor(Date.now() / 1000);
      const expiresAt = issuedAt + SESSION_DURATION_SECONDS;
      const nonceBytes = new Uint8Array(32);
      crypto.getRandomValues(nonceBytes);
      const nonce = BigInt(`0x${Array.from(nonceBytes, (value) => value.toString(16).padStart(2, "0")).join("")}`).toString();
      const grantBase = {
        owner: address,
        executor: health.executorAddress,
        marketId: selected.id,
        marketPool: selected.pool,
        marketCollateral: selected.collateral,
        marketOutcomeToken: selected.outcomeToken,
        outcomeTokenId: (outcome === "YES" ? selected.yesTokenId : selected.noTokenId),
        oneCollateral: (10n ** BigInt(selected.decimals)).toString(),
        outcome,
        side,
        maxContracts: parseUnits(quantity, selected.decimals).toString(),
        issuedAt,
        expiresAt,
        nonce,
      } as const;
      const grant: SessionGrant = {
        ...grantBase,
        grantId: crypto.randomUUID(),
        signature: await signTypedDataAsync({
          domain: grantDomain({ chainId: health.chainId, verifyingContract: health.sessionPolicyAddress }),
          types: SESSION_GRANT_TYPES,
          primaryType: "ExecutionGrant",
          message: grantMessage(grantBase),
        }),
      };
      const verified = await api<{ digest: Hex; registrationHash: Hex | null }>("/api/session/grants/verify", { method: "POST", body: JSON.stringify({ grant, quantity }) });
      const execution = await api<PublicExecution>("/api/executions", {
        method: "POST",
        body: JSON.stringify({ owner: address, marketId: selected.id, outcome, side, quantity, strategy, ...executionControls(), sessionGrant: grant }),
      });
      onStarted(execution, verified.digest, grant, verified.registrationHash);
    } catch (error) {
      onError(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return <main className="before-state terminal-view">
    {marketsLoading ? <div className="empty-panel"><h2>Loading live markets…</h2><p>Slice is reading the current DreamDEX venue. The controls will be ready as soon as the live window arrives.</p></div> : markets.length === 0 ? <div className="empty-panel"><h2>No live event market returned</h2><p>Refresh when DreamDEX has an active binary market. Slice does not invent a market or a quote.</p></div> : <>
      {selected && <MarketHeader market={selected} health={health} />}
      <div className="terminal-grid">
      {selected && <LiveLadder market={selected} outcome={outcome} />}
      <section className="order-panel execution-ticket">
        <div className="ticket-heading"><span className="terminal-label">Execution ticket</span><strong>Make size quiet.</strong></div>
        <div className="field-row">
          <label>Market<select value={selected?.id ?? ""} onChange={(event) => { const market = markets.find((item) => item.id === event.target.value); if (market) { setSelected(market); setPreview(null); } }}>{markets.map((market) => <option key={market.id} value={market.id}>{market.name} · {market.asset} · {market.interval ?? "live"}</option>)}</select></label>
          <label>Contracts<input inputMode="decimal" value={quantity} onChange={(event) => { setQuantity(event.target.value); setPreview(null); }} placeholder="Enter size" /></label>
        </div>
        <div className="control-line"><div className="segmented" aria-label="Outcome">{(["YES", "NO"] as const).map((item) => <button key={item} className={outcome === item ? "selected" : ""} onClick={() => { setOutcome(item); setPreview(null); }}>{item}</button>)}</div><div className="segmented" aria-label="Side">{(["buy", "sell"] as const).map((item) => <button key={item} className={side === item ? "selected" : ""} onClick={() => { setSide(item); setPreview(null); }}>{item}</button>)}</div></div>
        <div className="strategy-grid" aria-label="Order controls"><button className={strategy === "iceberg" ? "strategy selected" : "strategy"} onClick={() => { setStrategy("iceberg"); setPreview(null); }}><strong>Hide my size</strong><span>Show only the slice the book can see.</span></button><button className={strategy === "scale-in" ? "strategy selected" : "strategy"} onClick={() => { setStrategy("scale-in"); setPreview(null); }}><strong>Scale in</strong><span>Spread tranches across the live window.</span></button><button className={exitPlanned ? "strategy selected" : "strategy"} aria-pressed={exitPlanned} onClick={() => setExitPlanned((current) => !current)}><strong>Set my exit</strong><span>Arm an on-chain rule after the position fills.</span></button></div>
        {exitPlanned && <p className="inline-note exit-intent">After the fill, choose take profit, stop loss, or exit if book thins. The rule executes on-chain even when the Slice server is offline.</p>}
        <button className="text-button" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>{advanced ? "Hide advanced controls" : "Show advanced controls"}</button>
        {advanced && <div className="advanced-controls">
          <label>Visible slice<input inputMode="decimal" value={displayQuantity} onChange={(event) => { setDisplayQuantity(event.target.value); setPreview(null); }} placeholder="Use live touch size" /></label>
          {strategy === "scale-in" && <>
            <label>Window start<input type="datetime-local" value={windowStart} onChange={(event) => { setWindowStart(event.target.value); setPreview(null); }} /></label>
            <label>Window end<input type="datetime-local" value={windowEnd} onChange={(event) => { setWindowEnd(event.target.value); setPreview(null); }} /></label>
          </>}
          <p className="inline-note">Leave visible slice blank to derive it from current live depth. Leave the scale-in window blank to use the market's live trading window.</p>
        </div>}
        <div className="action-row"><button className="primary-button" onClick={() => void requestPreview()} disabled={previewing}>{previewing ? "Reading live book…" : "Preview impact"}</button>{preview && <button className="secondary-button" onClick={() => void startExecution()} disabled={busy || signing}>{busy || signing ? "Authorising…" : canUseEngine ? "Start Slice" : "Execution unavailable"}</button>}</div>
        <div className="ticket-wallet"><span>{isConnected ? shortAddress(address) : "Preview is public"}</span><strong>{isConnected ? "Somnia wallet connected" : "Wallet required only to execute"}</strong></div>
      </section>
      </div>
      {preview && <ImpactBlock preview={preview} decimals={selected?.decimals ?? 0} />}
      {preview && selected && <SnapshotLadder snapshot={preview.snapshot} />}
    </>}
    <div className="wallet-bar"><div><span className="section-kicker">Non-custodial controls</span><p>{isConnected ? `Connected ${shortAddress(address)}. Your wallet signs scope; the server never receives your key.` : "Preview is public. Starting an execution requires one scoped wallet signature."}</p></div>{isConnected ? <button className="secondary-button" onClick={() => disconnect()}>Disconnect</button> : <button className="secondary-button" onClick={() => { const connector = connectors[0]; if (connector) connect({ connector }); }}>Connect wallet</button>}</div>
  </main>;
}

function ImpactBlock({ preview }: { preview: ImpactPreview; decimals: number }) {
  const naive = preview.snapshot.naiveWalk.averagePrice;
  const projected = preview.strategy.projectedAveragePrice;
  const naiveNumber = naive === null ? null : Number(naive);
  const projectedNumber = projected === null ? null : Number(projected);
  const priceImprovement = naiveNumber === null || projectedNumber === null ? null : preview.snapshot.side === "buy" ? naiveNumber - projectedNumber : projectedNumber - naiveNumber;
  const basisPoints = priceImprovement === null || naiveNumber === null || naiveNumber === 0 ? null : priceImprovement / naiveNumber * 10_000;
  const relevantDepth = preview.snapshot.side === "buy" ? preview.snapshot.book.asks : preview.snapshot.book.bids;
  const availableDepth = relevantDepth.reduce((sum, level) => sum + Number(level.quantity), 0);
  const walkLevels = preview.snapshot.naiveWalk.levels;
  const maximumWalk = Math.max(1, ...walkLevels.map((level) => Number(level.quantity)));
  return <section className={`impact-block execution-edge ${preview.canSubmit ? "" : "is-refused"}`}>
    <div className="edge-heading"><div><span className="terminal-label">{preview.canSubmit ? "Projected execution edge" : "Execution refused"}</span><h2>{preview.canSubmit ? "Naive sweep vs. Slice plan" : "Live depth cannot safely support this order"}</h2></div><span className="data-badge">PROJECTED · block {preview.snapshot.blockNumber}</span></div>
    {preview.canSubmit ? <>
      <div className="edge-comparison"><div><span>Naive market sweep</span><strong>{cents(naive)}</strong></div><div className="edge-arrow" aria-hidden="true">→</div><div><span>Slice plan</span><strong>{cents(projected)}</strong></div><div className="edge-saving"><span>Estimated cost avoided</span><strong>{dollars(preview.strategy.projectedSavings)}</strong><small>{basisPoints === null ? "—" : `${basisPoints.toFixed(1)} bps improvement`}</small></div></div>
      <div className="edge-detail-grid"><div className="impact-walk"><span>Naive book consumption</span>{walkLevels.map((level, index) => <div className="impact-level" key={`${level.price}-${index}`}><b>{cents(level.price)}</b><i style={{ width: `${Math.max(5, Number(level.quantity) / maximumWalk * 100)}%` }} /><em>{level.quantity}</em></div>)}</div><dl className="plan-metrics"><div><dt>Estimated children</dt><dd>{preview.strategy.estimatedSlices ?? "—"}</dd></div><div><dt>Visible slice</dt><dd>{preview.strategy.displayQuantity ?? "Live depth"}</dd></div><div><dt>Book levels crossed</dt><dd>{walkLevels.length}</dd></div><div><dt>Available depth</dt><dd>{availableDepth.toLocaleString(undefined, { maximumFractionDigits: preview.market.decimals })}</dd></div></dl></div>
    </> : <div className="refusal-panel"><strong>{preview.refusalReason}</strong><span>Requested {preview.snapshot.requestedQuantity} contracts · available {preview.snapshot.naiveWalk.filledQuantity}</span><p>Reduce size or choose another live market. Slice does not extrapolate beyond resting orders.</p></div>}
    <p className="projection-note">Projection uses the live submission book. Realized receipt figures come only from confirmed child-order fills.</p>
  </section>;
}

function DuringState({ execution, health, market, onCancel, error }: { execution: PublicExecution; health: Health | null; market: MarketSummary | null; onCancel: () => void; error: string | null }) {
  const liveFilled = execution.fills.reduce((sum, fill) => sum + Number(fill.quantity), 0);
  const requested = Number(execution.request.quantity);
  const filled = execution.metrics?.filledQuantity ?? (Number.isFinite(liveFilled) ? String(liveFilled) : "0");
  const remaining = Math.max(0, requested - Number(filled));
  const weightedQuote = execution.fills.reduce((sum, fill) => sum + Number(fill.price) * Number(fill.quantity), 0);
  const averageFill = liveFilled > 0 ? weightedQuote / liveFilled : null;
  const confirmedChildren = execution.children.filter((child) => child.status === "filled" || child.status === "partial").length;
  const reconnectMessage = execution.state === "reconnecting" || execution.state === "paused" ? `Reconnecting — ${filled} of ${execution.request.quantity} filled, nothing at risk` : null;
  return <main className="during-state"><div className="state-heading"><div><p className="section-kicker">Working order</p><h1>{execution.request.marketName}</h1><p>{execution.request.quantity} contracts · {execution.request.outcome} · {execution.request.side} · {strategyLabel(execution.request.strategy)}</p></div><Heartbeat execution={execution} /></div>{error && <p className="error-banner" role="alert">{error}</p>}{reconnectMessage && <p className="reconnect-banner" role="status">{reconnectMessage}</p>}{execution.failureMessage && !reconnectMessage && <p className="error-banner" role="alert">{execution.failureMessage}</p>}<div className="progress-grid"><div className="progress-number"><span>Filled</span><strong>{filled}</strong><small>contracts</small></div><div className="progress-number"><span>Remaining</span><strong>{remaining.toFixed(4).replace(/\.?0+$/, "")}</strong><small>contracts</small></div><div className="progress-number"><span>Children</span><strong>{confirmedChildren} / {execution.children.length}</strong><small>confirmed / attempts</small></div><div className="progress-number"><span>Average fill</span><strong>{averageFill === null ? "—" : cents(String(averageFill))}</strong><small>verified fills</small></div></div><div className="working-grid"><section className="child-panel"><div className="panel-heading"><div><span className="section-kicker">Execution tape</span><h2>Child orders</h2></div><span className="state-pill">{execution.state}</span></div><ol className="child-list">{execution.children.map((child) => <li key={child.id}><div><strong>#{child.sequence} · {child.status}</strong><span>{child.filledQuantity} / {child.requestedQuantity}{child.averagePrice ? ` @ ${cents(child.averagePrice)}` : ""}</span>{child.rejectionReason && <small>{child.rejectionReason}</small>}</div>{child.transactionHash && health?.explorerUrl ? <a href={explorerTx(health.explorerUrl, child.transactionHash)} target="_blank" rel="noreferrer">{shortAddress(child.transactionHash)} ↗</a> : child.transactionHash ? <span>{shortAddress(child.transactionHash)}</span> : <span className="muted">pending</span>}</li>)}</ol>{execution.cancelRequested ? <p className="inline-note">Cancel requested. The engine will settle the filled portion from chain state.</p> : <button className="secondary-button" onClick={onCancel}>Cancel execution</button>}<details className="engine-log"><summary>Engine log</summary><ol><li><time>{new Date(execution.snapshot.capturedAt).toLocaleTimeString()}</time><span>snapshot captured</span><code>block {execution.snapshot.blockNumber}</code></li>{execution.children.map((child) => <li key={`log-${child.id}`}><time>{child.updatedAt ? new Date(child.updatedAt).toLocaleTimeString() : "—"}</time><span>child #{child.sequence} {child.status}</span><code>{child.transactionHash ? shortAddress(child.transactionHash) : "awaiting chain"}</code></li>)}</ol></details></section>{market ? <LiveLadder market={market} outcome={execution.request.outcome} /> : <SnapshotLadder snapshot={execution.snapshot} />}</div></main>;
}

function Heartbeat({ execution }: { execution: PublicExecution }) {
  const age = Date.now() - Date.parse(execution.heartbeatAt);
  const healthy = Number.isFinite(age) && age < 30_000 && !["reconnecting", "paused"].includes(execution.state);
  return <div className={`heartbeat ${healthy ? "healthy" : "unhealthy"}`}><span aria-hidden="true" />{healthy ? "Engine live" : execution.state === "reconnecting" ? "Reconnecting" : "Engine needs attention"}<small>beat {new Date(execution.heartbeatAt).toLocaleTimeString()}</small></div>;
}

function AfterState({ execution, digest, grant, registrationHash, health, onRevoke, revokePending, onExitRule, onResume, resumePending, onNewExecution }: { execution: PublicExecution; digest: Hex | null; grant: SessionGrant | null; registrationHash: Hex | null; health: Health | null; onRevoke: () => void; revokePending: boolean; onExitRule: (execution: PublicExecution) => void; onResume: () => void; resumePending: boolean; onNewExecution: () => void }) {
  const metrics = execution.metrics;
  const canResume = ["authorisation_expired", "venue_rejected", "engine_error"].includes(execution.failureCode ?? "") && execution.state !== "completed" && execution.state !== "cancelled";
  return <main className="after-state"><div className="receipt-heading"><div><p className="section-kicker">Execution receipt · {execution.state}</p><h1>{execution.request.marketName}</h1><p>{metrics?.filledQuantity ?? "0"} contracts · {execution.request.outcome} · {strategyLabel(execution.request.strategy)}</p></div><div className="receipt-actions">{execution.receiptUrl && <a className="secondary-button link-button" href={execution.receiptUrl} target="_blank" rel="noreferrer">Open public receipt</a>}<button className="secondary-button" onClick={onNewExecution}>New execution</button></div></div>{execution.failureMessage && <p className="error-banner" role="alert">{execution.failureMessage}</p>}{canResume && <button className="secondary-button" disabled={resumePending} onClick={onResume}>{resumePending ? "Waiting for authorisation…" : "Re-authorise and resume"}</button>}<section className="receipt-panel"><div className="saving-block"><span>Saved, net of observed drift</span><strong>{dollars(metrics?.netSavings ?? metrics?.rawSavings ?? null)}</strong></div><div className="comparison-grid"><div><span>Market order would have cost</span><strong>{cents(metrics?.naiveAveragePrice ?? null)}</strong><small>{metrics?.filledQuantity ?? "0"} contracts at submission snapshot</small></div><div><span>Slice filled at</span><strong>{cents(metrics?.actualAveragePrice ?? null)}</strong><small>{metrics?.filledQuantity ?? "0"} contracts across real fills</small></div></div><dl className="receipt-facts"><div><dt>Raw savings</dt><dd>{dollars(metrics?.rawSavings ?? null)}</dd></div><div><dt>Mid-price move</dt><dd>{cents(metrics?.midPriceMove ?? null)}</dd></div><div><dt>Drift adjustment</dt><dd>{dollars(metrics?.driftAdjustment ?? null)}</dd></div><div><dt>Receipt status</dt><dd>{execution.state}</dd></div></dl><SnapshotLadder snapshot={execution.snapshot} /></section><section className="child-panel receipt-children"><div className="panel-heading"><div><span className="section-kicker">Evidence</span><h2>Child-order transactions</h2></div></div><ul className="child-list">{execution.children.filter((child) => child.transactionHash !== null).map((child) => <li key={child.id}><div><strong>#{child.sequence}</strong><span>{child.filledQuantity} contracts at {cents(child.averagePrice)}</span></div>{health?.explorerUrl ? <a href={explorerTx(health.explorerUrl, child.transactionHash!)} target="_blank" rel="noreferrer">{child.transactionHash}</a> : <span>{child.transactionHash}</span>}</li>)}</ul></section><ExitRulePanel execution={execution} health={health} onRegistered={onExitRule} />{execution.exitRule && <section className="grant-panel"><div><span className="section-kicker">On-chain reactivity</span><h2>Active exit rule</h2></div><p>{triggerLabel(execution.exitRule.kind)} · {execution.exitRule.quantity} contracts · closes with a {execution.exitRule.side} order</p><p className="inline-note">Rule transaction: {health?.explorerUrl ? <a href={explorerTx(health.explorerUrl, execution.exitRule.transactionHash)} target="_blank" rel="noreferrer">{shortAddress(execution.exitRule.transactionHash)}</a> : execution.exitRule.transactionHash}</p></section>}{grant && digest && health?.sessionPolicyAddress && <section className="grant-panel"><div><span className="section-kicker">Authorisation</span><h2>Session scope</h2></div><GrantScope grant={grant} marketName={execution.request.marketName} />{registrationHash && health.explorerUrl && <p className="inline-note">Registered on-chain: <a href={explorerTx(health.explorerUrl, registrationHash)} target="_blank" rel="noreferrer">{shortAddress(registrationHash)}</a></p>}<button className="secondary-button" disabled={revokePending} onClick={onRevoke}>{revokePending ? "Revoking…" : "Revoke on-chain authorisation"}</button></section>}</main>;
}

function ExitRulePanel({ execution, health, onRegistered }: { execution: PublicExecution; health: Health | null; onRegistered: (execution: PublicExecution) => void }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const [kind, setKind] = useState<ExitRule["kind"]>("take-profit");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [minimumQuantity, setMinimumQuantity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const handler = health?.reactivityHandlerAddress;
  if (handler === null || handler === undefined || !health?.reactivityConfigured || execution.exitRule !== null || execution.request.marketPool === undefined || execution.request.marketDecimals === undefined || execution.request.marketExpiry === undefined || execution.request.marketCollateral === undefined || execution.request.marketOutcomeToken === undefined || execution.metrics?.filledQuantity === undefined || Number(execution.metrics.filledQuantity) <= 0) return null;

  const setExit = async () => {
    if (address === undefined || publicClient === undefined) {
      setError("Connect the wallet that owns this filled position before setting an exit");
      return;
    }
    try {
      setError(null);
      const decimals = execution.request.marketDecimals!;
      const oneCollateral = 10n ** BigInt(decimals);
      const quantity = parseUnits(execution.metrics!.filledQuantity, decimals);
      const exitSide = execution.request.side === "buy" ? "sell" : "buy";
      if (health?.executionRouterAddress === null || health?.executionRouterAddress === undefined || health.sessionPolicyAddress === null || health.sessionPolicyAddress === undefined) {
        throw new Error("The non-custodial exit router is not configured");
      }
      const router = health.executionRouterAddress;
      if (exitSide === "buy") {
        const allowance = await publicClient.readContract({
          address: execution.request.marketCollateral!,
          abi: erc20WriteAbi,
          functionName: "allowance",
          args: [address, router],
        });
        if (allowance < quantity) {
          const approvalHash = await writeContractAsync({
            address: execution.request.marketCollateral!,
            abi: erc20WriteAbi,
            functionName: "approve",
            args: [router, quantity],
          });
          const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
          if (approvalReceipt.status !== "success") throw new Error("Exit collateral approval did not confirm on Somnia");
        }
      } else {
        const operatorApproved = await publicClient.readContract({
          address: execution.request.marketOutcomeToken!,
          abi: erc6909Abi,
          functionName: "isOperator",
          args: [address, router],
        });
        if (!operatorApproved) {
          const operatorHash = await writeContractAsync({
            address: execution.request.marketOutcomeToken!,
            abi: erc6909Abi,
            functionName: "setOperator",
            args: [router, true],
          });
          const operatorReceipt = await publicClient.waitForTransactionReceipt({ hash: operatorHash });
          if (operatorReceipt.status !== "success") throw new Error("Exit outcome-token approval did not confirm on Somnia");
        }
      }
      const exitKind = execution.request.outcome === "YES" ? (exitSide === "sell" ? 1 : 0) : (exitSide === "sell" ? 3 : 2);
      const trigger = kind === "take-profit" ? 0 : kind === "stop-loss" ? 1 : 2;
      const rawTrigger = kind === "book-thins" ? 0n : centsToRaw(triggerPrice, decimals);
      const rawMinimum = kind === "book-thins" ? parseUnits(minimumQuantity, decimals) : 0n;
      if (kind !== "book-thins" && (rawTrigger <= 0n || rawTrigger >= oneCollateral)) throw new Error("Trigger price must be between 0¢ and 100¢");
      if (kind === "book-thins" && rawMinimum <= 0n) throw new Error("Minimum best-level quantity must be positive");
      const issuedAt = Math.floor(Date.now() / 1000);
      const marketExpiry = Number(execution.request.marketExpiry!);
      const expiresAt = Math.min(issuedAt + SESSION_DURATION_SECONDS, marketExpiry);
      if (!Number.isFinite(expiresAt) || expiresAt <= issuedAt) throw new Error("The filled market is too close to expiry for an on-chain exit");
      const outcomeTokenId = execution.request.outcome === "YES" ? execution.request.marketYesTokenId : execution.request.marketNoTokenId;
      if (outcomeTokenId === undefined) throw new Error("Execution is missing its live outcome-token id");
      const nonceBytes = new Uint8Array(32);
      crypto.getRandomValues(nonceBytes);
      const nonce = BigInt(`0x${Array.from(nonceBytes, (value) => value.toString(16).padStart(2, "0")).join("")}`).toString();
      const grantBase = {
        owner: address,
        executor: handler,
        marketId: execution.request.marketId as Hex,
        marketPool: execution.request.marketPool!,
        marketCollateral: execution.request.marketCollateral!,
        marketOutcomeToken: execution.request.marketOutcomeToken!,
        outcomeTokenId,
        oneCollateral: oneCollateral.toString(),
        outcome: execution.request.outcome,
        side: exitSide,
        maxContracts: quantity.toString(),
        issuedAt,
        expiresAt,
        nonce,
      } as const;
      const signature = await signTypedDataAsync({
        domain: grantDomain({ chainId: health.chainId, verifyingContract: health.sessionPolicyAddress }),
        types: SESSION_GRANT_TYPES,
        primaryType: "ExecutionGrant",
        message: grantMessage(grantBase),
      });
      const grant = {
        owner: address,
        executor: handler,
        marketId: execution.request.marketId as Hex,
        pool: execution.request.marketPool!,
        collateral: execution.request.marketCollateral!,
        outcomeToken: execution.request.marketOutcomeToken!,
        outcomeTokenId: BigInt(outcomeTokenId),
        oneCollateral,
        outcome: execution.request.outcome === "YES" ? 0 : 1,
        side: exitSide === "buy" ? 0 : 1,
        maxContracts: quantity,
        issuedAt: BigInt(issuedAt),
        expiresAt: BigInt(expiresAt),
        nonce: BigInt(nonce),
      } as const;
      const hash = await writeContractAsync({
        address: handler,
        abi: EXIT_HANDLER_ABI,
        functionName: "registerRule",
        args: [execution.request.marketPool!, exitKind, trigger, oneCollateral, rawTrigger, rawMinimum, quantity, BigInt(execution.request.marketExpiry!) * 1_000_000_000n, execution.request.marketCollateral!, execution.request.marketOutcomeToken!, BigInt(outcomeTokenId), grant, signature],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Exit rule transaction did not confirm on Somnia");
      const events = parseEventLogs({ abi: EXIT_HANDLER_ABI, eventName: "RuleRegistered", logs: receipt.logs, strict: false });
      const registered = events[0];
      if (registered === undefined) throw new Error("Exit rule confirmed without a RuleRegistered event");
      const rule: ExitRule = {
        id: registered.args.ruleId!,
        marketId: execution.request.marketId,
        owner: address,
        kind,
        triggerPrice: kind === "book-thins" ? null : triggerPrice,
        minimumBestLevelQuantity: kind === "book-thins" ? minimumQuantity : null,
        side: exitSide,
        quantity: execution.metrics!.filledQuantity,
        handlerAddress: handler,
        subscriptionId: health.reactivitySubscriptionId!,
        transactionHash: hash,
        status: "active",
      };
      const updated = await api<PublicExecution>(`/api/executions/${execution.id}/exit-rule`, { method: "POST", body: JSON.stringify(rule) });
      onRegistered(updated);
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  return <section className="grant-panel exit-panel"><div><span className="section-kicker">On-chain reactivity</span><h2>Set my exit</h2><p className="inline-note">The handler listens to the live pool event. It can fire after this server is offline.</p></div><div className="field-row"><label>Rule<select value={kind} onChange={(event) => setKind(event.target.value as ExitRule["kind"])}><option value="take-profit">Take profit</option><option value="stop-loss">Stop loss</option><option value="book-thins">Exit if book thins</option></select></label>{kind === "book-thins" ? <label>Minimum best level<input inputMode="decimal" value={minimumQuantity} onChange={(event) => setMinimumQuantity(event.target.value)} placeholder="Contracts" /></label> : <label>Trigger price<input inputMode="decimal" value={triggerPrice} onChange={(event) => setTriggerPrice(event.target.value)} placeholder="Cents, e.g. 72.5" /></label>}</div>{error && <p className="error-banner">{error}</p>}<button className="secondary-button" disabled={isPending} onClick={() => void setExit()}>{isPending ? "Waiting for wallet…" : `Set ${triggerLabel(kind).toLowerCase()}`}</button></section>;
}

function AppHeader({ view, health, address, onNavigate, onWallet }: { view: AppView; health: Health | null; address: Address | undefined; onNavigate: (view: AppView) => void; onWallet: () => void }) {
  const engineLive = health?.status === "ok";
  return <header className="app-header"><button className="brand" onClick={() => onNavigate("landing")} aria-label="Slice home"><svg viewBox="0 0 28 28" aria-hidden="true"><path d="M3 5h22v3H3zm4 7h18v3H7zm4 7h14v3H11z" /></svg><span>SLICE/</span></button><nav aria-label="Primary navigation">{(["trade", "executions", "proof", "integrations"] as AppView[]).map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => onNavigate(item)}>{item[0]!.toUpperCase() + item.slice(1)}</button>)}</nav><div className="header-status"><span className={statusClass(engineLive)}><i />{engineLive ? "Engine live" : "Engine offline"}</span><span className="network-tag">Shannon · 50312</span><button className="wallet-compact" onClick={onWallet}>{address ? shortAddress(address) : "Connect wallet"}</button></div></header>;
}

function LandingView({ health, receipts, onNavigate }: { health: Health | null; receipts: Receipt[]; onNavigate: (view: AppView) => void }) {
  const receipt = receipts[0] ?? null;
  const engineLive = health?.status === "ok";
  const levels = receipt?.snapshot.naiveWalk.levels ?? [];
  const maximum = Math.max(1, ...levels.map((level) => Number(level.quantity)));
  return <main className="landing-view">
    <section className="landing-hero"><div className="hero-message"><span className="terminal-label">Execution infrastructure for DreamDEX event contracts</span><h1>Work size without<br />sweeping the book.</h1><p className="product-line">Prediction markets have order books but no execution tools. Every serious trader silently overpays on entry. Slice is the first product that fixes it.</p><p className="lede">Slice breaks large positions into controlled child executions, measures what a naive order would have cost, and proves the difference from real on-chain fills.</p><div className="hero-actions"><button className="gold-button" onClick={() => onNavigate("trade")}>Open terminal</button><button className="secondary-button" onClick={() => onNavigate("executions")}>View verified executions</button></div><div className="hero-trust"><span className={statusClass(engineLive)}><i />{engineLive ? "Live on Somnia Shannon" : "Engine status unavailable"}</span><span>Non-custodial</span><span>On-chain fills</span><span>Reactive exits</span></div></div>
      <div className="hero-comparison" aria-label="Verified execution comparison"><div className="comparison-title"><span>{receipt ? "VERIFIED EXECUTION" : "WAITING FOR VERIFIED EXECUTION"}</span><strong>{receipt?.marketName ?? "Live receipts appear here"}</strong></div><div className="comparison-columns"><div><span>Naive sweep</span><strong>{cents(receipt?.metrics.naiveAveragePrice ?? null)}</strong><div className="sweep-levels">{levels.slice(0, 5).map((level, index) => <div key={`${level.price}-${index}`}><b>{cents(level.price)}</b><i style={{ width: `${Math.max(8, Number(level.quantity) / maximum * 100)}%` }} /></div>)}</div></div><div><span>Slice execution</span><strong>{cents(receipt?.metrics.actualAveragePrice ?? null)}</strong><ol>{receipt?.childOrders.slice(0, 5).map((child) => <li key={child.id}><span>child {String(child.sequence).padStart(2, "0")}</span><b>{cents(child.averagePrice)}</b><em>{child.status}</em></li>)}</ol></div></div><div className="hero-saving"><span>Verified net savings</span><strong>{dollars(receipt?.metrics.netSavings ?? receipt?.metrics.rawSavings ?? null)}</strong><small>{receipt ? `${receipt.metrics.filledQuantity} contracts · ${receipt.childOrders.length} child transactions` : "No placeholder metrics"}</small></div></div>
    </section>
    <section className="proof-rail"><div><span>Live on Shannon</span><strong>{health?.chainId ?? "—"}</strong></div><div><span>Non-custodial</span><strong>Scoped grants</strong></div><div><span>Live execution</span><strong>{engineLive ? "Engine live" : "Unavailable"}</strong></div><div><span>Reactivity</span><strong>{health?.reactivityConfigured ? "On-chain active" : "Not configured"}</strong></div><div><span>Public receipts</span><strong>{receipts.length > 0 ? `${receipts.length}+ verified` : "Loading"}</strong></div></section>
    <section className="how-section"><div><span className="terminal-label">How Slice works</span><h2>One book. Four inspectable steps.</h2></div><div className="how-flow">{[["01","Read the book","Capture executable DreamDEX depth at a fixed block."],["02","Plan","Walk the book and build a controlled child-order plan."],["03","Execute","Route scoped orders without custodying the position."],["04","Prove","Reconcile confirmed fills and publish the receipt."]].map(([number,title,copy]) => <article key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>
    {receipt && <section className="receipt-showcase"><div><span className="terminal-label">A real execution</span><h2>{receipt.marketName}</h2><p>{receipt.metrics.filledQuantity} contracts · {receipt.status} · snapshot block {receipt.snapshot.blockNumber}</p></div><div><span>Naive average</span><strong>{cents(receipt.metrics.naiveAveragePrice)}</strong></div><div><span>Slice average</span><strong>{cents(receipt.metrics.actualAveragePrice)}</strong></div><div className="showcase-saving"><span>Net savings</span><strong>{dollars(receipt.metrics.netSavings ?? receipt.metrics.rawSavings)}</strong></div><a className="secondary-button link-button" href={receiptUrl(receipt)} target="_blank" rel="noreferrer">Inspect receipt ↗</a></section>}
  </main>;
}

function ExecutionsView({ receipts }: { receipts: Receipt[] }) {
  const [filter, setFilter] = useState<"all" | Receipt["status"]>("all");
  const visible = filter === "all" ? receipts : receipts.filter((receipt) => receipt.status === filter);
  return <main className="page-view"><div className="page-heading"><span className="terminal-label">Verified on Somnia</span><h1>Executions</h1><p>Real Slice executions reconciled from confirmed child-order transactions. Failed and partial outcomes remain visible.</p></div><div className="filter-tabs" role="group" aria-label="Receipt status filter">{(["all", "completed", "partial", "cancelled"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div>{visible.length === 0 ? <div className="empty-panel"><h2>No verified executions in this view</h2><p>Receipts appear only after Somnia fills are reconciled. Slice does not populate this page with fixtures.</p></div> : <div className="execution-list">{visible.map((receipt) => <article key={receipt.id}><div className="execution-row-title"><div><span className="data-badge">VERIFIED</span><h2>{receipt.marketName}</h2><p>{receipt.metrics.filledQuantity} contracts · {receipt.childOrders.length} children</p></div><span className={`receipt-status ${receipt.status}`}>{receipt.status}</span></div><div className="execution-row-metrics"><div><span>Naive</span><strong>{cents(receipt.metrics.naiveAveragePrice)}</strong></div><div><span>Slice</span><strong>{cents(receipt.metrics.actualAveragePrice)}</strong></div><div><span>Net saved</span><strong>{dollars(receipt.metrics.netSavings ?? receipt.metrics.rawSavings)}</strong></div><div><span>Block</span><strong>{receipt.snapshot.blockNumber}</strong></div></div><a href={receiptUrl(receipt)} target="_blank" rel="noreferrer">View public receipt ↗</a></article>)}</div>}</main>;
}

function ProofView({ health }: { health: Health | null }) {
  const explorer = health?.explorerUrl ?? "https://shannon-explorer.somnia.network";
  const deployments = [["Session policy",health?.sessionPolicyAddress],["Execution router",health?.executionRouterAddress],["Reactivity handler",health?.reactivityHandlerAddress],["Delegated executor",health?.executorAddress]] as const;
  return <main className="page-view proof-view"><div className="page-heading"><span className="terminal-label">Machine room</span><h1>Proof</h1><p>Everything Slice claims is independently inspectable—from the live engine to each child fill.</p></div><section className="system-grid"><div><span>Execution engine</span><strong className={statusClass(health?.status === "ok")}><i />{health?.status === "ok" ? "Live" : "Unavailable"}</strong></div><div><span>DreamDEX quoter</span><strong className={statusClass(Boolean(health?.quoter?.running))}><i />{health?.quoter?.running ? `${health.quoter.openQuotes} live quotes` : "Stopped"}</strong></div><div><span>Somnia RPC</span><strong className={statusClass(health !== null)}><i />{health ? "Connected" : "Unavailable"}</strong></div><div><span>Reactivity</span><strong className={statusClass(Boolean(health?.reactivityConfigured))}><i />{health?.reactivityConfigured ? "Active" : "Not configured"}</strong></div></section><section className="deployment-section"><div><span className="terminal-label">On-chain infrastructure</span><h2>Deployed contracts and operators</h2></div><div className="deployment-grid">{deployments.map(([label,address]) => <article key={label}><span>{label}</span>{address ? <a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer">{address}</a> : <strong>Unavailable</strong>}</article>)}<article><span>Subscription ID</span><strong>{health?.reactivitySubscriptionId ?? "Unavailable"}</strong></article></div></section><section className="architecture"><span className="terminal-label">Execution path</span><div className="architecture-flow">{["User wallet","Session policy","Slice engine","Execution router","DreamDEX pool","Verified receipt"].map((item,index) => <div key={item}><strong>{item}</strong>{index < 5 && <span aria-hidden="true">→</span>}</div>)}</div><p>DreamDEX <code>OrderFilled</code> events also route through Somnia Reactivity to the exit handler. The handler remains live when the API is stopped.</p></section></main>;
}

function IntegrationsView() {
  return <main className="page-view"><div className="page-heading"><span className="terminal-label">Machine execution</span><h1>Integrations</h1><p>Slice is an execution layer for traders, scripts, and autonomous agents—not only a browser interface.</p></div><div className="integration-grid"><article><span className="data-badge">REST</span><h2>Execution API</h2><p>Preview live impact, start scoped execution, stream status, and retrieve a verified receipt.</p><pre>POST /api/preview-impact{"\n"}POST /api/executions{"\n"}GET  /api/executions/:id</pre></article><article><span className="data-badge">CCXT</span><h2>Existing trading scripts</h2><p>Route market-order intent through Slice while preserving CCXT order semantics and execution status.</p><pre>exchange.createOrder({"\n"}  symbol, 'market', 'buy', amount,{"\n"}  {'{'} strategy: 'iceberg', sessionGrant {'}'}{"\n"})</pre></article><article><span className="data-badge">MCP</span><h2>Agent-native execution</h2><p>Agents inspect live markets, preview impact, execute orders, follow progress, and retrieve receipts through five focused tools.</p><pre>list_markets{"\n"}preview_impact{"\n"}execute_order{"\n"}get_execution_status{"\n"}get_receipt</pre></article></div></main>;
}

export default function App() {
  const [view, setView] = useState<AppView>(() => viewFromPath(window.location.pathname));
  const [markets, setMarkets] = useState<MarketSummary[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [selected, setSelected] = useState<MarketSummary | null>(null);
  const [outcome, setOutcome] = useState<"YES" | "NO">("YES");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [quantity, setQuantity] = useState("0.001");
  const [strategy, setStrategy] = useState<StrategyName>("iceberg");
  const [preview, setPreview] = useState<ImpactPreview | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [execution, setExecution] = useState<PublicExecution | null>(null);
  const [grant, setGrant] = useState<SessionGrant | null>(null);
  const [digest, setDigest] = useState<Hex | null>(null);
  const [registrationHash, setRegistrationHash] = useState<Hex | null>(null);
  const [phase, setPhase] = useState<"before" | "during" | "after">("before");
  const [resumePending, setResumePending] = useState(false);
  const { address } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { writeContractAsync, isPending: revokePending } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();

  const navigate = (next: AppView) => {
    window.history.pushState({}, "", VIEW_PATHS[next]);
    setView(next);
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  useEffect(() => {
    const onPopState = () => setView(viewFromPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setMarketsLoading(true);
    void Promise.allSettled([api<{ markets: MarketSummary[] }>("/api/markets"), api<Health>("/health"), api<{ receipts: Receipt[] }>("/api/receipts?limit=20")]).then(([marketResult, healthResult, receiptResult]) => {
      if (cancelled) return;
      if (marketResult.status === "fulfilled") {
        const nextMarkets = marketResult.value.markets;
        setMarkets(nextMarkets);
        setSelected((current) => current !== null && nextMarkets.some((market) => market.id === current.id) ? current : nextMarkets[0] ?? null);
      } else {
        setError(errorText(marketResult.reason));
      }
      if (healthResult.status === "fulfilled") {
        setHealth(healthResult.value);
        const quotedMarketId = healthResult.value.quoter?.lastMarketId;
        if (marketResult.status === "fulfilled" && quotedMarketId) {
          const quotedMarket = marketResult.value.markets.find((market) => market.id.toLowerCase() === quotedMarketId.toLowerCase());
          if (quotedMarket) setSelected(quotedMarket);
        }
      } else {
        setError(errorText(healthResult.reason));
      }
      if (receiptResult.status === "fulfilled") setReceipts(receiptResult.value.receipts);
      setMarketsLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (execution === null || phase !== "during") return;
    const stream = new EventSource(`${API_URL}/api/executions/${execution.id}/events`);
    stream.addEventListener("execution", (event) => {
      const next = JSON.parse((event as MessageEvent<string>).data) as PublicExecution;
      setExecution(next);
      if (["completed", "partial", "cancelled", "failed"].includes(next.state)) setPhase("after");
    });
    stream.addEventListener("error", (event) => setError((event as MessageEvent<{ error?: string }>).data?.error ?? "Execution progress stream disconnected. Reload status to reconcile from chain state."));
    return () => stream.close();
  }, [execution?.id, phase]);

  const revoke = () => {
    if (digest === null || health?.sessionPolicyAddress === null || health?.sessionPolicyAddress === undefined) return;
    void writeContractAsync({ address: health.sessionPolicyAddress, abi: SESSION_POLICY_ABI, functionName: "revoke", args: [digest] }).catch((reason: unknown) => setError(errorText(reason)));
  };

  const resume = async () => {
    if (execution === null || address === undefined || health?.sessionPolicyAddress === null || health?.sessionPolicyAddress === undefined || health.executorAddress === null || execution.request.marketDecimals === undefined || execution.request.marketPool === undefined || execution.request.marketCollateral === undefined || execution.request.marketOutcomeToken === undefined) {
      setError("Connect the execution owner wallet before re-authorising");
      return;
    }
    if (address.toLowerCase() !== execution.request.owner.toLowerCase()) {
      setError("Connect the wallet that owns this execution before re-authorising");
      return;
    }
    try {
      setResumePending(true);
      if (!Number.isFinite(SESSION_DURATION_SECONDS) || SESSION_DURATION_SECONDS <= 0) throw new Error("Browser session duration is not configured");
      const filled = parseUnits(execution.metrics?.filledQuantity ?? "0", execution.request.marketDecimals);
      const requested = parseUnits(execution.request.quantity, execution.request.marketDecimals);
      if (requested <= filled) throw new Error("This execution has no remaining contracts");
      const remaining = formatUnits(requested - filled, execution.request.marketDecimals);
      const outcomeTokenId = execution.request.outcome === "YES" ? execution.request.marketYesTokenId : execution.request.marketNoTokenId;
      if (outcomeTokenId === undefined) throw new Error("Execution is missing its live outcome-token id");
      const issuedAt = Math.floor(Date.now() / 1000);
      const expiresAt = issuedAt + SESSION_DURATION_SECONDS;
      const nonceBytes = new Uint8Array(32);
      crypto.getRandomValues(nonceBytes);
      const nonce = BigInt(`0x${Array.from(nonceBytes, (value) => value.toString(16).padStart(2, "0")).join("")}`).toString();
      const grantBase = {
        owner: address,
        executor: health.executorAddress,
        marketId: execution.request.marketId,
        marketPool: execution.request.marketPool,
        marketCollateral: execution.request.marketCollateral,
        marketOutcomeToken: execution.request.marketOutcomeToken,
        outcomeTokenId,
        oneCollateral: (10n ** BigInt(execution.request.marketDecimals)).toString(),
        outcome: execution.request.outcome,
        side: execution.request.side,
        maxContracts: parseUnits(remaining, execution.request.marketDecimals).toString(),
        issuedAt,
        expiresAt,
        nonce,
      } as const;
      const grant: SessionGrant = {
        ...grantBase,
        grantId: crypto.randomUUID(),
        signature: await signTypedDataAsync({
          domain: grantDomain({ chainId: health.chainId, verifyingContract: health.sessionPolicyAddress }),
          types: SESSION_GRANT_TYPES,
          primaryType: "ExecutionGrant",
          message: grantMessage(grantBase),
        }),
      };
      const response = await api<PublicExecution & { digest: Hex; registrationHash: Hex | null }>(`/api/executions/${execution.id}/resume`, { method: "POST", body: JSON.stringify({ sessionGrant: grant }) });
      setGrant(grant);
      setDigest(response.digest);
      setRegistrationHash(response.registrationHash);
      setExecution(response);
      setPhase("during");
      setError(null);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setResumePending(false);
    }
  };

  const selectedMarket = useMemo(() => selected, [selected]);

  return <div className="app-shell">
    <AppHeader view={view} health={health} address={address} onNavigate={navigate} onWallet={() => { if (address) disconnect(); else { const connector = connectors[0]; if (connector) connect({ connector }); } }} />
    {error && <div className="global-error" role="alert"><strong>{error}</strong><button onClick={() => setError(null)} aria-label="Dismiss error">Dismiss</button></div>}
    {view === "landing" && <LandingView health={health} receipts={receipts} onNavigate={navigate} />}
    {view === "executions" && <ExecutionsView receipts={receipts} />}
    {view === "proof" && <ProofView health={health} />}
    {view === "integrations" && <IntegrationsView />}
    {view === "trade" && phase === "before" && <BeforeState markets={markets} setMarkets={setMarkets} marketsLoading={marketsLoading} selected={selectedMarket} setSelected={setSelected} outcome={outcome} setOutcome={setOutcome} side={side} setSide={setSide} quantity={quantity} setQuantity={setQuantity} strategy={strategy} setStrategy={setStrategy} preview={preview} setPreview={setPreview} health={health} onStarted={(next, nextDigest, nextGrant, nextRegistrationHash) => { setExecution(next); setDigest(nextDigest); setGrant(nextGrant); setRegistrationHash(nextRegistrationHash); setPhase("during"); setError(null); }} onError={setError} />}
    {view === "trade" && phase === "during" && execution && <DuringState execution={execution} health={health} market={selectedMarket} onCancel={() => { void api<PublicExecution>(`/api/executions/${execution.id}/cancel`, { method: "POST" }).then(setExecution).catch((reason: unknown) => setError(errorText(reason))); }} error={error} />}
    {view === "trade" && phase === "after" && execution && <AfterState execution={execution} digest={digest} grant={grant} registrationHash={registrationHash} health={health} onRevoke={revoke} revokePending={revokePending} onExitRule={setExecution} onResume={() => { void resume(); }} resumePending={resumePending} onNewExecution={() => { setExecution(null); setGrant(null); setDigest(null); setRegistrationHash(null); setPreview(null); setError(null); setPhase("before"); }} />}
    <footer><span>Live venue data only</span><span>·</span><a href="https://app.dreamdex.io/docs/developers/event-contracts" target="_blank" rel="noreferrer">DreamDEX event-contract docs</a></footer>
  </div>;
}
