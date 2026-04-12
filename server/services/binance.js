import EventEmitter from 'events';
import WebSocket from 'ws';

const BINANCE_REST_BASE = 'https://api.binance.com';
const BINANCE_WS_BASE = 'wss://stream.binance.com:9443/ws';
const BINANCE_FUTURES_REST = 'https://fapi.binance.com';
const BINANCE_FUTURES_WS = 'wss://fstream.binance.com/ws';

// Popular crypto pairs
const DEFAULT_PAIRS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'MATICUSDT',
  'LINKUSDT', 'UNIUSDT', 'ATOMUSDT', 'LTCUSDT', 'NEARUSDT',
  'APTUSDT', 'ARBUSDT', 'OPUSDT', 'SUIUSDT', 'PEPEUSDT',
];

class BinanceService extends EventEmitter {
  constructor() {
    super();
    this.prices = new Map();
    this.orderBooks = new Map();
    this.ws = null;
    this.futuresWs = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 50;
    this.isConnected = false;
    this.subscriptions = new Set();
    this.klineSubscriptions = new Map();
  }

  async fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance API error ${res.status}: ${await res.text()}`);
    return res.json();
  }

  // REST API Methods
  async getExchangeInfo() {
    return this.fetchJSON(`${BINANCE_REST_BASE}/api/v3/exchangeInfo`);
  }

  async getTicker(symbol) {
    return this.fetchJSON(`${BINANCE_REST_BASE}/api/v3/ticker/24hr?symbol=${symbol}`);
  }

  async getAllTickers() {
    return this.fetchJSON(`${BINANCE_REST_BASE}/api/v3/ticker/24hr`);
  }

  async getPrice(symbol) {
    const cached = this.prices.get(symbol);
    if (cached && Date.now() - cached.timestamp < 5000) {
      return cached.price;
    }
    const data = await this.fetchJSON(`${BINANCE_REST_BASE}/api/v3/ticker/price?symbol=${symbol}`);
    const price = parseFloat(data.price);
    this.prices.set(symbol, { price, timestamp: Date.now() });
    return price;
  }

  async getOrderBook(symbol, limit = 20) {
    return this.fetchJSON(`${BINANCE_REST_BASE}/api/v3/depth?symbol=${symbol}&limit=${limit}`);
  }

  async getCandles(symbol, interval = '1h', limit = 500, startTime, endTime) {
    let url = `${BINANCE_REST_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    if (startTime) url += `&startTime=${startTime}`;
    if (endTime) url += `&endTime=${endTime}`;
    const data = await this.fetchJSON(url);
    return data.map(k => ({
      openTime: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: k[6],
      quoteVolume: parseFloat(k[7]),
      trades: k[8],
    }));
  }

  async getHistoricalCandles(symbol, interval, startDate, endDate) {
    const startTime = new Date(startDate).getTime();
    const endTime = new Date(endDate).getTime();
    const allCandles = [];
    let currentStart = startTime;

    while (currentStart < endTime) {
      const candles = await this.getCandles(symbol, interval, 1000, currentStart, endTime);
      if (candles.length === 0) break;
      allCandles.push(...candles);
      currentStart = candles[candles.length - 1].closeTime + 1;
      // Rate limiting
      await new Promise(r => setTimeout(r, 200));
    }

    return allCandles;
  }

  async getFundingRate(symbol) {
    return this.fetchJSON(`${BINANCE_FUTURES_REST}/fapi/v1/fundingRate?symbol=${symbol}&limit=1`);
  }

  async getMarkPrice(symbol) {
    return this.fetchJSON(`${BINANCE_FUTURES_REST}/fapi/v1/premiumIndex?symbol=${symbol}`);
  }

  async getAvailablePairs() {
    try {
      const info = await this.getExchangeInfo();
      return info.symbols
        .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT')
        .map(s => ({
          symbol: s.symbol,
          baseAsset: s.baseAsset,
          quoteAsset: s.quoteAsset,
          pricePrecision: s.quotePrecision,
          quantityPrecision: s.baseAssetPrecision,
          minNotional: s.filters.find(f => f.filterType === 'NOTIONAL')?.minNotional || '10',
          stepSize: s.filters.find(f => f.filterType === 'LOT_SIZE')?.stepSize || '0.001',
          tickSize: s.filters.find(f => f.filterType === 'PRICE_FILTER')?.tickSize || '0.01',
        }));
    } catch (err) {
      console.error('Failed to fetch exchange info:', err.message);
      // Return default pairs as fallback
      return DEFAULT_PAIRS.map(symbol => ({
        symbol,
        baseAsset: symbol.replace('USDT', ''),
        quoteAsset: 'USDT',
        pricePrecision: 8,
        quantityPrecision: 8,
      }));
    }
  }

  // WebSocket Methods
  connectPriceStream(pairs = DEFAULT_PAIRS) {
    const streams = pairs.map(p => `${p.toLowerCase()}@ticker`).join('/');
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log(`[Binance WS] Connected — streaming ${pairs.length} pairs`);
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.emit('connected');
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.data && msg.data.e === '24hrTicker') {
          const d = msg.data;
          const ticker = {
            symbol: d.s,
            price: parseFloat(d.c),
            priceChange: parseFloat(d.p),
            priceChangePercent: parseFloat(d.P),
            high: parseFloat(d.h),
            low: parseFloat(d.l),
            volume: parseFloat(d.v),
            quoteVolume: parseFloat(d.q),
            open: parseFloat(d.o),
            timestamp: d.E,
          };
          this.prices.set(d.s, { price: ticker.price, timestamp: Date.now() });
          this.emit('ticker', ticker);
        }
      } catch (err) {
        // ignore parse errors
      }
    });

    this.ws.on('close', () => {
      console.log('[Binance WS] Disconnected');
      this.isConnected = false;
      this.emit('disconnected');
      this._reconnect(pairs);
    });

    this.ws.on('error', (err) => {
      console.error('[Binance WS] Error:', err.message);
    });
  }

  subscribeKline(symbol, interval = '1m') {
    const key = `${symbol.toLowerCase()}@kline_${interval}`;
    if (this.klineSubscriptions.has(key)) return;

    const ws = new WebSocket(`${BINANCE_WS_BASE}/${key}`);
    this.klineSubscriptions.set(key, ws);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.e === 'kline') {
          const k = msg.k;
          this.emit('kline', {
            symbol: k.s,
            interval: k.i,
            openTime: k.t,
            closeTime: k.T,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
            isClosed: k.x,
          });
        }
      } catch (err) { /* ignore */ }
    });

    ws.on('close', () => {
      this.klineSubscriptions.delete(key);
    });
  }

  subscribeDepth(symbol) {
    const key = `${symbol.toLowerCase()}@depth20@100ms`;
    const ws = new WebSocket(`${BINANCE_WS_BASE}/${key}`);

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw);
        const book = {
          symbol: symbol.toUpperCase(),
          bids: data.bids.map(([p, q]) => [parseFloat(p), parseFloat(q)]),
          asks: data.asks.map(([p, q]) => [parseFloat(p), parseFloat(q)]),
          timestamp: Date.now(),
        };
        this.orderBooks.set(symbol.toUpperCase(), book);
        this.emit('depth', book);
      } catch (err) { /* ignore */ }
    });

    ws.on('close', () => {
      // auto-reconnect depth
      setTimeout(() => this.subscribeDepth(symbol), 5000);
    });
  }

  _reconnect(pairs) {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[Binance WS] Max reconnect attempts reached');
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    console.log(`[Binance WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => this.connectPriceStream(pairs), delay);
  }

  getCachedPrice(symbol) {
    const cached = this.prices.get(symbol);
    return cached ? cached.price : null;
  }

  getCachedOrderBook(symbol) {
    return this.orderBooks.get(symbol) || null;
  }

  getStatus() {
    return {
      connected: this.isConnected,
      trackedPairs: this.prices.size,
      reconnectAttempts: this.reconnectAttempts,
      klineStreams: this.klineSubscriptions.size,
    };
  }

  disconnect() {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
    }
    for (const ws of this.klineSubscriptions.values()) {
      ws.close();
    }
    this.klineSubscriptions.clear();
    this.isConnected = false;
  }
}

// Singleton
const binanceService = new BinanceService();
export default binanceService;
export { DEFAULT_PAIRS };
