import Database from 'better-sqlite3';
import { runMigrations } from './migrations.js';
import type { Trade, Position, Candle, BotMode } from '../types/index.js';
import { DEFAULTS, DEFAULT_EXCHANGE } from '../utils/constants.js';

export interface DbUser {
  id: number;
  username: string;
  email: string | null;
  passwordHash: string;
  role: string;
  enabled: boolean;
  createdAt: number;
  lastLogin: number | null;
  /** Increments when sessions are revoked. Tokens carry the value they were signed with. */
  tokenVersion?: number;
  exchangeKey: string | null;
  exchangeSecret: string | null;
  exchangeTestnet: boolean;
  walletAddress: string | null;
  paperBalance: number;
  lang: string;
  theme: string;
  exchangeName: string;
  disclaimerAcceptedAt: number | null;
  disclaimerVersion: string | null;
  disclaimerLang: string | null;
  disclaimerSignature: string | null;
  disclaimerIp: string | null;
  disclaimerUserAgent: string | null;
}

export interface DbInvitation {
  id: string;
  email: string;
  tokenHash: string;
  createdBy: number;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
  revokedAt: number | null;
}

export interface DbFeatureFlag {
  id: string;
  description: string;
  enabled: boolean;
  createdBy: number;
  createdAt: number;
  updatedAt: number;
}

export interface DbFeatureFlagOverride {
  id: number;
  flagId: string;
  targetType: 'user' | 'role';
  targetValue: string;
  enabled: boolean;
}

export interface TradeFilters {
  symbol?: string;
  side?: string;
  strategy?: string;
  mode?: string;
  pnl?: 'profit' | 'loss';
  testnet?: string;
  exchange?: string;
  excludeZeroPnl?: boolean;
}

/** Rows read per query by the export iterators. */
export const EXPORT_PAGE_SIZE = 500;

function buildTradeFilterWhere(userId: number, filters?: TradeFilters): { where: string; params: unknown[] } {
  let where = 'WHERE user_id = ?';
  const params: unknown[] = [userId];
  if (filters?.symbol) { where += ' AND symbol = ?'; params.push(filters.symbol); }
  if (filters?.side) { where += ' AND side = ?'; params.push(filters.side); }
  if (filters?.strategy) { where += ' AND strategy = ?'; params.push(filters.strategy); }
  if (filters?.mode) { where += ' AND mode = ?'; params.push(filters.mode); }
  // "Network" (testnet vs mainnet) only applies to live trades — paper
  // trades are stored with testnet=0 and exchange='' which would otherwise
  // leak into the Mainnet filter.
  if (filters?.testnet === 'true') { where += " AND testnet = 1 AND mode = 'live'"; }
  if (filters?.testnet === 'false') { where += " AND testnet = 0 AND mode = 'live'"; }
  if (filters?.exchange) { where += ' AND exchange = ?'; params.push(filters.exchange); }
  if (filters?.pnl === 'profit') { where += ' AND pnl > 0'; }
  if (filters?.pnl === 'loss') { where += ' AND pnl < 0'; }
  if (filters?.excludeZeroPnl) { where += ' AND (pnl IS NULL OR pnl != 0)'; }
  return { where, params };
}

export interface Db {
  db: Database.Database;
  close(): void;
  insertTrade(trade: Trade): void;
  updateTradePnl(id: string, pnl: number): void;
  getTrades(userId: number, limit?: number): Trade[];
  getTradesPaginated(userId: number, page: number, limit: number, filters?: TradeFilters, sort?: { by: string; dir: 'asc' | 'desc' }): { data: Trade[]; total: number; totalPnl: number };
  getDailyPnlReport(userId: number): { date: string; pnl: number; tradeCount: number; volume: number; balance: number | null }[];
  upsertDailyEquitySnapshot(userId: number, totalEquity: number): void;
  exportTrades(userId: number, filters?: TradeFilters): Trade[];
  /**
   * Yields trades newest first, read in pages of `pageSize`. No SQLite cursor
   * stays open between pages, so the caller can await between rows and other
   * code can use the connection meanwhile.
   */
  iterateTrades(userId: number, filters?: TradeFilters, pageSize?: number): IterableIterator<Trade>;
  /** Yields open positions. Reads all rows first; a user has at most 100. */
  iteratePositions(userId: number): IterableIterator<Position>;
  getTradesBySymbol(userId: number, symbol: string): Trade[];
  getTradeDistinctSymbols(userId: number): string[];
  getTradeDistinctStrategies(userId: number): string[];
  upsertPosition(position: Position): void;
  getOpenPositions(userId: number): Position[];
  getOpenPositionsPaginated(userId: number, page: number, limit: number): { data: Position[]; total: number };
  removePosition(userId: number, id: string): void;
  setConfig(key: string, value: string): void;
  getConfig(key: string): string | undefined;
  insertCandles(symbol: string, interval: string, candles: Candle[]): void;
  getCandles(symbol: string, interval: string, from: number, to: number): Candle[];
  getDailyTrades(userId: number, options?: { mode?: BotMode; exchange?: string; testnet?: boolean; date?: Date }): Trade[];
  insertLead(email: string, meta?: { ip?: string; userAgent?: string; referrer?: string }): void;
  getLeads(): { id: number; email: string; createdAt: number; ip: string | null; userAgent: string | null; referrer: string | null }[];
  deleteLead(id: number): void;
  createUser(username: string, email: string | null, passwordHash: string, role: string): { id: number; username: string; role: string };
  getUserByUsername(username: string): DbUser | null;
  getUsers(): DbUser[];
  getUserById(id: number): DbUser | null;
  updateUser(id: number, updates: Partial<{ email: string | null; role: string; enabled: boolean; paperBalance: number; exchangeName: string }>): void;
  updateLastLogin(id: number): void;
  updateUserPassword(id: number, passwordHash: string): void;
  /** Revokes every token issued to the user before now. */
  bumpTokenVersion(id: number): void;
  updateUserPreferences(id: number, lang: string, theme: string): void;
  acceptDisclaimerForUser(userId: number, record: {
    version: string;
    lang: string;
    signature: string;
    ip: string | null;
    userAgent: string | null;
    timestamp: number;
  }): void;
  deleteUser(id: number): void;
  getUserConfig(userId: number): import('../types/index.js').BotConfig | null;
  setUserConfig(userId: number, config: import('../types/index.js').BotConfig): void;
  setBotEnabled(userId: number, enabled: boolean): void;
  getBotEnabled(userId: number): boolean;
  getEnabledBotUserIds(): number[];
  updateUserExchangeKeys(userId: number, key: string, secret: string, testnet: boolean): void;
  updateExchangeTestnet(userId: number, testnet: boolean): void;
  updateWalletAddress(userId: number, address: string | null): void;
  getUsersDailyPnl(): { userId: number; dailyPnl: number }[];
  // Admin: get all trades/positions across users
  getAllTrades(limit?: number): Trade[];
  /** Count and pnl sum over all trades, computed in SQL. A null pnl counts as 0. */
  getTradeTotals(): { count: number; totalPnl: number };
  getAllTradesPaginated(page: number, limit: number, filters?: TradeFilters & { userId?: number }): { data: Trade[]; total: number };
  getAllTradeDistinctSymbols(): string[];
  getAllTradeDistinctStrategies(): string[];
  getAllOpenPositions(): Position[];
  getAllOpenPositionsPaginated(page: number, limit: number): { data: Position[]; total: number };
  getUserTradesPaginated(userId: number, page: number, limit: number, filters?: TradeFilters): { data: Trade[]; total: number };
  getUserPositionsPaginated(userId: number, page: number, limit: number): { data: Position[]; total: number };
  // Action logs
  insertActionLog(userId: number, action: string, actorId: number, source: string): void;
  getActionLogs(userId: number, page: number, limit: number, filters?: { action?: string; source?: string }): { data: { id: number; userId: number; action: string; actorId: number; actorUsername: string; source: string; timestamp: number }[]; total: number };
  // Feature flags
  getActiveFlags(): DbFeatureFlag[];
  getFlagOverrides(flagId: string): DbFeatureFlagOverride[];
  getAllFlagOverrides(): DbFeatureFlagOverride[];
  createFlag(id: string, description: string, enabled: boolean, createdBy: number): void;
  updateFlag(id: string, updates: Partial<{ description: string; enabled: boolean }>): void;
  deleteFlag(id: string): void;
  replaceFlagOverrides(flagId: string, overrides: { targetType: string; targetValue: string; enabled: boolean }[]): void;
  // Invitations
  createInvitation(inv: Omit<DbInvitation, 'acceptedAt' | 'revokedAt'>): void;
  getInvitationByTokenHash(tokenHash: string): DbInvitation | null;
  getInvitationById(id: string): DbInvitation | null;
  getActiveInvitationByEmail(email: string): DbInvitation | null;
  listInvitations(opts: { includeAll: boolean }): DbInvitation[];
  updateInvitationState(id: string, patch: { acceptedAt?: number; revokedAt?: number }): void;
}

export function createDb(filepath: string): Db {
  const db = new Database(filepath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);

  const stmts = {
    insertTrade: db.prepare(`
      INSERT INTO trades (id, symbol, side, price, quantity, amount, strategy, mode, market_type, order_id, pnl, timestamp, user_id, testnet, exchange, close_reason)
      VALUES (@id, @symbol, @side, @price, @quantity, @amount, @strategy, @mode, @marketType, @orderId, @pnl, @timestamp, @userId, @testnet, @exchange, @closeReason)
    `),
    updateTradePnl: db.prepare('UPDATE trades SET pnl = ? WHERE id = ?'),
    getTrades: db.prepare('SELECT * FROM trades WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?'),
    getTradesPaginated: db.prepare('SELECT * FROM trades WHERE user_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?'),
    getTradesCount: db.prepare('SELECT COUNT(*) as count FROM trades WHERE user_id = ?'),
    getTradesBySymbol: db.prepare('SELECT * FROM trades WHERE user_id = ? AND symbol = ? ORDER BY timestamp DESC'),
    getTradeDistinctSymbols: db.prepare('SELECT DISTINCT symbol FROM trades WHERE user_id = ? ORDER BY symbol'),
    getTradeDistinctStrategies: db.prepare('SELECT DISTINCT strategy FROM trades WHERE user_id = ? ORDER BY strategy'),
    upsertPosition: db.prepare(`
      INSERT OR REPLACE INTO positions (id, symbol, side, entry_price, quantity, amount, current_price, pnl, pnl_pct, strategy, mode, market_type, stop_loss, opened_at, user_id, testnet, exchange)
      VALUES (@id, @symbol, @side, @entryPrice, @quantity, @amount, @currentPrice, @pnl, @pnlPct, @strategy, @mode, @marketType, @stopLoss, @openedAt, @userId, @testnet, @exchange)
    `),
    getOpenPositions: db.prepare('SELECT * FROM positions WHERE user_id = ?'),
    getOpenPositionsPaginated: db.prepare('SELECT * FROM positions WHERE user_id = ? ORDER BY opened_at DESC LIMIT ? OFFSET ?'),
    getOpenPositionsCount: db.prepare('SELECT COUNT(*) as count FROM positions WHERE user_id = ?'),
    removePosition: db.prepare('DELETE FROM positions WHERE id = ? AND user_id = ?'),
    setConfig: db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)'),
    getConfig: db.prepare('SELECT value FROM config WHERE key = ?'),
    insertCandle: db.prepare(`
      INSERT OR REPLACE INTO candles (symbol, interval, timestamp, open, high, low, close, volume)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getCandles: db.prepare('SELECT * FROM candles WHERE symbol = ? AND interval = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC'),
    getDailyTrades: db.prepare('SELECT * FROM trades WHERE user_id = ? AND timestamp >= ? AND timestamp < ? ORDER BY timestamp DESC'),
    insertLead: db.prepare('INSERT OR IGNORE INTO leads (email, created_at, ip, user_agent, referrer) VALUES (?, ?, ?, ?, ?)'),
    getLeads: db.prepare('SELECT * FROM leads WHERE deleted_at IS NULL ORDER BY created_at DESC'),
    deleteLead: db.prepare('UPDATE leads SET deleted_at = ? WHERE id = ?'),
    createUser: db.prepare('INSERT INTO users (username, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)'),
    getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ? AND deleted_at IS NULL'),
    getUsers: db.prepare('SELECT * FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC'),
    getUserById: db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL'),
    updateLastLogin: db.prepare('UPDATE users SET last_login = ? WHERE id = ?'),
    deleteUser: db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?'),
    getUserConfig: db.prepare('SELECT config FROM user_config WHERE user_id = ?'),
    setUserConfig: db.prepare(`
      INSERT INTO user_config (user_id, config) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET config = excluded.config
    `),
    setBotEnabled: db.prepare(`
      INSERT INTO user_config (user_id, config, bot_enabled)
      VALUES (?, '{}', ?)
      ON CONFLICT(user_id) DO UPDATE SET bot_enabled = excluded.bot_enabled
    `),
    getBotEnabled: db.prepare('SELECT bot_enabled FROM user_config WHERE user_id = ?'),
    getEnabledBotUserIds: db.prepare(`
      SELECT uc.user_id
      FROM user_config uc
      JOIN users u ON u.id = uc.user_id
      WHERE uc.bot_enabled = 1
        AND u.deleted_at IS NULL
        AND u.enabled = 1
    `),
    updateExchangeKeys: db.prepare('UPDATE users SET exchange_key = ?, exchange_secret = ?, exchange_testnet = ? WHERE id = ?'),
    updateExchangeTestnet: db.prepare('UPDATE users SET exchange_testnet = ? WHERE id = ?'),
    updateWalletAddress: db.prepare('UPDATE users SET wallet_address = ? WHERE id = ?'),
    updateUserPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
    acceptDisclaimer: db.prepare(
      `UPDATE users SET
         disclaimer_accepted_at = @acceptedAt,
         disclaimer_version = @version,
         disclaimer_lang = @lang,
         disclaimer_signature = @signature,
         disclaimer_ip = @ip,
         disclaimer_user_agent = @userAgent
       WHERE id = @id AND disclaimer_accepted_at IS NULL`,
    ),
    updateUserPreferences: db.prepare('UPDATE users SET lang = ?, theme = ? WHERE id = ?'),
    getAllTrades: db.prepare('SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?'),
    getAllTradesPaginated: db.prepare('SELECT * FROM trades ORDER BY timestamp DESC LIMIT ? OFFSET ?'),
    getAllTradesCount: db.prepare('SELECT COUNT(*) as count FROM trades'),
    getTradeTotals: db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(pnl), 0) as totalPnl FROM trades'),
    getAllTradeDistinctSymbols: db.prepare('SELECT DISTINCT symbol FROM trades ORDER BY symbol'),
    getAllTradeDistinctStrategies: db.prepare('SELECT DISTINCT strategy FROM trades ORDER BY strategy'),
    getAllOpenPositions: db.prepare('SELECT * FROM positions'),
    getAllOpenPositionsPaginated: db.prepare('SELECT * FROM positions ORDER BY opened_at DESC LIMIT ? OFFSET ?'),
    getAllOpenPositionsCount: db.prepare('SELECT COUNT(*) as count FROM positions'),
    getActiveFlags: db.prepare('SELECT * FROM feature_flags WHERE deleted_at IS NULL ORDER BY created_at DESC'),
    getFlagOverrides: db.prepare('SELECT * FROM feature_flag_overrides WHERE flag_id = ?'),
    getAllFlagOverrides: db.prepare('SELECT * FROM feature_flag_overrides WHERE flag_id IN (SELECT id FROM feature_flags WHERE deleted_at IS NULL)'),
    createFlag: db.prepare('INSERT INTO feature_flags (id, description, enabled, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'),
    deleteFlag: db.prepare('UPDATE feature_flags SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'),
    deleteFlagOverrides: db.prepare('DELETE FROM feature_flag_overrides WHERE flag_id = ?'),
    insertFlagOverride: db.prepare('INSERT INTO feature_flag_overrides (flag_id, target_type, target_value, enabled) VALUES (?, ?, ?, ?)'),
    insertActionLog: db.prepare('INSERT INTO action_logs (user_id, action, actor_id, source, timestamp) VALUES (?, ?, ?, ?, ?)'),
    getActionLogs: db.prepare('SELECT a.*, u.username as actor_username FROM action_logs a LEFT JOIN users u ON a.actor_id = u.id WHERE a.user_id = ? ORDER BY a.timestamp DESC LIMIT ? OFFSET ?'),
    getActionLogsCount: db.prepare('SELECT COUNT(*) as count FROM action_logs WHERE user_id = ?'),
    insertInvitation: db.prepare(`
      INSERT INTO invitations (id, email, token_hash, created_by, created_at, expires_at)
      VALUES (@id, @email, @tokenHash, @createdBy, @createdAt, @expiresAt)
    `),
    getInvitationByHash: db.prepare('SELECT * FROM invitations WHERE token_hash = ?'),
    getInvitationById: db.prepare('SELECT * FROM invitations WHERE id = ?'),
    getActiveInvitationByEmail: db.prepare(`
      SELECT * FROM invitations
      WHERE email = ? AND accepted_at IS NULL AND revoked_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    `),
    listInvitationsAll: db.prepare('SELECT * FROM invitations ORDER BY created_at DESC'),
    listInvitationsActive: db.prepare('SELECT * FROM invitations WHERE accepted_at IS NULL AND revoked_at IS NULL ORDER BY created_at DESC'),
  };

  function mapPosition(row: Record<string, unknown>): Position {
    return {
      id: row.id as string,
      symbol: row.symbol as string,
      side: row.side as 'buy' | 'sell',
      entryPrice: row.entry_price as number,
      quantity: row.quantity as number,
      amount: row.amount as number,
      currentPrice: row.current_price as number,
      pnl: row.pnl as number,
      pnlPct: row.pnl_pct as number,
      strategy: row.strategy as string,
      mode: (row.mode as 'live' | 'paper') ?? 'paper',
      marketType: row.market_type as 'spot' | 'futures',
      stopLoss: row.stop_loss as number | null,
      openedAt: row.opened_at as number,
      userId: (row.user_id as number) ?? 0,
      testnet: !!(row.testnet),
      exchange: (row.exchange as string) ?? DEFAULT_EXCHANGE,
    };
  }

  function mapTrade(row: Record<string, unknown>): Trade {
    return {
      id: row.id as string,
      symbol: row.symbol as string,
      side: row.side as 'buy' | 'sell',
      price: row.price as number,
      quantity: row.quantity as number,
      amount: row.amount as number,
      strategy: row.strategy as string,
      mode: row.mode as 'live' | 'paper',
      marketType: row.market_type as 'spot' | 'futures',
      orderId: row.order_id as string,
      pnl: row.pnl as number | null,
      timestamp: row.timestamp as number,
      userId: (row.user_id as number) ?? 0,
      testnet: !!(row.testnet),
      exchange: (row.exchange as string) ?? DEFAULT_EXCHANGE,
      closeReason: (row.close_reason as Trade['closeReason']) ?? null,
    };
  }

  function mapUser(row: Record<string, unknown>): DbUser {
    return {
      id: row.id as number,
      username: row.username as string,
      email: row.email as string | null,
      passwordHash: row.password_hash as string,
      role: row.role as string,
      enabled: (row.enabled as number) === 1,
      createdAt: row.created_at as number,
      lastLogin: row.last_login as number | null,
      tokenVersion: (row.token_version as number | null) ?? 0,
      exchangeKey: (row.exchange_key as string) ?? null,
      exchangeSecret: (row.exchange_secret as string) ?? null,
      exchangeTestnet: row.exchange_testnet == null ? true : (row.exchange_testnet as number) === 1,
      walletAddress: (row.wallet_address as string) ?? null,
      paperBalance: (row.paper_balance as number) ?? 10000,
      lang: (row.lang as string) ?? DEFAULTS.VALID_LANGS[0],
      theme: (row.theme as string) ?? DEFAULTS.VALID_THEMES[0],
      exchangeName: (row.exchange_name as string) ?? DEFAULT_EXCHANGE,
      disclaimerAcceptedAt: (row.disclaimer_accepted_at as number | null) ?? null,
      disclaimerVersion: (row.disclaimer_version as string | null) ?? null,
      disclaimerLang: (row.disclaimer_lang as string | null) ?? null,
      disclaimerSignature: (row.disclaimer_signature as string | null) ?? null,
      disclaimerIp: (row.disclaimer_ip as string | null) ?? null,
      disclaimerUserAgent: (row.disclaimer_user_agent as string | null) ?? null,
    };
  }

  function mapCandle(row: Record<string, unknown>): Candle {
    return {
      timestamp: row.timestamp as number,
      open: row.open as number,
      high: row.high as number,
      low: row.low as number,
      close: row.close as number,
      volume: row.volume as number,
    };
  }

  function mapFlag(row: Record<string, unknown>): DbFeatureFlag {
    return {
      id: row.id as string,
      description: row.description as string,
      enabled: (row.enabled as number) === 1,
      createdBy: row.created_by as number,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  function mapFlagOverride(row: Record<string, unknown>): DbFeatureFlagOverride {
    return {
      id: row.id as number,
      flagId: row.flag_id as string,
      targetType: row.target_type as 'user' | 'role',
      targetValue: row.target_value as string,
      enabled: (row.enabled as number) === 1,
    };
  }

  function rowToInvitation(row: Record<string, unknown>): DbInvitation {
    return {
      id: row.id as string,
      email: row.email as string,
      tokenHash: row.token_hash as string,
      createdBy: row.created_by as number,
      createdAt: row.created_at as number,
      expiresAt: row.expires_at as number,
      acceptedAt: (row.accepted_at as number | null) ?? null,
      revokedAt: (row.revoked_at as number | null) ?? null,
    };
  }

  return {
    db,
    close: () => db.close(),
    insertTrade(trade: Trade) {
      stmts.insertTrade.run({
        ...trade,
        testnet: trade.testnet ? 1 : 0,
        closeReason: trade.closeReason ?? null,
      });
    },
    updateTradePnl(id: string, pnl: number) { stmts.updateTradePnl.run(pnl, id); },
    getTrades(userId: number, limit = 100) { return (stmts.getTrades.all(userId, limit) as Record<string, unknown>[]).map(mapTrade); },
    getTradesPaginated(userId: number, page: number, limit: number, filters?: TradeFilters, sort?: { by: string; dir: 'asc' | 'desc' }) {
      const SORT_WHITELIST: Record<string, string> = {
        timestamp: 'timestamp', price: 'price', amount: 'amount',
        pnl: 'pnl', symbol: 'symbol', side: 'side', strategy: 'strategy',
      };
      const col = (sort?.by && SORT_WHITELIST[sort.by]) || 'timestamp';
      const dir = sort?.dir === 'asc' ? 'ASC' : 'DESC';
      const { where, params } = buildTradeFilterWhere(userId, filters);
      const agg = db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(pnl), 0) as totalPnl FROM trades ${where}`).get(...params) as { count: number; totalPnl: number };
      const data = (db.prepare(`SELECT * FROM trades ${where} ORDER BY ${col} ${dir} LIMIT ? OFFSET ?`).all(...params, limit, page * limit) as Record<string, unknown>[]).map(mapTrade);
      return { data, total: agg.count, totalPnl: agg.totalPnl };
    },
    getDailyPnlReport(userId: number) {
      return db.prepare(`
        SELECT DATE(t.timestamp / 1000, 'unixepoch', 'localtime') as date,
               COALESCE(SUM(t.pnl), 0) as pnl,
               COUNT(*) as tradeCount,
               COALESCE(SUM(t.amount), 0) as volume,
               MAX(s.total_equity) as balance
        FROM trades t
        LEFT JOIN daily_equity_snapshots s
          ON s.user_id = t.user_id AND s.date = DATE(t.timestamp / 1000, 'unixepoch', 'localtime')
        WHERE t.user_id = ? AND t.pnl IS NOT NULL
        GROUP BY DATE(t.timestamp / 1000, 'unixepoch', 'localtime')
        ORDER BY date DESC
      `).all(userId) as { date: string; pnl: number; tradeCount: number; volume: number; balance: number | null }[];
    },
    upsertDailyEquitySnapshot(userId: number, totalEquity: number) {
      db.prepare(`
        INSERT INTO daily_equity_snapshots (user_id, date, total_equity, updated_at)
        VALUES (?, DATE('now', 'localtime'), ?, ?)
        ON CONFLICT(user_id, date) DO UPDATE SET
          total_equity = excluded.total_equity,
          updated_at = excluded.updated_at
      `).run(userId, totalEquity, Date.now());
    },
    exportTrades(userId: number, filters?: TradeFilters) {
      const { where, params } = buildTradeFilterWhere(userId, filters);
      return (db.prepare(`SELECT * FROM trades ${where} ORDER BY timestamp DESC`).all(...params) as Record<string, unknown>[]).map(mapTrade);
    },
    iterateTrades(userId: number, filters?: TradeFilters, pageSize = EXPORT_PAGE_SIZE) {
      // Keyset paging on (timestamp, rowid). rowid breaks ties in the same
      // order as the (user_id, timestamp) index scan of the old single query.
      const { where, params } = buildTradeFilterWhere(userId, filters);
      const first = db.prepare(`SELECT rowid AS _rowid, * FROM trades ${where} ORDER BY timestamp DESC, rowid DESC LIMIT ?`);
      const next = db.prepare(
        `SELECT rowid AS _rowid, * FROM trades ${where} AND timestamp <= ? AND (timestamp < ? OR rowid < ?) `
        + 'ORDER BY timestamp DESC, rowid DESC LIMIT ?',
      );
      return (function* () {
        let page = first.all(...params, pageSize) as Record<string, unknown>[];
        while (page.length > 0) {
          for (const row of page) yield mapTrade(row);
          if (page.length < pageSize) return;
          const last = page[page.length - 1];
          page = next.all(...params, last.timestamp, last.timestamp, last._rowid, pageSize) as Record<string, unknown>[];
        }
      })();
    },
    iteratePositions(userId: number) {
      const rows = db.prepare('SELECT * FROM positions WHERE user_id = ?').all(userId) as Record<string, unknown>[];
      return (function* () {
        for (const row of rows) yield mapPosition(row);
      })();
    },
    getTradesBySymbol(userId: number, symbol: string) { return (stmts.getTradesBySymbol.all(userId, symbol) as Record<string, unknown>[]).map(mapTrade); },
    getTradeDistinctSymbols(userId: number) { return (stmts.getTradeDistinctSymbols.all(userId) as { symbol: string }[]).map((r) => r.symbol); },
    getTradeDistinctStrategies(userId: number) { return (stmts.getTradeDistinctStrategies.all(userId) as { strategy: string }[]).map((r) => r.strategy); },
    upsertPosition(position: Position) { stmts.upsertPosition.run({ ...position, testnet: position.testnet ? 1 : 0 }); },
    getOpenPositions(userId: number) { return (stmts.getOpenPositions.all(userId) as Record<string, unknown>[]).map(mapPosition); },
    getOpenPositionsPaginated(userId: number, page: number, limit: number) {
      const total = (stmts.getOpenPositionsCount.get(userId) as { count: number }).count;
      const data = (stmts.getOpenPositionsPaginated.all(userId, limit, page * limit) as Record<string, unknown>[]).map(mapPosition);
      return { data, total };
    },
    removePosition(userId: number, id: string) { stmts.removePosition.run(id, userId); },
    setConfig(key: string, value: string) { stmts.setConfig.run(key, value); },
    getConfig(key: string) { const row = stmts.getConfig.get(key) as { value: string } | undefined; return row?.value; },
    insertCandles(symbol: string, interval: string, candles: Candle[]) {
      const insert = db.transaction((rows: Candle[]) => {
        for (const c of rows) { stmts.insertCandle.run(symbol, interval, c.timestamp, c.open, c.high, c.low, c.close, c.volume); }
      });
      insert(candles);
    },
    getCandles(symbol: string, interval: string, from: number, to: number) {
      return (stmts.getCandles.all(symbol, interval, from, to) as Record<string, unknown>[]).map(mapCandle);
    },
    getDailyTrades(userId: number, options: { mode?: BotMode; exchange?: string; testnet?: boolean; date?: Date } = {}) {
      const start = new Date(options.date ?? new Date()); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(end.getDate() + 1);
      const clauses = ['user_id = ?', 'timestamp >= ?', 'timestamp < ?'];
      const params: unknown[] = [userId, start.getTime(), end.getTime()];
      if (options.mode !== undefined) { clauses.push('mode = ?'); params.push(options.mode); }
      if (options.exchange !== undefined) { clauses.push('exchange = ?'); params.push(options.exchange); }
      if (options.testnet !== undefined) { clauses.push('testnet = ?'); params.push(options.testnet ? 1 : 0); }
      const sql = `SELECT * FROM trades WHERE ${clauses.join(' AND ')} ORDER BY timestamp DESC`;
      const rows = db.prepare(sql).all(...params as any[]);
      return (rows as Record<string, unknown>[]).map(mapTrade);
    },
    insertLead(email: string, meta?: { ip?: string; userAgent?: string; referrer?: string }) {
      stmts.insertLead.run(email, Date.now(), meta?.ip ?? null, meta?.userAgent ?? null, meta?.referrer ?? null);
    },
    getLeads() {
      return (stmts.getLeads.all() as Record<string, unknown>[]).map((r) => ({
        id: r.id as number, email: r.email as string, createdAt: r.created_at as number,
        ip: (r.ip as string) ?? null, userAgent: (r.user_agent as string) ?? null, referrer: (r.referrer as string) ?? null,
      }));
    },
    deleteLead(id: number) {
      stmts.deleteLead.run(Date.now(), id);
    },
    createUser(username: string, email: string | null, passwordHash: string, role: string) {
      const result = stmts.createUser.run(username, email, passwordHash, role, Date.now());
      return { id: Number(result.lastInsertRowid), username, role };
    },
    getUserByUsername(username: string) {
      const row = stmts.getUserByUsername.get(username) as Record<string, unknown> | undefined;
      return row ? mapUser(row) : null;
    },
    getUsers() {
      return (stmts.getUsers.all() as Record<string, unknown>[]).map(mapUser);
    },
    bumpTokenVersion(id: number) {
      db.prepare('UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?').run(id);
    },
    getUserById(id: number) {
      const row = stmts.getUserById.get(id) as Record<string, unknown> | undefined;
      return row ? mapUser(row) : null;
    },
    updateUser(id: number, updates: Partial<{ email: string | null; role: string; enabled: boolean; paperBalance: number; exchangeName: string }>) {
      const fields: string[] = [];
      const values: unknown[] = [];
      if (updates.email !== undefined) { fields.push('email = ?'); values.push(updates.email); }
      if (updates.role !== undefined) { fields.push('role = ?'); values.push(updates.role); }
      if (updates.enabled !== undefined) { fields.push('enabled = ?'); values.push(updates.enabled ? 1 : 0); }
      if (updates.paperBalance !== undefined) { fields.push('paper_balance = ?'); values.push(updates.paperBalance); }
      if (updates.exchangeName !== undefined) { fields.push('exchange_name = ?'); values.push(updates.exchangeName); }
      if (fields.length === 0) return;
      values.push(id);
      db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    },
    updateLastLogin(id: number) {
      stmts.updateLastLogin.run(Date.now(), id);
    },
    updateUserPassword(id: number, passwordHash: string) {
      stmts.updateUserPassword.run(passwordHash, id);
    },
    updateUserPreferences(id: number, lang: string, theme: string) {
      stmts.updateUserPreferences.run(lang, theme, id);
    },
    acceptDisclaimerForUser(userId, record) {
      stmts.acceptDisclaimer.run({
        id: userId,
        acceptedAt: record.timestamp,
        version: record.version,
        lang: record.lang,
        signature: record.signature,
        ip: record.ip,
        userAgent: record.userAgent,
      });
    },
    deleteUser(id: number) {
      stmts.deleteUser.run(Date.now(), id);
    },
    getUserConfig(userId: number) {
      const row = stmts.getUserConfig.get(userId) as { config: string } | undefined;
      if (!row) return null;
      try {
        const parsed = JSON.parse(row.config);
        // A valid BotConfig has at minimum a `mode` field. Anything
        // else (e.g. a stub row left behind by setBotEnabled for a
        // user who never saved config) is treated as "no config" so
        // callers fall through to createBotConfig('paper').
        if (!parsed || typeof parsed !== 'object' || !parsed.mode) return null;
        return parsed;
      } catch { return null; }
    },
    setUserConfig(userId: number, config: import('../types/index.js').BotConfig) {
      stmts.setUserConfig.run(userId, JSON.stringify(config));
    },
    setBotEnabled(userId: number, enabled: boolean) {
      stmts.setBotEnabled.run(userId, enabled ? 1 : 0);
    },
    getBotEnabled(userId: number): boolean {
      const row = stmts.getBotEnabled.get(userId) as { bot_enabled: number } | undefined;
      return row?.bot_enabled === 1;
    },
    getEnabledBotUserIds(): number[] {
      return (stmts.getEnabledBotUserIds.all() as { user_id: number }[]).map((r) => r.user_id);
    },
    updateUserExchangeKeys(userId: number, key: string, secret: string, testnet: boolean) {
      stmts.updateExchangeKeys.run(key, secret, testnet ? 1 : 0, userId);
    },
    updateExchangeTestnet(userId: number, testnet: boolean) {
      stmts.updateExchangeTestnet.run(testnet ? 1 : 0, userId);
    },
    updateWalletAddress(userId: number, address: string | null) {
      stmts.updateWalletAddress.run(address, userId);
    },
    getUsersDailyPnl() {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(end.getDate() + 1);
      return db.prepare(`
        SELECT user_id as userId, COALESCE(SUM(pnl), 0) as dailyPnl
        FROM trades
        WHERE timestamp >= ? AND timestamp < ? AND pnl IS NOT NULL
        GROUP BY user_id
      `).all(start.getTime(), end.getTime()) as { userId: number; dailyPnl: number }[];
    },
    getTradeTotals() { return stmts.getTradeTotals.get() as { count: number; totalPnl: number }; },
    getAllTrades(limit = 100) { return (stmts.getAllTrades.all(limit) as Record<string, unknown>[]).map(mapTrade); },
    getAllTradesPaginated(page: number, limit: number, filters?: TradeFilters & { userId?: number }) {
      let where = 'WHERE 1=1';
      const params: unknown[] = [];
      if (filters?.userId) { where += ' AND user_id = ?'; params.push(filters.userId); }
      if (filters?.symbol) { where += ' AND symbol = ?'; params.push(filters.symbol); }
      if (filters?.side) { where += ' AND side = ?'; params.push(filters.side); }
      if (filters?.strategy) { where += ' AND strategy = ?'; params.push(filters.strategy); }
      if (filters?.mode) { where += ' AND mode = ?'; params.push(filters.mode); }
      // "Network" (testnet vs mainnet) only applies to live trades — paper
      // trades are stored with testnet=0 and exchange='' which would otherwise
      // leak into the Mainnet filter.
      if (filters?.testnet === 'true') { where += " AND testnet = 1 AND mode = 'live'"; }
      if (filters?.testnet === 'false') { where += " AND testnet = 0 AND mode = 'live'"; }
      if (filters?.exchange) { where += ' AND exchange = ?'; params.push(filters.exchange); }
      if (filters?.pnl === 'profit') { where += ' AND pnl > 0'; }
      if (filters?.pnl === 'loss') { where += ' AND pnl < 0'; }
      if (filters?.excludeZeroPnl) { where += ' AND (pnl IS NULL OR pnl != 0)'; }
      const SORT_WHITELIST: Record<string, string> = {
        timestamp: 'timestamp', price: 'price', amount: 'amount',
        pnl: 'pnl', symbol: 'symbol', side: 'side', strategy: 'strategy',
      };
      const col = (filters as any)?.sortBy && SORT_WHITELIST[(filters as any).sortBy] || 'timestamp';
      const dir = (filters as any)?.sortDir === 'asc' ? 'ASC' : 'DESC';
      const total = (db.prepare(`SELECT COUNT(*) as count FROM trades ${where}`).get(...params) as { count: number }).count;
      const data = (db.prepare(`SELECT * FROM trades ${where} ORDER BY ${col} ${dir} LIMIT ? OFFSET ?`).all(...params, limit, page * limit) as Record<string, unknown>[]).map(mapTrade);
      return { data, total };
    },
    getAllTradeDistinctSymbols() { return (stmts.getAllTradeDistinctSymbols.all() as { symbol: string }[]).map((r) => r.symbol); },
    getAllTradeDistinctStrategies() { return (stmts.getAllTradeDistinctStrategies.all() as { strategy: string }[]).map((r) => r.strategy); },
    getAllOpenPositions() { return (stmts.getAllOpenPositions.all() as Record<string, unknown>[]).map(mapPosition); },
    getAllOpenPositionsPaginated(page: number, limit: number) {
      const total = (stmts.getAllOpenPositionsCount.get() as { count: number }).count;
      const data = (stmts.getAllOpenPositionsPaginated.all(limit, page * limit) as Record<string, unknown>[]).map(mapPosition);
      return { data, total };
    },
    getUserTradesPaginated(userId: number, page: number, limit: number, filters?: TradeFilters) {
      return this.getTradesPaginated(userId, page, limit, filters);
    },
    getUserPositionsPaginated(userId: number, page: number, limit: number) {
      return this.getOpenPositionsPaginated(userId, page, limit);
    },
    getActiveFlags() {
      return (stmts.getActiveFlags.all() as Record<string, unknown>[]).map(mapFlag);
    },
    getFlagOverrides(flagId: string) {
      return (stmts.getFlagOverrides.all(flagId) as Record<string, unknown>[]).map(mapFlagOverride);
    },
    getAllFlagOverrides() {
      return (stmts.getAllFlagOverrides.all() as Record<string, unknown>[]).map(mapFlagOverride);
    },
    createFlag(id: string, description: string, enabled: boolean, createdBy: number) {
      const now = Date.now();
      stmts.createFlag.run(id, description, enabled ? 1 : 0, createdBy, now, now);
    },
    updateFlag(id: string, updates: Partial<{ description: string; enabled: boolean }>) {
      const fields: string[] = [];
      const values: unknown[] = [];
      if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
      if (updates.enabled !== undefined) { fields.push('enabled = ?'); values.push(updates.enabled ? 1 : 0); }
      if (fields.length === 0) return;
      fields.push('updated_at = ?');
      values.push(Date.now());
      values.push(id);
      db.prepare(`UPDATE feature_flags SET ${fields.join(', ')} WHERE id = ? AND deleted_at IS NULL`).run(...values);
    },
    deleteFlag(id: string) {
      const now = Date.now();
      stmts.deleteFlag.run(now, now, id);
    },
    insertActionLog(userId: number, action: string, actorId: number, source: string) {
      stmts.insertActionLog.run(userId, action, actorId, source, Date.now());
    },
    getActionLogs(userId: number, page: number, limit: number, filters?: { action?: string; source?: string }) {
      const offset = page * limit;
      let where = 'WHERE a.user_id = ?';
      const params: unknown[] = [userId];
      if (filters?.action) { where += ' AND a.action = ?'; params.push(filters.action); }
      if (filters?.source) { where += ' AND a.source = ?'; params.push(filters.source); }
      const data = (db.prepare(
        `SELECT a.*, u.username as actor_username FROM action_logs a
         LEFT JOIN users u ON a.actor_id = u.id
         ${where} ORDER BY a.timestamp DESC LIMIT ? OFFSET ?`,
      ).all(...params, limit, offset) as Record<string, unknown>[]).map((r) => ({
        id: r.id as number,
        userId: r.user_id as number,
        action: r.action as string,
        actorId: r.actor_id as number,
        actorUsername: (r.actor_username as string) || 'unknown',
        source: r.source as string,
        timestamp: r.timestamp as number,
      }));
      const countWhere = where.replace(/a\./g, '');
      const total = (db.prepare(`SELECT COUNT(*) as count FROM action_logs ${countWhere}`).get(...params) as { count: number }).count;
      return { data, total };
    },
    replaceFlagOverrides(flagId: string, overrides: { targetType: string; targetValue: string; enabled: boolean }[]) {
      const replace = db.transaction(() => {
        stmts.deleteFlagOverrides.run(flagId);
        for (const o of overrides) {
          stmts.insertFlagOverride.run(flagId, o.targetType, o.targetValue, o.enabled ? 1 : 0);
        }
      });
      replace();
      db.prepare('UPDATE feature_flags SET updated_at = ? WHERE id = ?').run(Date.now(), flagId);
    },
    createInvitation(inv) {
      stmts.insertInvitation.run(inv);
    },
    getInvitationByTokenHash(tokenHash) {
      const row = stmts.getInvitationByHash.get(tokenHash) as Record<string, unknown> | undefined;
      return row ? rowToInvitation(row) : null;
    },
    getInvitationById(id) {
      const row = stmts.getInvitationById.get(id) as Record<string, unknown> | undefined;
      return row ? rowToInvitation(row) : null;
    },
    getActiveInvitationByEmail(email) {
      const row = stmts.getActiveInvitationByEmail.get(email) as Record<string, unknown> | undefined;
      return row ? rowToInvitation(row) : null;
    },
    listInvitations({ includeAll }) {
      const rows = (includeAll ? stmts.listInvitationsAll : stmts.listInvitationsActive).all() as Record<string, unknown>[];
      return rows.map(rowToInvitation);
    },
    updateInvitationState(id, patch) {
      const fields: string[] = [];
      const params: Record<string, unknown> = { id };
      if (patch.acceptedAt !== undefined) { fields.push('accepted_at = @acceptedAt'); params.acceptedAt = patch.acceptedAt; }
      if (patch.revokedAt !== undefined) { fields.push('revoked_at = @revokedAt'); params.revokedAt = patch.revokedAt; }
      if (fields.length === 0) return;
      db.prepare(`UPDATE invitations SET ${fields.join(', ')} WHERE id = @id`).run(params);
    },
  };
}
