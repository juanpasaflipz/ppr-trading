# Strategy Lab Product Spec

## Goal

Evolve PaperTrade Pro from a paper trading dashboard into a strategy intelligence product.

The system should help a trader:

- import strategies from TradingView and internal templates
- normalize them into a consistent internal strategy model
- evaluate them against Binance market data
- detect overfitting, weak assumptions, and regime mismatch
- improve them with structured coaching instead of blind copying

This is not a "copy the most profitable TradingView script" product.
The real product is strategy evaluation, validation, adaptation, and discipline.

## Product Thesis

Users do not actually need more strategies. They need:

- a faster way to reject bad strategies
- a way to understand why a strategy works
- a way to see when a strategy stops working
- guidance on how to adapt a strategy without overfitting it

The moat is not raw strategy scraping.
The moat is the evaluation layer and the coaching layer.

## Core User

Primary user:

- self-directed crypto trader using Binance/TradingView
- already experiments with public scripts, indicators, and alerts
- does not trust TradingView strategy claims at face value
- wants a private lab to evaluate and refine systems before risking capital

Secondary user:

- technical hobbyist or quant-curious trader who wants a programmable strategy SDK

## User Outcomes

The product should let a user answer:

- Is this strategy actually robust?
- Which pairs and timeframes does it fit?
- Does it only work in trend or chop?
- Is this result overfit to a specific lookback window?
- How should I modify risk, filters, or exits?
- Should I paper trade this next week or discard it now?

## Product Pillars

### 1. Strategy Import

Bring strategies into the system from:

- TradingView metadata
- open-source Pine scripts
- built-in internal templates
- user-authored manual strategies

The import layer should treat TradingView as a raw input source, not as a trusted truth source.

### 2. Strategy SDK

A single internal strategy interface should power:

- backtesting
- forward-testing
- simulations
- strategy comparison
- coaching explanations

This should be JS-first to match the current Node codebase.

### 3. Validation Engine

Every strategy should go through:

- historical backtest
- walk-forward validation
- parameter sensitivity checks
- regime segmentation
- paper forward-test tracking

### 4. Coach Layer

The assistant should act like a trading coach, not an execution oracle.

It should explain:

- weak assumptions
- risk issues
- overfitting risks
- market regime mismatch
- possible improvements

It should not pretend to predict markets.

## MVP Scope

The MVP should stay narrow.

### In scope

- manual import of TradingView strategy metadata and optional Pine code
- internal strategy schema
- 5-10 prebuilt strategies
- strategy analyzer scorecard
- parameter sensitivity test
- regime labeling
- coach panel with deterministic recommendations
- paper forward-test recommendation state

### Out of scope

- autonomous live trading
- broad TradingView scraping at scale
- social strategy marketplace
- natural language strategy generation
- hundreds of indicators
- multi-exchange support
- portfolio optimizer across many strategies

## MVP UX

### New top-level area: Strategy Lab

Add a new product section with four views:

1. Library
2. Analyzer
3. Compare
4. Coach

### Library

Displays all strategies with:

- source
- strategy style
- pairs tested
- timeframe
- confidence score
- paper-test status
- last evaluation timestamp

### Analyzer

Single strategy deep-dive page with:

- strategy summary
- assumptions
- imported source metadata
- historical backtest metrics
- realistic degradation estimate
- sensitivity heatmap
- regime performance breakdown
- failure report

### Compare

Side-by-side strategy comparison with:

- risk-adjusted return
- max drawdown
- parameter stability
- regime dependence
- forward-test drift

### Coach

A floating or docked assistant panel that explains:

- what is weak
- what to test next
- what to ignore
- how to improve the strategy without curve fitting

This should initially be panel-based, not a fully persistent screen bot.

## Coach Behavior

The coach should not give fake certainty.

### Good coach behaviors

- "This strategy only performs well in high-momentum trend regimes."
- "Your stop loss is tighter than the pair's recent ATR."
- "Performance collapses when RSI changes from 14 to 12 or 16. This is unstable."
- "Net profit is positive, but expectancy is weak after fees."
- "This script is profitable on BTCUSDT 4h but not portable to SOLUSDT 1h."

### Bad coach behaviors

- "This strategy will beat the market."
- "Use this exact setup live."
- "Buy now."

## Internal Strategy Model

Every strategy should normalize into one object:

```js
{
  id: "uuid-or-slug",
  name: "SuperTrend + WaveTrend",
  source: {
    kind: "tradingview" | "internal" | "manual",
    url: "https://...",
    author: "name",
    importedAt: "timestamp"
  },
  market: {
    assetClass: "crypto",
    allowedPairs: ["BTCUSDT", "ETHUSDT"],
    preferredTimeframes: ["1h", "4h"]
  },
  classification: {
    style: "trend" | "mean_reversion" | "breakout" | "scalping" | "market_structure",
    directionality: "long_only" | "short_only" | "long_short"
  },
  indicators: {
    rsi: { period: 14 },
    emaFast: { period: 9 },
    emaSlow: { period: 21 }
  },
  rules: {
    entry: "callable-or-expression",
    exit: "callable-or-expression",
    filters: [],
    risk: {
      stopLossPct: 0.02,
      takeProfitPct: 0.05
    }
  },
  notes: {
    hypothesis: "Works in directional environments after volatility compression",
    assumptions: [
      "Momentum continuation persists for 2-4 bars",
      "Fees do not fully erase edge"
    ]
  }
}
```

## Backend Additions

### 1. Strategy Registry

New module:

- `server/services/strategyRegistry.js`

Responsibilities:

- own normalized strategy definitions
- import, version, and validate strategies
- store canonical internal format

### 2. Strategy Import Service

New module:

- `server/services/strategyImport.js`

Responsibilities:

- ingest TradingView metadata
- ingest manual Pine code / JSON config
- classify source and strategy style
- produce normalized strategy records

First version should support manual import and curated source ingestion.
Do not start with broad uncontrolled scraping.

### 3. Strategy Analyzer

New module:

- `server/services/strategyAnalyzer.js`

Responsibilities:

- run strategy through backtester
- compute robustness metrics
- evaluate sensitivity to key params
- detect regime dependence
- generate structured warnings and recommendations

### 4. Coach Service

New module:

- `server/services/coach.js`

Responsibilities:

- convert analyzer output into user-facing guidance
- deterministic rule engine first
- optional LLM explanation layer later

### 5. Forward Validation Tracker

New module:

- `server/services/forwardTracker.js`

Responsibilities:

- run strategy in paper mode over live incoming data
- compare forward performance to historical expectations
- mark strategy as "stable", "drifting", or "invalidated"

## Database Changes

Add the following tables.

### strategies_v2

Canonical normalized strategy records.

Fields:

- `id`
- `slug`
- `name`
- `source_kind`
- `source_url`
- `source_author`
- `pine_script`
- `strategy_json`
- `style`
- `directionality`
- `status`
- `created_at`
- `updated_at`

### strategy_evaluations

One row per strategy evaluation run.

Fields:

- `id`
- `strategy_id`
- `symbol`
- `timeframe`
- `start_date`
- `end_date`
- `evaluation_type` (`backtest`, `walk_forward`, `sensitivity`, `forward_review`)
- `score_total`
- `score_stability`
- `score_portability`
- `score_regime_fit`
- `score_execution_realism`
- `summary_json`
- `created_at`

### strategy_regime_stats

Store performance by regime.

Fields:

- `id`
- `evaluation_id`
- `regime`
- `trade_count`
- `win_rate`
- `net_profit`
- `profit_factor`
- `max_drawdown`

### strategy_param_tests

Store sensitivity runs.

Fields:

- `id`
- `evaluation_id`
- `param_name`
- `param_value`
- `net_profit`
- `profit_factor`
- `max_drawdown`
- `sharpe_ratio`

### coach_reports

Store generated recommendations.

Fields:

- `id`
- `strategy_id`
- `evaluation_id`
- `report_json`
- `created_at`

### forward_strategy_runs

Track paper forward-test state.

Fields:

- `id`
- `strategy_id`
- `symbol`
- `timeframe`
- `status`
- `started_at`
- `ended_at`
- `expected_profile_json`
- `actual_profile_json`

## Evaluation Framework

Every strategy should receive a composite score built from:

- historical performance quality
- parameter stability
- regime robustness
- portability across symbols/timeframes
- execution realism after fees/slippage

Recommended initial score model:

```text
Total Score =
  Performance Quality * 0.25 +
  Stability * 0.25 +
  Regime Robustness * 0.20 +
  Portability * 0.15 +
  Execution Realism * 0.15
```

### Performance Quality

Use:

- net profit %
- profit factor
- drawdown
- expectancy

### Stability

Use:

- sensitivity to parameter perturbation
- degradation outside the exact chosen settings

### Regime Robustness

Use:

- performance in trend, chop, high-volatility, low-volatility segments

### Portability

Use:

- transferability across pairs and neighboring timeframes

### Execution Realism

Use:

- slippage
- fee drag
- signal delay assumptions

## Regime Model

Keep the first regime model simple.

Label each segment as one of:

- `trend_up`
- `trend_down`
- `range_low_vol`
- `range_high_vol`
- `breakout_expansion`

These can be derived from:

- ATR percentile
- ADX
- rolling slope / EMA spread
- Bollinger width

The point is not perfect market taxonomy.
The point is to explain where a strategy is fragile.

## API Surface

Add the following backend routes.

### Import / Registry

- `POST /api/strategy-lab/import`
- `GET /api/strategy-lab/strategies`
- `GET /api/strategy-lab/strategies/:id`

### Evaluation

- `POST /api/strategy-lab/analyze/:id`
- `GET /api/strategy-lab/evaluations/:id`
- `GET /api/strategy-lab/strategies/:id/evaluations`

### Coach

- `GET /api/strategy-lab/strategies/:id/coach-report`

### Forward testing

- `POST /api/strategy-lab/forward-runs`
- `GET /api/strategy-lab/forward-runs`
- `POST /api/strategy-lab/forward-runs/:id/stop`

## Frontend Changes

Add a new page:

- `src/pages/StrategyLab.jsx`

Subsections:

- library rail
- analyzer view
- compare view
- coach drawer

Add supporting components:

- `src/components/strategy-lab/StrategyCard.jsx`
- `src/components/strategy-lab/ScoreBadge.jsx`
- `src/components/strategy-lab/SensitivityChart.jsx`
- `src/components/strategy-lab/RegimeBreakdown.jsx`
- `src/components/strategy-lab/CoachPanel.jsx`

## Implementation Order

### Phase 1: Foundation

1. Add DB tables for strategy lab
2. Add normalized strategy registry
3. Add manual strategy import endpoint
4. Add seeded internal strategy definitions

### Phase 2: Analyzer

5. Extend backtester to support evaluation jobs
6. Build parameter sensitivity runner
7. Build regime segmentation
8. Persist strategy evaluation results

### Phase 3: Coach

9. Add deterministic coach rules
10. Build analyzer page and coach panel
11. Add compare page

### Phase 4: Forward validation

12. Add paper forward-test tracker
13. Compare historical expectations vs live paper behavior
14. Mark strategies as stable, drifting, or invalidated

## Technical Principles

- deterministic scoring before AI explanations
- no direct dependence on TradingView claims
- every imported strategy becomes an internal normalized strategy
- no live trading automation in MVP
- explanations should be grounded in actual metrics

## Risks

### 1. TradingView scraping brittleness

Mitigation:

- manual/curated import first
- importer abstraction, not scraper coupling

### 2. Overfitting theater

Mitigation:

- force sensitivity and walk-forward checks
- emphasize stability over headline PnL

### 3. Bot becoming fake guru UX

Mitigation:

- coach must cite metrics, regimes, and specific weak spots
- avoid predictive language

### 4. Scope explosion

Mitigation:

- keep MVP narrow
- strategy lab first, autonomous trader later

## Recommendation

Build this as a strategy intelligence lab, not an AI trader.

The winning sequence is:

1. import
2. normalize
3. evaluate
4. coach
5. forward validate

If this works, then later layers like LLM-assisted strategy authoring, private SDK access, Telegram/Discord bots, or live execution controls become meaningful.
