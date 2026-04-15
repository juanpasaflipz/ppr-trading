import { getDb } from '../db/database.js';
import binanceService from './binance.js';
import backtester from './backtester.js';
import strategyRegistry from './strategyRegistry.js';

const DEFAULT_START_DATE = '2024-01-01';
const DEFAULT_INITIAL_CAPITAL = 100000;
const DEFAULT_FEE_RATE = 0.001;
const DEFAULT_SLIPPAGE = 0.0005;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  if (values.length <= 1) return 0;
  const mean = average(values);
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function scoreBand(value, min, max) {
  if (!Number.isFinite(value)) return 0;
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}

function normalizeNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function buildRiskManagement(strategy) {
  return {
    stopLoss: normalizeNumber(strategy.rules?.risk?.stopLossPct, 0.02),
    takeProfit: normalizeNumber(strategy.rules?.risk?.takeProfitPct, 0.05),
  };
}

function cloneWithOverrides(strategy, overrides = {}) {
  return {
    ...strategy,
    indicators: {
      ...(strategy.indicators || {}),
      ...(overrides.indicators || {}),
    },
    rules: {
      ...(strategy.rules || {}),
      ...(overrides.rules || {}),
      risk: {
        ...(strategy.rules?.risk || {}),
        ...(overrides.rules?.risk || {}),
      },
    },
  };
}

function getPrimaryIndicatorConfig(indicators = {}) {
  const keys = Object.keys(indicators);
  if (!keys.length) return null;

  const priority = ['rsi', 'supertrend', 'bollinger', 'macd', 'wavetrend', 'atr', 'marketStructure', 'volume'];
  const key = priority.find((name) => keys.includes(name)) || keys[0];
  const config = indicators[key];
  if (!config || typeof config !== 'object') return null;

  const numericField = Object.keys(config).find((field) => typeof config[field] === 'number');
  if (!numericField) return null;

  return { key, field: numericField, value: config[numericField] };
}

function compileStrategyRuntime(strategy) {
  const riskManagement = buildRiskManagement(strategy);
  const indicators = strategy.indicators || {};
  const style = strategy.style || strategy.classification?.style || 'trend';
  const directionality = strategy.directionality || strategy.classification?.directionality || 'long_short';

  const longAllowed = directionality !== 'short_only';
  const hasRsi = !!indicators.rsi;
  const hasMacd = !!indicators.macd;
  const hasSupertrend = !!indicators.supertrend;
  const hasBollinger = !!indicators.bollinger;
  const hasAtr = !!indicators.atr;

  const longEntry = (candle, ind) => {
    if (!longAllowed) return false;

    if (style === 'mean_reversion') {
      if (hasRsi) return ind.rsi !== undefined && ind.rsi < 35;
      if (hasBollinger) return ind.bbLower !== undefined && candle.close <= ind.bbLower;
      return false;
    }

    if (style === 'breakout') {
      return ind.bbUpper !== undefined && candle.close > ind.bbUpper && (!hasAtr || ind.atr > 0);
    }

    if (style === 'market_structure') {
      return ind.supertrend !== undefined && candle.close > ind.supertrend;
    }

    if (hasSupertrend) {
      return ind.supertrend !== undefined && candle.close > ind.supertrend && ind.prevClose <= ind.prevSupertrend;
    }

    if (hasMacd) {
      return ind.macd !== undefined && ind.macdSignal !== undefined && ind.macd > ind.macdSignal && ind.prevMacd <= ind.prevMacdSignal;
    }

    if (hasRsi) {
      return ind.rsi !== undefined && ind.rsi < 40;
    }

    return false;
  };

  const longExit = (candle, ind) => {
    if (style === 'mean_reversion') {
      if (hasRsi) return ind.rsi !== undefined && ind.rsi > 60;
      if (hasBollinger) return ind.bbMiddle !== undefined && candle.close >= ind.bbMiddle;
    }

    if (style === 'breakout') {
      return ind.bbMiddle !== undefined && candle.close < ind.bbMiddle;
    }

    if (hasSupertrend) {
      return ind.supertrend !== undefined && candle.close < ind.supertrend;
    }

    if (hasMacd) {
      return ind.macd !== undefined && ind.macdSignal !== undefined && ind.macd < ind.macdSignal && ind.prevMacd >= ind.prevMacdSignal;
    }

    if (hasRsi) {
      return ind.rsi !== undefined && ind.rsi > 65;
    }

    return false;
  };

  return {
    name: strategy.name,
    indicators: {
      ...(hasBollinger ? { bb: { period: indicators.bollinger.period, stdDev: indicators.bollinger.stdDev } } : {}),
      ...(hasRsi ? { rsi: { period: indicators.rsi.period } } : {}),
      ...(hasMacd ? { macd: indicators.macd } : {}),
      ...(hasSupertrend ? { supertrend: indicators.supertrend } : {}),
      ...(hasAtr ? { atr: indicators.atr } : {}),
    },
    riskManagement,
    entry: longEntry,
    exit: longExit,
  };
}

function segmentRegimes(candles, indicators) {
  const atrValues = indicators
    .map((indicator, index) => {
      const price = candles[index]?.close || 1;
      return indicator.atr ? (indicator.atr / price) * 100 : null;
    })
    .filter((value) => value !== null);
  const medianAtrPct = median(atrValues);

  return candles.map((candle, index) => {
    const indicator = indicators[index] || {};
    const atrPct = indicator.atr ? (indicator.atr / candle.close) * 100 : 0;
    const trendGap = indicator.supertrend ? ((candle.close - indicator.supertrend) / candle.close) * 100 : 0;

    if (indicator.supertrend !== undefined && trendGap > 0.6) return 'trend_up';
    if (indicator.supertrend !== undefined && trendGap < -0.6) return 'trend_down';
    if (medianAtrPct && atrPct >= medianAtrPct * 1.25) return 'high_volatility';
    return 'range';
  });
}

function summarizeRegimes(trades, regimes) {
  const buckets = new Map();

  for (const trade of trades) {
    const regime = regimes[trade.entryIndex] || 'unknown';
    const bucket = buckets.get(regime) || {
      regime,
      tradeCount: 0,
      wins: 0,
      netProfit: 0,
      grossWins: 0,
      grossLosses: 0,
      maxDrawdown: 0,
    };

    bucket.tradeCount += 1;
    bucket.netProfit += trade.pnl;
    if (trade.pnl > 0) {
      bucket.wins += 1;
      bucket.grossWins += trade.pnl;
    } else {
      bucket.grossLosses += Math.abs(trade.pnl);
      bucket.maxDrawdown = Math.max(bucket.maxDrawdown, Math.abs(trade.pnl));
    }

    buckets.set(regime, bucket);
  }

  return [...buckets.values()].map((bucket) => ({
    regime: bucket.regime,
    tradeCount: bucket.tradeCount,
    winRate: bucket.tradeCount ? round((bucket.wins / bucket.tradeCount) * 100, 2) : 0,
    netProfit: round(bucket.netProfit, 2),
    profitFactor: bucket.grossLosses > 0 ? round(bucket.grossWins / bucket.grossLosses, 2) : bucket.grossWins > 0 ? 99 : 0,
    maxDrawdown: round(bucket.maxDrawdown, 2),
  })).sort((a, b) => b.netProfit - a.netProfit);
}

function buildCoach(summary, regimeStats, sensitivityTests) {
  const notes = [];

  if (summary.metrics.totalTrades < 8) {
    notes.push('Low sample size. This strategy needs more trades before the score is trustworthy.');
  }
  if (summary.scores.stability < 45) {
    notes.push('Performance is unstable under small parameter changes. Treat current results as curve-fit risk.');
  }
  if (summary.scores.executionRealism < 50) {
    notes.push('Edge degrades materially after fees and slippage. Execution assumptions are too fragile.');
  }

  const bestRegime = regimeStats[0];
  const secondRegime = regimeStats[1];
  if (bestRegime && (!secondRegime || bestRegime.netProfit > Math.abs(summary.metrics.netProfit) * 0.65)) {
    notes.push(`Most profit comes from ${bestRegime.regime}. Regime dependence is high.`);
  }

  const weakSensitivity = sensitivityTests.filter((test) => test.netProfit < summary.metrics.netProfit * 0.5);
  if (weakSensitivity.length >= 2) {
    notes.push('Multiple nearby parameter variants collapse quickly. Use this as a reject signal unless you can explain the edge.');
  }

  if (!notes.length) {
    notes.push('Metrics are reasonably balanced. Next step is validating portability across another pair or timeframe.');
  }

  return notes;
}

function buildScorecard(baseMetrics, regimeStats, sensitivityTests) {
  const sensitivityProfits = sensitivityTests.map((test) => test.netProfit);
  const meanProfit = average(sensitivityProfits);
  const deviation = standardDeviation(sensitivityProfits);
  const stabilityRatio = Math.abs(meanProfit) > 0 ? deviation / Math.abs(meanProfit) : 1;

  const positiveRegimes = regimeStats.filter((regime) => regime.netProfit > 0);
  const largestRegimeShare = regimeStats.length
    ? Math.max(...regimeStats.map((regime) => Math.abs(regime.netProfit))) / Math.max(Math.abs(baseMetrics.netProfit), 1)
    : 1;

  const stability = round(clamp(100 - stabilityRatio * 100, 0, 100), 1);
  const portability = round(clamp(scoreBand(baseMetrics.totalTrades, 4, 18) * 0.45 + scoreBand(baseMetrics.profitFactor, 1, 2.2) * 0.55, 0, 100), 1);
  const regimeFit = round(clamp((positiveRegimes.length >= 2 ? 70 : 40) + (1 - Math.min(largestRegimeShare, 1)) * 30, 0, 100), 1);
  const executionRealism = round(clamp(scoreBand(baseMetrics.realisticProfitFactor, 1, 1.8) * 0.6 + scoreBand(baseMetrics.realisticWinRate, 48, 62) * 0.4, 0, 100), 1);
  const total = round((stability + portability + regimeFit + executionRealism) / 4, 1);

  return { total, stability, portability, regimeFit, executionRealism };
}

class StrategyAnalyzerService {
  async evaluateStrategy(strategyId, options = {}) {
    const strategy = strategyRegistry.getStrategy(strategyId);
    if (!strategy) throw new Error('Strategy not found');

    const symbol = options.symbol || strategy.market?.allowedPairs?.[0] || 'BTCUSDT';
    const timeframe = options.timeframe || strategy.market?.preferredTimeframes?.[0] || '1h';
    const startDate = options.startDate || DEFAULT_START_DATE;
    const endDate = options.endDate || new Date().toISOString().slice(0, 10);
    const initialCapital = normalizeNumber(options.initialCapital, DEFAULT_INITIAL_CAPITAL);
    const feeRate = normalizeNumber(options.feeRate, DEFAULT_FEE_RATE);
    const slippage = normalizeNumber(options.slippage, DEFAULT_SLIPPAGE);

    const runtime = compileStrategyRuntime(strategy);
    const candles = await binanceService.getHistoricalCandles(symbol, timeframe, startDate, endDate);
    const simulation = backtester.runStrategySimulation({
      strategy: runtime,
      candles,
      initialCapital,
      feeRate,
      slippage,
    });

    const regimes = segmentRegimes(candles, simulation.indicators);
    const regimeStats = summarizeRegimes(simulation.trades, regimes);
    const sensitivityTests = this.runSensitivityTests(strategy, candles, { initialCapital, feeRate, slippage });
    const scores = buildScorecard(simulation, regimeStats, sensitivityTests);

    const summary = {
      strategy: {
        id: strategy.id,
        name: strategy.name,
        slug: strategy.slug,
        style: strategy.style,
        directionality: strategy.directionality,
        sourceKind: strategy.sourceKind,
      },
      evaluation: {
        symbol,
        timeframe,
        startDate,
        endDate,
        ranAt: new Date().toISOString(),
      },
      metrics: {
        totalTrades: simulation.totalTrades,
        winRate: round(simulation.winRate, 2),
        netProfit: round(simulation.netProfit, 2),
        netProfitPct: round(simulation.netProfitPct, 2),
        profitFactor: Number.isFinite(simulation.profitFactor) ? round(simulation.profitFactor, 2) : 99,
        maxDrawdown: round(simulation.maxDrawdown, 2),
        maxDrawdownPct: round(simulation.maxDrawdownPct, 2),
        sharpeRatio: round(simulation.sharpeRatio, 2),
        realisticNetProfit: round(simulation.realisticNetProfit, 2),
        realisticWinRate: round(simulation.realisticWinRate, 2),
        realisticProfitFactor: round(simulation.realisticProfitFactor, 2),
      },
      scores,
      regimeStats,
      sensitivityTests,
    };
    summary.coachNotes = buildCoach(summary, regimeStats, sensitivityTests);

    const evaluationId = this.persistEvaluation(strategy.id, summary);

    return {
      id: evaluationId,
      strategyId: strategy.id,
      ...summary,
      equityCurve: simulation.equityCurve,
      trades: simulation.trades,
    };
  }

  runSensitivityTests(strategy, candles, simulationConfig) {
    const tests = [];
    const baseIndicator = getPrimaryIndicatorConfig(strategy.indicators);
    const risk = buildRiskManagement(strategy);

    const variants = [
      { paramName: 'stopLossPct', paramValue: round(risk.stopLoss * 0.8, 4), overrides: { rules: { risk: { stopLossPct: risk.stopLoss * 0.8 } } } },
      { paramName: 'stopLossPct', paramValue: round(risk.stopLoss * 1.2, 4), overrides: { rules: { risk: { stopLossPct: risk.stopLoss * 1.2 } } } },
      { paramName: 'takeProfitPct', paramValue: round(risk.takeProfit * 0.8, 4), overrides: { rules: { risk: { takeProfitPct: risk.takeProfit * 0.8 } } } },
      { paramName: 'takeProfitPct', paramValue: round(risk.takeProfit * 1.2, 4), overrides: { rules: { risk: { takeProfitPct: risk.takeProfit * 1.2 } } } },
    ];

    if (baseIndicator) {
      variants.push(
        {
          paramName: `${baseIndicator.key}.${baseIndicator.field}`,
          paramValue: Math.max(2, Math.round(baseIndicator.value * 0.8)),
          overrides: {
            indicators: {
              [baseIndicator.key]: {
                ...strategy.indicators[baseIndicator.key],
                [baseIndicator.field]: Math.max(2, Math.round(baseIndicator.value * 0.8)),
              },
            },
          },
        },
        {
          paramName: `${baseIndicator.key}.${baseIndicator.field}`,
          paramValue: Math.max(2, Math.round(baseIndicator.value * 1.2)),
          overrides: {
            indicators: {
              [baseIndicator.key]: {
                ...strategy.indicators[baseIndicator.key],
                [baseIndicator.field]: Math.max(2, Math.round(baseIndicator.value * 1.2)),
              },
            },
          },
        },
      );
    }

    for (const variant of variants) {
      const candidate = cloneWithOverrides(strategy, variant.overrides);
      const simulation = backtester.runStrategySimulation({
        strategy: compileStrategyRuntime(candidate),
        candles,
        ...simulationConfig,
      });

      tests.push({
        paramName: variant.paramName,
        paramValue: String(variant.paramValue),
        netProfit: round(simulation.netProfit, 2),
        profitFactor: Number.isFinite(simulation.profitFactor) ? round(simulation.profitFactor, 2) : 99,
        maxDrawdown: round(simulation.maxDrawdown, 2),
        sharpeRatio: round(simulation.sharpeRatio, 2),
      });
    }

    return tests;
  }

  persistEvaluation(strategyId, summary) {
    const db = getDb();
    const insertEvaluation = db.prepare(`
      INSERT INTO strategy_evaluations
      (strategy_id, symbol, timeframe, start_date, end_date, evaluation_type,
       score_total, score_stability, score_portability, score_regime_fit, score_execution_realism, summary_json)
      VALUES (?, ?, ?, ?, ?, 'backtest', ?, ?, ?, ?, ?, ?)
    `);
    const insertRegime = db.prepare(`
      INSERT INTO strategy_regime_stats
      (evaluation_id, regime, trade_count, win_rate, net_profit, profit_factor, max_drawdown)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertParamTest = db.prepare(`
      INSERT INTO strategy_param_tests
      (evaluation_id, param_name, param_value, net_profit, profit_factor, max_drawdown, sharpe_ratio)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertCoachReport = db.prepare(`
      INSERT INTO coach_reports
      (strategy_id, evaluation_id, report_json)
      VALUES (?, ?, ?)
    `);

    const tx = db.transaction(() => {
      const evaluation = insertEvaluation.run(
        strategyId,
        summary.evaluation.symbol,
        summary.evaluation.timeframe,
        summary.evaluation.startDate,
        summary.evaluation.endDate,
        summary.scores.total,
        summary.scores.stability,
        summary.scores.portability,
        summary.scores.regimeFit,
        summary.scores.executionRealism,
        JSON.stringify(summary)
      );

      const evaluationId = Number(evaluation.lastInsertRowid);

      for (const regime of summary.regimeStats) {
        insertRegime.run(
          evaluationId,
          regime.regime,
          regime.tradeCount,
          regime.winRate,
          regime.netProfit,
          regime.profitFactor,
          regime.maxDrawdown
        );
      }

      for (const test of summary.sensitivityTests) {
        insertParamTest.run(
          evaluationId,
          test.paramName,
          test.paramValue,
          test.netProfit,
          test.profitFactor,
          test.maxDrawdown,
          test.sharpeRatio
        );
      }

      insertCoachReport.run(strategyId, evaluationId, JSON.stringify({ notes: summary.coachNotes }));

      return evaluationId;
    });

    return tx();
  }

  listEvaluations(strategyId, limit = 10) {
    const rows = getDb().prepare(`
      SELECT *
      FROM strategy_evaluations
      WHERE strategy_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(strategyId, limit);

    return rows.map((row) => ({
      id: row.id,
      strategyId: row.strategy_id,
      symbol: row.symbol,
      timeframe: row.timeframe,
      startDate: row.start_date,
      endDate: row.end_date,
      scoreTotal: row.score_total,
      scoreStability: row.score_stability,
      scorePortability: row.score_portability,
      scoreRegimeFit: row.score_regime_fit,
      scoreExecutionRealism: row.score_execution_realism,
      createdAt: row.created_at,
      summary: JSON.parse(row.summary_json),
    }));
  }

  getEvaluation(evaluationId) {
    const row = getDb().prepare('SELECT * FROM strategy_evaluations WHERE id = ?').get(evaluationId);
    if (!row) return null;

    return {
      id: row.id,
      strategyId: row.strategy_id,
      symbol: row.symbol,
      timeframe: row.timeframe,
      startDate: row.start_date,
      endDate: row.end_date,
      scoreTotal: row.score_total,
      scoreStability: row.score_stability,
      scorePortability: row.score_portability,
      scoreRegimeFit: row.score_regime_fit,
      scoreExecutionRealism: row.score_execution_realism,
      createdAt: row.created_at,
      summary: JSON.parse(row.summary_json),
    };
  }
}

const strategyAnalyzer = new StrategyAnalyzerService();
export default strategyAnalyzer;
