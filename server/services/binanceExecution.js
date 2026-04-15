import crypto from 'crypto';

const BINANCE_SPOT_LIVE_BASE = 'https://api.binance.com';
const BINANCE_SPOT_TESTNET_BASE = 'https://testnet.binance.vision';
const BINANCE_FUTURES_LIVE_BASE = 'https://fapi.binance.com';

function trimTrailingZeros(value) {
  return value.replace(/\.?0+$/, '');
}

function floorToStep(value, stepSize) {
  if (!Number.isFinite(value) || !Number.isFinite(stepSize) || stepSize <= 0) return value;
  const precision = Math.max(0, (String(stepSize).split('.')[1] || '').replace(/0+$/, '').length);
  const floored = Math.floor(value / stepSize) * stepSize;
  return Number(floored.toFixed(precision));
}

function parseFilter(filters, filterType) {
  return filters.find((filter) => filter.filterType === filterType) || null;
}

class BinanceExecutionService {
  getExecutionEnv() {
    const value = (process.env.BINANCE_EXECUTION_ENV || 'testnet').toLowerCase();
    return value === 'live' ? 'live' : 'testnet';
  }

  isLiveEnv() {
    return this.getExecutionEnv() === 'live';
  }

  getCredentials() {
    if (this.isLiveEnv()) {
      return {
        apiKey: process.env.BINANCE_LIVE_API_KEY || process.env.BINANCE_API_KEY || '',
        apiSecret: process.env.BINANCE_LIVE_API_SECRET || process.env.BINANCE_API_SECRET || '',
      };
    }

    return {
      apiKey: process.env.BINANCE_TESTNET_API_KEY || '',
      apiSecret: process.env.BINANCE_TESTNET_API_SECRET || '',
    };
  }

  getBaseUrl(product = 'spot') {
    if (product === 'futures') {
      return BINANCE_FUTURES_LIVE_BASE;
    }
    return this.isLiveEnv() ? BINANCE_SPOT_LIVE_BASE : BINANCE_SPOT_TESTNET_BASE;
  }

  isConfigured() {
    const { apiKey, apiSecret } = this.getCredentials();
    return !!apiKey && !!apiSecret;
  }

  assertConfigured() {
    if (!this.isConfigured()) {
      const scope = this.isLiveEnv() ? 'live' : 'testnet';
      throw new Error(`Binance ${scope} API credentials are not configured`);
    }
  }

  assertProductEnabled(product) {
    if (!this.isLiveEnv()) return;

    if (product === 'spot' && process.env.BINANCE_LIVE_TRADING_ENABLED !== 'true') {
      throw new Error('Live Binance spot execution is disabled. Set BINANCE_LIVE_TRADING_ENABLED=true when you intentionally want real spot orders.');
    }

    if (product === 'futures' && process.env.BINANCE_FUTURES_LIVE_ENABLED !== 'true') {
      throw new Error('Live Binance futures execution is disabled. Set BINANCE_FUTURES_LIVE_ENABLED=true when you intentionally want real futures orders.');
    }
  }

  buildSignature(params, secret) {
    const payload = new URLSearchParams(params).toString();
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  async publicRequest(product, path) {
    const url = `${this.getBaseUrl(product)}${path}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Binance ${product} public API error ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }

  async signedRequest(method, product, path, params = {}) {
    this.assertConfigured();
    this.assertProductEnabled(product);

    const { apiKey, apiSecret } = this.getCredentials();
    const timestamp = Date.now();
    const requestParams = {
      ...params,
      recvWindow: params.recvWindow || 5000,
      timestamp,
    };

    const signature = this.buildSignature(requestParams, apiSecret);
    const query = new URLSearchParams({ ...requestParams, signature }).toString();
    const url = `${this.getBaseUrl(product)}${path}?${query}`;

    const res = await fetch(url, {
      method,
      headers: {
        'X-MBX-APIKEY': apiKey,
      },
    });

    if (!res.ok) {
      throw new Error(`Binance ${product} execution error ${res.status}: ${await res.text()}`);
    }

    if (res.status === 204) return null;
    return res.json();
  }

  getBalanceMap(account) {
    return new Map(
      (account.balances || []).map((balance) => [
        balance.asset,
        {
          free: Number(balance.free || 0),
          locked: Number(balance.locked || 0),
        },
      ])
    );
  }

  getFuturesAsset(account, asset = 'USDT') {
    return (account.assets || []).find((row) => row.asset === asset) || null;
  }

  getSpotSymbolRules(exchangeInfo, symbol) {
    const meta = exchangeInfo.symbols?.find((item) => item.symbol === symbol);
    if (!meta) {
      throw new Error(`Symbol ${symbol} is not available on Binance Spot ${this.getExecutionEnv()}`);
    }

    const lotSize = parseFilter(meta.filters || [], 'LOT_SIZE');
    const minNotional = parseFilter(meta.filters || [], 'NOTIONAL') || parseFilter(meta.filters || [], 'MIN_NOTIONAL');

    return {
      baseAsset: meta.baseAsset,
      quoteAsset: meta.quoteAsset,
      quantityStepSize: lotSize ? Number(lotSize.stepSize) : null,
      minQty: lotSize ? Number(lotSize.minQty) : null,
      minNotional: minNotional ? Number(minNotional.minNotional) : null,
      quotePrecision: Number(meta.quoteAssetPrecision ?? 8),
    };
  }

  getFuturesSymbolRules(exchangeInfo, symbol) {
    const meta = exchangeInfo.symbols?.find((item) => item.symbol === symbol);
    if (!meta) {
      throw new Error(`Symbol ${symbol} is not available on Binance USD-M Futures`);
    }

    const lotSize = parseFilter(meta.filters || [], 'LOT_SIZE');
    const minNotional = parseFilter(meta.filters || [], 'MIN_NOTIONAL') || parseFilter(meta.filters || [], 'NOTIONAL');

    return {
      quantityStepSize: lotSize ? Number(lotSize.stepSize) : null,
      minQty: lotSize ? Number(lotSize.minQty) : null,
      minNotional: minNotional ? Number(minNotional.notional || minNotional.minNotional) : null,
      quantityPrecision: Number(meta.quantityPrecision ?? 8),
    };
  }

  roundQuote(value, precision = 8) {
    if (!Number.isFinite(value)) return null;
    return Number(Number(value).toFixed(Math.min(precision, 8)));
  }

  async getSpotAccountInfo() {
    return this.signedRequest('GET', 'spot', '/api/v3/account', { omitZeroBalances: true });
  }

  async getFuturesAccountInfo() {
    return this.signedRequest('GET', 'futures', '/fapi/v3/account');
  }

  async getFuturesPositionRisk(symbol) {
    const params = {};
    if (symbol) params.symbol = symbol;
    return this.signedRequest('GET', 'futures', '/fapi/v3/positionRisk', params);
  }

  async getSpotOrder(symbol, orderId, origClientOrderId) {
    const params = { symbol };
    if (orderId) params.orderId = orderId;
    if (origClientOrderId) params.origClientOrderId = origClientOrderId;
    return this.signedRequest('GET', 'spot', '/api/v3/order', params);
  }

  async getFuturesExchangeInfo() {
    return this.publicRequest('futures', '/fapi/v1/exchangeInfo');
  }

  async setFuturesLeverage(symbol, leverage) {
    return this.signedRequest('POST', 'futures', '/fapi/v1/leverage', {
      symbol,
      leverage,
    });
  }

  async buildSpotOrderParams({ symbol, side, type, quantity, quantityPercent }, exchangeInfo, currentPrice) {
    if (type !== 'market') {
      throw new Error('Binance Spot execution currently supports market orders only');
    }

    const account = await this.getSpotAccountInfo();
    const balances = this.getBalanceMap(account);
    const rules = this.getSpotSymbolRules(exchangeInfo, symbol);
    const baseBalance = balances.get(rules.baseAsset)?.free || 0;
    const quoteBalance = balances.get(rules.quoteAsset)?.free || 0;

    const orderParams = {
      symbol,
      side: side.toUpperCase(),
      type: 'MARKET',
      newOrderRespType: 'FULL',
    };

    if (side === 'buy') {
      if (quantityPercent) {
        const quoteOrderQty = this.roundQuote(quoteBalance * (quantityPercent / 100), rules.quotePrecision);
        if (!quoteOrderQty || quoteOrderQty <= 0) {
          throw new Error(`No ${rules.quoteAsset} available for buy order`);
        }
        if (rules.minNotional && quoteOrderQty < rules.minNotional) {
          throw new Error(`Buy order notional ${quoteOrderQty} is below Binance minimum ${rules.minNotional}`);
        }
        orderParams.quoteOrderQty = trimTrailingZeros(String(quoteOrderQty));
      } else {
        const normalizedQty = floorToStep(Number(quantity), rules.quantityStepSize);
        if (!normalizedQty || normalizedQty <= 0) {
          throw new Error('Buy quantity is invalid after Binance step-size normalization');
        }
        const estimatedNotional = normalizedQty * currentPrice;
        if (rules.minNotional && estimatedNotional < rules.minNotional) {
          throw new Error(`Buy order notional ${estimatedNotional.toFixed(2)} is below Binance minimum ${rules.minNotional}`);
        }
        orderParams.quantity = trimTrailingZeros(String(normalizedQty));
      }
    } else {
      let sellQty = Number(quantity);
      if (!sellQty && quantityPercent) {
        sellQty = baseBalance * (quantityPercent / 100);
      }

      const normalizedQty = floorToStep(sellQty, rules.quantityStepSize);
      if (!normalizedQty || normalizedQty <= 0) {
        throw new Error(`No ${rules.baseAsset} available for sell order`);
      }
      if (rules.minQty && normalizedQty < rules.minQty) {
        throw new Error(`Sell quantity ${normalizedQty} is below Binance minimum ${rules.minQty}`);
      }
      const estimatedNotional = normalizedQty * currentPrice;
      if (rules.minNotional && estimatedNotional < rules.minNotional) {
        throw new Error(`Sell order notional ${estimatedNotional.toFixed(2)} is below Binance minimum ${rules.minNotional}`);
      }
      orderParams.quantity = trimTrailingZeros(String(normalizedQty));
    }

    return orderParams;
  }

  async placeSpotOrder(params, exchangeInfo, currentPrice) {
    const orderParams = await this.buildSpotOrderParams(params, exchangeInfo, currentPrice);
    return this.signedRequest('POST', 'spot', '/api/v3/order', orderParams);
  }

  async buildFuturesOrderParams({ symbol, side, type, quantity, quantityPercent, leverage = 1, reduceOnly }, exchangeInfo, currentPrice) {
    if (type !== 'market') {
      throw new Error('Binance futures execution currently supports market orders only');
    }

    const account = await this.getFuturesAccountInfo();
    const rules = this.getFuturesSymbolRules(exchangeInfo, symbol);
    const usdtAsset = this.getFuturesAsset(account, 'USDT');
    const availableBalance = Number(usdtAsset?.availableBalance || 0);

    let normalizedQty = Number(quantity);
    if (!normalizedQty && quantityPercent) {
      const marginToUse = availableBalance * (quantityPercent / 100);
      const notional = marginToUse * leverage;
      normalizedQty = notional / currentPrice;
    }

    normalizedQty = floorToStep(normalizedQty, rules.quantityStepSize);
    if (!normalizedQty || normalizedQty <= 0) {
      throw new Error('Futures quantity is invalid after Binance step-size normalization');
    }
    if (rules.minQty && normalizedQty < rules.minQty) {
      throw new Error(`Futures quantity ${normalizedQty} is below Binance minimum ${rules.minQty}`);
    }

    const estimatedNotional = normalizedQty * currentPrice;
    if (rules.minNotional && estimatedNotional < rules.minNotional) {
      throw new Error(`Futures order notional ${estimatedNotional.toFixed(2)} is below Binance minimum ${rules.minNotional}`);
    }

    return {
      symbol,
      side: side.toUpperCase(),
      type: 'MARKET',
      quantity: trimTrailingZeros(String(normalizedQty)),
      reduceOnly: reduceOnly ? 'true' : undefined,
      newOrderRespType: 'RESULT',
    };
  }

  async placeFuturesOrder(params, exchangeInfo, currentPrice) {
    const leverage = Math.max(1, Math.min(Number(params.leverage || 1), 125));
    await this.setFuturesLeverage(params.symbol, leverage);
    const orderParams = await this.buildFuturesOrderParams(params, exchangeInfo, currentPrice);
    return this.signedRequest('POST', 'futures', '/fapi/v1/order', orderParams);
  }
}

const binanceExecutionService = new BinanceExecutionService();
export default binanceExecutionService;
