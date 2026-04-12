import { Router } from 'express';
import strategyDiscovery from '../services/strategyDiscovery.js';

const router = Router();

router.get('/', (req, res) => {
  try {
    const strategies = strategyDiscovery.getStrategies(req.query);
    res.json(strategies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const strategy = strategyDiscovery.getStrategy(parseInt(req.params.id));
    if (!strategy) return res.status(404).json({ error: 'Strategy not found' });
    res.json(strategy);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const result = await strategyDiscovery.refreshStrategies();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
