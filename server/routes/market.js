import { Router } from 'express';
import binanceService from '../services/binance.js';

const router = Router();

router.get('/pairs', async (req, res) => {
  try {
    const pairs = await binanceService.getAvailablePairs();
    res.json(pairs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/ticker/:symbol', async (req, res) => {
  try {
    const ticker = await binanceService.getTicker(req.params.symbol);
    res.json(ticker);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tickers', async (req, res) => {
  try {
    const tickers = await binanceService.getAllTickers();
    const usdtPairs = tickers.filter(t => t.symbol.endsWith('USDT'));
    res.json(usdtPairs.map(t => ({
      symbol: t.symbol,
      price: parseFloat(t.lastPrice),
      priceChange: parseFloat(t.priceChange),
      priceChangePercent: parseFloat(t.priceChangePercent),
      high: parseFloat(t.highPrice),
      low: parseFloat(t.lowPrice),
      volume: parseFloat(t.volume),
      quoteVolume: parseFloat(t.quoteVolume),
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/orderbook/:symbol', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const book = await binanceService.getOrderBook(req.params.symbol, limit);
    res.json({
      symbol: req.params.symbol,
      bids: book.bids.map(([p, q]) => [parseFloat(p), parseFloat(q)]),
      asks: book.asks.map(([p, q]) => [parseFloat(p), parseFloat(q)]),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/candles/:symbol', async (req, res) => {
  try {
    const { interval = '1h', limit = 500 } = req.query;
    const candles = await binanceService.getCandles(req.params.symbol, interval, parseInt(limit));
    res.json(candles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
