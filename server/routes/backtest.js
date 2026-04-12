import { Router } from 'express';
import backtester from '../services/backtester.js';

const router = Router();

router.get('/strategies', (req, res) => {
  res.json(backtester.getStrategies());
});

router.post('/', async (req, res) => {
  try {
    const result = await backtester.runBacktest(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/results', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const results = backtester.getResults(limit);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/results/:id', (req, res) => {
  try {
    const result = backtester.getResult(parseInt(req.params.id));
    if (!result) return res.status(404).json({ error: 'Result not found' });
    // Parse JSON fields
    if (result.equity_curve) result.equity_curve = JSON.parse(result.equity_curve);
    if (result.config) result.config = JSON.parse(result.config);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
