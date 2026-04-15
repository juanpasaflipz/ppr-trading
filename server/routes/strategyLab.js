import { Router } from 'express';
import strategyRegistry from '../services/strategyRegistry.js';
import strategyImportService from '../services/strategyImport.js';
import strategyAnalyzer from '../services/strategyAnalyzer.js';
import strategyRecommender from '../services/strategyRecommender.js';
import strategyLlmService from '../services/strategyLlmService.js';

const router = Router();

router.get('/strategies', (req, res) => {
  try {
    res.json(strategyRegistry.listStrategies(req.query));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/strategies/:id', (req, res) => {
  try {
    const strategy = strategyRegistry.getStrategy(parseInt(req.params.id));
    if (!strategy) return res.status(404).json({ error: 'Strategy not found' });
    res.json(strategy);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/strategies/:id/family', (req, res) => {
  try {
    const family = strategyRegistry.getStrategyFamily(parseInt(req.params.id));
    if (!family) return res.status(404).json({ error: 'Strategy family not found' });
    res.json(family);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/strategies/:id/promote', (req, res) => {
  try {
    const family = strategyRegistry.promoteStrategy(parseInt(req.params.id));
    res.json(family);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/strategies/:id/archive', (req, res) => {
  try {
    const family = strategyRegistry.archiveStrategy(parseInt(req.params.id));
    res.json(family);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/strategies/:id/family/recommendation', (req, res) => {
  try {
    const recommendation = strategyRecommender.getFamilyRecommendation(parseInt(req.params.id), req.body || {});
    if (!recommendation) return res.status(404).json({ error: 'Strategy family not found' });
    res.json(recommendation);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/strategies/:id/evaluations', (req, res) => {
  try {
    const evaluations = strategyAnalyzer.listEvaluations(parseInt(req.params.id), parseInt(req.query.limit) || 10);
    res.json(evaluations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/strategies/:id/evaluate', async (req, res) => {
  try {
    const result = await strategyAnalyzer.evaluateStrategy(parseInt(req.params.id), req.body || {});
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/evaluations/:id', (req, res) => {
  try {
    const evaluation = strategyAnalyzer.getEvaluation(parseInt(req.params.id));
    if (!evaluation) return res.status(404).json({ error: 'Evaluation not found' });
    res.json(evaluation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/recommendations', (req, res) => {
  try {
    const recommendations = strategyRecommender.getRecommendations(req.body || {});
    res.json(recommendations);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/llm/settings', (req, res) => {
  try {
    res.json(strategyLlmService.getSettings());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/llm/proposals', async (req, res) => {
  try {
    const result = await strategyLlmService.generateProposals(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/import/tradingview/normalize', async (req, res) => {
  try {
    const result = await strategyImportService.normalizeTradingView(req.body || {});
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/import/tradingview', async (req, res) => {
  try {
    const result = await strategyImportService.importTradingView(req.body || {});
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/import/tradingview/family', async (req, res) => {
  try {
    const result = await strategyImportService.importTradingViewFamily(req.body || {});
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/strategies/:id/generate-children', async (req, res) => {
  try {
    const result = await strategyImportService.generateNextGenerationVariants({
      ...req.body,
      strategyId: parseInt(req.params.id),
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/import', (req, res) => {
  try {
    const result = strategyImportService.importManual(req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
