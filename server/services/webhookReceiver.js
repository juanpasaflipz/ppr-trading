import { getDb } from '../db/database.js';
import tradingEngine from './tradingEngine.js';
import executionRouter from './executionRouter.js';

class WebhookReceiver {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  validateSecret(payload) {
    const secret = process.env.WEBHOOK_SECRET || 'change_this_to_a_secure_random_string';
    return payload.secret === secret;
  }

  parseAlert(raw) {
    let payload;
    if (typeof raw === 'string') {
      try { payload = JSON.parse(raw); } catch { payload = this._parseTextAlert(raw); }
    } else {
      payload = raw;
    }

    return {
      action: payload.action || payload.strategy?.order?.action,
      symbol: (payload.symbol || payload.ticker || '').toUpperCase().replace(/[^A-Z]/g, ''),
      type: payload.type || 'spot',
      orderType: payload.orderType || 'market',
      price: parseFloat(payload.price) || undefined,
      quantity: parseFloat(payload.quantity) || undefined,
      quantityPercent: parseFloat(payload.quantityPercent || payload.qty_pct) || undefined,
      leverage: parseInt(payload.leverage) || 1,
      side: payload.side || undefined,
      takeProfit: parseFloat(payload.takeProfit || payload.tp) || undefined,
      stopLoss: parseFloat(payload.stopLoss || payload.sl) || undefined,
      comment: payload.comment || payload.message || '',
    };
  }

  _parseTextAlert(text) {
    // Support simple text format: "BUY BTCUSDT 0.5"
    const parts = text.trim().split(/\s+/);
    return {
      action: parts[0]?.toLowerCase(),
      symbol: parts[1]?.toUpperCase(),
      quantity: parseFloat(parts[2]) || undefined,
    };
  }

  async processAlert(rawPayload) {
    const db = getDb();

    // Validate secret
    let payload;
    try {
      payload = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;
    } catch {
      payload = rawPayload;
    }

    if (!this.validateSecret(payload)) {
      const alert = this._logAlert(rawPayload, null, null, 'rejected', null, 'Invalid secret');
      return { success: false, error: 'Invalid secret', alert };
    }

    const parsed = this.parseAlert(payload);

    // Validate required fields
    if (!parsed.action || !parsed.symbol) {
      const alert = this._logAlert(rawPayload, parsed.action, parsed.symbol, 'rejected', null, 'Missing action or symbol');
      return { success: false, error: 'Missing action or symbol', alert };
    }

    // Execute the trade
    try {
      let order;

      if (parsed.action === 'close') {
        // Close open position
        const positions = tradingEngine.getOpenPositions().filter(p => p.symbol === parsed.symbol);
        if (positions.length === 0) {
          throw new Error(`No open position for ${parsed.symbol}`);
        }
        const result = tradingEngine.closePosition(positions[0].id);
        const alert = this._logAlert(rawPayload, parsed.action, parsed.symbol, 'executed', null, null);
        return { success: true, result, alert };
      }

      const side = parsed.action === 'buy' ? 'buy' : 'sell';

      order = await executionRouter.routeOrder({
        symbol: parsed.symbol,
        side,
        type: parsed.orderType,
        marketType: parsed.type,
        price: parsed.price,
        quantity: parsed.quantity,
        quantityPercent: parsed.quantityPercent || (parsed.quantity ? undefined : 5),
        leverage: parsed.leverage,
        takeProfit: parsed.takeProfit,
        stopLoss: parsed.stopLoss,
        source: 'webhook',
      });

      const alert = this._logAlert(rawPayload, parsed.action, parsed.symbol, 'executed', order.id, null);
      return { success: true, order, alert };
    } catch (err) {
      const alert = this._logAlert(rawPayload, parsed.action, parsed.symbol, 'error', null, err.message);
      return { success: false, error: err.message, alert };
    }
  }

  _logAlert(rawPayload, action, symbol, status, orderId, errorMessage) {
    const db = getDb();
    const raw = typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload);
    const result = db.prepare(`
      INSERT INTO alerts (raw_payload, parsed_action, symbol, status, order_id, error_message)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(raw, action, symbol, status, orderId, errorMessage);
    return db.prepare('SELECT * FROM alerts WHERE id = ?').get(result.lastInsertRowid);
  }

  getAlertHistory(limit = 100) {
    const db = getDb();
    return db.prepare('SELECT * FROM alerts ORDER BY received_at DESC LIMIT ?').all(limit);
  }
}

const webhookReceiver = new WebhookReceiver();
export default webhookReceiver;
