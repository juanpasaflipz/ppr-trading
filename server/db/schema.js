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
`;

export default SCHEMA;
