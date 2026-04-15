import { getDb } from '../db/database.js';
import { v4 as uuidv4 } from 'uuid';
import tradingEngine from './tradingEngine.js';
import binanceExecutionService from './binanceExecution.js';
import binanceService from './binance.js';

function mapBinanceStatus(status) {
  if (status === 'FILLED') return 'filled';
  if (status === 'PARTIALLY_FILLED') return 'partial';
  if (status === 'CANCELED' || status === 'EXPIRED' || status === 'REJECTED') return 'cancelled';
  return 'pending';
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

class ExecutionRouter {
  getMode() {
    return process.env.TRADING_MODE || 'paper';
  }

  getExecutionEnv() {
    return binanceExecutionService.getExecutionEnv();
  }

  isLive() {
    return this.getMode() === 'live';
  }

  async routeOrder(params) {
    if (this.isLive()) {
      return this._executeLive(params);
    }
    return tradingEngine.placeOrder(params);
  }

  async closePosition(positionId, price) {
    if (!this.isLive()) {
      return tradingEngine.closePosition(positionId, price);
    }

    await tradingEngine.syncLiveFuturesPositions();
    const db = getDb();
    const pos = db.prepare('SELECT * FROM positions WHERE id = ?').get(positionId);
    if (!pos || pos.status !== 'open') {
      throw new Error('Position not found or already closed');
    }

    if (this.getExecutionEnv() !== 'live') {
      throw new Error('Live Binance futures position closing is only enabled against the live USD-M futures API in this build');
    }

    const closeSide = pos.side === 'long' ? 'sell' : 'buy';
    const result = await this.routeOrder({
      symbol: pos.symbol,
      side: closeSide,
      type: 'market',
      marketType: 'futures',
      quantity: pos.quantity,
      leverage: pos.leverage,
      reduceOnly: true,
      source: 'manual',
    });

    await tradingEngine.syncLiveFuturesPositions();
    return {
      ...result,
      closedPositionId: positionId,
      note: 'Reduce-only futures close submitted to Binance and local positions re-synced.',
    };
  }

  async _executeLive(params) {
    const {
      symbol,
      side,
      type = 'market',
      marketType = 'spot',
      quantity,
      quantityPercent,
      leverage = 1,
      reduceOnly = false,
      source = 'manual',
    } = params;

    const normalizedType = String(type).toLowerCase();
    if (normalizedType !== 'market') {
      throw new Error('Live Binance execution currently supports market orders only');
    }

    if (marketType === 'spot') {
      const exchangeInfo = await binanceService.getExchangeInfo();
      const currentPrice = await binanceService.getPrice(symbol);
      const remoteOrder = await binanceExecutionService.placeSpotOrder(
        { symbol, side, type: normalizedType, quantity, quantityPercent },
        exchangeInfo,
        currentPrice
      );

      return this._recordExternalSpotOrder({
        request: params,
        remoteOrder,
        source,
      });
    }

    if (marketType === 'futures') {
      if (this.getExecutionEnv() !== 'live') {
        throw new Error('Binance futures execution is only enabled against the live USD-M futures API in this build');
      }

      const exchangeInfo = await binanceExecutionService.getFuturesExchangeInfo();
      const mark = await binanceService.getMarkPrice(symbol);
      const currentPrice = toNumber(mark?.markPrice) || await binanceService.getPrice(symbol);
      const remoteOrder = await binanceExecutionService.placeFuturesOrder(
        {
          symbol,
          side,
          type: normalizedType,
          quantity,
          quantityPercent,
          leverage,
          reduceOnly,
        },
        exchangeInfo,
        currentPrice
      );

      const loggedOrder = this._recordExternalFuturesOrder({
        request: params,
        remoteOrder,
        source,
      });

      await tradingEngine.syncLiveFuturesPositions();

      return loggedOrder;
    }

    throw new Error(`Unsupported live market type: ${marketType}`);
  }

  _recordExternalSpotOrder({ request, remoteOrder, source }) {
    const db = getDb();
    const clientOrderId = remoteOrder.clientOrderId || uuidv4();
    const fills = Array.isArray(remoteOrder.fills) ? remoteOrder.fills : [];
    const totalFee = fills.reduce((sum, fill) => sum + toNumber(fill.commission), 0);
    const commissionAsset = fills[0]?.commissionAsset || 'USDT';
    const localStatus = mapBinanceStatus(remoteOrder.status);
    const localPrice = toNumber(remoteOrder.price) || (toNumber(remoteOrder.cummulativeQuoteQty) > 0 && toNumber(remoteOrder.executedQty) > 0
      ? toNumber(remoteOrder.cummulativeQuoteQty) / toNumber(remoteOrder.executedQty)
      : 0);

    const result = db.prepare(`
      INSERT INTO orders
      (client_order_id, symbol, side, type, market_type, price, quantity, filled_quantity, status, leverage, fee, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      clientOrderId,
      request.symbol,
      request.side,
      request.type || 'market',
      'spot',
      localPrice || null,
      toNumber(remoteOrder.origQty) || toNumber(request.quantity),
      toNumber(remoteOrder.executedQty),
      localStatus,
      1,
      totalFee,
      source
    );

    const localOrderId = Number(result.lastInsertRowid);

    if (fills.length) {
      const insertTrade = db.prepare(`
        INSERT INTO trades (order_id, symbol, side, price, quantity, fee, fee_asset, market_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const fill of fills) {
        insertTrade.run(
          localOrderId,
          request.symbol,
          request.side,
          toNumber(fill.price),
          toNumber(fill.qty),
          toNumber(fill.commission),
          fill.commissionAsset || commissionAsset,
          'spot'
        );
      }
    }

    const localOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(localOrderId);
    return {
      ...localOrder,
      executionEnv: this.getExecutionEnv(),
      exchangeOrderId: remoteOrder.orderId,
      remoteStatus: remoteOrder.status,
      fills,
      cummulativeQuoteQty: toNumber(remoteOrder.cummulativeQuoteQty),
    };
  }

  _recordExternalFuturesOrder({ request, remoteOrder, source }) {
    const db = getDb();
    const clientOrderId = remoteOrder.clientOrderId || uuidv4();
    const executedQty = toNumber(remoteOrder.executedQty || remoteOrder.origQty);
    const avgPrice = toNumber(remoteOrder.avgPrice || remoteOrder.price);
    const localStatus = mapBinanceStatus(remoteOrder.status);

    const result = db.prepare(`
      INSERT INTO orders
      (client_order_id, symbol, side, type, market_type, price, quantity, filled_quantity, status, leverage, fee, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      clientOrderId,
      request.symbol,
      request.side,
      request.type || 'market',
      'futures',
      avgPrice || null,
      toNumber(remoteOrder.origQty) || toNumber(request.quantity),
      executedQty,
      localStatus,
      toNumber(request.leverage || 1),
      0,
      source
    );

    const localOrderId = Number(result.lastInsertRowid);

    if (executedQty > 0) {
      db.prepare(`
        INSERT INTO trades (order_id, symbol, side, price, quantity, fee, fee_asset, market_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        localOrderId,
        request.symbol,
        request.side,
        avgPrice,
        executedQty,
        0,
        'USDT',
        'futures'
      );
    }

    const localOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(localOrderId);
    return {
      ...localOrder,
      executionEnv: this.getExecutionEnv(),
      exchangeOrderId: remoteOrder.orderId,
      remoteStatus: remoteOrder.status,
      avgPrice,
      reduceOnly: !!request.reduceOnly,
      note: 'Local futures positions are not yet synchronized with Binance; this records the execution event only.',
    };
  }

  switchMode(newMode, confirmation) {
    const db = getDb();

    if (newMode !== 'paper' && newMode !== 'live') {
      throw new Error('Invalid mode. Use "paper" or "live".');
    }

    if (newMode === 'live') {
      if (!binanceExecutionService.isConfigured()) {
        throw new Error(`Binance ${this.getExecutionEnv()} API keys are not configured`);
      }

      if (this.getExecutionEnv() === 'live') {
        if (confirmation !== 'I_UNDERSTAND_REAL_MONEY') {
          throw new Error('Live mode against real Binance requires confirmation string: "I_UNDERSTAND_REAL_MONEY"');
        }

        const tradeCount = db.prepare('SELECT COUNT(*) as count FROM trades').get().count;
        if (tradeCount < 50) {
          throw new Error(`Minimum 50 paper trades required before real-money live mode. Current: ${tradeCount}`);
        }

        if (process.env.BINANCE_LIVE_TRADING_ENABLED !== 'true' && process.env.BINANCE_FUTURES_LIVE_ENABLED !== 'true') {
          throw new Error('Live Binance execution is disabled. Enable BINANCE_LIVE_TRADING_ENABLED or BINANCE_FUTURES_LIVE_ENABLED first.');
        }
      }
    }

    const oldMode = this.getMode();
    process.env.TRADING_MODE = newMode;
    db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('trading_mode', ?)").run(newMode);

    db.prepare('INSERT INTO audit_log (event, details) VALUES (?, ?)').run(
      'mode_switch',
      JSON.stringify({
        from: oldMode,
        to: newMode,
        executionEnv: this.getExecutionEnv(),
        timestamp: new Date().toISOString(),
      })
    );

    return { previousMode: oldMode, currentMode: newMode, executionEnv: this.getExecutionEnv() };
  }

  getAuditLog(limit = 50) {
    return getDb().prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?').all(limit);
  }
}

const executionRouter = new ExecutionRouter();
export default executionRouter;
