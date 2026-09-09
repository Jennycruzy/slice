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
  type SessionGrant,
  type StrategyName,
} from "@slice/core";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const SESSION_DURATION_SECONDS = Number(import.meta.env.VITE_SESSION_DURATION_SECONDS);
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
  executorAddress: Address | null;
  sessionPolicyAddress: Address | null;
  explorerUrl: string;
  reactivityConfigured: boolean;
  reactivityHandlerAddress: Address | null;
  reactivityEmitterAddress: Address | null;
  reactivitySubscriptionId: string | null;
  lastHeartbeatAt: string;
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
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
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

function human(value: bigint | string, decimals: number): string {
  return formatUnits(typeof value === "bigint" ? value : BigInt(value), decimals);
}

function cents(value: string | null): string {
  return value === null ? "—" : `${(Number(value) * 100).toFixed(2)}¢`;
}

function dollars(value: string | null): string {
  return value === null ? "—" : `$${Number(value).toFixed(2)}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function LiveLadder({ market, outcome }: { market: MarketSummary; outcome: "YES" | "NO" }) {
  const watchStatus = useWatchMarket(market.pool);
  const tail = useLiveStatus();
  const binaryBook = useLiveBinaryOrderBook(market.pool, 10);
  const bids = outcome === "YES" ? binaryBook.yesBids : binaryBook.noBids;
  const asks = outcome === "YES" ? binaryBook.yesAsks : binaryBook.noAsks;
  const rows = Math.max(bids.length, asks.length);

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
      {watchStatus === "live" && rows === 0 && <p className="empty-state">No live levels are resting for this outcome.</p>}
      {rows > 0 && (
        <div className="book-table-wrap">
          <table className="book-table">
            <thead><tr><th scope="col">Bid size</th><th scope="col">Bid</th><th scope="col">Ask</th><th scope="col">Ask size</th></tr></thead>
            <tbody>
              {Array.from({ length: rows }, (_, index) => {
                const bid = bids[index];
                const ask = asks[index];
                return <tr key={`${bid?.price ?? "none"}-${ask?.price ?? "none"}`}>
                  <td className="bid-number">{bid ? human(bid.quantity, market.decimals) : ""}</td>
                  <td className="bid-number">{bid ? cents(human(bid.price, market.decimals)) : ""}</td>
                  <td className="ask-number">{ask ? cents(human(ask.price, market.decimals)) : ""}</td>
                  <td className="ask-number">{ask ? human(ask.quantity, market.decimals) : ""}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="source-note">Source: DreamDEX live tail · block {tail.lastBlock > 0 ? tail.lastBlock : "pending"}</p>
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

function GrantScope({ grant, marketName }: { grant: SessionGrant; marketName: string }) {
  return <div className="grant-scope" aria-label="Session authorisation scope">
    <div><span>Market</span><strong>{marketName}</strong></div>
    <div><span>Outcome / side</span><strong>{grant.outcome} · {grant.side}</strong></div>
    <div><span>Maximum</span><strong>{grant.maxContracts} contracts</strong></div>
    <div><span>Expires</span><strong>{new Date(grant.expiresAt * 1000).toLocaleString()}</strong></div>
  </div>;
}

function BeforeState({
  markets,
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
  const [advanced, setAdvanced] = useState(false);
  const canUseEngine = health?.status === "ok" && health.executorConfigured && health.sessionPolicyAddress !== null;
  const validQuantity = /^\d+(?:\.\d+)?$/.test(quantity) && Number(quantity) > 0;

  async function requestPreview() {
    if (selected === null || !validQuantity) {
      onError("Choose a live market and enter a positive contract size before previewing impact.");
      return;
    }
    try {
      const next = await api<ImpactPreview>("/api/preview-impact", { method: "POST", body: JSON.stringify({ marketId: selected.id, outcome, side, quantity, strategy }) });
      setPreview(next);
      if (!next.canSubmit) onError(next.refusalReason ?? "The live book cannot fill that size.");
    } catch (error) {
      onError(errorText(error));
    }
  }

  async function prepareEscrow() {
    if (selected === null || address === undefined || publicClient === undefined) throw new Error("Connect a wallet before preparing the live venue escrow");
    const maximumCollateral = parseUnits(quantity, selected.decimals);
    if (side === "buy") {
      const allowance = await publicClient.readContract({
        address: selected.collateral,
        abi: erc20WriteAbi,
        functionName: "allowance",
        args: [address, selected.pool],
      });
      if (allowance < maximumCollateral) {
        const hash = await writeContractAsync({
          address: selected.collateral,
          abi: erc20WriteAbi,
          functionName: "approve",
          args: [selected.pool, maximumCollateral],
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
      args: [address, selected.pool],
    });
    if (!operatorApproved) {
      const hash = await writeContractAsync({
        address: selected.outcomeToken,
        abi: erc6909Abi,
        functionName: "setOperator",
        args: [selected.pool, true],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Outcome-token approval did not confirm on Somnia");
    }
  }

  async function startExecution() {
    if (selected === null || preview === null || !preview.canSubmit) return;
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
        outcome,
        side,
        maxContracts: quantity,
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
        body: JSON.stringify({ owner: address, marketId: selected.id, outcome, side, quantity, strategy, sessionGrant: grant }),
      });
      onStarted(execution, verified.digest, grant, verified.registrationHash);
    } catch (error) {
      onError(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return <main className="before-state">
    <div className="hero-copy">
      <p className="section-kicker">DreamDEX event contracts · Somnia Shannon</p>
      <h1>Make size quiet.</h1>
      <p className="product-line">Prediction markets have order books but no execution tools. Every serious trader silently overpays on entry. Slice is the first product that fixes it.</p>
      <p className="lede">A market order announces your whole position to a thin book. Slice works it in measured child orders and proves what the execution saved.</p>
    </div>
    {markets.length === 0 ? <div className="empty-panel"><h2>No live event market returned</h2><p>Refresh when DreamDEX has an active binary market. Slice does not invent a market or a quote.</p></div> : <>
      <section className="order-panel">
        <div className="field-row">
          <label>Market<select value={selected?.id ?? ""} onChange={(event) => { const market = markets.find((item) => item.id === event.target.value); if (market) { setSelected(market); setPreview(null); } }}>{markets.map((market) => <option key={market.id} value={market.id}>{market.name}</option>)}</select></label>
          <label>Contracts<input inputMode="decimal" value={quantity} onChange={(event) => { setQuantity(event.target.value); setPreview(null); }} placeholder="Enter size" /></label>
        </div>
        <div className="control-line"><div className="segmented" aria-label="Outcome">{(["YES", "NO"] as const).map((item) => <button key={item} className={outcome === item ? "selected" : ""} onClick={() => { setOutcome(item); setPreview(null); }}>{item}</button>)}</div><div className="segmented" aria-label="Side">{(["buy", "sell"] as const).map((item) => <button key={item} className={side === item ? "selected" : ""} onClick={() => { setSide(item); setPreview(null); }}>{item}</button>)}</div></div>
        <div className="strategy-grid" aria-label="Execution strategy"><button className={strategy === "iceberg" ? "strategy selected" : "strategy"} onClick={() => { setStrategy("iceberg"); setPreview(null); }}><strong>Hide my size</strong><span>Show only the slice the book can see.</span></button><button className={strategy === "scale-in" ? "strategy selected" : "strategy"} onClick={() => { setStrategy("scale-in"); setPreview(null); }}><strong>Scale in</strong><span>Spread tranches across the live window.</span></button></div>
        <button className="text-button" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>{advanced ? "Hide advanced controls" : "Show advanced controls"}</button>
        {advanced && <p className="inline-note">Slice derives the default display size from the current executable level. The schedule window follows the market's on-chain expiry unless you provide a custom window through the API.</p>}
        <div className="action-row"><button className="primary-button" onClick={() => void requestPreview()} disabled={selected === null || !validQuantity}>Preview impact</button>{preview && <button className="secondary-button" onClick={() => void startExecution()} disabled={!canUseEngine || !isConnected || busy || signing || !preview.canSubmit}>{busy || signing ? "Authorising…" : canUseEngine ? "Start Slice" : "Execution unavailable"}</button>}</div>
        {preview && <ImpactBlock preview={preview} decimals={selected?.decimals ?? 0} />}
        {preview && selected && <SnapshotLadder snapshot={preview.snapshot} />}
      </section>
      {selected && <LiveLadder market={selected} outcome={outcome} />}
    </>}
    <div className="wallet-bar"><div><span className="section-kicker">Wallet-signed controls</span><p>{isConnected ? `Connected ${shortAddress(address)}` : "Preview is public. Starting an execution requires your wallet signature."}</p></div>{isConnected ? <button className="secondary-button" onClick={() => disconnect()}>Disconnect</button> : <button className="secondary-button" onClick={() => { const connector = connectors[0]; if (connector) connect({ connector }); }}>Connect wallet</button>}</div>
  </main>;
}

function ImpactBlock({ preview }: { preview: ImpactPreview; decimals: number }) {
  const naive = preview.snapshot.naiveWalk.averagePrice;
  const projected = preview.strategy.projectedAveragePrice;
  return <div className={`impact-block ${preview.canSubmit ? "" : "is-refused"}`}><div><span>Market order would average</span><strong>{cents(naive)}</strong></div><div><span>Projected worked fill</span><strong>{cents(projected)}</strong></div><div className="impact-delta"><span>Projected difference</span><strong>{dollars(preview.strategy.projectedSavings)}</strong></div>{!preview.canSubmit && <p className="error-banner">{preview.refusalReason}</p>}<p className="projection-note">Projection uses the live touch. The receipt uses the stored submission snapshot and real fills.</p></div>;
}

function DuringState({ execution, health, onCancel, error }: { execution: PublicExecution; health: Health | null; onCancel: () => void; error: string | null }) {
  const liveFilled = execution.fills.reduce((sum, fill) => sum + Number(fill.quantity), 0);
  const requested = Number(execution.request.quantity);
  const filled = execution.metrics?.filledQuantity ?? (Number.isFinite(liveFilled) ? String(liveFilled) : "0");
  const remaining = Math.max(0, requested - Number(filled));
  const reconnectMessage = execution.state === "reconnecting" || execution.state === "paused" ? `Reconnecting — ${filled} of ${execution.request.quantity} filled, nothing at risk` : null;
  return <main className="during-state"><div className="state-heading"><div><p className="section-kicker">Working the order</p><h1>{execution.request.marketName}</h1><p>{execution.request.quantity} contracts · {execution.request.outcome} · {execution.request.side} · {strategyLabel(execution.request.strategy)}</p></div><Heartbeat execution={execution} /></div>{error && <p className="error-banner" role="alert">{error}</p>}{reconnectMessage && <p className="reconnect-banner" role="status">{reconnectMessage}</p>}{execution.failureMessage && !reconnectMessage && <p className="error-banner" role="alert">{execution.failureMessage}</p>}<div className="progress-grid"><div className="progress-number"><span>Filled</span><strong>{filled}</strong><small>contracts</small></div><div className="progress-number"><span>Remaining</span><strong>{remaining.toFixed(4).replace(/\.?0+$/, "")}</strong><small>contracts</small></div><div className="progress-number"><span>Children</span><strong>{execution.children.length}</strong><small>transactions / attempts</small></div></div><div className="working-grid"><section className="child-panel"><div className="panel-heading"><div><span className="section-kicker">Execution tape</span><h2>Child orders</h2></div><span className="state-pill">{execution.state}</span></div><ol className="child-list">{execution.children.map((child) => <li key={child.id}><div><strong>#{child.sequence}</strong><span>{child.status} · {child.filledQuantity} / {child.requestedQuantity}</span></div>{child.transactionHash && health?.explorerUrl ? <a href={explorerTx(health.explorerUrl, child.transactionHash)} target="_blank" rel="noreferrer">{shortAddress(child.transactionHash)}</a> : child.transactionHash ? <span>{shortAddress(child.transactionHash)}</span> : <span className="muted">pending</span>}</li>)}</ol>{execution.cancelRequested ? <p className="inline-note">Cancel requested. The engine will settle the filled portion from chain state.</p> : <button className="secondary-button" onClick={onCancel}>Cancel execution</button>}</section>{execution.snapshot && <SnapshotLadder snapshot={execution.snapshot} />}</div></main>;
}

function Heartbeat({ execution }: { execution: PublicExecution }) {
  const age = Date.now() - Date.parse(execution.heartbeatAt);
  const healthy = Number.isFinite(age) && age < 30_000 && !["reconnecting", "paused"].includes(execution.state);
  return <div className={`heartbeat ${healthy ? "healthy" : "unhealthy"}`}><span aria-hidden="true" />{healthy ? "Engine live" : execution.state === "reconnecting" ? "Reconnecting" : "Engine needs attention"}<small>beat {new Date(execution.heartbeatAt).toLocaleTimeString()}</small></div>;
}

function AfterState({ execution, digest, grant, registrationHash, health, onRevoke, revokePending, onExitRule, onResume, resumePending }: { execution: PublicExecution; digest: Hex | null; grant: SessionGrant | null; registrationHash: Hex | null; health: Health | null; onRevoke: () => void; revokePending: boolean; onExitRule: (execution: PublicExecution) => void; onResume: () => void; resumePending: boolean }) {
  const metrics = execution.metrics;
  const canResume = ["authorisation_expired", "venue_rejected", "engine_error"].includes(execution.failureCode ?? "") && execution.state !== "completed" && execution.state !== "cancelled";
  return <main className="after-state"><div className="receipt-heading"><div><p className="section-kicker">Execution receipt · {execution.state}</p><h1>{execution.request.marketName}</h1><p>{metrics?.filledQuantity ?? "0"} contracts · {execution.request.outcome} · {strategyLabel(execution.request.strategy)}</p></div>{execution.receiptUrl && <a className="secondary-button link-button" href={execution.receiptUrl} target="_blank" rel="noreferrer">Open public receipt</a>}</div>{execution.failureMessage && <p className="error-banner" role="alert">{execution.failureMessage}</p>}{canResume && <button className="secondary-button" disabled={resumePending} onClick={onResume}>{resumePending ? "Waiting for authorisation…" : "Re-authorise and resume"}</button>}<section className="receipt-panel"><div className="saving-block"><span>Saved, net of observed drift</span><strong>{dollars(metrics?.netSavings ?? metrics?.rawSavings ?? null)}</strong></div><div className="comparison-grid"><div><span>Market order would have cost</span><strong>{cents(metrics?.naiveAveragePrice ?? null)}</strong><small>{metrics?.filledQuantity ?? "0"} contracts at submission snapshot</small></div><div><span>Slice filled at</span><strong>{cents(metrics?.actualAveragePrice ?? null)}</strong><small>{metrics?.filledQuantity ?? "0"} contracts across real fills</small></div></div><dl className="receipt-facts"><div><dt>Raw savings</dt><dd>{dollars(metrics?.rawSavings ?? null)}</dd></div><div><dt>Mid-price move</dt><dd>{cents(metrics?.midPriceMove ?? null)}</dd></div><div><dt>Drift adjustment</dt><dd>{dollars(metrics?.driftAdjustment ?? null)}</dd></div><div><dt>Receipt status</dt><dd>{execution.state}</dd></div></dl><SnapshotLadder snapshot={execution.snapshot} /></section><section className="child-panel receipt-children"><div className="panel-heading"><div><span className="section-kicker">Evidence</span><h2>Child-order transactions</h2></div></div><ul className="child-list">{execution.children.filter((child) => child.transactionHash !== null).map((child) => <li key={child.id}><div><strong>#{child.sequence}</strong><span>{child.filledQuantity} contracts at {cents(child.averagePrice)}</span></div>{health?.explorerUrl ? <a href={explorerTx(health.explorerUrl, child.transactionHash!)} target="_blank" rel="noreferrer">{child.transactionHash}</a> : <span>{child.transactionHash}</span>}</li>)}</ul></section><ExitRulePanel execution={execution} health={health} onRegistered={onExitRule} />{execution.exitRule && <section className="grant-panel"><div><span className="section-kicker">On-chain reactivity</span><h2>Active exit rule</h2></div><p>{triggerLabel(execution.exitRule.kind)} · {execution.exitRule.quantity} contracts · closes with a {execution.exitRule.side} order</p><p className="inline-note">Rule transaction: {health?.explorerUrl ? <a href={explorerTx(health.explorerUrl, execution.exitRule.transactionHash)} target="_blank" rel="noreferrer">{shortAddress(execution.exitRule.transactionHash)}</a> : execution.exitRule.transactionHash}</p></section>}{grant && digest && health?.sessionPolicyAddress && <section className="grant-panel"><div><span className="section-kicker">Authorisation</span><h2>Session scope</h2></div><GrantScope grant={grant} marketName={execution.request.marketName} />{registrationHash && health.explorerUrl && <p className="inline-note">Registered on-chain: <a href={explorerTx(health.explorerUrl, registrationHash)} target="_blank" rel="noreferrer">{shortAddress(registrationHash)}</a></p>}<button className="secondary-button" disabled={revokePending} onClick={onRevoke}>{revokePending ? "Revoking…" : "Revoke on-chain authorisation"}</button></section>}</main>;
}

function ExitRulePanel({ execution, health, onRegistered }: { execution: PublicExecution; health: Health | null; onRegistered: (execution: PublicExecution) => void }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();
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
      if (exitSide === "buy") {
        const allowance = await publicClient.readContract({
          address: execution.request.marketCollateral!,
          abi: erc20WriteAbi,
          functionName: "allowance",
          args: [address, execution.request.marketPool!],
        });
        if (allowance < quantity) {
          const approvalHash = await writeContractAsync({
            address: execution.request.marketCollateral!,
            abi: erc20WriteAbi,
            functionName: "approve",
            args: [execution.request.marketPool!, quantity],
          });
          const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
          if (approvalReceipt.status !== "success") throw new Error("Exit collateral approval did not confirm on Somnia");
        }
      } else {
        const operatorApproved = await publicClient.readContract({
          address: execution.request.marketOutcomeToken!,
          abi: erc6909Abi,
          functionName: "isOperator",
          args: [address, execution.request.marketPool!],
        });
        if (!operatorApproved) {
          const operatorHash = await writeContractAsync({
            address: execution.request.marketOutcomeToken!,
            abi: erc6909Abi,
            functionName: "setOperator",
            args: [execution.request.marketPool!, true],
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
      const hash = await writeContractAsync({
        address: handler,
        abi: EXIT_HANDLER_ABI,
        functionName: "registerRule",
        args: [execution.request.marketPool!, exitKind, trigger, oneCollateral, rawTrigger, rawMinimum, quantity, BigInt(execution.request.marketExpiry!) * 1_000_000_000n],
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

export default function App() {
  const [markets, setMarkets] = useState<MarketSummary[]>([]);
  const [selected, setSelected] = useState<MarketSummary | null>(null);
  const [outcome, setOutcome] = useState<"YES" | "NO">("YES");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [quantity, setQuantity] = useState("");
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
  const { writeContractAsync, isPending: revokePending } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();

  useEffect(() => {
    void Promise.all([api<{ markets: MarketSummary[] }>("/api/markets"), api<Health>("/health")]).then(([marketResponse, healthResponse]) => {
      setMarkets(marketResponse.markets);
      setSelected(marketResponse.markets[0] ?? null);
      setHealth(healthResponse);
    }).catch((reason: unknown) => setError(errorText(reason)));
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
    if (execution === null || address === undefined || health?.sessionPolicyAddress === null || health?.sessionPolicyAddress === undefined || health.executorAddress === null || execution.request.marketDecimals === undefined) {
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
      const issuedAt = Math.floor(Date.now() / 1000);
      const expiresAt = issuedAt + SESSION_DURATION_SECONDS;
      const nonceBytes = new Uint8Array(32);
      crypto.getRandomValues(nonceBytes);
      const nonce = BigInt(`0x${Array.from(nonceBytes, (value) => value.toString(16).padStart(2, "0")).join("")}`).toString();
      const grantBase = {
        owner: address,
        executor: health.executorAddress,
        marketId: execution.request.marketId,
        outcome: execution.request.outcome,
        side: execution.request.side,
        maxContracts: remaining,
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

  return <div className="app-shell"><header className="topbar"><a href="/" className="wordmark">SLICE<span>/</span></a><span className="network-tag">{health?.network ?? "Somnia Shannon"}</span><div className="topbar-copy">Execution for event markets</div></header>{error && <div className="global-error" role="alert"><strong>{error}</strong><button onClick={() => setError(null)} aria-label="Dismiss error">Dismiss</button></div>}{phase === "before" && <BeforeState markets={markets} selected={selectedMarket} setSelected={setSelected} outcome={outcome} setOutcome={setOutcome} side={side} setSide={setSide} quantity={quantity} setQuantity={setQuantity} strategy={strategy} setStrategy={setStrategy} preview={preview} setPreview={setPreview} health={health} onStarted={(next, nextDigest, nextGrant, nextRegistrationHash) => { setExecution(next); setDigest(nextDigest); setGrant(nextGrant); setRegistrationHash(nextRegistrationHash); setPhase("during"); setError(null); }} onError={setError} />}{phase === "during" && execution && <DuringState execution={execution} health={health} onCancel={() => { void api<PublicExecution>(`/api/executions/${execution.id}/cancel`, { method: "POST" }).then(setExecution).catch((reason: unknown) => setError(errorText(reason))); }} error={error} />}{phase === "after" && execution && <AfterState execution={execution} digest={digest} grant={grant} registrationHash={registrationHash} health={health} onRevoke={revoke} revokePending={revokePending} onExitRule={setExecution} onResume={() => { void resume(); }} resumePending={resumePending} />}<footer><span>Live venue data only</span><span>·</span><a href="https://app.dreamdex.io/docs/developers/event-contracts" target="_blank" rel="noreferrer">DreamDEX event-contract docs</a></footer></div>;
}
