import { getDb } from '../db/database.js';
import strategyRegistry from './strategyRegistry.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

const TIMEFRAME_BUCKETS = {
  scalping: ['1m', '5m', '15m'],
  intraday: ['15m', '1h'],
  swing: ['4h', '1d'],
};

const RISK_TARGETS = {
  conservative: { maxDrawdownPct: 12, minStability: 55, minExecution: 55 },
  balanced: { maxDrawdownPct: 20, minStability: 45, minExecution: 45 },
  aggressive: { maxDrawdownPct: 30, minStability: 35, minExecution: 35 },
};

function timeframeMatchScore(preference, preferredTimeframes = []) {
  const accepted = TIMEFRAME_BUCKETS[preference] || [];
  if (!accepted.length || !preferredTimeframes.length) return 40;
  return preferredTimeframes.some((timeframe) => accepted.includes(timeframe)) ? 100 : 35;
}

function styleScore(style, objective) {
  if (!objective) return 60;
  if (objective === 'consistency') {
    return ['mean_reversion', 'swing', 'trend'].includes(style) ? 90 : 55;
  }
  if (objective === 'higher_return') {
    return ['breakout', 'trend', 'market_structure'].includes(style) ? 90 : 60;
  }
  if (objective === 'low_drawdown') {
    return ['mean_reversion', 'swing'].includes(style) ? 90 : 55;
  }
  return 60;
}

function estimateFallbackMetrics(strategy) {
  const risk = strategy.rules?.risk || {};
  const stopLossPct = Number(risk.stopLossPct || 0.02) * 100;
  const takeProfitPct = Number(risk.takeProfitPct || 0.05) * 100;
  const timeframe = strategy.market?.preferredTimeframes?.[0] || '1h';

  return {
    netProfit: 0,
    profitFactor: 1.2,
    winRate: 50,
    maxDrawdownPct: round(clamp(stopLossPct * 4.5, 6, 28), 1),
    stability: round(clamp(78 - stopLossPct * 10, 35, 75), 1),
    executionRealism: round(clamp(72 - (timeframe === '5m' ? 20 : timeframe === '15m' ? 12 : timeframe === '1h' ? 5 : 0), 35, 75), 1),
    totalScore: 50,
  };
}

function buildVariant(strategy, profile, baseSummary) {
  const risk = strategy.rules?.risk || { stopLossPct: 0.02, takeProfitPct: 0.05 };
  const currentStop = Number(risk.stopLossPct || 0.02);
  const currentTake = Number(risk.takeProfitPct || 0.05);
  const currentTimeframe = strategy.market?.preferredTimeframes?.[0] || '1h';

  if (profile.riskLevel === 'conservative') {
    return {
      title: `Safer ${strategy.name}`,
      summary: 'Reduce volatility and trade frequency by widening confirmation and lowering risk per trade.',
      changes: [
        `Widen stop from ${(currentStop * 100).toFixed(1)}% to ${Math.min(currentStop * 1.15, 0.04) * 100}%`,
        `Trim take profit from ${(currentTake * 100).toFixed(1)}% to ${Math.max(currentTake * 0.9, currentStop * 1.8) * 100}%`,
        currentTimeframe === '1h' || currentTimeframe === '15m' ? 'Move one step slower in timeframe to reduce noise.' : 'Keep the current timeframe and tighten entry confirmation.',
      ],
      rationale: baseSummary
        ? `Base strategy drawdown is ${baseSummary.metrics.maxDrawdownPct.toFixed(1)}%, so the variant tilts toward smoother equity.`
        : 'This variant prioritizes smoother behavior over upside.',
    };
  }

  if (profile.riskLevel === 'aggressive') {
    return {
      title: `Higher-beta ${strategy.name}`,
      summary: 'Lean into the edge by accepting wider swings and faster entries.',
      changes: [
        `Keep stop near ${(currentStop * 100).toFixed(1)}% but extend take profit toward ${Math.max(currentTake * 1.2, currentStop * 2.8) * 100}%`,
        'Allow more momentum-following entries before mean reversion exits.',
        profile.timeframePreference === 'scalping' ? 'Run on faster timeframes only if slippage remains acceptable.' : 'Test the same logic on the next faster timeframe.',
      ],
      rationale: baseSummary
        ? `Base profit factor is ${baseSummary.metrics.profitFactor.toFixed(2)}, so the variant pushes for larger winners.`
        : 'This variant prioritizes upside over smoothness.',
    };
  }

  return {
    title: `Balanced ${strategy.name}`,
    summary: 'Keep the core edge but adapt risk settings to the requested timeframe and consistency target.',
    changes: [
      `Anchor stop near ${(currentStop * 100).toFixed(1)}% and target at least ${(Math.max(currentTake, currentStop * 2.2) * 100).toFixed(1)}%`,
      'Require confirmation from the primary trend filter before entry.',
      'Prefer symbols and timeframes where the strategy already shows portability.',
    ],
    rationale: baseSummary
      ? `Base stability is ${baseSummary.scores.stability.toFixed(1)}, so the variant tries to preserve it while improving fit.`
      : 'This variant aims for a middle ground between drawdown and upside.',
  };
}

function getLatestEvaluationSummary(strategyId) {
  const row = getDb().prepare(`
    SELECT summary_json, created_at
    FROM strategy_evaluations
    WHERE strategy_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(strategyId);

  if (!row) return null;

  return {
    createdAt: row.created_at,
    ...JSON.parse(row.summary_json),
  };
}

function buildRationale(parts) {
  return parts.filter(Boolean).join(' ');
}

class StrategyRecommenderService {
  scoreStrategy(strategy, profile = {}) {
    const riskLevel = profile.riskLevel || 'balanced';
    const timeframePreference = profile.timeframePreference || 'intraday';
    const objective = profile.objective || 'consistency';
    const targets = RISK_TARGETS[riskLevel] || RISK_TARGETS.balanced;
    const summary = getLatestEvaluationSummary(strategy.id);
    const metrics = summary
      ? {
          netProfit: summary.metrics.netProfit,
          profitFactor: summary.metrics.profitFactor,
          winRate: summary.metrics.winRate,
          maxDrawdownPct: summary.metrics.maxDrawdownPct,
          stability: summary.scores.stability,
          executionRealism: summary.scores.executionRealism,
          totalScore: summary.scores.total,
        }
      : estimateFallbackMetrics(strategy);

    const timeframeScore = timeframeMatchScore(timeframePreference, strategy.market?.preferredTimeframes);
    const drawdownScore = clamp(100 - Math.max(0, metrics.maxDrawdownPct - targets.maxDrawdownPct) * 5, 0, 100);
    const stabilityScore = clamp(metrics.stability + (metrics.stability >= targets.minStability ? 15 : -10), 0, 100);
    const executionScore = clamp(metrics.executionRealism + (metrics.executionRealism >= targets.minExecution ? 10 : -10), 0, 100);
    const objectiveScore = styleScore(strategy.style, objective);
    const score = round(
      metrics.totalScore * 0.3 +
      timeframeScore * 0.2 +
      drawdownScore * 0.2 +
      stabilityScore * 0.15 +
      executionScore * 0.1 +
      objectiveScore * 0.05,
      1
    );

    const rationale = buildRationale([
      timeframeScore >= 90 ? `Timeframe fit is strong for ${timeframePreference} trading.` : `Timeframe fit is weaker for ${timeframePreference} trading.`,
      metrics.maxDrawdownPct <= targets.maxDrawdownPct ? `Drawdown profile fits ${riskLevel} risk.` : `Drawdown profile runs hot for ${riskLevel} risk.`,
      metrics.stability >= targets.minStability ? 'Stability is acceptable.' : 'Stability needs more caution.',
      summary ? `Grounded in the latest analyzer run from ${summary.evaluation.ranAt.slice(0, 10)}.` : 'No analyzer run yet, so this is a heuristic recommendation.',
    ]);

    return {
      strategyId: strategy.id,
      name: strategy.name,
      style: strategy.style,
      directionality: strategy.directionality,
      sourceKind: strategy.sourceKind,
      preferredTimeframes: strategy.market?.preferredTimeframes || [],
      allowedPairs: strategy.market?.allowedPairs || [],
      score,
      basedOnEvaluation: !!summary,
      metrics: {
        totalScore: metrics.totalScore,
        stability: metrics.stability,
        executionRealism: metrics.executionRealism,
        maxDrawdownPct: metrics.maxDrawdownPct,
        profitFactor: metrics.profitFactor,
        winRate: metrics.winRate,
        netProfit: metrics.netProfit,
      },
      rationale,
      proposedVariant: buildVariant(strategy, { riskLevel, timeframePreference, objective }, summary),
    };
  }

  rankStrategiesByProfile(strategies = [], profile = {}) {
    return strategies.map((strategy) => this.scoreStrategy(strategy, profile)).sort((a, b) => b.score - a.score);
  }

  getRecommendations(profile = {}) {
    const strategies = strategyRegistry.listStrategies();
    const ranked = this.rankStrategiesByProfile(strategies, profile);

    return {
      profile: {
        riskLevel: profile.riskLevel || 'balanced',
        timeframePreference: profile.timeframePreference || 'intraday',
        objective: profile.objective || 'consistency',
      },
      recommendations: ranked.slice(0, 5),
    };
  }

  getFamilyRecommendation(strategyId, profile = {}) {
    const family = strategyRegistry.getStrategyFamily(strategyId);
    if (!family) return null;

    const ranked = this.rankStrategiesByProfile(family.members, profile);
    const best = ranked[0] || null;
    const runnerUp = ranked[1] || null;

    const byRisk = {
      conservative: this.rankStrategiesByProfile(family.members, { ...profile, riskLevel: 'conservative' })[0] || null,
      balanced: this.rankStrategiesByProfile(family.members, { ...profile, riskLevel: 'balanced' })[0] || null,
      aggressive: this.rankStrategiesByProfile(family.members, { ...profile, riskLevel: 'aggressive' })[0] || null,
    };

    let summary = 'Only one sibling is available in this family.';
    if (best && runnerUp) {
      const margin = round(best.score - runnerUp.score, 1);
      summary = `${best.name} is the strongest fit for the current profile. It leads ${runnerUp.name} by ${margin} points. ${best.rationale}`;
    } else if (best) {
      summary = `${best.name} is the best fit for the current profile. ${best.rationale}`;
    }

    return {
      profile: {
        riskLevel: profile.riskLevel || 'balanced',
        timeframePreference: profile.timeframePreference || 'intraday',
        objective: profile.objective || 'consistency',
      },
      familyId: family.familyId,
      familyName: family.familyName,
      summary,
      best,
      runnerUp,
      byRisk,
      ranked,
    };
  }
}

const strategyRecommender = new StrategyRecommenderService();
export default strategyRecommender;
