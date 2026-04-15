import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import http from 'http';
import dotenv from 'dotenv';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, '../dist');

// Import services
import { getDb } from './db/database.js';
import binanceService, { DEFAULT_PAIRS } from './services/binance.js';
import tradingEngine from './services/tradingEngine.js';

// Import routes
import marketRoutes from './routes/market.js';
import portfolioRoutes from './routes/portfolio.js';
import orderRoutes from './routes/orders.js';
import positionRoutes from './routes/positions.js';
import tradeRoutes from './routes/trades.js';
import webhookRoutes from './routes/webhook.js';
import strategyRoutes from './routes/strategies.js';
import strategyLabRoutes from './routes/strategyLab.js';
import backtestRoutes from './routes/backtest.js';
import configRoutes from './routes/config.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: process.env.TRADING_MODE || 'paper',
    binance: binanceService.getStatus(),
    uptime: process.uptime(),
  });
});

// Routes
app.use('/api/market', marketRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/positions', positionRoutes);
app.use('/api/trades', tradeRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/strategies', strategyRoutes);
app.use('/api/strategy-lab', strategyLabRoutes);
app.use('/api/backtest', backtestRoutes);
app.use('/api/config', configRoutes);

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(distPath));
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Create HTTP server
const server = http.createServer(app);
let isShuttingDown = false;

// WebSocket server
const wss = new WebSocketServer({ server, path: '/ws/market' });
const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log(`[WS] Client connected (${wsClients.size} total)`);

  // Send initial prices
  const prices = {};
  for (const [symbol, data] of binanceService.prices) {
    prices[symbol] = data.price;
  }
  ws.send(JSON.stringify({ type: 'prices', data: prices }));

  ws.on('close', () => {
    wsClients.delete(ws);
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'subscribe_kline') {
        binanceService.subscribeKline(msg.symbol, msg.interval);
      }
      if (msg.type === 'subscribe_depth') {
        binanceService.subscribeDepth(msg.symbol);
      }
    } catch { /* ignore */ }
  });
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of wsClients) {
    if (ws.readyState === 1) {
      ws.send(msg);
    }
  }
}

function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[Server] Received ${signal}, shutting down...`);
  tradingEngine.stopOrderMonitor();
  binanceService.disconnect();
  wss.close(() => {
    server.close(() => {
      console.log('[Server] Shutdown complete');
      process.exit(0);
    });
  });

  setTimeout(() => {
    console.error('[Server] Forced shutdown after timeout');
    process.exit(1);
  }, 5000).unref();
}

server.on('error', (err) => {
  console.error('[Server] HTTP server error:', err);
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception:', err);
});

// Forward Binance events to WebSocket clients
binanceService.on('ticker', (ticker) => {
  broadcast({ type: 'ticker', data: ticker });
});

binanceService.on('kline', (kline) => {
  broadcast({ type: 'kline', data: kline });
});

binanceService.on('depth', (depth) => {
  broadcast({ type: 'depth', data: depth });
});

// Initialize
async function start() {
  console.log(`[Server] Starting on port ${PORT} in ${(process.env.TRADING_MODE || 'paper').toUpperCase()} mode`);

  // Init database
  getDb();
  console.log('[DB] SQLite initialized');

  // Connect to Binance
  try {
    binanceService.connectPriceStream(DEFAULT_PAIRS);
    console.log('[Binance] Connecting to price stream...');
  } catch (err) {
    console.error('[Binance] Connection failed:', err.message);
    console.log('[Binance] Running without live data — prices will be fetched on demand');
  }

  // Start order monitoring
  tradingEngine.startOrderMonitor();

  // Portfolio snapshot every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      await tradingEngine.takeSnapshot();
    } catch (err) {
      console.error('[Snapshot] Error:', err.message);
    }
  });
  console.log('[Snapshot] Cron scheduled (every 5 minutes)');

  server.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║           PaperTrade Pro — Server                ║
║──────────────────────────────────────────────────║
║  REST API:    http://localhost:${PORT}              ║
║  WebSocket:   ws://localhost:${PORT}/ws/market      ║
║  Mode:        ${(process.env.TRADING_MODE || 'paper').toUpperCase().padEnd(35)}║
║  Webhook:     POST /api/webhook/tradingview      ║
╚══════════════════════════════════════════════════╝
    `);
  });
}

start().catch(console.error);
