import type Database from 'better-sqlite3';

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      price REAL NOT NULL,
      quantity REAL NOT NULL,
      amount REAL NOT NULL,
      strategy TEXT NOT NULL,
      mode TEXT NOT NULL,
      market_type TEXT NOT NULL,
      order_id TEXT NOT NULL,
      pnl REAL,
      timestamp INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      entry_price REAL NOT NULL,
      quantity REAL NOT NULL,
      amount REAL NOT NULL,
      current_price REAL NOT NULL,
      pnl REAL NOT NULL,
      pnl_pct REAL NOT NULL,
      strategy TEXT NOT NULL,
      market_type TEXT NOT NULL,
      stop_loss REAL,
      opened_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS candles (
      symbol TEXT NOT NULL,
      interval TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL,
      PRIMARY KEY (symbol, interval, timestamp)
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'demo',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      last_login INTEGER,
      deleted_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
    CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
    CREATE INDEX IF NOT EXISTS idx_candles_lookup ON candles(symbol, interval, timestamp);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_config (
      user_id INTEGER PRIMARY KEY,
      config TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_equity_snapshots (
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      total_equity REAL NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, date)
    );
  `);

  // Add columns to existing tables (safe to run multiple times)
  const addColumn = (table: string, column: string, type: string) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); } catch { /* column already exists */ }
  };
  addColumn('leads', 'deleted_at', 'INTEGER');
  addColumn('leads', 'ip', 'TEXT');
  addColumn('leads', 'user_agent', 'TEXT');
  addColumn('leads', 'referrer', 'TEXT');
  addColumn('users', 'deleted_at', 'INTEGER');
  addColumn('trades', 'user_id', 'INTEGER');
  addColumn('positions', 'user_id', 'INTEGER');
  addColumn('users', 'exchange_key', 'TEXT');
  addColumn('users', 'exchange_secret', 'TEXT');
  addColumn('users', 'exchange_testnet', 'INTEGER DEFAULT 1');
  addColumn('users', 'wallet_address', 'TEXT');
  addColumn('users', 'paper_balance', 'REAL DEFAULT 10000');
  addColumn('positions', 'mode', "TEXT DEFAULT 'paper'");
  addColumn('users', 'lang', "TEXT DEFAULT 'en'");
  addColumn('users', 'theme', "TEXT DEFAULT 'dark'");
  addColumn('users', 'exchange_name', "TEXT DEFAULT 'bybit'");
  addColumn('users', 'disclaimer_accepted_at', 'INTEGER');
  addColumn('users', 'disclaimer_version', 'TEXT');
  addColumn('users', 'token_version', 'INTEGER DEFAULT 0');
  addColumn('users', 'disclaimer_lang', 'TEXT');
  addColumn('users', 'disclaimer_signature', 'TEXT');
  addColumn('users', 'disclaimer_ip', 'TEXT');
  addColumn('users', 'disclaimer_user_agent', 'TEXT');
  addColumn('trades', 'testnet', 'INTEGER DEFAULT 0');
  addColumn('positions', 'testnet', 'INTEGER DEFAULT 0');
  addColumn('trades', 'exchange', "TEXT DEFAULT 'bybit'");
  addColumn('positions', 'exchange', "TEXT DEFAULT 'bybit'");
  addColumn('trades', 'close_reason', 'TEXT');
  addColumn('user_config', 'bot_enabled', 'INTEGER DEFAULT 0');

  // Create index on close_reason column
  db.exec('CREATE INDEX IF NOT EXISTS idx_trades_close_reason ON trades(close_reason)');

  // Normalize legacy paper-mode rows. The exchange column was added with
  // DEFAULT 'bybit', which backfilled every pre-existing row — including
  // paper trades that never touched a real exchange. The orchestrator now
  // stamps paper records with exchange='' and testnet=false, so align
  // historical data with the same invariant. Idempotent: once the rows
  // are normalized the WHERE clause matches nothing on subsequent runs.
  db.exec(`
    UPDATE trades SET exchange = '', testnet = 0
    WHERE mode = 'paper' AND (exchange != '' OR testnet != 0);
    UPDATE positions SET exchange = '', testnet = 0
    WHERE mode = 'paper' AND (exchange != '' OR testnet != 0);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS feature_flags (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS feature_flag_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      flag_id TEXT NOT NULL REFERENCES feature_flags(id),
      target_type TEXT NOT NULL CHECK(target_type IN ('user', 'role')),
      target_value TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      UNIQUE(flag_id, target_type, target_value)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS action_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      actor_id INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'self',
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_action_logs_user ON action_logs(user_id, timestamp);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_by INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      accepted_at INTEGER,
      revoked_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_invitations_active_email
      ON invitations(email)
      WHERE revoked_at IS NULL AND accepted_at IS NULL;
  `);

  // Seed feature flags
  const seedFlag = (id: string, description: string, enabled: number) => {
    const exists = db.prepare('SELECT id FROM feature_flags WHERE id = ?').get(id);
    if (!exists) {
      db.prepare('INSERT INTO feature_flags (id, description, enabled, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        id, description, enabled, 0, Date.now(), Date.now()
      );
    }
  };
  seedFlag('connectWallet', 'Show wallet connect button in top bar', 1);
  seedFlag('backtest', 'Show backtest page in navigation', 1);
}
