import { getDb, closeDb } from './database.js';
import dotenv from 'dotenv';
import strategyRegistry from '../services/strategyRegistry.js';

dotenv.config();

const STARTING_BALANCE = parseFloat(process.env.STARTING_BALANCE || '100000');

function ensureStrategyLabMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategy_families (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      source_kind TEXT NOT NULL CHECK(source_kind IN ('tradingview', 'manual', 'internal')),
      source_url TEXT,
      source_author TEXT,
      import_run_id INTEGER REFERENCES strategy_import_runs(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const columns = db.prepare(`PRAGMA table_info(strategies_v2)`).all();
  const names = new Set(columns.map((column) => column.name));
  const alterStatements = [];

  if (!names.has('family_id')) {
    alterStatements.push(`ALTER TABLE strategies_v2 ADD COLUMN family_id INTEGER REFERENCES strategy_families(id) ON DELETE SET NULL`);
  }
  if (!names.has('variant_label')) {
    alterStatements.push(`ALTER TABLE strategies_v2 ADD COLUMN variant_label TEXT`);
  }
  if (!names.has('parent_strategy_id')) {
    alterStatements.push(`ALTER TABLE strategies_v2 ADD COLUMN parent_strategy_id INTEGER REFERENCES strategies_v2(id) ON DELETE SET NULL`);
  }
  if (!names.has('generation')) {
    alterStatements.push(`ALTER TABLE strategies_v2 ADD COLUMN generation INTEGER DEFAULT 0`);
  }
  if (!names.has('family_role')) {
    alterStatements.push(`ALTER TABLE strategies_v2 ADD COLUMN family_role TEXT DEFAULT 'standalone'`);
  }
  if (!names.has('import_run_id')) {
    alterStatements.push(`ALTER TABLE strategies_v2 ADD COLUMN import_run_id INTEGER REFERENCES strategy_import_runs(id) ON DELETE SET NULL`);
  }

  for (const statement of alterStatements) {
    db.exec(statement);
  }

  const familyColumns = db.prepare(`PRAGMA table_info(strategy_families)`).all();
  const familyNames = new Set(familyColumns.map((column) => column.name));
  if (!familyNames.has('active_strategy_id')) {
    db.exec(`ALTER TABLE strategy_families ADD COLUMN active_strategy_id INTEGER REFERENCES strategies_v2(id) ON DELETE SET NULL`);
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_strategies_v2_family ON strategies_v2(family_id, updated_at)`);
}

function ensureOrderExecutionMigrations(db) {
  const columns = db.prepare(`PRAGMA table_info(orders)`).all();
  const names = new Set(columns.map((column) => column.name));

  if (!names.has('exchange_order_id')) {
    db.exec(`ALTER TABLE orders ADD COLUMN exchange_order_id TEXT`);
  }
  if (!names.has('execution_env')) {
    db.exec(`ALTER TABLE orders ADD COLUMN execution_env TEXT DEFAULT 'paper'`);
  }
  if (!names.has('remote_status')) {
    db.exec(`ALTER TABLE orders ADD COLUMN remote_status TEXT`);
  }
}

function seed() {
  const db = getDb();
  ensureStrategyLabMigrations(db);
  ensureOrderExecutionMigrations(db);

  // Seed default config
  const configs = [
    ['trading_mode', 'paper'],
    ['binance_execution_env', process.env.BINANCE_EXECUTION_ENV || 'testnet'],
    ['binance_futures_live_enabled', process.env.BINANCE_FUTURES_LIVE_ENABLED || 'false'],
    ['live_auto_strategy_id', 'ema_cross'],
    ['live_auto_enabled', 'false'],
    ['live_auto_symbol', 'BTCUSDT'],
    ['live_auto_timeframe', '1h'],
    ['live_auto_leverage', '3'],
    ['live_auto_max_position_pct', '5'],
    ['ema_cross_auto_enabled', 'false'],
    ['ema_cross_auto_symbol', 'BTCUSDT'],
    ['ema_cross_auto_timeframe', '1h'],
    ['ema_cross_auto_leverage', '3'],
    ['ema_cross_auto_max_position_pct', '5'],
    ['starting_balance', String(STARTING_BALANCE)],
    ['maker_fee', process.env.MAKER_FEE || '0.001'],
    ['taker_fee', process.env.TAKER_FEE || '0.001'],
    ['default_leverage', process.env.DEFAULT_LEVERAGE || '1'],
    ['slippage', process.env.SLIPPAGE || '0.0005'],
    ['max_position_size_pct', '25'],
    ['daily_loss_limit', '10000'],
    ['max_leverage', '125'],
    ['llm_provider', 'openai'],
    ['llm_model', process.env.OPENAI_DEFAULT_MODEL || 'gpt-5.4'],
  ];

  const insertConfig = db.prepare(
    'INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)'
  );
  for (const [key, value] of configs) {
    insertConfig.run(key, value);
  }

  // Seed starting USDT balance split 50/50 between spot and futures
  const halfBalance = STARTING_BALANCE / 2;
  const existingSpot = db.prepare(
    "SELECT id FROM wallets WHERE type = 'spot' AND asset = 'USDT'"
  ).get();
  if (!existingSpot) {
    db.prepare(
      "INSERT INTO wallets (type, asset, balance) VALUES ('spot', 'USDT', ?)"
    ).run(halfBalance);
    db.prepare(
      "INSERT INTO wallets (type, asset, balance) VALUES ('futures', 'USDT', ?)"
    ).run(halfBalance);
  } else {
    // Migrate: if futures wallet is 0 and no trades exist, split the balance
    const futuresWallet = db.prepare(
      "SELECT * FROM wallets WHERE type = 'futures' AND asset = 'USDT'"
    ).get();
    const tradeCount = db.prepare('SELECT COUNT(*) as cnt FROM trades').get().cnt;
    if (futuresWallet && futuresWallet.balance === 0 && tradeCount === 0) {
      const spotWallet = db.prepare(
        "SELECT * FROM wallets WHERE type = 'spot' AND asset = 'USDT'"
      ).get();
      db.prepare("UPDATE wallets SET balance = ? WHERE type = 'spot' AND asset = 'USDT'")
        .run(spotWallet.balance / 2);
      db.prepare("UPDATE wallets SET balance = ? WHERE type = 'futures' AND asset = 'USDT'")
        .run(spotWallet.balance / 2);
      console.log('[Seed] Migrated balance: split 50/50 between spot and futures');
    }
  }

  // Seed known strategies
  const strategies = [
    {
      name: 'Smart Money Concepts (SMC)',
      author: 'Community',
      description: 'Market structure analysis + order block identification. Tracks institutional money flow through break of structure (BOS) and change of character (CHOCH) patterns.',
      strategy_type: 'trend',
      win_rate: 0.58,
      profit_factor: 1.85,
      max_drawdown: 0.15,
      net_profit_pct: 42.5,
      likes: 12500,
    },
    {
      name: 'SuperTrend + WaveTrend Combo',
      author: 'Community',
      description: 'Combines SuperTrend for trend direction with WaveTrend oscillator for entry timing. Works well on 1h-4h timeframes for crypto.',
      strategy_type: 'trend',
      win_rate: 0.52,
      profit_factor: 1.65,
      max_drawdown: 0.18,
      net_profit_pct: 35.2,
      likes: 8200,
    },
    {
      name: 'Bollinger Band Squeeze Breakout',
      author: 'Community',
      description: 'Detects low volatility squeezes via Bollinger Band width, then enters on the breakout direction with momentum confirmation.',
      strategy_type: 'swing',
      win_rate: 0.48,
      profit_factor: 1.92,
      max_drawdown: 0.12,
      net_profit_pct: 38.7,
      likes: 6800,
    },
    {
      name: 'RSI + MACD Confluence',
      author: 'Community',
      description: 'Classic momentum strategy: enters when RSI exits oversold/overbought AND MACD crosses signal line in the same direction.',
      strategy_type: 'swing',
      win_rate: 0.55,
      profit_factor: 1.45,
      max_drawdown: 0.20,
      net_profit_pct: 28.3,
      likes: 15000,
    },
    {
      name: 'Ichimoku Cloud Crypto Adaptation',
      author: 'Community',
      description: 'Ichimoku Cloud with crypto-optimized settings (20/60/120/30). Trades cloud breakouts with Chikou span confirmation.',
      strategy_type: 'trend',
      win_rate: 0.50,
      profit_factor: 1.72,
      max_drawdown: 0.16,
      net_profit_pct: 33.1,
      likes: 5500,
    },
    {
      name: 'VWAP + Volume Profile',
      author: 'Community',
      description: 'Intraday strategy using VWAP as dynamic support/resistance with volume profile to identify high-value areas.',
      strategy_type: 'scalping',
      win_rate: 0.62,
      profit_factor: 1.35,
      max_drawdown: 0.08,
      net_profit_pct: 22.5,
      likes: 4200,
    },
    {
      name: 'Multi-Band Comparison',
      author: 'Community',
      description: 'Compares Bollinger Bands, Quantile Bands, and Power-Law bands to find confluence zones for high-probability entries.',
      strategy_type: 'mean_reversion',
      win_rate: 0.54,
      profit_factor: 1.58,
      max_drawdown: 0.14,
      net_profit_pct: 31.0,
      likes: 3800,
    },
  ];

  const existingStrategyByName = db.prepare(
    'SELECT id FROM strategies WHERE name = ?'
  );
  const insertStrategy = db.prepare(`
    INSERT INTO strategies
    (name, author, description, strategy_type, win_rate, profit_factor, max_drawdown, net_profit_pct, likes, composite_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const s of strategies) {
    if (existingStrategyByName.get(s.name)) continue;

    const score =
      (s.win_rate * 0.3) +
      (s.profit_factor * 0.25) +
      ((1 - s.max_drawdown) * 0.25) +
      (Math.log(s.likes + 1) / Math.log(20000) * 0.2);
    insertStrategy.run(
      s.name, s.author, s.description, s.strategy_type,
      s.win_rate, s.profit_factor, s.max_drawdown, s.net_profit_pct,
      s.likes, parseFloat(score.toFixed(4))
    );
  }

  // Clean up duplicate seeded strategies from older runs before the
  // uniqueness check existed. Keep the earliest row for each name.
  db.prepare(`
    DELETE FROM strategies
    WHERE id NOT IN (
      SELECT MIN(id)
      FROM strategies
      GROUP BY name
    )
  `).run();

  // Initial portfolio snapshot
  const snap = db.prepare(
    "SELECT id FROM portfolio_snapshots LIMIT 1"
  ).get();
  if (!snap) {
    db.prepare(
      "INSERT INTO portfolio_snapshots (total_value_usdt, spot_value, futures_value) VALUES (?, ?, 0)"
    ).run(STARTING_BALANCE, STARTING_BALANCE);
  }

  strategyRegistry.seedDefaults();

  console.log('[Seed] Database setup complete.');
  console.log(`[Seed] Starting balance: $${STARTING_BALANCE.toLocaleString()} USDT`);
  console.log(`[Seed] Seeded ${strategies.length} strategies`);
}

export { seed };

// Run standalone when called directly (node server/db/setup.js)
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed();
  closeDb();
}
