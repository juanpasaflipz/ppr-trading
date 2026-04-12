import { Router } from 'express';
import tradingEngine from '../services/tradingEngine.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const portfolio = await tradingEngine.getPortfolio();
    res.json(portfolio);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 500;
    const history = tradingEngine.getPortfolioHistory(limit);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/transfer', (req, res) => {
  try {
    const { from, to, asset, amount } = req.body;
    const result = tradingEngine.transferBetweenWallets(from, to, asset, parseFloat(amount));
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
