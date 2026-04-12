import { Router } from 'express';
import tradingEngine from '../services/tradingEngine.js';

const router = Router();

router.get('/', (req, res) => {
  try {
    const trades = tradingEngine.getTradeHistory(req.query);
    res.json(trades);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/summary', (req, res) => {
  try {
    const summary = tradingEngine.getTradeSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/export', (req, res) => {
  try {
    const trades = tradingEngine.getTradeHistory({ limit: 10000 });
    const headers = 'Date,Symbol,Side,Price,Quantity,Fee,PnL,Type\n';
    const csv = trades.map(t =>
      `${t.executed_at},${t.symbol},${t.side},${t.price},${t.quantity},${t.fee},${t.realized_pnl},${t.market_type}`
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=trades.csv');
    res.send(headers + csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
