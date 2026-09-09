import ccxt from "ccxt";

const baseUrl = (process.env.SLICE_API_URL ?? "http://localhost:8787").replace(/\/$/, "");

class SliceExchange extends ccxt.Exchange {
  describe() {
    return this.deepExtend(super.describe(), {
      id: "slice",
      name: "Slice",
      countries: [],
      version: "v1",
      rateLimit: 250,
      urls: { api: { public: baseUrl } },
      has: {
        fetchMarkets: true,
        fetchOrderBook: true,
        createOrder: true,
        fetchOrder: true,
      },
    });
  }

  async requestJson(path, init = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
    let body;
    try {
      body = await response.json();
    } catch (error) {
      throw new Error(`Slice API returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) throw new Error(body?.error ?? `Slice API request failed (${response.status})`);
    return body;
  }

  async fetchMarkets() {
    const response = await this.requestJson("/ccxt/markets");
    return response.map((market) => ({
      id: market.id,
      symbol: market.symbol,
      base: market.base,
      quote: market.quote,
      baseId: market.base,
      quoteId: market.quote,
      active: market.active,
      type: "binary",
      spot: false,
      contract: true,
      info: market.info,
    }));
  }

  async fetchOrderBook(symbol, limit = undefined) {
    const market = this.market(symbol);
    const [marketId, outcome] = market.id.split("#");
    if (marketId === undefined || (outcome !== "YES" && outcome !== "NO")) throw new Error("Slice market metadata has no binary outcome");
    const query = new URLSearchParams({ marketId, outcome });
    if (limit !== undefined) query.set("limit", String(limit));
    const response = await this.requestJson(`/ccxt/orderbook?${query.toString()}`);
    return {
      bids: response.bids,
      asks: response.asks,
      timestamp: response.timestamp,
      datetime: response.datetime,
      nonce: response.nonce,
      symbol,
    };
  }

  async createOrder(symbol, type, side, amount, price = undefined, params = {}) {
    if (type !== "market") throw new Error("Slice accepts market orders with an execution strategy");
    const sessionGrant = params.sessionGrant;
    if (typeof sessionGrant !== "object" || sessionGrant === null) throw new Error("Pass an owner-signed sessionGrant in order params");
    const body = await this.requestJson("/ccxt/order", {
      method: "POST",
      body: JSON.stringify({ symbol, type, side, amount, ...(price === undefined ? {} : { price }), params }),
    });
    return body;
  }

  async fetchOrder(id, symbol = undefined) {
    const order = await this.requestJson(`/ccxt/order/${encodeURIComponent(id)}`);
    return { ...order, ...(symbol === undefined ? {} : { symbol }) };
  }
}

const exchange = new SliceExchange({ enableRateLimit: true });
const markets = await exchange.loadMarkets();
const symbols = Object.keys(markets);
const symbol = process.env.SLICE_SYMBOL ?? symbols[0];
if (symbol === undefined) throw new Error("Slice returned no active event-contract market");
const book = await exchange.fetchOrderBook(symbol);
console.log({ symbol, bestBid: book.bids[0], bestAsk: book.asks[0], block: book.nonce });

const grantText = process.env.SLICE_SESSION_GRANT;
if (grantText === undefined) {
  console.log("Read completed. Set SLICE_SESSION_GRANT and SLICE_ORDER_AMOUNT before submitting a worked order.");
} else {
  const sessionGrant = JSON.parse(grantText);
  const amount = process.env.SLICE_ORDER_AMOUNT;
  if (amount === undefined) throw new Error("SLICE_ORDER_AMOUNT is required for the write example");
  const order = await exchange.createOrder(symbol, "market", sessionGrant.side, amount, undefined, {
    marketId: sessionGrant.marketId,
    outcome: sessionGrant.outcome,
    strategy: process.env.SLICE_STRATEGY ?? "iceberg",
    sessionGrant,
  });
  console.log(order);
}
