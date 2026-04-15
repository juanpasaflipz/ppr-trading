import strategyRecommender from './strategyRecommender.js';
import strategyRegistry from './strategyRegistry.js';
import strategyAnalyzer from './strategyAnalyzer.js';
import openaiService from './openaiService.js';

function compactRecommendation(recommendation) {
  return {
    strategyId: recommendation.strategyId,
    name: recommendation.name,
    style: recommendation.style,
    directionality: recommendation.directionality,
    score: recommendation.score,
    preferredTimeframes: recommendation.preferredTimeframes,
    allowedPairs: recommendation.allowedPairs,
    metrics: recommendation.metrics,
    rationale: recommendation.rationale,
    proposedVariant: recommendation.proposedVariant,
  };
}

class StrategyLlmService {
  getSettings() {
    return openaiService.getSettings();
  }

  async generateProposals(payload = {}) {
    const profile = {
      riskLevel: payload.riskLevel || 'balanced',
      timeframePreference: payload.timeframePreference || 'intraday',
      objective: payload.objective || 'consistency',
    };
    const recommendationResult = strategyRecommender.getRecommendations(profile);
    const topRecommendations = recommendationResult.recommendations.slice(0, 3).map(compactRecommendation);

    const selectedStrategy = payload.strategyId ? strategyRegistry.getStrategy(Number(payload.strategyId)) : null;
    let selectedEvaluation = null;
    if (payload.evaluationId) {
      selectedEvaluation = strategyAnalyzer.getEvaluation(Number(payload.evaluationId));
    }

    const { model, parsed } = await openaiService.createResponse({
      model: payload.model,
      instructions: [
        'You are a trading strategy research assistant.',
        'You must propose strategy ideas grounded only in the supplied recommendation and evaluation data.',
        'Do not claim certainty, future returns, or guaranteed profits.',
        'Prefer adaptations of the top strategies over entirely unrelated inventions.',
        'Return JSON with keys: summary, proposals.',
        'Each item in proposals must include: title, basedOn, fit, why, changes, cautions.',
      ].join(' '),
      input: JSON.stringify({
        task: 'Generate user-facing strategy proposals from deterministic rankings and analysis.',
        profile,
        topRecommendations,
        selectedStrategy,
        selectedEvaluation: selectedEvaluation?.summary || null,
      }),
    });

    return {
      model,
      profile,
      summary: parsed.summary || '',
      proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
      sourceRecommendations: topRecommendations,
    };
  }
}

const strategyLlmService = new StrategyLlmService();
export default strategyLlmService;
