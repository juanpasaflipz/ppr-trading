import { Router } from 'express';
import tradingEngine from '../services/tradingEngine.js';
import { getDb } from '../db/database.js';

const router = Router();

router.get('/', (req, res) => {
  try {
    const positions = tradingEngine.getOpenPositions();
    res.json(positions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/close', (req, res) => {
  try {
    const { price } = req.body;
    const result = tradingEngine.closePosition(parseInt(req.params.id), price);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id/leverage', (req, res) => {
  try {
    const db = getDb();
    const { leverage } = req.body;
    const pos = db.prepare('SELECT * FROM positions WHERE id = ?').get(parseInt(req.params.id));
    if (!pos || pos.status !== 'open') {
      return res.status(404).json({ error: 'Position not found' });
    }
    db.prepare('UPDATE positions SET leverage = ? WHERE id = ?').run(leverage, pos.id);
    res.json({ id: pos.id, leverage });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id/margin', (req, res) => {
  try {
    const db = getDb();
    const { amount, action } = req.body; // action: 'add' | 'remove'
    const pos = db.prepare('SELECT * FROM positions WHERE id = ?').get(parseInt(req.params.id));
    if (!pos || pos.status !== 'open') {
      return res.status(404).json({ error: 'Position not found' });
    }

    const delta = action === 'add' ? amount : -amount;
    if (action === 'add') {
      const available = tradingEngine.getBalance('futures', 'USDT');
      if (amount > available) {
        return res.status(400).json({ error: 'Insufficient balance' });
      }
      tradingEngine.lockBalance('futures', 'USDT', amount);
    } else {
      tradingEngine.unlockBalance('futures', 'USDT', amount);
    }

    db.prepare('UPDATE positions SET margin = margin + ? WHERE id = ?').run(delta, pos.id);
    const updated = db.prepare('SELECT * FROM positions WHERE id = ?').get(pos.id);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
