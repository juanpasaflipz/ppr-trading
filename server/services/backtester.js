import { getDb } from '../db/database.js';
import binanceService from './binance.js';
import * as ti from 'technicalindicators';

// Built-in strategy definitions
const BUILT_IN_STRATEGIES = {
  rsi_oversold: {
    name: 'RSI Oversold Bounce',
    description: 'Buy when RSI < 30, sell when RSI > 70',
    timeframe: '1h',
    indicators: { rsi: { period: 14 } },
    entry: (candle, ind) => ind.rsi !== undefined && ind.rsi < 30,
    exit: (candle, ind) => ind.rsi !== undefined && ind.rsi > 70,
    riskManagement: { stopLoss: 0.02, takeProfit: 0.05 },
  },
  macd_cross: {
    name: 'MACD Crossover',
    description: 'Buy on MACD bullish cross, sell on bearish cross',
    timeframe: '4h',
    indicators: { macd: { fast: 12, slow: 26, signal: 9 } },
    entry: (candle, ind) => ind.macdSignal && ind.macd > ind.macdSignal && ind.prevMacd <= ind.prevMacdSignal,
    exit: (candle, ind) => ind.macdSignal && ind.macd < ind.macdSignal && ind.prevMacd >= ind.prevMacdSignal,
    riskManagement: { stopLoss: 0.03, takeProfit: 0.06 },
  },
  bollinger_squeeze: {
    name: 'Bollinger Band Squeeze',
    description: 'Enter on squeeze breakout, exit on band touch',
    timeframe: '1h',
    indicators: { bb: { period: 20, stdDev: 2 }, atr: { period: 14 } },
    entry: (candle, ind) => ind.bbWidth < ind.avgBbWidth * 0.5 && candle.close > ind.bbUpper,
    exit: (candle, ind) => candle.close < ind.bbMiddle,
    riskManagement: { stopLoss: 0.025, takeProfit: 0.05 },
  },
  supertrend: {
    name: 'SuperTrend Follow',
    description: 'Follow SuperTrend indicator direction',
    timeframe: '1h',
    indicators: { supertrend: { period: 10, multiplier: 3 } },
    entry: (candle, ind) => ind.supertrend && candle.close > ind.supertrend && ind.prevClose <= ind.prevSupertrend,
    exit: (candle, ind) => ind.supertrend && candle.close < ind.supertrend,
    riskManagement: { stopLoss: 0.03, takeProfit: 0.08 },
  },
  rsi_macd_confluence: {
    name: 'RSI + MACD Confluence',
    description: 'Enter when RSI < 40 AND MACD crosses bullish',
    timeframe: '4h',
    indicators: { rsi: { period: 14 }, macd: { fast: 12, slow: 26, signal: 9 } },
    entry: (candle, ind) => ind.rsi < 40 && ind.macd > ind.macdSignal && ind.prevMacd <= ind.prevMacdSignal,
    exit: (candle, ind) => ind.rsi > 65 || (ind.macd < ind.macdSignal && ind.prevMacd >= ind.prevMacdSignal),
    riskManagement: { stopLoss: 0.025, takeProfit: 0.06 },
  },
  ema_cross: {
    name: 'EMA 9/21 Cross',
    description: 'Buy when EMA9 crosses above EMA21, sell on cross below',
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
    }));
  }

  calculateIndicators(candles, config) {
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);
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
      const widths = bbValues.map(b => b.upper - b.lower);
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
      // Simple SuperTrend approximation
      const atrValues = ti.ATR.calculate({ high: highs, low: lows, close: closes, period: config.supertrend.period });
      const offset = candles.length - atrValues.length;
      let supertrend = 0;
      let direction = 1; // 1 = up, -1 = down
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

    // Add prev close for all
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

  async runBacktest(params) {
    const {
      strategyId, symbol, timeframe, startDate, endDate,
      initialCapital = 100000, feeRate = 0.001, slippage = 0.0005,
    } = params;

    const strategy = BUILT_IN_STRATEGIES[strategyId];
    if (!strategy) throw new Error(`Strategy '${strategyId}' not found`);

    // Fetch historical data
    console.log(`[Backtest] Fetching ${symbol} ${timeframe} candles from ${startDate} to ${endDate}`);
    const candles = await binanceService.getHistoricalCandles(symbol, timeframe, startDate, endDate);
    if (candles.length < 50) throw new Error(`Not enough data: ${candles.length} candles`);

    console.log(`[Backtest] Running ${strategy.name} on ${candles.length} candles`);

    // Calculate indicators
    const indicators = this.calculateIndicators(candles, strategy.indicators);

    // Simulate trades
    let capital = initialCapital;
    let position = null;
    const trades = [];
    const equityCurve = [];
    let peakCapital = capital;
    let maxDrawdown = 0;
    let maxDrawdownPct = 0;

    for (let i = 50; i < candles.length; i++) {
      const candle = candles[i];
      const ind = indicators[i];
      const equity = position
        ? capital + (candle.close - position.entryPrice) * position.quantity
        : capital;

      equityCurve.push({
        time: candle.openTime,
        equity,
        price: candle.close,
      });

      if (equity > peakCapital) peakCapital = equity;
      const dd = peakCapital - equity;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
        maxDrawdownPct = (dd / peakCapital) * 100;
      }

      if (!position) {
        // Check entry
        try {
          if (strategy.entry(candle, ind)) {
            const entryPrice = candle.close * (1 + slippage);
            const positionSize = capital * 0.95; // Use 95% of capital
            const quantity = positionSize / entryPrice;
            const fee = positionSize * feeRate;
            capital -= fee;

            position = {
              entryPrice,
              quantity,
              entryTime: candle.openTime,
              stopLoss: strategy.riskManagement?.stopLoss ? entryPrice * (1 - strategy.riskManagement.stopLoss) : null,
              takeProfit: strategy.riskManagement?.takeProfit ? entryPrice * (1 + strategy.riskManagement.takeProfit) : null,
            };
          }
        } catch { /* indicator not ready */ }
      } else {
        // Check exit conditions
        let exitPrice = null;
        let exitReason = '';

        // Stop loss
        if (position.stopLoss && candle.low <= position.stopLoss) {
          exitPrice = position.stopLoss;
          exitReason = 'stop_loss';
        }
        // Take profit
        else if (position.takeProfit && candle.high >= position.takeProfit) {
          exitPrice = position.takeProfit;
          exitReason = 'take_profit';
        }
        // Strategy exit
        else {
          try {
            if (strategy.exit(candle, ind)) {
              exitPrice = candle.close * (1 - slippage);
              exitReason = 'signal';
            }
          } catch { /* indicator not ready */ }
        }

        if (exitPrice) {
          const fee = position.quantity * exitPrice * feeRate;
          const pnl = (exitPrice - position.entryPrice) * position.quantity - fee;
          capital += pnl + position.quantity * position.entryPrice;

          trades.push({
            entryTime: position.entryTime,
            exitTime: candle.openTime,
            entryPrice: position.entryPrice,
            exitPrice,
            quantity: position.quantity,
            pnl,
            pnlPct: (pnl / (position.quantity * position.entryPrice)) * 100,
            fee,
            reason: exitReason,
          });

          position = null;
        }
      }
    }

    // Close any open position at the end
    if (position) {
      const lastCandle = candles[candles.length - 1];
      const exitPrice = lastCandle.close;
      const fee = position.quantity * exitPrice * feeRate;
      const pnl = (exitPrice - position.entryPrice) * position.quantity - fee;
      capital += pnl + position.quantity * position.entryPrice;
      trades.push({
        entryTime: position.entryTime,
        exitTime: lastCandle.openTime,
        entryPrice: position.entryPrice,
        exitPrice,
        quantity: position.quantity,
        pnl,
        pnlPct: (pnl / (position.quantity * position.entryPrice)) * 100,
        fee,
        reason: 'end_of_data',
      });
    }

    // Calculate metrics
    const metrics = this._calculateMetrics(trades, initialCapital, capital, maxDrawdown, maxDrawdownPct, equityCurve);

    // Save to database
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
      metrics.totalTrades, metrics.winRate, metrics.netProfit, metrics.netProfitPct,
      metrics.profitFactor, maxDrawdown, maxDrawdownPct,
      metrics.sharpeRatio, metrics.sortinoRatio, metrics.avgWin, metrics.avgLoss,
      metrics.longestWinStreak, metrics.longestLossStreak,
      JSON.stringify(equityCurve.filter((_, i) => i % Math.max(1, Math.floor(equityCurve.length / 500)) === 0)),
      metrics.netProfit * this.degradationFactor,
      metrics.winRate * this.degradationFactor + (1 - this.degradationFactor) * 50,
      JSON.stringify(params)
    );

    return {
      id: result.lastInsertRowid,
      strategyName: strategy.name,
      symbol,
      timeframe,
      startDate,
      endDate,
      ...metrics,
      maxDrawdown,
      maxDrawdownPct,
      realisticNetProfit: metrics.netProfit * this.degradationFactor,
      realisticWinRate: metrics.winRate * this.degradationFactor + (1 - this.degradationFactor) * 50,
      realisticProfitFactor: metrics.profitFactor * this.degradationFactor + (1 - this.degradationFactor),
      trades,
      equityCurve: equityCurve.filter((_, i) => i % Math.max(1, Math.floor(equityCurve.length / 500)) === 0),
    };
  }

  _calculateMetrics(trades, initialCapital, finalCapital, maxDrawdown, maxDrawdownPct, equityCurve) {
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const totalTrades = trades.length;

    const netProfit = finalCapital - initialCapital;
    const netProfitPct = (netProfit / initialCapital) * 100;
    const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;

    const totalWins = wins.reduce((s, t) => s + t.pnl, 0);
    const totalLosses = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

    const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
    const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;

    // Streaks
    let currentStreak = 0;
    let longestWinStreak = 0;
    let longestLossStreak = 0;
    let isWinStreak = true;

    for (const t of trades) {
      if (t.pnl > 0) {
        if (isWinStreak) { currentStreak++; }
        else { currentStreak = 1; isWinStreak = true; }
        longestWinStreak = Math.max(longestWinStreak, currentStreak);
      } else {
        if (!isWinStreak) { currentStreak++; }
        else { currentStreak = 1; isWinStreak = false; }
        longestLossStreak = Math.max(longestLossStreak, currentStreak);
      }
    }

    // Sharpe & Sortino ratios
    const returns = trades.map(t => t.pnlPct / 100);
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdDev = returns.length > 1
      ? Math.sqrt(returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1))
      : 0;
    const downside = returns.filter(r => r < 0);
    const downsideDev = downside.length > 1
      ? Math.sqrt(downside.reduce((s, r) => s + Math.pow(r, 2), 0) / (downside.length - 1))
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
    const db = getDb();
    return db.prepare('SELECT * FROM backtest_results ORDER BY ran_at DESC LIMIT ?').all(limit);
  }

  getResult(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM backtest_results WHERE id = ?').get(id);
  }
}

const backtester = new Backtester();
export default backtester;
export { BUILT_IN_STRATEGIES };
