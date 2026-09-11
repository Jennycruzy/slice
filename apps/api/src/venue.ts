import { Decimal } from "decimal.js/decimal";
import {
  isBinaryMarket,
  ORDER_TYPE,
  ORDER_KIND,
  SELF_MATCHING_OPTION,
  SOMNIA_MAINNET_ADDRESSES,
  SOMNIA_TESTNET_ADDRESSES,
  SomniaMarkets,
  orderBookEventsAbi,
  type BinaryMarket,
  type BinarySide,
  type MarketOnchain,
  type OrderFill,
} from "@somnia-chain/markets-sdk";
import { SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS, SomniaReactivityPrecompileABI } from "@somnia-chain/markets-sdk/reactivity";
import { somniaMainnet, somniaShannon } from "@somnia-chain/markets-sdk/chains";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  formatUnits,
  http,
  keccak256,
  parseAbi,
  parseUnits,
  publicActions,
  toBytes,
  webSocket,
  zeroAddress,
  type Address,
  type Block,
  type Hash,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AppEnv } from "./env.js";
import { createSnapshot, normalizeOrderBook, type BookSnapshot, type BookLevel, type OrderBook, type SessionGrant, type TradeSide } from "@slice/core";

const allOpenOrdersAbi = parseAbi([
  "function getAllOpenOrdersOffChain(bool isBid, uint256 maxCount, uint64 startCursor) view returns ((uint128 orderId, bool isBid, address owner, uint64 userData, uint256 price, uint256 fullQuantity, uint256 quantityRemaining, uint64 expireTimestampNs)[] orders, bool hasMoreOrders, uint64 nextCursor)",
]);

const binaryOrderPlacedAbi = parseAbi([
  "event BinaryOrderPlaced(uint128 indexed orderId, uint8 kind)",
]);

const sessionPolicyAbi = parseAbi([
  "function ownerOf(bytes32 digest) view returns (address)",
  "function revoked(bytes32 digest) view returns (bool)",
  "function registerGrant((address owner,address executor,bytes32 marketId,address pool,address collateral,address outcomeToken,uint256 outcomeTokenId,uint256 oneCollateral,uint8 outcome,uint8 side,uint256 maxContracts,uint64 issuedAt,uint64 expiresAt,uint256 nonce) grant, bytes signature) returns (bytes32 digest)",
]);

const executionRouterAbi = parseAbi([
  "function executeBinaryOrder((address owner,address executor,bytes32 marketId,address pool,address collateral,address outcomeToken,uint256 outcomeTokenId,uint256 oneCollateral,uint8 outcome,uint8 side,uint256 maxContracts,uint64 issuedAt,uint64 expiresAt,uint256 nonce) grant, bytes signature, address pool, address collateral, address outcomeToken, uint8 kind, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k, uint64 userData, uint256 oneCollateral, uint256 outcomeTokenId) payable returns (bool success, uint128 id)",
]);

const ORDER_FILLED_TOPIC = keccak256(toBytes("OrderFilled(uint128,uint128,uint256,uint256,uint256,uint256)"));
const BINARY_ORDER_PLACED_TOPIC = keccak256(toBytes("BinaryOrderPlaced(uint128,uint8)"));

export interface VenueMarket {
  row: BinaryMarket;
  onchain: MarketOnchain;
  marketName: string;
  yesSymbol: string;
  noSymbol: string;
}

export interface PlacedChild {
  orderId: string | null;
  hash: Hash;
  receipt: TransactionReceipt;
  fills: Array<{
    orderFill: OrderFill;
    logIndex: number;
    outcomePrice: string;
    quantity: string;
    quote: string;
  }>;
  requestedQuantity: string;
  averagePrice: string | null;
  filledQuantity: string;
  status: "filled" | "partial" | "rejected";
  rejectionReason: string | null;
}

export interface VenueConfig {
  maxBookLevels: number;
  minExpiryHeadroomSeconds: number;
  childOrderExpirySeconds: number;
}

type RawOpenOrder = {
  orderId: bigint;
  isBid: boolean;
  price: bigint;
  quantityRemaining: bigint;
  expireTimestampNs: bigint;
};

const NANOSECONDS_PER_SECOND = 1_000_000_000n;

function formatRaw(value: bigint, decimals: number): string {
  return formatUnits(value, decimals);
}

function orderSideForOutcome(outcome: "YES" | "NO", tradeSide: TradeSide): BinarySide {
  if (outcome === "YES") return tradeSide === "buy" ? "BUY_YES" : "SELL_YES";
  return tradeSide === "buy" ? "BUY_NO" : "SELL_NO";
}

function rawYesPriceForOutcome(rawOutcomePrice: bigint, outcome: "YES" | "NO", decimals: number): bigint {
  if (outcome === "YES") return rawOutcomePrice;
  const one = 10n ** BigInt(decimals);
  if (rawOutcomePrice >= one) throw new Error("NO probability must be below one collateral unit");
  return one - rawOutcomePrice;
}

function outcomePriceFromYes(rawYesPrice: bigint, outcome: "YES" | "NO", decimals: number): bigint {
  if (outcome === "YES") return rawYesPrice;
  const one = 10n ** BigInt(decimals);
  if (rawYesPrice > one) throw new Error("YES probability is above one collateral unit");
  return one - rawYesPrice;
}

function aggregateLevels(orders: RawOpenOrder[], outcome: "YES" | "NO", isBid: boolean, decimals: number): BookLevel[] {
  const aggregated = new Map<string, bigint>();
  const one = 10n ** BigInt(decimals);
  for (const order of orders) {
    if (order.isBid !== isBid || order.quantityRemaining <= 0n) continue;
    const price = outcome === "YES" ? order.price : one - order.price;
    if (price <= 0n || price >= one) continue;
    const key = price.toString();
    aggregated.set(key, (aggregated.get(key) ?? 0n) + order.quantityRemaining);
  }
  return [...aggregated.entries()]
    .map(([price, quantity]) => ({ price: formatRaw(BigInt(price), decimals), quantity: formatRaw(quantity, decimals) }))
    .sort((left, right) => {
      const compare = new Decimal(left.price).cmp(right.price);
      return isBid ? -compare : compare;
    });
}

function parseOrderBookFromOrders(orders: RawOpenOrder[], outcome: "YES" | "NO", decimals: number, block: Block): OrderBook {
  if (block.number === null) throw new Error("Somnia returned a latest block without a block number");
  const cutoffNs = block.timestamp * NANOSECONDS_PER_SECOND;
  const liveOrders = orders.filter((order) => order.expireTimestampNs === 0n || order.expireTimestampNs > cutoffNs);
  return normalizeOrderBook({
    bids: aggregateLevels(liveOrders, outcome, true, decimals),
    asks: aggregateLevels(liveOrders, outcome, false, decimals),
  }, new Date(Number(block.timestamp) * 1000).toISOString(), block.number);
}

function orderFillFromReceipt(receipt: TransactionReceipt, pool: Address): { fills: OrderFill[]; orderId: bigint | null; logs: Array<{ fill: OrderFill; logIndex: number }> } {
  let orderId: bigint | null = null;
  const fills: OrderFill[] = [];
  const logs: Array<{ fill: OrderFill; logIndex: number }> = [];
  for (const [index, log] of receipt.logs.entries()) {
    if (log.address.toLowerCase() !== pool.toLowerCase()) continue;
    const topic = log.topics[0];
    if (topic === ORDER_FILLED_TOPIC) {
      const decoded = decodeEventLog({ abi: orderBookEventsAbi, data: log.data, topics: log.topics });
      if (decoded.eventName !== "OrderFilled") throw new Error("DreamDEX returned an unexpected event for the OrderFilled topic");
      const fill: OrderFill = {
        takerOrderId: decoded.args.takerOrderId,
        makerOrderId: decoded.args.makerOrderId,
        quantityFilled: decoded.args.quantityFilled,
        takerRemainingQuantity: decoded.args.takerRemainingQuantity,
        makerRemainingQuantity: decoded.args.makerRemainingQuantity,
        fillPrice: decoded.args.fillPrice,
      };
      orderId ??= fill.takerOrderId;
      fills.push(fill);
      logs.push({ fill, logIndex: log.logIndex === null ? index : Number(log.logIndex) });
    } else if (topic === BINARY_ORDER_PLACED_TOPIC) {
      const decoded = decodeEventLog({ abi: binaryOrderPlacedAbi, data: log.data, topics: log.topics });
      if (decoded.eventName !== "BinaryOrderPlaced") throw new Error("DreamDEX returned an unexpected event for the BinaryOrderPlaced topic");
      orderId = decoded.args.orderId;
    }
  }
  return { fills, orderId, logs };
}

export class DreamDexVenue {
  readonly exchange: SomniaMarkets;
  readonly publicClient: PublicClient;
  readonly walletClient: WalletClient | null;
  readonly executorAddress: Address | null;
  readonly quoterWalletClient: WalletClient | null;
  readonly quoterPublicClient: PublicClient | null;
  readonly quoterAddress: Address | null;
  readonly executionRouterAddress: Address | null;
  readonly config: VenueConfig;
  private readonly chain: typeof somniaMainnet | typeof somniaShannon;
  private readonly env: AppEnv;

  constructor(env: AppEnv) {
    this.env = env;
    const chain = env.networkName === "mainnet" ? somniaMainnet : somniaShannon;
    this.chain = chain;
    const addresses = env.networkName === "mainnet" ? SOMNIA_MAINNET_ADDRESSES : SOMNIA_TESTNET_ADDRESSES;
    this.exchange = new SomniaMarkets({
      indexerUrl: env.indexerUrl,
      chain,
      wsRpcUrl: env.wsRpcUrl,
      addresses,
    });
    this.publicClient = createPublicClient({ chain, transport: http(env.rpcUrl) });
    if (env.executorPrivateKey !== null) {
      const account = privateKeyToAccount(env.executorPrivateKey);
      this.executorAddress = account.address;
      this.walletClient = createWalletClient({ account, chain, transport: http(env.rpcUrl) }).extend(publicActions);
    } else {
      this.executorAddress = null;
      this.walletClient = null;
    }
    if (env.quoterPrivateKey !== null) {
      const account = privateKeyToAccount(env.quoterPrivateKey);
      if (this.executorAddress !== null && account.address.toLowerCase() === this.executorAddress.toLowerCase()) {
        throw new Error("The quoter key must resolve to a different account than the delegated executor key");
      }
      this.quoterAddress = account.address;
      this.quoterWalletClient = createWalletClient({ account, chain, transport: http(env.rpcUrl) }).extend(publicActions);
      this.quoterPublicClient = createPublicClient({ chain, transport: webSocket(env.wsRpcUrl) });
    } else {
      this.quoterAddress = null;
      this.quoterWalletClient = null;
      this.quoterPublicClient = null;
    }
    this.executionRouterAddress = env.executionRouterAddress;
    this.config = {
      maxBookLevels: env.slice.maxBookLevels,
      minExpiryHeadroomSeconds: env.slice.minExpiryHeadroomSeconds,
      childOrderExpirySeconds: env.slice.childOrderExpirySeconds,
    };
  }

  async listLiveMarkets(): Promise<VenueMarket[]> {
    const expiryCutoff = BigInt(Math.floor(Date.now() / 1000) + this.config.minExpiryHeadroomSeconds);
    const rows = await this.exchange.client.listLiveBinaryMarkets({
      limit: Math.min(this.config.maxBookLevels, 25),
      nowSec: Number(expiryCutoff),
    });
    const markets = await Promise.all(rows.filter(isBinaryMarket).map(async (row) => {
      try {
        const onchain = await this.exchange.client.getMarketOnchain(row.marketId as Hex);
        if (onchain.status !== 1 || onchain.expiry < expiryCutoff) return null;
        return this.toVenueMarket(row, onchain);
      } catch (error) {
        throw new Error(`Unable to validate live market ${row.marketId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    })).then((validated) => validated.filter((market): market is VenueMarket => market !== null));
    return markets;
  }

  async resolveMarket(marketId: string): Promise<VenueMarket> {
    const row = await this.exchange.client.getBinaryMarket(marketId);
    if (row === null) throw new Error("That event market is not present in the live venue");
    const onchain = await this.exchange.client.getMarketOnchain(row.marketId as Hex);
    if (onchain.status !== 1) throw new Error("This market is no longer trading");
    const secondsLeft = Number(onchain.expiry) - Math.floor(Date.now() / 1000);
    if (secondsLeft < this.config.minExpiryHeadroomSeconds) throw new Error("This market is too close to expiry for a worked order");
    return this.toVenueMarket(row, onchain);
  }

  private toVenueMarket(row: BinaryMarket, onchain: MarketOnchain): VenueMarket {
    const quote = row.collateral.slice(0, 10).toUpperCase();
    const marketName = row.question || `${row.asset} event`;
    return {
      row,
      onchain,
      marketName,
      yesSymbol: `${row.asset} / ${quote} · YES`,
      noSymbol: `${row.asset} / ${quote} · NO`,
    };
  }

  private async readRawOrders(pool: Address, blockNumber: bigint): Promise<RawOpenOrder[]> {
    const orders: RawOpenOrder[] = [];
    for (const isBid of [true, false]) {
      let cursor = 0n;
      let hasMore = true;
      while (hasMore) {
        const result = await this.publicClient.readContract({
          address: pool,
          abi: allOpenOrdersAbi,
          functionName: "getAllOpenOrdersOffChain",
          args: [isBid, BigInt(this.config.maxBookLevels), cursor],
          blockNumber,
        });
        for (const order of result[0]) orders.push(order);
        const nextCursor = result[2];
        if (result[1] && nextCursor === cursor) throw new Error("DreamDEX returned an unchanged order-book pagination cursor");
        hasMore = result[1];
        cursor = nextCursor;
      }
    }
    return orders;
  }

  async readBook(market: VenueMarket, outcome: "YES" | "NO"): Promise<{ book: OrderBook; block: Block }> {
    const block = await this.publicClient.getBlock({ blockTag: "latest" });
    if (block.number === null) throw new Error("Somnia returned a latest block without a block number");
    const orders = await this.readRawOrders(market.onchain.pool, block.number);
    const book = parseOrderBookFromOrders(orders, outcome, market.onchain.decimals, block);
    return { book, block };
  }

  async captureSnapshot(params: { market: VenueMarket; outcome: "YES" | "NO"; side: TradeSide; quantity: string; snapshotId: string }): Promise<BookSnapshot> {
    const { book } = await this.readBook(params.market, params.outcome);
    return createSnapshot({
      id: params.snapshotId,
      marketId: params.market.row.marketId,
      symbol: params.outcome === "YES" ? params.market.yesSymbol : params.market.noSymbol,
      side: params.side,
      requestedQuantity: quantityString(params.quantity),
      book,
    });
  }

  async placeChild(params: { market: VenueMarket; owner: Address; outcome: "YES" | "NO"; side: TradeSide; quantity: string; sequence: number; sessionGrant: SessionGrant }): Promise<PlacedChild> {
    if (this.walletClient === null || this.executorAddress === null) throw new Error("Slice execution is not configured with a delegated executor key");
    if (this.executionRouterAddress === null) throw new Error("Slice execution is not configured with the non-custodial binary execution router");
    const current = await this.readBook(params.market, params.outcome);
    const level = params.side === "buy" ? current.book.asks[0] : current.book.bids[0];
    if (level === undefined) throw new Error("Book has no executable liquidity at the current touch");
    const decimals = params.market.onchain.decimals;
    const grid = await this.exchange.client.getBinaryBookParams(params.market.onchain.pool);
    const requestedRaw = roundDown(parseUnits(quantityString(params.quantity), decimals), grid.lotSize);
    if (requestedRaw < grid.minQuantity) throw new Error(`Child quantity is below the venue minimum of ${formatRaw(grid.minQuantity, decimals)}`);
    const rawOutcomePrice = roundDown(parseUnits(level.price, decimals), grid.tickSize);
    if (rawOutcomePrice <= 0n) throw new Error("The live touch is below the venue price grid");
    const rawYesPrice = rawYesPriceForOutcome(rawOutcomePrice, params.outcome, decimals);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expirySeconds = Math.min(nowSeconds + this.config.childOrderExpirySeconds, Number(params.market.onchain.expiry));
    if (expirySeconds <= nowSeconds) throw new Error("The market expired before this child order could be placed");
    const kind = ORDER_KIND[orderSideForOutcome(params.outcome, params.side)];
    const tokenId = params.outcome === "YES" ? params.market.onchain.yesId : params.market.onchain.noId;
    const grant = {
      owner: params.sessionGrant.owner,
      executor: params.sessionGrant.executor,
      marketId: params.sessionGrant.marketId as Hex,
      pool: params.sessionGrant.marketPool,
      collateral: params.sessionGrant.marketCollateral,
      outcomeToken: params.sessionGrant.marketOutcomeToken,
      outcomeTokenId: BigInt(params.sessionGrant.outcomeTokenId),
      oneCollateral: BigInt(params.sessionGrant.oneCollateral),
      outcome: params.sessionGrant.outcome === "YES" ? 0 : 1,
      side: params.sessionGrant.side === "buy" ? 0 : 1,
      maxContracts: BigInt(params.sessionGrant.maxContracts),
      issuedAt: BigInt(params.sessionGrant.issuedAt),
      expiresAt: BigInt(params.sessionGrant.expiresAt),
      nonce: BigInt(params.sessionGrant.nonce),
    } as const;
    const hash = await this.walletClient.writeContract({
      address: this.executionRouterAddress,
      abi: executionRouterAbi,
      functionName: "executeBinaryOrder",
      args: [
        grant,
        params.sessionGrant.signature,
        params.market.onchain.pool,
        params.market.onchain.collateral,
        params.market.onchain.outcomeToken,
        kind,
        rawYesPrice,
        requestedRaw,
        BigInt(expirySeconds) * NANOSECONDS_PER_SECOND,
        ORDER_TYPE.MARKET,
        SELF_MATCHING_OPTION.CANCEL_TAKER,
        zeroAddress,
        0n,
        BigInt(params.sequence),
        10n ** BigInt(decimals),
        tokenId,
      ],
      account: this.walletClient.account!,
      chain: this.chain,
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`Venue rejected the child order in transaction ${hash}`);
    }
    const decoded = orderFillFromReceipt(receipt, params.market.onchain.pool);
    const selectedOrderId = decoded.orderId === null ? null : decoded.orderId.toString();
    const selectedFills = decoded.orderId === null
      ? decoded.logs
      : decoded.logs.filter(({ fill }) => fill.takerOrderId === decoded.orderId || fill.makerOrderId === decoded.orderId);
    const fills = selectedFills.map(({ fill, logIndex }) => {
      const outcomePriceRaw = outcomePriceFromYes(fill.fillPrice, params.outcome, decimals);
      const quantity = formatRaw(fill.quantityFilled, decimals);
      const outcomePrice = formatRaw(outcomePriceRaw, decimals);
      return { orderFill: fill, logIndex, outcomePrice, quantity, quote: new Decimal(quantity).mul(outcomePrice).toFixed() };
    });
    const filledQuantity = fills.reduce((sum, fill) => sum.add(fill.quantity), new Decimal(0));
    const quote = fills.reduce((sum, fill) => sum.add(fill.quote), new Decimal(0));
    const averagePrice = filledQuantity.gt(0) ? quote.div(filledQuantity).toFixed() : null;
    return {
      orderId: selectedOrderId,
      hash,
      receipt,
      fills,
      requestedQuantity: quantityString(params.quantity),
      averagePrice,
      filledQuantity: filledQuantity.toFixed(),
      status: filledQuantity.gte(new Decimal(params.quantity)) ? "filled" : filledQuantity.gt(0) ? "partial" : "rejected",
      rejectionReason: filledQuantity.gt(0) ? null : "The IOC child found no fill at the live touch",
    };
  }

  async isSessionDigestRevoked(digest: Hex): Promise<boolean> {
    if (this.env.sessionPolicyAddress === null) return false;
    return this.publicClient.readContract({
      address: this.env.sessionPolicyAddress,
      abi: sessionPolicyAbi,
      functionName: "revoked",
      args: [digest],
    });
  }

  async isSessionDigestRegistered(digest: Hex): Promise<boolean> {
    if (this.env.sessionPolicyAddress === null) return false;
    const owner = await this.publicClient.readContract({
      address: this.env.sessionPolicyAddress,
      abi: sessionPolicyAbi,
      functionName: "ownerOf",
      args: [digest],
    });
    return owner.toLowerCase() !== zeroAddress.toLowerCase();
  }

  async getReactivitySubscription(subscriptionId: string): Promise<{ owner: Address; handler: Address; emitter: Address; eventTopic: Hex }> {
    if (!/^\d+$/.test(subscriptionId)) throw new Error("Reactivity subscription id must be a decimal integer");
    const raw = await this.publicClient.readContract({
      address: SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS,
      abi: SomniaReactivityPrecompileABI,
      functionName: "getSubscriptionInfo",
      args: [BigInt(subscriptionId)],
    });
    const [data, owner] = raw as readonly [{ readonly handlerContractAddress: Address; readonly emitter: Address; readonly eventTopics: readonly Hex[] }, Address];
    const eventTopic = data.eventTopics[0];
    if (eventTopic === undefined) throw new Error("Reactivity subscription returned no event topic");
    return { owner, handler: data.handlerContractAddress, emitter: data.emitter, eventTopic };
  }

  async registerSessionGrant(grant: SessionGrant): Promise<Hash> {
    if (this.env.sessionPolicyAddress === null) throw new Error("Session authorization is not configured on this deployment");
    if (this.walletClient === null || this.executorAddress === null) throw new Error("Slice execution is not configured with a delegated executor key");
    const hash = await this.walletClient.writeContract({
      address: this.env.sessionPolicyAddress,
      abi: sessionPolicyAbi,
      functionName: "registerGrant",
      args: [{
        owner: grant.owner,
        executor: grant.executor,
        marketId: grant.marketId as Hex,
        pool: grant.marketPool,
        collateral: grant.marketCollateral,
        outcomeToken: grant.marketOutcomeToken,
        outcomeTokenId: BigInt(grant.outcomeTokenId),
        oneCollateral: BigInt(grant.oneCollateral),
        outcome: grant.outcome === "YES" ? 0 : 1,
        side: grant.side === "buy" ? 0 : 1,
        maxContracts: BigInt(grant.maxContracts),
        issuedAt: BigInt(grant.issuedAt),
        expiresAt: BigInt(grant.expiresAt),
        nonce: BigInt(grant.nonce),
      }, grant.signature],
      account: this.walletClient.account!,
      chain: this.chain,
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`Session grant registration did not confirm on Somnia: ${hash}`);
    return hash;
  }

  async currentMid(market: VenueMarket, outcome: "YES" | "NO"): Promise<string | null> {
    const { book } = await this.readBook(market, outcome);
    const bid = book.bids[0]?.price;
    const ask = book.asks[0]?.price;
    return bid === undefined || ask === undefined ? null : new Decimal(bid).add(ask).div(2).toFixed();
  }
}

function quantityString(value: string): string {
  const quantity = new Decimal(value);
  if (!quantity.isFinite() || quantity.lte(0)) throw new Error("Order quantity must be positive");
  return quantity.toFixed();
}

function roundDown(value: bigint, increment: bigint): bigint {
  if (increment <= 0n) throw new Error("Venue returned an invalid order grid");
  return (value / increment) * increment;
}
