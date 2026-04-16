# PaperTrade Pro

PaperTrade Pro is a full-stack crypto paper trading workspace with:

- a live market dashboard fed by Binance data
- a paper trading engine for spot and futures-style simulation
- TradingView webhook ingestion
- a strategy discovery catalog
- a Strategy Lab for import, evaluation, recommendation, and AI-assisted proposal generation
- a historical backtesting engine

This guide explains how to use every major part of the system, how the pieces fit together, and where the current implementation boundaries are.

## 1. What The System Actually Includes

### Frontend product areas

The app is a single React shell with these tabs:

- `Terminal`
- `Portfolio`
- `History`
- `Strategies`
- `Strategy Lab`
- `Backtest`
- `Alerts`
- `Settings`

Keyboard shortcuts:

- `1` Terminal
- `2` Portfolio
- `3` History
- `4` Strategies
- `5` Strategy Lab
- `6` Backtest
- `7` Alerts
- `8` Settings

### Backend system areas

The Express server exposes:

- REST API under `/api`
- WebSocket market stream under `/ws/market`
- SQLite persistence in `data/ppr-trading.db`
- background order monitoring
- portfolio snapshot cron every 5 minutes

### Core subsystems

- `server/services/binance.js`: public Binance market data, WebSocket ticker/kline/depth feeds
- `server/services/tradingEngine.js`: wallets, spot orders, futures positions, fills, history, snapshots
- `server/services/executionRouter.js`: paper/live mode switch and order routing
- `server/services/webhookReceiver.js`: TradingView alert parsing and execution
- `server/services/strategyDiscovery.js`: strategy catalog and ranking
- `server/services/backtester.js`: historical backtests
- `server/services/strategyRegistry.js`: Strategy Lab strategy store
- `server/services/strategyAnalyzer.js`: Strategy Lab evaluation engine
- `server/services/strategyRecommender.js`: profile-based ranking and family recommendations
- `server/services/strategyImport.js`: TradingView/manual normalization and strategy import
- `server/services/strategyLlmService.js`: OpenAI-backed proposal generation

## 2. Local Setup

### Requirements

- Node.js 18+ is the safe baseline
- npm

### Install

```bash
npm install
```

### Recommended `.env`

Create a `.env` file in the repo root with the values you actually need:

```env
PORT=3001
FRONTEND_URL=http://localhost:5173
TRADING_MODE=paper

DATABASE_PATH=./data/ppr-trading.db
STARTING_BALANCE=100000
MAKER_FEE=0.001
TAKER_FEE=0.001
DEFAULT_LEVERAGE=1
SLIPPAGE=0.0005
LIVE_DEGRADATION_FACTOR=0.65

WEBHOOK_SECRET=change_this_to_a_secure_random_string

BINANCE_EXECUTION_ENV=testnet
BINANCE_TESTNET_API_KEY=
BINANCE_TESTNET_API_SECRET=
BINANCE_LIVE_API_KEY=
BINANCE_LIVE_API_SECRET=
BINANCE_LIVE_TRADING_ENABLED=false
BINANCE_FUTURES_LIVE_ENABLED=false

OPENAI_API_KEY=
OPENAI_DEFAULT_MODEL=gpt-5.4
OPENAI_AVAILABLE_MODELS=gpt-5.4,gpt-5.4-mini,gpt-5.4-nano
```

Notes:

- `BINANCE_EXECUTION_ENV=testnet` enables Binance Spot testnet execution when `TRADING_MODE=live`.
- `BINANCE_TESTNET_API_KEY` and `BINANCE_TESTNET_API_SECRET` are used for Binance Spot testnet.
- `BINANCE_LIVE_API_KEY` and `BINANCE_LIVE_API_SECRET` are used only when `BINANCE_EXECUTION_ENV=live`.
- `BINANCE_LIVE_TRADING_ENABLED=true` is required before real Binance orders are allowed.
- `BINANCE_FUTURES_LIVE_ENABLED=true` is separately required before real USDⓈ-M futures orders are allowed.
- Without execution credentials, the app still uses public Binance data for market feeds and paper trading.
- `OPENAI_API_KEY` is optional. Without it, Strategy Lab still works, but AI proposals and LLM-based normalization fall back to deterministic behavior.

### Initialize the database

```bash
npm run db:setup
```

This seeds:

- config values
- wallet balances
- the original strategy catalog
- Strategy Lab templates

### Run locally

```bash
npm run dev
```

This starts:

- Vite frontend on `http://localhost:5173`
- Node server on `http://localhost:3001`

### Production-ish local run

```bash
npm run build
npm start
```

## 3. System Architecture

### Request flow

1. React UI calls `src/lib/api.js`.
2. Express routes in `server/routes/*.js` delegate to services.
3. Services read/write SQLite and, when needed, hit Binance or OpenAI.
4. Real-time prices, candles, and depth updates are pushed through `/ws/market`.

### Data model

Main SQLite tables:

- `wallets`: spot/futures balances
- `orders`: pending/filled/cancelled orders
- `positions`: open/closed/liquidated futures positions
- `trades`: execution history
- `portfolio_snapshots`: equity history
- `alerts`: webhook history
- `strategies`: original discovery catalog
- `strategies_v2`: Strategy Lab strategies
- `strategy_families`: grouped variants
- `strategy_import_runs`: import lineage
- `strategy_evaluations`: Strategy Lab evaluation results
- `strategy_regime_stats`: regime breakdown per evaluation
- `strategy_param_tests`: sensitivity test rows
- `coach_reports`: generated coaching outputs
- `backtest_results`: backtest history
- `config`: runtime config
- `audit_log`: mode switches and related events

## 4. How To Use Each Part Of The Product

## 4.1 Terminal

Purpose:

- monitor live price action
- view order book
- place spot or futures paper orders
- review open orders and positions

How to use it:

1. Choose a pair such as `BTCUSDT`.
2. Choose a timeframe for the candlestick chart.
3. Set `spot` or `futures`.
4. Choose `market` or non-market order type.
5. Enter either absolute quantity or quantity percent.
6. For futures, set leverage.
7. Optionally set take profit and stop loss.
8. Submit the order.

What the system does:

- Market orders execute immediately using the paper trading engine.
- Non-market orders are stored and monitored by the backend order monitor.
- Depth subscriptions are requested over the WebSocket channel.
- Open futures positions are tracked in the `positions` table.

How to take advantage:

- Use percent-based sizing early instead of fixed quantity to keep risk normalized.
- Use paper futures with modest leverage to pressure-test liquidation logic and margin behavior before trusting a strategy.
- Let the chart, order book, and position state live together in one loop instead of placing trades blind from webhook automation.

Current limitation:

- Binance Spot market orders can be sent through the Binance API when `TRADING_MODE=live`.
- `BINANCE_EXECUTION_ENV=testnet` routes orders to Spot testnet.
- `BINANCE_EXECUTION_ENV=live` is guarded behind explicit confirmation, credentials, and `BINANCE_LIVE_TRADING_ENABLED=true`.
- Binance USDⓈ-M futures market orders can be sent when `BINANCE_EXECUTION_ENV=live` and `BINANCE_FUTURES_LIVE_ENABLED=true`.
- Futures live execution now synchronizes open Binance USDⓈ-M positions into the local `positions` view on reads and after live futures orders.
- Closing a live futures position from the UI now submits a `reduceOnly` market order and then re-syncs positions from Binance.
- Live limit orders, TP/SL bracket placement, hedge-mode handling, and full account reconciliation are still not implemented.

## 4.2 Portfolio

Purpose:

- inspect total account value
- view holdings across spot and futures
- track portfolio history
- transfer funds between spot and futures wallets

How to use it:

1. Open `Portfolio`.
2. Review total value, PnL, spot value, futures value, and unrealized PnL.
3. Check the holdings allocation chart.
4. Use wallet transfer controls to move `USDT` between spot and futures.

How to take advantage:

- Split capital intentionally. Keep futures margin smaller than total capital while you refine strategy behavior.
- Use the snapshot chart as your operating equity curve, not just trade-level PnL.

Implementation detail:

- Portfolio snapshots are taken every 5 minutes by cron on the server.

## 4.3 History

Purpose:

- inspect trade history
- filter by pair and market type
- export a CSV ledger

How to use it:

1. Open `History`.
2. Review summary stats such as win rate and total PnL.
3. Filter by symbol or `spot`/`futures`.
4. Export CSV when you want an external review workflow.

How to take advantage:

- Use this page to validate whether paper trade outcomes align with your expectations after webhook or Strategy Lab driven activity.
- Export before major config changes so you can compare regimes or trading settings.

## 4.4 Strategies

Purpose:

- browse the legacy strategy catalog
- rank seeded strategies by composite score and filters

What is in this section:

- seeded strategies like SMC, SuperTrend + WaveTrend, RSI + MACD, and others
- filterable metrics such as win rate, drawdown, profit factor, and likes

How to take advantage:

- Treat this as a curated idea board, not ground truth.
- Use it to shortlist candidates for Strategy Lab import or backtesting.

Current limitation:

- `refresh` currently recalculates scores for stored rows. It does not scrape TradingView live yet.

## 4.5 Strategy Lab

Purpose:

- import or create strategies in a normalized schema
- evaluate them
- compare family variants
- get deterministic recommendations
- optionally generate AI proposals

This is the most leverage-rich part of the product.

### Main workflows

#### A. Manual strategy import

Use when you already understand the logic and want clean internal representation.

Flow:

1. Open `Strategy Lab`.
2. Create/import a manual strategy.
3. Define source, style, directionality, allowed pairs, timeframes, indicators, rules, and notes.
4. Save it into the Strategy Lab registry.

#### B. TradingView strategy normalization/import

Use when you have a TradingView strategy URL, notes, or Pine code.

Flow:

1. Provide a TradingView URL.
2. Optionally paste Pine Script and notes.
3. The backend fetches page metadata.
4. If OpenAI is configured, the system proposes normalized variants.
5. If OpenAI is not configured, it builds a deterministic fallback normalization.
6. Persist the selected version into `strategies_v2`.

#### C. Evaluate a strategy

Use when you want evidence rather than intuition.

Flow:

1. Select a strategy.
2. Trigger evaluation.
3. The analyzer runs historical testing and scores dimensions like stability, portability, regime fit, and execution realism.
4. Review the saved evaluation and its breakdowns.

#### D. Family management

Use when you want multiple variants of the same idea.

Flow:

1. Import or generate related children.
2. Group them into a family.
3. Compare siblings.
4. Promote the strongest sibling as the active family member.
5. Archive weak variants.

#### E. Recommendation mode

Use when you want strategies matched to a profile:

- `riskLevel`
- `timeframePreference`
- `objective`

The recommender ranks strategies and can also recommend the best member within a family.

#### F. AI proposal generation

Use when you want idea extensions, not blind automation.

Flow:

1. Configure `OPENAI_API_KEY`.
2. Choose a strategy or evaluation context.
3. Request proposals.
4. Review the returned summary, suggested changes, and cautions.

How to take advantage:

- Use Strategy Lab as the decision layer before backtesting more aggressively.
- Maintain families of conservative, balanced, and aggressive variants instead of overwriting one strategy repeatedly.
- Prefer deterministic evaluation and recommendations first, then use AI proposals as hypothesis generation.
- Use notes and assumptions fields seriously. They become the memory of why a strategy exists.

Current limitations:

- The quality of imported TradingView interpretations depends heavily on the metadata you provide.
- AI proposals are advisory only and intentionally non-executable.

## 4.6 Backtest

Purpose:

- run historical tests on built-in strategies
- inspect equity curves and performance metrics
- compare raw vs realistic estimates

Built-in strategies currently include examples such as:

- RSI Oversold Bounce
- MACD Crossover
- Bollinger Band Squeeze
- SuperTrend Follow
- RSI + MACD Confluence
- EMA 9/21 Cross

How to use it:

1. Open `Backtest`.
2. Choose strategy, symbol, timeframe, and date range.
3. Run the backtest.
4. Review net profit, win rate, drawdown, Sharpe, average win/loss, and the equity curve.
5. Toggle `Realistic Estimate` to see degraded expectations.

How to take advantage:

- Use backtests to eliminate obviously weak ideas before they ever touch webhook automation or discretionary paper trading.
- Favor robustness over raw PnL. The realistic estimate exists because live performance usually degrades.
- Re-run the same strategy across multiple symbols and timeframes before trusting one strong result.

Important note:

- The realistic estimate multiplies results by the degradation factor, default `0.65`.

## 4.7 Alerts

Purpose:

- connect TradingView alerts
- test webhook execution
- inspect alert history

Webhook endpoint:

- `POST /api/webhook/tradingview`

Expected fields:

- required: `secret`, `action`, `symbol`
- optional: `type`, `orderType`, `price`, `quantity`, `quantityPercent`, `leverage`, `takeProfit`, `stopLoss`

Example payload:

```json
{
  "secret": "change_this_to_a_secure_random_string",
  "action": "buy",
  "symbol": "BTCUSDT",
  "type": "spot",
  "orderType": "market",
  "quantityPercent": 5,
  "comment": "Test alert"
}
```

How to use it:

1. Copy the webhook URL from the UI.
2. Set the same `WEBHOOK_SECRET` in TradingView and your server.
3. Send a test payload from the app first.
4. Inspect the alert history and linked order behavior.

How to take advantage:

- Start with `quantityPercent` instead of fixed quantities so TradingView alerts stay size-aware as balance changes.
- Route all automated ideas through paper mode first and inspect alerts plus resulting trades together.

## 4.8 Settings

Purpose:

- manage paper/live mode
- update fee, slippage, leverage, and risk defaults
- inspect Binance/OpenAI connectivity

What you can change in-app:

- starting balance
- maker/taker fees
- default leverage
- slippage
- max leverage
- max position size
- daily loss limit
- LLM model selection

How to take advantage:

- Tune fees and slippage to be more pessimistic than you want, not more optimistic.
- Use Settings to model your actual operating constraints before judging a strategy.

Important live-mode behavior:

- Switching to `live` while `BINANCE_EXECUTION_ENV=testnet` requires testnet API keys but does not require the real-money confirmation phrase.
- Switching to `live` while `BINANCE_EXECUTION_ENV=live` requires the exact confirmation phrase `I_UNDERSTAND_REAL_MONEY`.
- Real-money live mode also requires live Binance keys, `BINANCE_LIVE_TRADING_ENABLED=true`, and at least 50 paper trades.
- Real-money USDⓈ-M futures also requires `BINANCE_FUTURES_LIVE_ENABLED=true`.
- The currently supported live execution path is Binance Spot `MARKET` orders and Binance USDⓈ-M Futures `MARKET` orders only.

## 5. API Surface

Main REST groups:

- `/api/health`
- `/api/config`
- `/api/market`
- `/api/portfolio`
- `/api/orders`
- `/api/positions`
- `/api/trades`
- `/api/webhook`
- `/api/strategies`
- `/api/strategy-lab`
- `/api/backtest`

Useful endpoints:

- `GET /api/health`
- `GET /api/config`
- `PUT /api/config`
- `GET /api/market/tickers`
- `GET /api/market/candles/:symbol`
- `GET /api/portfolio`
- `POST /api/portfolio/transfer`
- `POST /api/orders`
- `GET /api/orders`
- `DELETE /api/orders/:id`
- `GET /api/positions`
- `POST /api/positions/:id/close`
- `GET /api/trades`
- `GET /api/trades/summary`
- `GET /api/trades/export`
- `POST /api/webhook/tradingview`
- `GET /api/webhook/alerts`
- `GET /api/strategies`
- `POST /api/strategies/refresh`
- `GET /api/strategy-lab/strategies`
- `POST /api/strategy-lab/import`
- `POST /api/strategy-lab/import/tradingview`
- `POST /api/strategy-lab/strategies/:id/evaluate`
- `POST /api/strategy-lab/recommendations`
- `POST /api/strategy-lab/llm/proposals`
- `GET /api/backtest/strategies`
- `POST /api/backtest`

WebSocket:

- `ws://localhost:3001/ws/market` in local backend-only mode
- browser clients usually connect through the current host as `/ws/market`

Messages sent by server:

- `prices`
- `ticker`
- `kline`
- `depth`

Messages accepted from client:

- `subscribe_kline`
- `subscribe_depth`

## 6. Recommended Operating Playbooks

### Playbook 1: Safest evaluation loop

1. Start in `Strategies` or `Strategy Lab`.
2. Import or choose a strategy.
3. Run Strategy Lab evaluation.
4. Run a backtest on target pairs and timeframes.
5. Paper trade it manually in `Terminal`.
6. Only then wire it into `Alerts`.

### Playbook 2: TradingView idea intake

1. Find a public TradingView strategy.
2. Import it into Strategy Lab with notes and Pine code if available.
3. Generate or inspect variants.
4. Evaluate the strategy and compare family members.
5. Promote only the strongest sibling.
6. Move to webhook-based paper execution if it survives review.

### Playbook 3: Risk tuning

1. Adjust fees, slippage, and leverage in `Settings`.
2. Re-run backtests.
3. Compare portfolio behavior and trade summaries.
4. Tighten assumptions until the strategy still looks acceptable under worse conditions.

## 7. Verification And Maintenance

### Smoke test

Run:

```bash
npm run smoke
```

Current smoke coverage checks:

- futures position merge behavior
- webhook refusal in live mode
- order filter query safety

### Useful operational checks

- `GET /api/health`
- inspect `Settings` for Binance and OpenAI status
- inspect `Alerts` after TradingView integration changes
- inspect `History` after changing execution parameters

## 8. Current Gaps And Non-Obvious Caveats

- Binance Spot testnet and guarded real-money market execution are implemented.
- Binance USDⓈ-M futures real-money market execution is implemented behind a separate futures enable flag.
- The legacy strategy discovery refresh does not scrape new TradingView strategies yet.
- Strategy Lab AI features depend on `OPENAI_API_KEY`.
- The webhook secret defaults to an insecure placeholder if not set. Change it.
- Futures live execution currently assumes one-way mode and market orders.
- Futures wallet/account reconciliation is still partial; open positions are synced, but the local wallet ledger is not treated as the Binance source of truth.
- Live limit orders and full exchange-to-local portfolio reconciliation are still missing.
- Production deploy behavior depends on your hosting setup; `render.yaml` exists, but environment and secret management still need to be configured correctly in the target platform.

## 9. Where To Look In The Code

- Frontend shell: [src/App.jsx](/Users/juan/Documents/Claude/Projects/ppr-trading/src/App.jsx)
- API client: [src/lib/api.js](/Users/juan/Documents/Claude/Projects/ppr-trading/src/lib/api.js)
- Server bootstrap: [server/index.js](/Users/juan/Documents/Claude/Projects/ppr-trading/server/index.js)
- Database path/init: [server/db/database.js](/Users/juan/Documents/Claude/Projects/ppr-trading/server/db/database.js)
- Schema: [server/db/schema.js](/Users/juan/Documents/Claude/Projects/ppr-trading/server/db/schema.js)
- Trading engine: [server/services/tradingEngine.js](/Users/juan/Documents/Claude/Projects/ppr-trading/server/services/tradingEngine.js)
- Strategy Lab routes: [server/routes/strategyLab.js](/Users/juan/Documents/Claude/Projects/ppr-trading/server/routes/strategyLab.js)
- Backtester: [server/services/backtester.js](/Users/juan/Documents/Claude/Projects/ppr-trading/server/services/backtester.js)
- Webhook receiver: [server/services/webhookReceiver.js](/Users/juan/Documents/Claude/Projects/ppr-trading/server/services/webhookReceiver.js)

## 10. Best Way To Get Value From The System

The best use of PaperTrade Pro is not “find a strategy and automate it immediately.” The system is strongest when used as a validation stack:

1. source ideas
2. normalize them
3. score and evaluate them
4. backtest them pessimistically
5. paper trade them under realistic settings
6. only then consider deeper automation work

If you use the product that way, every subsystem reinforces the others instead of acting like isolated features.
