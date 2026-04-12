import { Router } from 'express';
import webhookReceiver from '../services/webhookReceiver.js';

const router = Router();

router.post('/tradingview', async (req, res) => {
  try {
    const result = await webhookReceiver.processAlert(req.body);
    if (result.success) {
      res.json({ success: true, order: result.order, alert: result.alert });
    } else {
      res.status(400).json({ success: false, error: result.error, alert: result.alert });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/alerts', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const alerts = webhookReceiver.getAlertHistory(limit);
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
