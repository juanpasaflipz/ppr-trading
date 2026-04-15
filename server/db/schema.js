const SCHEMA = `
-- Portfolio Wallets
CREATE TABLE IF NOT EXISTS wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('spot', 'futures')),
  asset TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  locked REAL NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(type, asset)
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_order_id TEXT UNIQUE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
  type TEXT NOT NULL,
  market_type TEXT NOT NULL CHECK(market_type IN ('spot', 'futures')),
  price REAL,
  stop_price REAL,
  quantity REAL NOT NULL,
  filled_quantity REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'partial', 'filled', 'cancelled')),
  leverage INTEGER DEFAULT 1,
  take_profit REAL,
  stop_loss REAL,
  fee REAL DEFAULT 0,
  source TEXT DEFAULT 'manual' CHECK(source IN ('manual', 'webhook', 'backtest')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Futures Positions
CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('long', 'short')),
  entry_price REAL NOT NULL,
  quantity REAL NOT NULL,
  leverage INTEGER NOT NULL DEFAULT 1,
  margin_type TEXT DEFAULT 'isolated' CHECK(margin_type IN ('isolated', 'cross')),
  margin REAL NOT NULL,
  liquidation_price REAL,
  unrealized_pnl REAL DEFAULT 0,
  realized_pnl REAL DEFAULT 0,
  status TEXT DEFAULT 'open' CHECK(status IN ('open', 'closed', 'liquidated')),
  opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME
);

-- Trade History
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  total_value_usdt REAL NOT NULL,
  spot_value REAL NOT NULL,
  futures_value REAL NOT NULL,
  unrealized_pnl REAL DEFAULT 0,
  snapshot_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- TradingView Alerts
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_payload TEXT NOT NULL,
  parsed_action TEXT,
  symbol TEXT,
  status TEXT NOT NULL CHECK(status IN ('executed', 'rejected', 'error')),
  order_id INTEGER REFERENCES orders(id),
  error_message TEXT,
  received_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Discovered Strategies
CREATE TABLE IF NOT EXISTS strategies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  author TEXT,
  description TEXT,
  source_url TEXT,
  pine_script TEXT,
  strategy_type TEXT CHECK(strategy_type IN ('trend', 'mean_reversion', 'scalping', 'swing')),
  win_rate REAL,
  profit_factor REAL,
  max_drawdown REAL,
  net_profit_pct REAL,
  likes INTEGER DEFAULT 0,
  composite_score REAL,
  discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Strategy Lab Registry
CREATE TABLE IF NOT EXISTS strategies_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('tradingview', 'internal', 'manual')),
  source_url TEXT,
  source_author TEXT,
  pine_script TEXT,
  strategy_json TEXT NOT NULL,
  family_id INTEGER REFERENCES strategy_families(id) ON DELETE SET NULL,
  parent_strategy_id INTEGER REFERENCES strategies_v2(id) ON DELETE SET NULL,
  generation INTEGER DEFAULT 0,
  variant_label TEXT,
  family_role TEXT DEFAULT 'standalone' CHECK(family_role IN ('standalone', 'parent', 'sibling')),
  import_run_id INTEGER REFERENCES strategy_import_runs(id) ON DELETE SET NULL,
  style TEXT NOT NULL CHECK(style IN ('trend', 'mean_reversion', 'breakout', 'scalping', 'market_structure', 'swing')),
  directionality TEXT NOT NULL CHECK(directionality IN ('long_only', 'short_only', 'long_short')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'ready', 'archived')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Strategy Lab Families
CREATE TABLE IF NOT EXISTS strategy_families (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('tradingview', 'manual', 'internal')),
  source_url TEXT,
  source_author TEXT,
  import_run_id INTEGER REFERENCES strategy_import_runs(id) ON DELETE SET NULL,
  active_strategy_id INTEGER REFERENCES strategies_v2(id) ON DELETE SET NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Strategy Lab Import Runs
CREATE TABLE IF NOT EXISTS strategy_import_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('tradingview', 'manual')),
  source_url TEXT,
  source_author TEXT,
  model TEXT,
  raw_input_json TEXT NOT NULL,
  metadata_json TEXT,
  normalization_json TEXT,
  selected_variant_index INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Strategy Lab Evaluations
CREATE TABLE IF NOT EXISTS strategy_evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_id INTEGER NOT NULL REFERENCES strategies_v2(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  evaluation_type TEXT NOT NULL CHECK(evaluation_type IN ('backtest', 'walk_forward', 'sensitivity', 'forward_review')),
  score_total REAL,
  score_stability REAL,
  score_portability REAL,
  score_regime_fit REAL,
  score_execution_realism REAL,
  summary_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Strategy Lab Regime Stats
CREATE TABLE IF NOT EXISTS strategy_regime_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_id INTEGER NOT NULL REFERENCES strategy_evaluations(id) ON DELETE CASCADE,
  regime TEXT NOT NULL,
  trade_count INTEGER DEFAULT 0,
  win_rate REAL,
  net_profit REAL,
  profit_factor REAL,
  max_drawdown REAL
);

-- Strategy Lab Parameter Tests
CREATE TABLE IF NOT EXISTS strategy_param_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_id INTEGER NOT NULL REFERENCES strategy_evaluations(id) ON DELETE CASCADE,
  param_name TEXT NOT NULL,
  param_value TEXT NOT NULL,
  net_profit REAL,
  profit_factor REAL,
  max_drawdown REAL,
  sharpe_ratio REAL
);

-- Strategy Lab Coach Reports
CREATE TABLE IF NOT EXISTS coach_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_id INTEGER NOT NULL REFERENCES strategies_v2(id) ON DELETE CASCADE,
  evaluation_id INTEGER REFERENCES strategy_evaluations(id) ON DELETE SET NULL,
  report_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Strategy Lab Forward Runs
CREATE TABLE IF NOT EXISTS forward_strategy_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_id INTEGER NOT NULL REFERENCES strategies_v2(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'running', 'stopped', 'invalidated', 'completed')),
  started_at DATETIME,
  ended_at DATETIME,
  expected_profile_json TEXT,
  actual_profile_json TEXT
);

-- Backtest Results
CREATE TABLE IF NOT EXISTS backtest_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  equity_curve TEXT,
  realistic_net_profit REAL,
  realistic_win_rate REAL,
  config TEXT,
  ran_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Config
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders(symbol);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_market_type ON orders(market_type);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_executed_at ON trades(executed_at);
CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_at ON portfolio_snapshots(snapshot_at);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_strategies_score ON strategies(composite_score);
CREATE INDEX IF NOT EXISTS idx_strategies_v2_slug ON strategies_v2(slug);
CREATE INDEX IF NOT EXISTS idx_strategies_v2_status ON strategies_v2(status);
CREATE INDEX IF NOT EXISTS idx_strategy_families_source ON strategy_families(source_kind, updated_at);
CREATE INDEX IF NOT EXISTS idx_strategy_import_runs_source ON strategy_import_runs(source_kind, created_at);
CREATE INDEX IF NOT EXISTS idx_strategy_evaluations_strategy ON strategy_evaluations(strategy_id);
CREATE INDEX IF NOT EXISTS idx_coach_reports_strategy ON coach_reports(strategy_id);
CREATE INDEX IF NOT EXISTS idx_forward_strategy_runs_strategy ON forward_strategy_runs(strategy_id);
`;

export default SCHEMA;
