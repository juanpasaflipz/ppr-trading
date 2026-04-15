import { Router } from 'express';
import { getDb } from '../db/database.js';
import executionRouter from '../services/executionRouter.js';
import binanceService from '../services/binance.js';
import openaiService from '../services/openaiService.js';

const router = Router();

router.get('/', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM config').all();
    const config = {};
    for (const row of rows) config[row.key] = row.value;

    res.json({
      ...config,
      trading_mode: executionRouter.getMode(),
      binance_execution_env: executionRouter.getExecutionEnv(),
      binance_live_trading_enabled: process.env.BINANCE_LIVE_TRADING_ENABLED === 'true',
      binance_futures_live_enabled: process.env.BINANCE_FUTURES_LIVE_ENABLED === 'true',
      binance_connected: binanceService.isConnected,
      binance_status: binanceService.getStatus(),
      llm_enabled: openaiService.isConfigured(),
      llm_provider: config.llm_provider || 'openai',
      llm_model: config.llm_model || openaiService.getSettings().defaultModel,
      llm_available_models: openaiService.getSettings().availableModels,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', (req, res) => {
  try {
    const db = getDb();
    const updates = req.body;
    const stmt = db.prepare('INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');

    for (const [key, value] of Object.entries(updates)) {
      if (key === 'trading_mode') {
        const result = executionRouter.switchMode(value, updates.confirmation);
        continue;
      }
      stmt.run(key, String(value));
    }

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
