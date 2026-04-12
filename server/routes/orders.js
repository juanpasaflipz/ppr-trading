import { Router } from 'express';
import tradingEngine from '../services/tradingEngine.js';
import executionRouter from '../services/executionRouter.js';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const order = await executionRouter.routeOrder(req.body);
    res.json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/', (req, res) => {
  try {
    const { marketType } = req.query;
    const orders = tradingEngine.getOpenOrders(marketType);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const orders = tradingEngine.getOrderHistory(limit, offset);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const order = tradingEngine.cancelOrder(parseInt(req.params.id));
    res.json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
