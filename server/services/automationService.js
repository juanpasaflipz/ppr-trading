import { getDb } from '../db/database.js';
import binanceService from './binance.js';
import backtester, { BUILT_IN_STRATEGIES } from './backtester.js';
import executionRouter from './executionRouter.js';
import tradingEngine from './tradingEngine.js';

const DEFAULTS = {
  enabled: 'false',
  symbol: 'BTCUSDT',
  timeframe: '1h',
  leverage: '3',
  maxPositionPct: '5',
};

function toBool(value) {
  return String(value).toLowerCase() === 'true';
}

function toNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

class AutomationService {
  constructor() {
    this.strategyId = 'ema_cross';
    this.strategy = BUILT_IN_STRATEGIES.ema_cross;
    this.active = false;
    this.lastProcessedCloseTime = null;
    this.inFlight = false;
    this.boundKlineHandler = this.handleKline.bind(this);
  }

  getConfig() {
    const db = getDb();
    const keys = [
      'ema_cross_auto_enabled',
      'ema_cross_auto_symbol',
      'ema_cross_auto_timeframe',
      'ema_cross_auto_leverage',
      'ema_cross_auto_max_position_pct',
    ];

    const values = {};
    for (const key of keys) {
      const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
      values[key] = row?.value;
    }

    return {
      enabled: values.ema_cross_auto_enabled ?? DEFAULTS.enabled,
      symbol: values.ema_cross_auto_symbol ?? DEFAULTS.symbol,
      timeframe: values.ema_cross_auto_timeframe ?? DEFAULTS.timeframe,
      leverage: values.ema_cross_auto_leverage ?? DEFAULTS.leverage,
      maxPositionPct: values.ema_cross_auto_max_position_pct ?? DEFAULTS.maxPositionPct,
    };
  }

  getStatus() {
    const config = this.getConfig();
    return {
      strategyId: this.strategyId,
      active: this.active,
      enabled: toBool(config.enabled),
      symbol: config.symbol,
      timeframe: config.timeframe,
      leverage: toNumber(config.leverage, 3),
      maxPositionPct: toNumber(config.maxPositionPct, 5),
      lastProcessedCloseTime: this.lastProcessedCloseTime,
      inFlight: this.inFlight,
    };
  }

  canRunLive() {
    return process.env.TRADING_MODE === 'live'
      && process.env.BINANCE_EXECUTION_ENV === 'live'
      && process.env.BINANCE_FUTURES_LIVE_ENABLED === 'true';
  }

  ensureConfigSeeded() {
    const db = getDb();
    const stmt = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
    stmt.run('ema_cross_auto_enabled', DEFAULTS.enabled);
    stmt.run('ema_cross_auto_symbol', DEFAULTS.symbol);
    stmt.run('ema_cross_auto_timeframe', DEFAULTS.timeframe);
    stmt.run('ema_cross_auto_leverage', DEFAULTS.leverage);
    stmt.run('ema_cross_auto_max_position_pct', DEFAULTS.maxPositionPct);
  }

  start() {
    this.ensureConfigSeeded();
    const config = this.getConfig();
    if (!toBool(config.enabled)) {
      this.stop();
      return this.getStatus();
    }

    if (this.active) {
      return this.getStatus();
    }

    this.active = true;
    this.lastProcessedCloseTime = null;
    binanceService.on('kline', this.boundKlineHandler);
    binanceService.subscribeKline(config.symbol, config.timeframe);
    return this.getStatus();
  }

  stop() {
    if (this.active) {
      binanceService.off('kline', this.boundKlineHandler);
    }
    this.active = false;
    this.inFlight = false;
    return this.getStatus();
  }

  async refresh() {
    this.ensureConfigSeeded();
    const config = this.getConfig();
    if (toBool(config.enabled)) {
      this.stop();
      return this.start();
    }
    return this.stop();
  }

  async handleKline(kline) {
    const config = this.getConfig();
    if (!this.active || !toBool(config.enabled)) return;
    if (this.inFlight) return;
    if (!kline.isClosed) return;
    if (kline.symbol !== config.symbol || kline.interval !== config.timeframe) return;
    if (this.lastProcessedCloseTime === kline.closeTime) return;
    if (!this.canRunLive()) return;

    this.inFlight = true;
    try {
      await this.evaluateAndExecute(config, kline.closeTime);
      this.lastProcessedCloseTime = kline.closeTime;
    } catch (err) {
      getDb().prepare('INSERT INTO audit_log (event, details) VALUES (?, ?)').run(
        'automation_error',
        JSON.stringify({
          strategyId: this.strategyId,
          symbol: config.symbol,
          timeframe: config.timeframe,
          message: err.message,
          at: new Date().toISOString(),
        })
      );
    } finally {
      this.inFlight = false;
    }
  }

  async evaluateAndExecute(config, closeTime) {
    const candles = await binanceService.getCandles(config.symbol, config.timeframe, 80);
    if (candles.length < 60) return;

    const indicators = backtester.calculateIndicators(candles, this.strategy.indicators || {});
    const index = candles.length - 1;
    const candle = candles[index];
    const indicator = indicators[index];
    const context = { candles, indicators, index };

    await tradingEngine.syncLiveFuturesPositions();
    const positions = await tradingEngine.getOpenPositions();
    const livePosition = positions.find((pos) => pos.symbol === config.symbol);
    const hasLong = livePosition?.side === 'long';
    const hasShort = livePosition?.side === 'short';

    const entrySignal = this.strategy.entry(candle, indicator, context);
    const exitSignal = this.strategy.exit(candle, indicator, { ...context, position: livePosition || null });

    if (hasLong && exitSignal) {
      await executionRouter.closePosition(livePosition.id);
      this.logAutomationAction('close', config, closeTime, { positionId: livePosition.id, reason: 'ema_cross_exit' });
      return;
    }

    if (hasShort) {
      await executionRouter.closePosition(livePosition.id);
      this.logAutomationAction('close_short', config, closeTime, { positionId: livePosition.id, reason: 'unsupported_short_for_ema_long_only' });
      return;
    }

    if (!livePosition && entrySignal) {
      const leverage = Math.min(
        toNumber(config.leverage, 3),
        toNumber(getDb().prepare("SELECT value FROM config WHERE key = 'max_leverage'").get()?.value, 125)
      );
      const quantityPercent = Math.min(
        toNumber(config.maxPositionPct, 5),
        toNumber(getDb().prepare("SELECT value FROM config WHERE key = 'max_position_size_pct'").get()?.value, 25)
      );

      const result = await executionRouter.routeOrder({
        symbol: config.symbol,
        side: 'buy',
        type: 'market',
        marketType: 'futures',
        leverage,
        quantityPercent,
        reduceOnly: false,
        source: 'webhook',
      });

      this.logAutomationAction('open', config, closeTime, {
        orderId: result.id,
        exchangeOrderId: result.exchangeOrderId,
        leverage,
        quantityPercent,
      });
    }
  }

  logAutomationAction(action, config, closeTime, details = {}) {
    getDb().prepare('INSERT INTO audit_log (event, details) VALUES (?, ?)').run(
      'automation_action',
      JSON.stringify({
        strategyId: this.strategyId,
        action,
        symbol: config.symbol,
        timeframe: config.timeframe,
        closeTime,
        ...details,
      })
    );
  }
}

const automationService = new AutomationService();
export default automationService;
