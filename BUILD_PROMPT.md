# PPR-Trading: Full Build Prompt for Claude Code Agent

## Overview

Build a full-stack crypto paper trading platform called **PaperTrade Pro** that connects to real Binance market data, receives TradingView alerts as trade signals, includes a strategy discovery/backtesting engine, and has a clear path to switch from paper to live trading with a single config toggle.

The user is Juan (juan@injupe.com). He wants a realistic, professional-grade platform — think Binance or Coinbase Pro — with $100,000 starting virtual capital. This is NOT a toy demo. It should feel like a real exchange.

---

## Existing Project State

There is an existing React + Vite + Tailwind project scaffolded at the root of this repo:
- `package.json` — has react, recharts, lucide-react, lodash, tailwind, vite
- `CryptoTrader.jsx` — an earlier UI prototype (can be used for reference or replaced)
- `src/main.jsx`, `src/index.css` — entry points
- `index.html` — Vite entry HTML
- `vite.config.js`, `tailwind.config.js`, `postcss.config.js` — build config

You should build on top of this foundation, extending it significantly.

---

## Architecture

Build this as a **monorepo with two main parts**:

### 1. Backend (Node.js / Express)
Located in `/server`

### 2. Frontend (React + Vite + Tailwind)
Located in root `/` (already scaffolded)

Use **SQLite** (via `better-sqlite3`) for persistence — no external database needed. Store it in `/data/ppr-trading.db`.

---

## Module-by-Module Specification

### MODULE 1: Binance Data Layer (`/server/services/binance.js`)

Connect to Binance using the `binance` npm package (or raw WebSocket/REST API).

**Requirements:**
- Real-time price feeds via Binance WebSocket streams (ticker, kline/candlestick, depth)
- REST API for historical candlestick data (for backtesting)
- Support all major crypto pairs (BTC/USDT, ETH/USDT, SOL/USDT, etc.)
- Order book depth data for realistic fill simulation
- API key configuration via `.env` file:
  ```
  BINANCE_API_KEY=your_key_here
  BINANCE_API_SECRET=your_secret_here
  TRADING_MODE=paper  # paper | live
  ```
- When `TRADING_MODE=paper`, API keys are used read-only (market data only)
- When `TRADING_MODE=live`, API keys are used for actual order execution
- Rate limiting and error handling with exponential backoff
- Connection health monitoring and auto-reconnect for WebSockets

### MODULE 2: Paper Trading Engine (`/server/services/tradingEngine.js`)

The core simulation engine. Must be realistic.

**Portfolio Management:**
- Starting balance: $100,000 USDT
- Track balances per asset (like a real exchange wallet)
- Separate spot wallet and futures wallet
- Transfer between wallets
- Real-time portfolio valuation using live Binance prices

**Spot Trading:**
- Market orders: fill at current best ask/bid from order book
- Limit orders: queue and fill when price crosses the limit
- Stop-loss and take-profit orders
- Partial fills simulation based on order book depth
- Trading fees: configurable, default 0.1% maker / 0.1% taker (Binance standard)
- Order statuses: pending, partial, filled, cancelled

**Futures Trading:**
- USDT-margined perpetual futures
- Leverage: 1x to 125x (configurable per position)
- Long and short positions
- Cross and isolated margin modes
- Liquidation price calculation and automatic liquidation
- Funding rate simulation (fetch real Binance funding rates)
- Mark price vs last price
- Unrealized and realized PnL tracking
- ADL (Auto-Deleveraging) simulation

**Order Types (both spot and futures):**
- Market
- Limit
- Stop-limit
- Stop-market
- Trailing stop
- Take-profit
- Take-profit limit
- OCO (One-Cancels-Other)

**Risk Management:**
- Position size limits
- Max leverage limits
- Daily loss limits (configurable)
- Margin ratio monitoring
- Liquidation warnings

### MODULE 3: TradingView Webhook Receiver (`/server/services/webhookReceiver.js`)

An Express endpoint that receives TradingView alert webhooks and converts them into trades.

**Webhook Endpoint:** `POST /api/webhook/tradingview`

**Expected Alert Payload Format:**
```json
{
  "secret": "user_defined_secret_key",
  "action": "buy" | "sell" | "close",
  "symbol": "BTCUSDT",
  "type": "spot" | "futures",
  "orderType": "market" | "limit",
  "price": 65000,          // for limit orders
  "quantity": 0.5,          // absolute quantity
  "quantityPercent": 10,    // OR percentage of portfolio
  "leverage": 10,           // for futures
  "side": "long" | "short", // for futures
  "takeProfit": 70000,      // optional
  "stopLoss": 60000,        // optional
  "comment": "SuperTrend signal"
}
```

**Requirements:**
- Secret key validation (defined in `.env`)
- Parse and validate incoming alerts
- Convert alerts to trading engine orders
- Log all received alerts with timestamps
- Support for multiple alert formats (flexible parsing)
- Queue system for high-frequency alerts
- Response with trade confirmation or error
- Alert history viewable in dashboard

### MODULE 4: Strategy Discovery & Scraper (`/server/services/strategyDiscovery.js`)

Fetch and rank profitable trading strategies from TradingView's community.

**Requirements:**
- Use the `tradingview-scraper` Python package (run via child_process or rewrite in Node)
  - OR scrape TradingView's community scripts pages directly
- Fetch strategies filtered by:
  - Asset class: crypto
  - Sort by: most liked, most popular, most recent, editors' picks
  - Filter by: strategy type (trend-following, mean-reversion, scalping, swing)
- Extract for each strategy:
  - Name, author, description
  - Backtest metrics (if available): win rate, profit factor, max drawdown, net profit %
  - Pine Script source code (if open-source)
  - Likes, comments, views
  - TradingView URL
- Store discovered strategies in SQLite database
- Rank strategies by a composite score:
  - `score = (win_rate * 0.3) + (profit_factor * 0.25) + (1 - max_drawdown) * 0.25 + (log(likes) * 0.2)`
- Periodic refresh (daily cron or manual trigger)
- Strategy detail page with full metrics

**Pre-seed with known good strategies:**
- Smart Money Concepts (SMC) — market structure + order blocks
- SuperTrend + WaveTrend combo
- Bollinger Band squeeze breakouts
- Multi-band comparison (Bollinger + Quantile + Power-Law)
- RSI + MACD confluence
- Ichimoku Cloud crypto adaptation
- VWAP + volume profile

### MODULE 5: Backtesting Engine (`/server/services/backtester.js`)

Run strategies against historical Binance data.

**Requirements:**
- Fetch historical candlestick data from Binance REST API
- Configurable timeframes: 1m, 5m, 15m, 1h, 4h, 1d
- Configurable date range
- Simulate trades with realistic conditions:
  - Slippage modeling (configurable, default 0.05%)
  - Fee deduction
  - Partial fill simulation
- Built-in technical indicators (use `technicalindicators` npm package):
  - RSI, MACD, Bollinger Bands, SuperTrend, EMA, SMA, ATR, OBV, VWAP, Ichimoku
- Strategy definition format (JavaScript-based):
  ```javascript
  {
    name: "RSI Oversold Bounce",
    description: "Buy when RSI < 30, sell when RSI > 70",
    timeframe: "1h",
    indicators: { rsi: { period: 14 } },
    entry: (candle, indicators) => indicators.rsi < 30,
    exit: (candle, indicators) => indicators.rsi > 70,
    riskManagement: { stopLoss: 0.02, takeProfit: 0.05 }
  }
  ```
- Output metrics:
  - Total trades, win rate, loss rate
  - Net profit/loss ($ and %)
  - Profit factor
  - Max drawdown ($ and %)
  - Sharpe ratio
  - Sortino ratio
  - Average win vs average loss
  - Longest winning/losing streak
  - Equity curve data points
  - **Realistic estimate column** (multiply results by 0.65 to simulate live degradation)
- Save backtest results to database
- Compare multiple strategies side-by-side

### MODULE 6: Web Dashboard (React Frontend)

A professional, dark-themed trading dashboard. Think Binance Pro / Bybit.

**Layout:**
- Top bar: logo, balance overview, paper/live mode indicator, settings
- Main content: tabbed interface

**Pages/Tabs:**

#### 6a. Trading Terminal
- **TradingView chart widget** (use TradingView's free lightweight-charts library or embed widget)
- **Order entry panel** (right side):
  - Market / Limit / Stop-Limit tabs
  - Buy/Sell (spot) or Long/Short (futures)
  - Quantity input (absolute or % of balance)
  - Leverage slider (futures)
  - Take profit / Stop loss inputs
  - Order preview with estimated fees
- **Order book** (depth visualization)
- **Recent trades** feed
- **Open orders** table with cancel buttons
- **Position panel** (futures): entry price, mark price, liq price, PnL, margin, close button

#### 6b. Portfolio
- Total portfolio value with 24h change
- Asset allocation pie chart
- Holdings table: asset, quantity, avg buy price, current price, PnL, % of portfolio
- Spot vs futures wallet balances
- Deposit/withdraw simulation (add/remove virtual funds)
- Portfolio value history chart (line graph)

#### 6c. Trade History
- Filterable table of all executed trades
- Columns: date, pair, type (spot/futures), side, price, quantity, fee, PnL
- Export to CSV
- Daily/weekly/monthly PnL summary

#### 6d. Strategy Discovery
- Grid/list of discovered strategies from TradingView
- Each card: name, author, score, win rate, profit factor, max drawdown
- Click to view full details + Pine Script code
- "Backtest This" button → runs against selected pair + timeframe
- "Set Up Alert" button → shows TradingView alert setup instructions
- Filter by: type, min win rate, min profit factor, max drawdown
- Sort by: composite score, win rate, newest

#### 6e. Backtesting
- Strategy selector (from library or custom)
- Pair selector, timeframe selector, date range picker
- Run backtest button
- Results dashboard:
  - All metrics listed in Module 5
  - Equity curve chart
  - Drawdown chart
  - Trade markers on price chart
  - Side-by-side comparison mode
  - Raw backtest vs "Realistic Estimate" toggle

#### 6f. Alerts & Webhooks
- Webhook URL display with copy button
- Secret key management
- Alert log: all received TradingView alerts with status (executed, rejected, error)
- Test alert button (sends a mock alert)
- Alert format documentation / cheat sheet

#### 6g. Settings
- **Trading Mode Toggle**: Paper ↔ Live (with confirmation dialog and big warning)
- Starting balance configuration
- Fee rates (maker/taker)
- Default leverage
- Slippage settings
- Binance API key management (enter/update keys)
- Webhook secret key
- Risk management settings (max position size, daily loss limit)
- Theme (dark/light)
- Notifications preferences

**UI/UX Requirements:**
- Dark theme by default (Binance-style dark grays + accent colors)
- Green for profit/buy, Red for loss/sell
- Real-time updates via WebSocket (no polling)
- Responsive (desktop-first, but usable on tablet)
- Loading states, error states, empty states
- Toast notifications for order fills, alerts received, liquidations
- Keyboard shortcuts for quick trading (B = buy, S = sell, Esc = cancel)

### MODULE 7: Paper → Live Toggle (`/server/services/executionRouter.js`)

**Requirements:**
- Single `TRADING_MODE` env variable controls everything
- When `paper`: all orders go through paper trading engine
- When `live`: all orders go through Binance API
- Shared interface — both modes use the same order format
- Safety checks before enabling live mode:
  - Require explicit confirmation
  - Show warning about real money
  - Validate API keys have correct permissions
  - Optional: require minimum paper trading history (e.g., 50 trades)
- Audit log of mode switches

---

## API Routes (`/server/routes/`)

```
GET    /api/health                     — Health check
GET    /api/config                     — Current config (mode, fees, etc.)
PUT    /api/config                     — Update config

GET    /api/market/pairs               — Available trading pairs
GET    /api/market/ticker/:symbol      — Current price
GET    /api/market/orderbook/:symbol   — Order book depth
GET    /api/market/candles/:symbol     — Historical candles
WS     /ws/market                      — Real-time price stream

GET    /api/portfolio                  — Full portfolio overview
GET    /api/portfolio/history          — Portfolio value history
POST   /api/portfolio/transfer         — Transfer between wallets

POST   /api/orders                     — Place order
GET    /api/orders                     — List open orders
GET    /api/orders/history             — Order history
DELETE /api/orders/:id                 — Cancel order

GET    /api/positions                  — Open futures positions
POST   /api/positions/:id/close       — Close position
PUT    /api/positions/:id/leverage    — Adjust leverage
PUT    /api/positions/:id/margin      — Adjust margin

POST   /api/webhook/tradingview        — TradingView webhook endpoint
GET    /api/webhook/alerts             — Alert history

GET    /api/strategies                 — Discovered strategies
POST   /api/strategies/refresh         — Trigger strategy refresh
GET    /api/strategies/:id             — Strategy detail

POST   /api/backtest                   — Run backtest
GET    /api/backtest/results           — List past results
GET    /api/backtest/results/:id       — Specific result

GET    /api/trades                     — Trade history
GET    /api/trades/summary             — PnL summary
GET    /api/trades/export              — Export CSV
```

---

## Database Schema (SQLite)

```sql
-- Portfolio
CREATE TABLE wallets (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL, -- 'spot' | 'futures'
  asset TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  locked REAL NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Orders
CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  client_order_id TEXT UNIQUE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL, -- 'buy' | 'sell'
  type TEXT NOT NULL, -- 'market' | 'limit' | 'stop_limit' | etc.
  market_type TEXT NOT NULL, -- 'spot' | 'futures'
  price REAL,
  stop_price REAL,
  quantity REAL NOT NULL,
  filled_quantity REAL DEFAULT 0,
  status TEXT NOT NULL, -- 'pending' | 'partial' | 'filled' | 'cancelled'
  leverage INTEGER DEFAULT 1,
  take_profit REAL,
  stop_loss REAL,
  fee REAL DEFAULT 0,
  source TEXT DEFAULT 'manual', -- 'manual' | 'webhook' | 'backtest'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Futures Positions
CREATE TABLE positions (
  id INTEGER PRIMARY KEY,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL, -- 'long' | 'short'
  entry_price REAL NOT NULL,
  quantity REAL NOT NULL,
  leverage INTEGER NOT NULL,
  margin_type TEXT DEFAULT 'isolated', -- 'isolated' | 'cross'
  margin REAL NOT NULL,
  liquidation_price REAL,
  unrealized_pnl REAL DEFAULT 0,
  realized_pnl REAL DEFAULT 0,
  status TEXT DEFAULT 'open', -- 'open' | 'closed' | 'liquidated'
  opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME
);

-- Trade History
CREATE TABLE trades (
  id INTEGER PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  price REAL NOT NULL,
  quantity REAL NOT NULL,
  fee REAL NOT NULL,
  fee_asset TEXT DEFAULT 'USDT',
  realized_pnl REAL DEFAULT 0,
  market_type TEXT NOT NULL,
  executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Portfolio Snapshots (for equity curve)
CREATE TABLE portfolio_snapshots (
  id INTEGER PRIMARY KEY,
  total_value_usdt REAL NOT NULL,
  spot_value REAL NOT NULL,
  futures_value REAL NOT NULL,
  unrealized_pnl REAL DEFAULT 0,
  snapshot_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- TradingView Alerts
CREATE TABLE alerts (
  id INTEGER PRIMARY KEY,
  raw_payload TEXT NOT NULL,
  parsed_action TEXT,
  symbol TEXT,
  status TEXT NOT NULL, -- 'executed' | 'rejected' | 'error'
  order_id INTEGER REFERENCES orders(id),
  error_message TEXT,
  received_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Discovered Strategies
CREATE TABLE strategies (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  author TEXT,
  description TEXT,
  source_url TEXT,
  pine_script TEXT,
  strategy_type TEXT, -- 'trend' | 'mean_reversion' | 'scalping' | 'swing'
  win_rate REAL,
  profit_factor REAL,
  max_drawdown REAL,
  net_profit_pct REAL,
  likes INTEGER DEFAULT 0,
  composite_score REAL,
  discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Backtest Results
CREATE TABLE backtest_results (
  id INTEGER PRIMARY KEY,
  strategy_id INTEGER REFERENCES strategies(id),
  strategy_name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  total_trades INTEGER,
  win_rate REAL,
  net_profit REAL,
  net_profit_pct REAL,
  profit_factor REAL,
  max_drawdown REAL,
  max_drawdown_pct REAL,
  sharpe_ratio REAL,
  sortino_ratio REAL,
  avg_win REAL,
  avg_loss REAL,
  longest_win_streak INTEGER,
  longest_loss_streak INTEGER,
  equity_curve TEXT, -- JSON array of data points
  realistic_net_profit REAL, -- net_profit * 0.65
  realistic_win_rate REAL,   -- adjusted
  config TEXT, -- JSON of backtest parameters
  ran_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Config
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Audit Log
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  event TEXT NOT NULL,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## Tech Stack Summary

**Backend:**
- Node.js + Express
- SQLite via `better-sqlite3`
- `ws` for WebSocket server
- Binance API: `binance` npm package or raw REST/WS
- `technicalindicators` for backtest indicators
- `node-cron` for scheduled tasks
- `dotenv` for environment config

**Frontend:**
- React 18 + Vite
- Tailwind CSS (dark theme)
- Recharts (charts/graphs)
- Lucide React (icons)
- `lightweight-charts` by TradingView (candlestick charts)
- WebSocket client for real-time updates

**Dev:**
- Concurrently (run frontend + backend together)
- `npm run dev` should start both

---

## .env Template

```env
# Binance
BINANCE_API_KEY=
BINANCE_API_SECRET=

# Trading
TRADING_MODE=paper
STARTING_BALANCE=100000
MAKER_FEE=0.001
TAKER_FEE=0.001
DEFAULT_LEVERAGE=1
SLIPPAGE=0.0005

# Webhook
WEBHOOK_SECRET=change_this_to_a_secure_random_string
WEBHOOK_PORT=3001

# Server
PORT=3001
FRONTEND_URL=http://localhost:5173

# Backtesting
BACKTEST_DEFAULT_TIMEFRAME=1h
LIVE_DEGRADATION_FACTOR=0.65
```

---

## Build Order (Recommended)

1. **Set up project structure** — `/server` directory, install backend deps, configure scripts
2. **Database setup** — SQLite schema, migration script, seed config
3. **Binance data service** — REST + WebSocket connections, price feeds
4. **Trading engine** — Order management, portfolio tracking, fills simulation
5. **Futures engine** — Leverage, liquidation, margin, funding rates
6. **API routes** — All REST endpoints + WebSocket server
7. **Webhook receiver** — TradingView alert parsing and execution
8. **Backtesting engine** — Historical data, indicators, strategy runner, metrics
9. **Strategy discovery** — Scraper/fetcher, ranking, storage
10. **Frontend: Trading terminal** — Charts, order entry, order book, positions
11. **Frontend: Portfolio** — Balances, holdings, allocation, history
12. **Frontend: Trade history** — Table, filters, export, PnL summary
13. **Frontend: Strategy discovery** — Browse, detail view, backtest trigger
14. **Frontend: Backtesting** — Config, results, equity curve, comparison
15. **Frontend: Alerts & Webhooks** — Log, test, documentation
16. **Frontend: Settings** — All configuration, paper/live toggle
17. **Integration testing** — End-to-end flows, WebSocket stability
18. **Paper → Live router** — Execution routing, safety checks, audit log

---

## Critical Notes

- **NEVER execute live trades unless `TRADING_MODE=live` AND the user explicitly confirms.** Default must always be paper.
- All prices must come from real Binance data. No fake/random prices.
- Futures liquidation math must be accurate — this is how Juan will learn risk management.
- The webhook must be secure — validate the secret on every request.
- Backtest results must include the "realistic estimate" (65% of raw results) prominently.
- The UI must feel professional. No placeholder UI. Dark theme, clean typography, proper spacing.
- Handle WebSocket disconnections gracefully — auto-reconnect with exponential backoff.
- Snapshot portfolio value every 5 minutes for the equity curve.
- All monetary values displayed with proper formatting (commas, 2 decimal places for USD, 8 for BTC).

---

## Getting Started Command

After building, the user should be able to:

```bash
cp .env.example .env
# Edit .env with Binance API keys
npm install
npm run dev
# Opens at http://localhost:5173
```

That's it. One command to run everything.
