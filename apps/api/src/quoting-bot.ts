import { parseUnits } from "viem";
import { ORDER_TYPE, SELF_MATCHING_OPTION, type BinarySide } from "@somnia-chain/markets-sdk";
import type { AppEnv } from "./env.js";
import { DreamDexVenue, type VenueMarket } from "./venue.js";

const NANOSECONDS_PER_SECOND = 1_000_000_000n;

type Quote = { pool: `0x${string}`; orderId: bigint };
type QuoterLog = (message: string, details: Record<string, unknown>) => void;

function floorToGrid(value: bigint, increment: bigint): bigint {
  if (value <= 0n) return 0n;
  return (value / increment) * increment;
}

function ceilToGrid(value: bigint, increment: bigint): bigint {
  if (value <= 0n) return 0n;
  return ((value + increment - 1n) / increment) * increment;
}

function outcomeSide(outcome: "YES" | "NO", side: "buy" | "sell"): BinarySide {
  if (outcome === "YES") return side === "buy" ? "BUY_YES" : "SELL_YES";
  return side === "buy" ? "BUY_NO" : "SELL_NO";
}

function yesPrice(outcomePrice: bigint, outcome: "YES" | "NO", oneCollateral: bigint): bigint {
  return outcome === "YES" ? outcomePrice : oneCollateral - outcomePrice;
}

export class QuotingBot {
  private running = false;
  private openQuotes: Quote[] = [];
  private seededMarketId: string | null = null;
  private lastError: string | null = null;
  private lastRunAt: string | null = null;
  private lastMarketId: string | null = null;

  constructor(
    private readonly venue: DreamDexVenue,
    private readonly env: AppEnv,
    private readonly log: QuoterLog,
  ) {}

  status() {
    return {
      enabled: this.env.quoter.enabled,
      running: this.running,
      accountConfigured: this.venue.quoterAddress !== null,
      quoterAddress: this.venue.quoterAddress,
      lastError: this.lastError,
      lastRunAt: this.lastRunAt,
      lastMarketId: this.lastMarketId,
      openQuotes: this.openQuotes.length,
    };
  }

  async start(): Promise<void> {
    if (!this.env.quoter.enabled) return;
    this.running = true;
    while (this.running) {
      try {
        await this.requote();
        this.lastError = null;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.log("Quoting bot paused after a live venue error", { error: this.lastError });
      }
      if (this.running) await this.wait(this.env.quoter.refreshSeconds! * 1000);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    try {
      await this.cancelQuotes();
    } catch (error) {
      this.log("Quoting bot could not cancel every resting quote before shutdown", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async requote(): Promise<void> {
    if (this.venue.quoterWalletClient === null || this.venue.quoterAddress === null) throw new Error("Quoting requires a separate configured quoter account");
    if (this.env.quoter.quantity === null || this.env.quoter.spreadTicks === null || this.env.quoter.refreshSeconds === null) throw new Error("Quoting requires quantity, spread ticks, and refresh interval configuration");
    const market = await this.selectMarket();
    const { book } = await this.venue.readBook(market, this.env.quoter.outcome);
    await this.cancelQuotes();
    const decimals = market.onchain.decimals;
    const oneCollateral = 10n ** BigInt(decimals);
    const grid = await this.venue.exchange.client.getBinaryBookParams(market.onchain.pool);
    const quantity = parseUnits(this.env.quoter.quantity, decimals);
    if (quantity < grid.minQuantity || quantity % grid.lotSize !== 0n) throw new Error("Configured quote quantity is below the live minimum or off the live lot grid");
    const reference = this.referencePrice(market, book, decimals, oneCollateral);
    if (reference === null) throw new Error("The live market has no reference price for bounded quoting");
    const spread = grid.tickSize * this.env.quoter.spreadTicks;
    let bid = floorToGrid(reference - spread, grid.tickSize);
    let ask = ceilToGrid(reference + spread, grid.tickSize);
    const bestBid = book.bids[0] === undefined ? null : parseUnits(book.bids[0].price, decimals);
    const bestAsk = book.asks[0] === undefined ? null : parseUnits(book.asks[0].price, decimals);
    if (bestAsk !== null && bid >= bestAsk) bid = floorToGrid(bestAsk - grid.tickSize, grid.tickSize);
    if (bestBid !== null && ask <= bestBid) ask = ceilToGrid(bestBid + grid.tickSize, grid.tickSize);
    if (bid <= 0n || ask >= oneCollateral || bid >= ask) throw new Error("The live price and configured spread cannot form a bounded two-sided quote");

    const trader = this.venue.exchange.client.createTrader({ walletClient: this.venue.quoterWalletClient, publicClient: this.venue.publicClient, decimals });
    if (this.seededMarketId !== market.row.marketId) {
      const seed = await trader.mintSet({ pool: market.onchain.pool, collateral: market.onchain.collateral, amount: quantity, autoApprove: true });
      this.seededMarketId = market.row.marketId;
      this.log("Seeded the quote account with a live complete set", { marketId: market.row.marketId, transactionHash: seed.hash });
    }
    const expiry = market.onchain.expiry * NANOSECONDS_PER_SECOND;
    const buy = await trader.placeOrder({
      pool: market.onchain.pool,
      side: outcomeSide(this.env.quoter.outcome, "buy"),
      price: yesPrice(bid, this.env.quoter.outcome, oneCollateral),
      quantity,
      expireTimestampNs: expiry,
      orderType: ORDER_TYPE.POST_ONLY,
      selfMatchingOption: SELF_MATCHING_OPTION.CANCEL_TAKER,
      autoApprove: true,
    });
    if (buy.orderId === undefined) throw new Error("Live venue did not return a resting bid id");
    this.openQuotes.push({ pool: market.onchain.pool, orderId: buy.orderId });
    const sell = await trader.placeOrder({
      pool: market.onchain.pool,
      side: outcomeSide(this.env.quoter.outcome, "sell"),
      price: yesPrice(ask, this.env.quoter.outcome, oneCollateral),
      quantity,
      expireTimestampNs: expiry,
      orderType: ORDER_TYPE.POST_ONLY,
      selfMatchingOption: SELF_MATCHING_OPTION.CANCEL_TAKER,
      autoApprove: true,
    });
    if (sell.orderId === undefined) throw new Error("Live venue did not return a resting ask id");
    this.openQuotes.push({ pool: market.onchain.pool, orderId: sell.orderId });
    this.lastRunAt = new Date().toISOString();
    this.lastMarketId = market.row.marketId;
    this.log("Placed bounded two-sided live quotes", { marketId: market.row.marketId, pool: market.onchain.pool, outcome: this.env.quoter.outcome, bid: bid.toString(), ask: ask.toString(), quantity: quantity.toString(), bidTransactionHash: buy.hash, askTransactionHash: sell.hash });
  }

  private async cancelQuotes(): Promise<void> {
    if (this.openQuotes.length === 0) return;
    if (this.venue.quoterWalletClient === null) throw new Error("Quoting cannot reconcile without its separate quoter wallet");
    const trader = this.venue.exchange.client.createTrader({ walletClient: this.venue.quoterWalletClient, publicClient: this.venue.publicClient });
    const remaining: Quote[] = [];
    for (const quote of this.openQuotes) {
      try {
        await trader.cancelOrder({ pool: quote.pool, orderId: quote.orderId });
      } catch (error) {
        const chainOrder = await this.venue.exchange.client.getOrder(quote.pool, quote.orderId);
        if (chainOrder !== null) {
          remaining.push(quote);
          throw new Error(`Quote cancel failed while the order is still live: ${error instanceof Error ? error.message : String(error)}`);
        }
        this.log("Quote cancel raced with a fill or expiry; chain state removed the order", { pool: quote.pool, orderId: quote.orderId.toString() });
      }
    }
    this.openQuotes = remaining;
  }

  private async selectMarket(): Promise<VenueMarket> {
    if (this.env.quoter.marketId !== null) return this.venue.resolveMarket(this.env.quoter.marketId);
    const markets = await this.venue.listLiveMarkets();
    const market = markets[0];
    if (market === undefined) throw new Error("No live market is available for the quote account");
    return market;
  }

  private referencePrice(market: VenueMarket, book: { bids: Array<{ price: string }>; asks: Array<{ price: string }> }, decimals: number, oneCollateral: bigint): bigint | null {
    const bid = book.bids[0] === undefined ? null : parseUnits(book.bids[0].price, decimals);
    const ask = book.asks[0] === undefined ? null : parseUnits(book.asks[0].price, decimals);
    if (bid !== null && ask !== null) return (bid + ask) / 2n;
    if (bid !== null) return bid;
    if (ask !== null) return ask;
    if (market.row.lastPrice === null) return null;
    const lastYesPrice = BigInt(market.row.lastPrice);
    return this.env.quoter.outcome === "YES" ? lastYesPrice : oneCollateral - lastYesPrice;
  }

  private wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
