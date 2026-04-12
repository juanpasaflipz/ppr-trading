import { getDb } from '../db/database.js';
import tradingEngine from './tradingEngine.js';

class ExecutionRouter {
  getMode() {
    return process.env.TRADING_MODE || 'paper';
  }

  isLive() {
    return this.getMode() === 'live';
  }

  async routeOrder(params) {
    if (this.isLive()) {
      return this._executeLive(params);
    }
    return tradingEngine.placeOrder(params);
  }

  async _executeLive(params) {
    // Live trading via Binance API
    // This is a placeholder — requires actual Binance order API integration
    // Only activated when TRADING_MODE=live
    throw new Error('Live trading not yet implemented. Switch to paper mode.');
  }

  async switchMode(newMode, confirmation) {
    const db = getDb();

    if (newMode !== 'paper' && newMode !== 'live') {
      throw new Error('Invalid mode. Use "paper" or "live".');
    }

    if (newMode === 'live') {
      if (confirmation !== 'I_UNDERSTAND_REAL_MONEY') {
        throw new Error('Live mode requires confirmation string: "I_UNDERSTAND_REAL_MONEY"');
      }

      // Safety checks
      if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_API_SECRET) {
        throw new Error('Binance API keys not configured');
      }

      // Check minimum trading history
      const tradeCount = db.prepare('SELECT COUNT(*) as count FROM trades').get().count;
      if (tradeCount < 50) {
        throw new Error(`Minimum 50 paper trades required before live mode. Current: ${tradeCount}`);
      }
    }

    const oldMode = this.getMode();
    process.env.TRADING_MODE = newMode;
    db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('trading_mode', ?)").run(newMode);

    db.prepare('INSERT INTO audit_log (event, details) VALUES (?, ?)').run(
      'mode_switch',
      JSON.stringify({ from: oldMode, to: newMode, timestamp: new Date().toISOString() })
    );

    return { previousMode: oldMode, currentMode: newMode };
  }

  getAuditLog(limit = 50) {
    const db = getDb();
    return db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?').all(limit);
  }
}

const executionRouter = new ExecutionRouter();
export default executionRouter;
