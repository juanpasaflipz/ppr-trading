import { Router } from 'express';
import automationService from '../services/automationService.js';
import { getDb } from '../db/database.js';

const router = Router();

router.get('/ema-cross', (req, res) => {
  try {
    res.json(automationService.getStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/ema-cross/start', async (req, res) => {
  try {
    getDb().prepare(`
      INSERT OR REPLACE INTO config (key, value, updated_at)
      VALUES ('live_auto_enabled', 'true', CURRENT_TIMESTAMP)
    `).run();
    const status = await automationService.refresh();
    res.json(status);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/ema-cross/stop', (req, res) => {
  try {
    getDb().prepare(`
      INSERT OR REPLACE INTO config (key, value, updated_at)
      VALUES ('live_auto_enabled', 'false', CURRENT_TIMESTAMP)
    `).run();
    res.json(automationService.stop());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
