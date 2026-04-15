import { getDb } from '../db/database.js';
import binanceService from './binance.js';
import * as ti from 'technicalindicators';

const WARMUP_CANDLES = 50;

function round(value, decimals = 4) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function formatIndicatorValue(value) {
  return Number.isFinite(value) ? round(value, 2) : null;
}

function buildReason(type, label, signal, blocker, value) {
  return {
    type,
    label,
    signal,
    blocker: !!blocker,
    value: value ?? null,
  };
}

function buildActionSummary(action, reasons, blockers) {
  if (action === 'buy') {
    if (reasons.length) return `Entry triggered: ${reasons[0].label.toLowerCase()}.`;
    return 'Entry triggered by the active setup.';
  }

  if (action === 'sell') {
    if (reasons.length) return `Exit triggered: ${reasons[0].label.toLowerCase()}.`;
    return 'Exit triggered by the active setup.';
  }

  if (blockers.length) {
    return `No trade: ${blockers[0].label.toLowerCase()}.`;
  }

  return 'No trade: waiting for stronger confirmation.';
}

function calculateConfidence(action, reasons, blockers) {
  if (action === 'hold') {
    return Math.max(0.25, Math.min(0.8, 0.35 + blockers.length * 0.12));
  }
  return Math.max(0.45, Math.min(0.95, 0.48 + reasons.length * 0.16 - blockers.length * 0.08));
}

function buildExplanation({ action, reasons, blockers, state }) {
  return {
    action,
    confidence: round(calculateConfidence(action, reasons, blockers), 2),
    summary: buildActionSummary(action, reasons, blockers),
    reasons: reasons.map((reason) => reason.label),
    blockers: blockers.map((reason) => reason.label),
    detail: {
      reasons,
      blockers,
    },
    state,
  };
}

function buildSignalEvaluation(strategy, candle, ind) {
  const close = candle.close;
  const hasPosition = !!strategy._positionState;
  const reasons = [];
  const blockers = [];
  const state = {
    close: formatIndicatorValue(close),
  };

  if (ind.rsi !== undefined) {
    state.rsi = formatIndicatorValue(ind.rsi);
    if (strategy.id === 'rsi_oversold') {
      if (!hasPosition) {
        if (ind.rsi < 30) reasons.push(buildReason('indicator', `RSI is oversold at ${round(ind.rsi, 1)}`, true, false, round(ind.rsi, 1)));
        else blockers.push(buildReason('indicator', `RSI is not oversold enough (${round(ind.rsi, 1)})`, false, true, round(ind.rsi, 1)));
      } else if (ind.rsi > 70) {
        reasons.push(buildReason('indicator', `RSI is overbought at ${round(ind.rsi, 1)}`, true, false, round(ind.rsi, 1)));
      } else {
        blockers.push(buildReason('indicator', `RSI exit threshold is not met (${round(ind.rsi, 1)})`, false, true, round(ind.rsi, 1)));
      }
    }
  }

  if (ind.macd !== undefined) {
    state.macd = formatIndicatorValue(ind.macd);
    state.macdSignal = formatIndicatorValue(ind.macdSignal);
    if (strategy.id === 'macd_cross' || strategy.id === 'rsi_macd_confluence') {
      const bullishCross = ind.macdSignal !== undefined && ind.macd > ind.macdSignal && ind.prevMacd <= ind.prevMacdSignal;
      const bearishCross = ind.macdSignal !== undefined && ind.macd < ind.macdSignal && ind.prevMacd >= ind.prevMacdSignal;
      if (!hasPosition) {
        if (bullishCross) reasons.push(buildReason('indicator', 'MACD crossed bullish', true, false, round(ind.macd - ind.macdSignal, 3)));
        else blockers.push(buildReason('indicator', 'MACD has not crossed bullish', false, true, round(ind.macd - ind.macdSignal, 3)));
      } else if (bearishCross) {
        reasons.push(buildReason('indicator', 'MACD crossed bearish', true, false, round(ind.macd - ind.macdSignal, 3)));
      } else if (strategy.id === 'rsi_macd_confluence' && ind.rsi !== undefined && ind.rsi > 65) {
        reasons.push(buildReason('indicator', `RSI is stretched at ${round(ind.rsi, 1)}`, true, false, round(ind.rsi, 1)));
      } else {
        blockers.push(buildReason('indicator', 'MACD exit trigger is not active', false, true, round(ind.macd - ind.macdSignal, 3)));
      }
    }
  }

  if (ind.ema9 !== undefined) {
    state.ema9 = formatIndicatorValue(ind.ema9);
  }
  if (ind.ema21 !== undefined) {
    state.ema21 = formatIndicatorValue(ind.ema21);
  }
  if (strategy.id === 'ema_cross' && ind.ema9 !== undefined && ind.ema21 !== undefined) {
    const bullishCross = ind.ema9 > ind.ema21 && ind.prevEma9 <= ind.prevEma21;
    const bearishCross = ind.ema9 < ind.ema21 && ind.prevEma9 >= ind.prevEma21;
    if (!hasPosition) {
      if (bullishCross) reasons.push(buildReason('indicator', 'EMA9 crossed above EMA21', true, false, round(ind.ema9 - ind.ema21, 3)));
      else blockers.push(buildReason('indicator', 'EMA9 is not crossing above EMA21', false, true, round(ind.ema9 - ind.ema21, 3)));
    } else if (bearishCross) {
      reasons.push(buildReason('indicator', 'EMA9 crossed below EMA21', true, false, round(ind.ema9 - ind.ema21, 3)));
    } else {
      blockers.push(buildReason('indicator', 'EMA trend remains constructive', false, true, round(ind.ema9 - ind.ema21, 3)));
    }
  }

  if (ind.bbUpper !== undefined) {
    state.bbUpper = formatIndicatorValue(ind.bbUpper);
    state.bbMiddle = formatIndicatorValue(ind.bbMiddle);
    state.bbLower = formatIndicatorValue(ind.bbLower);
    state.bbWidth = formatIndicatorValue(ind.bbWidth);
  }
  if (strategy.id === 'bollinger_squeeze' && ind.bbUpper !== undefined) {
    const inSqueeze = ind.avgBbWidth !== undefined && ind.bbWidth < ind.avgBbWidth * 0.5;
    if (!hasPosition) {
      if (inSqueeze && close > ind.bbUpper) {
        reasons.push(buildReason('indicator', 'Price broke above the upper Bollinger band during a squeeze', true, false, round(close - ind.bbUpper, 3)));
      } else {
        if (!inSqueeze) blockers.push(buildReason('indicator', 'Bollinger bands are not compressed', false, true, round(ind.bbWidth, 3)));
        if (!(close > ind.bbUpper)) blockers.push(buildReason('price', 'Price has not broken the upper band', false, true, round(close - ind.bbUpper, 3)));
      }
    } else if (close < ind.bbMiddle) {
      reasons.push(buildReason('indicator', 'Price fell back below the Bollinger midline', true, false, round(close - ind.bbMiddle, 3)));
    } else {
      blockers.push(buildReason('indicator', 'Price is still above the Bollinger midline', false, true, round(close - ind.bbMiddle, 3)));
    }
  }

  if (ind.supertrend !== undefined) {
    state.supertrend = formatIndicatorValue(ind.supertrend);
  }
  if (strategy.id === 'supertrend' && ind.supertrend !== undefined) {
    const crossedUp = close > ind.supertrend && ind.prevClose <= ind.prevSupertrend;
    const crossedDown = close < ind.supertrend;
    if (!hasPosition) {
      if (crossedUp) reasons.push(buildReason('indicator', 'Price reclaimed the SuperTrend line', true, false, round(close - ind.supertrend, 3)));
      else blockers.push(buildReason('indicator', 'Price is not reclaiming the SuperTrend line', false, true, round(close - ind.supertrend, 3)));
    } else if (crossedDown) {
      reasons.push(buildReason('indicator', 'Price lost the SuperTrend line', true, false, round(close - ind.supertrend, 3)));
    } else {
      blockers.push(buildReason('indicator', 'SuperTrend remains supportive', false, true, round(close - ind.supertrend, 3)));
    }
  }

  return { reasons, blockers, state };
}

// Built-in strategy definitions
const BUILT_IN_STRATEGIES = {
  rsi_oversold: {
    id: 'rsi_oversold',
    name: 'RSI Oversold Bounce',
    description: 'Buy when RSI < 30, sell when RSI > 70',
    family: 'mean_reversion',
    timeframe: '1h',
    indicators: { rsi: { period: 14 } },
    entry: (candle, ind) => ind.rsi !== undefined && ind.rsi < 30,
    exit: (candle, ind) => ind.rsi !== undefined && ind.rsi > 70,
    riskManagement: { stopLoss: 0.02, takeProfit: 0.05 },
  },
  macd_cross: {
    id: 'macd_cross',
    name: 'MACD Crossover',
    description: 'Buy on MACD bullish cross, sell on bearish cross',
    family: 'trend',
    timeframe: '4h',
    indicators: { macd: { fast: 12, slow: 26, signal: 9 } },
    entry: (candle, ind) => ind.macdSignal && ind.macd > ind.macdSignal && ind.prevMacd <= ind.prevMacdSignal,
    exit: (candle, ind) => ind.macdSignal && ind.macd < ind.macdSignal && ind.prevMacd >= ind.prevMacdSignal,
    riskManagement: { stopLoss: 0.03, takeProfit: 0.06 },
  },
  bollinger_squeeze: {
    id: 'bollinger_squeeze',
    name: 'Bollinger Band Squeeze',
    description: 'Enter on squeeze breakout, exit on band touch',
    family: 'breakout',
    timeframe: '1h',
    indicators: { bb: { period: 20, stdDev: 2 }, atr: { period: 14 } },
    entry: (candle, ind) => ind.bbWidth < ind.avgBbWidth * 0.5 && candle.close > ind.bbUpper,
    exit: (candle, ind) => candle.close < ind.bbMiddle,
    riskManagement: { stopLoss: 0.025, takeProfit: 0.05 },
  },
  supertrend: {
    id: 'supertrend',
    name: 'SuperTrend Follow',
    description: 'Follow SuperTrend indicator direction',
    family: 'trend',
    timeframe: '1h',
    indicators: { supertrend: { period: 10, multiplier: 3 } },
    entry: (candle, ind) => ind.supertrend && candle.close > ind.supertrend && ind.prevClose <= ind.prevSupertrend,
    exit: (candle, ind) => ind.supertrend && candle.close < ind.supertrend,
    riskManagement: { stopLoss: 0.03, takeProfit: 0.08 },
  },
  rsi_macd_confluence: {
    id: 'rsi_macd_confluence',
    name: 'RSI + MACD Confluence',
    description: 'Enter when RSI < 40 AND MACD crosses bullish',
    family: 'swing',
    timeframe: '4h',
    indicators: { rsi: { period: 14 }, macd: { fast: 12, slow: 26, signal: 9 } },
    entry: (candle, ind) => ind.rsi < 40 && ind.macd > ind.macdSignal && ind.prevMacd <= ind.prevMacdSignal,
    exit: (candle, ind) => ind.rsi > 65 || (ind.macd < ind.macdSignal && ind.prevMacd >= ind.prevMacdSignal),
    riskManagement: { stopLoss: 0.025, takeProfit: 0.06 },
  },
  ema_cross: {
    id: 'ema_cross',
    name: 'EMA 9/21 Cross',
    description: 'Buy when EMA9 crosses above EMA21, sell on cross below',
    family: 'trend',
    timeframe: '1h',
    indicators: { ema9: { period: 9 }, ema21: { period: 21 } },
    entry: (candle, ind) => ind.ema9 > ind.ema21 && ind.prevEma9 <= ind.prevEma21,
    exit: (candle, ind) => ind.ema9 < ind.ema21 && ind.prevEma9 >= ind.prevEma21,
    riskManagement: { stopLoss: 0.02, takeProfit: 0.04 },
  },
};

class Backtester {
  constructor() {
    this.degradationFactor = parseFloat(process.env.LIVE_DEGRADATION_FACTOR || '0.65');
  }

  getStrategies() {
    return Object.entries(BUILT_IN_STRATEGIES).map(([key, s]) => ({
      id: key,
      name: s.name,
      description: s.description,
      timeframe: s.timeframe,
      family: s.family,
    }));
  }

  calculateIndicators(candles, config) {
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const results = new Array(candles.length).fill(null).map(() => ({}));

    if (config.rsi) {
      const rsiValues = ti.RSI.calculate({ values: closes, period: config.rsi.period });
      const offset = candles.length - rsiValues.length;
      rsiValues.forEach((v, i) => { results[i + offset].rsi = v; });
    }

    if (config.macd) {
      const macdValues = ti.MACD.calculate({
        values: closes,
        fastPeriod: config.macd.fast,
        slowPeriod: config.macd.slow,
        signalPeriod: config.macd.signal,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
      });
      const offset = candles.length - macdValues.length;
      macdValues.forEach((v, i) => {
        results[i + offset].macd = v.MACD;
        results[i + offset].macdSignal = v.signal;
        results[i + offset].macdHist = v.histogram;
        if (i > 0) {
          results[i + offset].prevMacd = macdValues[i - 1].MACD;
          results[i + offset].prevMacdSignal = macdValues[i - 1].signal;
        }
      });
    }

    if (config.bb) {
      const bbValues = ti.BollingerBands.calculate({
        period: config.bb.period,
        values: closes,
        stdDev: config.bb.stdDev,
      });
      const offset = candles.length - bbValues.length;
      const widths = bbValues.map((b) => b.upper - b.lower);
      const avgWidth = widths.reduce((a, b) => a + b, 0) / widths.length;
      bbValues.forEach((v, i) => {
        results[i + offset].bbUpper = v.upper;
        results[i + offset].bbMiddle = v.middle;
        results[i + offset].bbLower = v.lower;
        results[i + offset].bbWidth = v.upper - v.lower;
        results[i + offset].avgBbWidth = avgWidth;
      });
    }

    if (config.ema9) {
      const ema = ti.EMA.calculate({ values: closes, period: config.ema9.period });
      const offset = candles.length - ema.length;
      ema.forEach((v, i) => {
        results[i + offset].ema9 = v;
        if (i > 0) results[i + offset].prevEma9 = ema[i - 1];
      });
    }

    if (config.ema21) {
      const ema = ti.EMA.calculate({ values: closes, period: config.ema21.period });
      const offset = candles.length - ema.length;
      ema.forEach((v, i) => {
        results[i + offset].ema21 = v;
        if (i > 0) results[i + offset].prevEma21 = ema[i - 1];
      });
    }

    if (config.atr) {
      const atrValues = ti.ATR.calculate({ high: highs, low: lows, close: closes, period: config.atr.period });
      const offset = candles.length - atrValues.length;
      atrValues.forEach((v, i) => { results[i + offset].atr = v; });
    }

    if (config.supertrend) {
      const atrValues = ti.ATR.calculate({ high: highs, low: lows, close: closes, period: config.supertrend.period });
      const offset = candles.length - atrValues.length;
      let supertrend = 0;
      let direction = 1;
      atrValues.forEach((atr, i) => {
        const idx = i + offset;
        const hl2 = (candles[idx].high + candles[idx].low) / 2;
        const upperBand = hl2 + config.supertrend.multiplier * atr;
        const lowerBand = hl2 - config.supertrend.multiplier * atr;

        if (candles[idx].close > supertrend) direction = 1;
        else direction = -1;

        supertrend = direction === 1 ? lowerBand : upperBand;
        results[idx].supertrend = supertrend;
        if (idx > 0) {
          results[idx].prevClose = candles[idx - 1].close;
          results[idx].prevSupertrend = results[idx - 1].supertrend || supertrend;
        }
      });
    }

    for (let i = 1; i < results.length; i++) {
      results[i].prevClose = candles[i - 1].close;
      if (results[i - 1].macd !== undefined) {
        results[i].prevMacd = results[i].prevMacd || results[i - 1].macd;
        results[i].prevMacdSignal = results[i].prevMacdSignal || results[i - 1].macdSignal;
      }
      if (results[i - 1].ema9 !== undefined) {
        results[i].prevEma9 = results[i].prevEma9 || results[i - 1].ema9;
      }
      if (results[i - 1].ema21 !== undefined) {
        results[i].prevEma21 = results[i].prevEma21 || results[i - 1].ema21;
      }
    }

    return results;
  }

  _createStrategyState(strategy, candles, initialCapital) {
    return {
      strategy,
      capital: initialCapital,
      position: null,
      trades: [],
      equityCurve: [],
      indicators: this.calculateIndicators(candles, strategy.indicators || {}),
      peakCapital: initialCapital,
      maxDrawdown: 0,
      maxDrawdownPct: 0,
    };
  }

  _recordEquity(state, candle) {
    const equity = state.position
      ? state.capital + (candle.close - state.position.entryPrice) * state.position.quantity
      : state.capital;

    state.equityCurve.push({
      time: candle.openTime,
      equity,
      price: candle.close,
    });

    if (equity > state.peakCapital) state.peakCapital = equity;
    const dd = state.peakCapital - equity;
    if (dd > state.maxDrawdown) {
      state.maxDrawdown = dd;
      state.maxDrawdownPct = state.peakCapital ? (dd / state.peakCapital) * 100 : 0;
    }

    return equity;
  }

  _buildDecision(strategy, candle, ind, position) {
    strategy._positionState = position;
    const { reasons, blockers, state } = buildSignalEvaluation(strategy, candle, ind);
    delete strategy._positionState;
    return { reasons, blockers, state };
  }

  _simulateCandle(state, candles, index, feeRate, slippage, options = {}) {
    const candle = candles[index];
    const ind = state.indicators[index];
    const equity = this._recordEquity(state, candle);
    const decision = this._buildDecision(state.strategy, candle, ind, state.position);

    let action = 'hold';
    let event = null;

    if (!state.position) {
      try {
        if (state.strategy.entry(candle, ind, { candles, indicators: state.indicators, index })) {
          const entryPrice = candle.close * (1 + slippage);
          const positionSize = state.capital * 0.95;
          const quantity = positionSize / entryPrice;
          const fee = positionSize * feeRate;
          state.capital -= fee;

          state.position = {
            entryPrice,
            quantity,
            entryTime: candle.openTime,
            entryIndex: index,
            stopLoss: state.strategy.riskManagement?.stopLoss ? entryPrice * (1 - state.strategy.riskManagement.stopLoss) : null,
            takeProfit: state.strategy.riskManagement?.takeProfit ? entryPrice * (1 + state.strategy.riskManagement.takeProfit) : null,
          };

          action = 'buy';
          event = {
            type: 'entry',
            time: candle.openTime,
            price: round(entryPrice, 4),
            quantity: round(quantity, 6),
          };
        }
      } catch {
        // Indicators may not be ready on early bars.
      }
    } else {
      let exitPrice = null;
      let exitReason = '';

      if (state.position.stopLoss && candle.low <= state.position.stopLoss) {
        exitPrice = state.position.stopLoss;
        exitReason = 'stop_loss';
      } else if (state.position.takeProfit && candle.high >= state.position.takeProfit) {
        exitPrice = state.position.takeProfit;
        exitReason = 'take_profit';
      } else {
        try {
          if (state.strategy.exit(candle, ind, { candles, indicators: state.indicators, index, position: state.position })) {
            exitPrice = candle.close * (1 - slippage);
            exitReason = 'signal';
          }
        } catch {
          // Indicators may not be ready on early bars.
        }
      }

      if (exitPrice) {
        const fee = state.position.quantity * exitPrice * feeRate;
        const pnl = (exitPrice - state.position.entryPrice) * state.position.quantity - fee;
        state.capital += pnl + state.position.quantity * state.position.entryPrice;

        state.trades.push({
          entryTime: state.position.entryTime,
          exitTime: candle.openTime,
          entryIndex: state.position.entryIndex,
          exitIndex: index,
          entryPrice: state.position.entryPrice,
          exitPrice,
          quantity: state.position.quantity,
          pnl,
          pnlPct: (pnl / (state.position.quantity * state.position.entryPrice)) * 100,
          fee,
          reason: exitReason,
        });

        action = 'sell';
        event = {
          type: 'exit',
          time: candle.openTime,
          price: round(exitPrice, 4),
          quantity: round(state.position.quantity, 6),
          pnl: round(pnl, 2),
          reason: exitReason,
        };
        state.position = null;
      }
    }

    const explanation = buildExplanation({
      action,
      reasons: decision.reasons,
      blockers: decision.blockers,
      state: decision.state,
    });

    if (event?.reason === 'stop_loss') {
      explanation.summary = 'Exit triggered by stop loss.';
      explanation.reasons = ['Stop loss was hit.'];
      explanation.blockers = [];
    } else if (event?.reason === 'take_profit') {
      explanation.summary = 'Exit triggered by take profit.';
      explanation.reasons = ['Take profit target was hit.'];
      explanation.blockers = [];
    }

    return {
      action,
      equity,
      explanation,
      event,
      inPosition: !!state.position,
      openPosition: state.position
        ? {
            entryPrice: round(state.position.entryPrice, 4),
            quantity: round(state.position.quantity, 6),
            stopLoss: state.position.stopLoss ? round(state.position.stopLoss, 4) : null,
            takeProfit: state.position.takeProfit ? round(state.position.takeProfit, 4) : null,
          }
        : null,
    };
  }

  _finalizeState(state, candles, initialCapital, feeRate) {
    if (state.position) {
      const lastCandle = candles[candles.length - 1];
      const exitPrice = lastCandle.close;
      const fee = state.position.quantity * exitPrice * feeRate;
      const pnl = (exitPrice - state.position.entryPrice) * state.position.quantity - fee;
      state.capital += pnl + state.position.quantity * state.position.entryPrice;
      state.trades.push({
        entryTime: state.position.entryTime,
        exitTime: lastCandle.openTime,
        entryIndex: state.position.entryIndex,
        exitIndex: candles.length - 1,
        entryPrice: state.position.entryPrice,
        exitPrice,
        quantity: state.position.quantity,
        pnl,
        pnlPct: (pnl / (state.position.quantity * state.position.entryPrice)) * 100,
        fee,
        reason: 'end_of_data',
      });
      state.position = null;
    }

    const metrics = this._calculateMetrics(
      state.trades,
      initialCapital,
      state.capital,
      state.maxDrawdown,
      state.maxDrawdownPct,
      state.equityCurve
    );

    return {
      strategyId: state.strategy.id,
      strategyName: state.strategy.name,
      strategyFamily: state.strategy.family,
      ...metrics,
      maxDrawdown: state.maxDrawdown,
      maxDrawdownPct: state.maxDrawdownPct,
      trades: state.trades,
      equityCurve: state.equityCurve.filter((_, i) => i % Math.max(1, Math.floor(state.equityCurve.length / 500)) === 0),
      rawEquityCurve: state.equityCurve,
      indicators: state.indicators,
      realisticNetProfit: metrics.netProfit * this.degradationFactor,
      realisticWinRate: metrics.winRate * this.degradationFactor + (1 - this.degradationFactor) * 50,
      realisticProfitFactor: metrics.profitFactor * this.degradationFactor + (1 - this.degradationFactor),
    };
  }

  runStrategySimulation(params) {
    const {
      strategy,
      candles,
      initialCapital = 100000,
      feeRate = 0.001,
      slippage = 0.0005,
    } = params;

    if (!strategy?.entry || !strategy?.exit) {
      throw new Error('Strategy runtime is missing entry/exit rules');
    }
    if (!Array.isArray(candles) || candles.length < WARMUP_CANDLES) {
      throw new Error(`Not enough data: ${candles?.length || 0} candles`);
    }

    const state = this._createStrategyState(strategy, candles, initialCapital);

    for (let i = WARMUP_CANDLES; i < candles.length; i++) {
      this._simulateCandle(state, candles, i, feeRate, slippage);
    }

    const summary = this._finalizeState(state, candles, initialCapital, feeRate);

    return {
      ...summary,
      candles,
    };
  }

  async runArena(params) {
    const {
      strategyIds,
      symbol,
      timeframe,
      startDate,
      endDate,
      initialCapital = 100000,
      feeRate = 0.001,
      slippage = 0.0005,
    } = params;

    if (!Array.isArray(strategyIds) || strategyIds.length < 2) {
      throw new Error('Select at least two strategies for the arena');
    }
    if (strategyIds.length > 3) {
      throw new Error('Arena comparison currently supports up to three strategies');
    }

    const strategies = strategyIds.map((id) => {
      const strategy = BUILT_IN_STRATEGIES[id];
      if (!strategy) throw new Error(`Strategy '${id}' not found`);
      return strategy;
    });

    const candles = await binanceService.getHistoricalCandles(symbol, timeframe, startDate, endDate);
    if (candles.length < WARMUP_CANDLES) throw new Error(`Not enough data: ${candles.length} candles`);

    const states = strategies.map((strategy) => this._createStrategyState(strategy, candles, initialCapital));
    const timeline = [];

    for (let i = WARMUP_CANDLES; i < candles.length; i++) {
      const candle = candles[i];
      const strategiesAtStep = states.map((state) => {
        const snapshot = this._simulateCandle(state, candles, i, feeRate, slippage, { arena: true });
        return {
          strategyId: state.strategy.id,
          strategyName: state.strategy.name,
          family: state.strategy.family,
          action: snapshot.action,
          equity: round(snapshot.equity, 2),
          inPosition: snapshot.inPosition,
          openPosition: snapshot.openPosition,
          explanation: snapshot.explanation,
          event: snapshot.event,
        };
      });

      const actionSet = new Set(strategiesAtStep.map((item) => item.action));
      const keyMoment = strategiesAtStep.some((item) => item.event) || actionSet.size > 1;

      timeline.push({
        index: i,
        time: candle.openTime,
        candle: {
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        },
        strategies: strategiesAtStep,
        keyMoment,
      });
    }

    const results = states.map((state) => this._finalizeState(state, candles, initialCapital, feeRate));
    const keyMoments = timeline
      .filter((step) => step.keyMoment)
      .map((step) => ({
        index: step.index,
        time: step.time,
        price: round(step.candle.close, 2),
        actions: step.strategies.map((item) => ({
          strategyId: item.strategyId,
          strategyName: item.strategyName,
          action: item.action,
          summary: item.explanation.summary,
        })),
      }));

    return {
      symbol,
      timeframe,
      startDate,
      endDate,
      initialCapital,
      strategyIds,
      strategies: results.map((result) => ({
        strategyId: result.strategyId,
        strategyName: result.strategyName,
        strategyFamily: result.strategyFamily,
        netProfit: round(result.netProfit, 2),
        netProfitPct: round(result.netProfitPct, 2),
        winRate: round(result.winRate, 2),
        profitFactor: Number.isFinite(result.profitFactor) ? round(result.profitFactor, 2) : null,
        maxDrawdown: round(result.maxDrawdown, 2),
        maxDrawdownPct: round(result.maxDrawdownPct, 2),
        totalTrades: result.totalTrades,
        equityCurve: result.equityCurve,
        trades: result.trades,
      })),
      timeline,
      keyMoments,
    };
  }

  async runBacktest(params) {
    const {
      strategyId, symbol, timeframe, startDate, endDate,
      initialCapital = 100000, feeRate = 0.001, slippage = 0.0005,
    } = params;

    const strategy = BUILT_IN_STRATEGIES[strategyId];
    if (!strategy) throw new Error(`Strategy '${strategyId}' not found`);

    const candles = await binanceService.getHistoricalCandles(symbol, timeframe, startDate, endDate);
    if (candles.length < WARMUP_CANDLES) throw new Error(`Not enough data: ${candles.length} candles`);

    const simulation = this.runStrategySimulation({
      strategy,
      candles,
      initialCapital,
      feeRate,
      slippage,
    });

    const db = getDb();
    const result = db.prepare(`
      INSERT INTO backtest_results
      (strategy_name, symbol, timeframe, start_date, end_date, total_trades, win_rate,
       net_profit, net_profit_pct, profit_factor, max_drawdown, max_drawdown_pct,
       sharpe_ratio, sortino_ratio, avg_win, avg_loss, longest_win_streak, longest_loss_streak,
       equity_curve, realistic_net_profit, realistic_win_rate, config)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      strategy.name, symbol, timeframe, startDate, endDate,
      simulation.totalTrades, simulation.winRate, simulation.netProfit, simulation.netProfitPct,
      simulation.profitFactor, simulation.maxDrawdown, simulation.maxDrawdownPct,
      simulation.sharpeRatio, simulation.sortinoRatio, simulation.avgWin, simulation.avgLoss,
      simulation.longestWinStreak, simulation.longestLossStreak,
      JSON.stringify(simulation.equityCurve),
      simulation.realisticNetProfit,
      simulation.realisticWinRate,
      JSON.stringify(params)
    );

    return {
      id: result.lastInsertRowid,
      strategyName: strategy.name,
      symbol,
      timeframe,
      startDate,
      endDate,
      ...simulation,
    };
  }

  _calculateMetrics(trades, initialCapital, finalCapital) {
    const wins = trades.filter((t) => t.pnl > 0);
    const losses = trades.filter((t) => t.pnl <= 0);
    const totalTrades = trades.length;

    const netProfit = finalCapital - initialCapital;
    const netProfitPct = (netProfit / initialCapital) * 100;
    const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;

    const totalWins = wins.reduce((s, t) => s + t.pnl, 0);
    const totalLosses = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

    const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
    const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;

    let currentStreak = 0;
    let longestWinStreak = 0;
    let longestLossStreak = 0;
    let isWinStreak = true;

    for (const t of trades) {
      if (t.pnl > 0) {
        if (isWinStreak) currentStreak += 1;
        else {
          currentStreak = 1;
          isWinStreak = true;
        }
        longestWinStreak = Math.max(longestWinStreak, currentStreak);
      } else {
        if (!isWinStreak) currentStreak += 1;
        else {
          currentStreak = 1;
          isWinStreak = false;
        }
        longestLossStreak = Math.max(longestLossStreak, currentStreak);
      }
    }

    const returns = trades.map((t) => t.pnlPct / 100);
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdDev = returns.length > 1
      ? Math.sqrt(returns.reduce((s, r) => s + ((r - avgReturn) ** 2), 0) / (returns.length - 1))
      : 0;
    const downside = returns.filter((r) => r < 0);
    const downsideDev = downside.length > 1
      ? Math.sqrt(downside.reduce((s, r) => s + (r ** 2), 0) / (downside.length - 1))
      : 0;

    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;
    const sortinoRatio = downsideDev > 0 ? (avgReturn / downsideDev) * Math.sqrt(252) : 0;

    return {
      totalTrades,
      winRate,
      netProfit,
      netProfitPct,
      profitFactor,
      avgWin,
      avgLoss: -avgLoss,
      longestWinStreak,
      longestLossStreak,
      sharpeRatio,
      sortinoRatio,
      totalFees: trades.reduce((s, t) => s + t.fee, 0),
    };
  }

  getResults(limit = 50) {
    return getDb().prepare('SELECT * FROM backtest_results ORDER BY ran_at DESC LIMIT ?').all(limit);
  }

  getResult(id) {
    return getDb().prepare('SELECT * FROM backtest_results WHERE id = ?').get(id);
  }
}

const backtester = new Backtester();
export default backtester;
export { BUILT_IN_STRATEGIES };
