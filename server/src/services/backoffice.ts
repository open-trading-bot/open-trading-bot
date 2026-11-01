import type { Db, DbUser, TradeFilters } from '../db/index.js';
import type { BotManager } from '../engine/bot-manager.js';
import type { Trade, Position, BotStatus } from '../types/index.js';
import { getRiskPreset } from '../types/index.js';
import { hashPassword } from '../db/seed.js';
import { ERROR_MSG, BOT_ACTIONS, ACTION_SOURCES } from '../utils/constants.js';
import { blockUser, unblockUser, isBlocked } from '../utils/token-blocklist.js';
import logger from '../utils/logger.js';

export interface UserBotStatus {
  userId: number;
  username: string;
  status: BotStatus;
  mode: string;
  blocked: boolean;
  testnet: boolean;
}

export interface BackofficeService {
  getLeads(): { id: number; email: string; createdAt: number }[];
  deleteLead(id: number): void;
  getStats(): Promise<{ totalTrades: number; openPositions: number; totalPnl: number }>;
  getUsers(): DbUser[];
  createUser(username: string, password: string, email: string | null, role: string): { id: number; username: string; role: string };
  updateUser(id: number, updates: Partial<{ email: string | null; role: string; enabled: boolean; paperBalance: number }>, adminId?: number): Promise<void>;
  updateUserPassword(id: number, password: string): void;
  deleteUser(id: number, adminId?: number): void;
  getAllTrades(limit: number): Trade[];
  getAllTradesPaginated(page: number, limit: number, filters?: TradeFilters & { userId?: number }): { data: Trade[]; total: number; page: number; totalPages: number };
  getAllTradeFilters(): { symbols: string[]; strategies: string[] };
  getAllPositions(): Position[];
  getAllPositionsPaginated(page: number, limit: number): { data: Position[]; total: number; page: number; totalPages: number };
  getUsersDailyPnl(): { userId: number; dailyPnl: number }[];
  getUserBotStatuses(): UserBotStatus[];
  getUserTrades(userId: number, limit: number): Trade[];
  getUserTradesPaginated(userId: number, page: number, limit: number, filters?: TradeFilters): { data: Trade[]; total: number; page: number; totalPages: number };
  getUserTradeFilters(userId: number): { symbols: string[]; strategies: string[] };
  getUserPositions(userId: number): Position[];
  getUserPositionsPaginated(userId: number, page: number, limit: number): { data: Position[]; total: number; page: number; totalPages: number };
  getUserBotStatus(userId: number): UserBotStatus | null;
  getUserActionLogs(userId: number, page: number, limit: number, filters?: { action?: string; source?: string }): { data: { id: number; userId: number; action: string; actorId: number; actorUsername: string; source: string; timestamp: number }[]; total: number; page: number; totalPages: number };
}

export function createBackofficeService(db: Db, botManager: BotManager): BackofficeService {
  // Invalidates every token issued to the user, also after a restart.
  // The blocklist entry only drives the "revoked" badge in the backoffice.
  function revokeSessions(id: number): void {
    db.bumpTokenVersion(id);
    blockUser(id);
  }

  return {
    getLeads() {
      return db.getLeads();
    },

    deleteLead(id: number) {
      db.deleteLead(id);
    },

    async getStats() {
      const totals = db.getTradeTotals();
      const positions = db.getAllOpenPositions();
      return {
        totalTrades: totals.count,
        openPositions: positions.length,
        totalPnl: totals.totalPnl,
      };
    },

    getUsers() {
      return db.getUsers();
    },

    createUser(username: string, password: string, email: string | null, role: string) {
      const existing = db.getUserByUsername(username);
      if (existing) throw new Error(ERROR_MSG.USERNAME_TAKEN);
      return db.createUser(username, email, hashPassword(password), role);
    },

    async updateUser(id: number, updates: Partial<{ email: string | null; role: string; enabled: boolean; paperBalance: number }>, adminId?: number) {
      if (updates.paperBalance !== undefined) {
        const config = botManager.getConfig(id);
        if (config.mode === 'live') return;
      }
      db.updateUser(id, updates);
      if (updates.enabled === false) {
        revokeSessions(id);
        botManager.stopBot(id);
        if (adminId) db.insertActionLog(id, BOT_ACTIONS.STOP, adminId, ACTION_SOURCES.BACKOFFICE);
      } else if (updates.enabled === true) {
        unblockUser(id);
      }
      if (updates.role !== undefined) {
        revokeSessions(id);
      }
      if (updates.paperBalance !== undefined) {
        try {
          await botManager.killBot(id, 'admin');
          if (adminId) db.insertActionLog(id, BOT_ACTIONS.KILL, adminId, ACTION_SOURCES.BACKOFFICE);
        } catch (err) {
          logger.error(`[backoffice] killBot threw for user ${id} during paperBalance update: ${(err as Error)?.stack ?? err}`);
        }
        // Always check after killBot, success or failure: closePosition
        // errors inside killSwitch are swallowed per-position, so killBot
        // can return ok while leaving stale positions in DB. Without this,
        // user-very-aggresive's 15 stale positions stayed invisible.
        try {
          const stale = db.getOpenPositions(id).length;
          if (stale > 0) {
            logger.warn(`[backoffice] user ${id} has ${stale} open positions left after killBot`);
          }
        } catch {}
        const config = db.getUserConfig(id);
        if (config) {
          const bal = updates.paperBalance;
          if (config.riskLevel && config.riskLevel !== 'custom') {
            const preset = getRiskPreset(config.riskLevel, bal);
            config.tradeAmount = preset.tradeAmount;
            config.dailyLossLimit = preset.dailyLossLimit;
            config.stopLossPct = preset.stopLossPct;
            config.maxOpenPositions = preset.maxOpenPositions;
            config.minConfidence = preset.minConfidence;
            db.setUserConfig(id, config);
          } else {
            let changed = false;
            if (config.tradeAmount > bal) { config.tradeAmount = Math.max(1, bal); changed = true; }
            if (config.dailyLossLimit > bal) { config.dailyLossLimit = Math.max(1, bal); changed = true; }
            if (changed) db.setUserConfig(id, config);
          }
        }
        botManager.resetBot(id);
        // Final word: re-write the admin's intended paperBalance. killBot
        // above may have triggered onCashChange callbacks (while closing
        // open positions), which would have overwritten the value we
        // wrote at the top of this method. This ensures the admin's
        // requested balance wins.
        db.updateUser(id, { paperBalance: updates.paperBalance });
      }
    },

    updateUserPassword(id: number, password: string) {
      db.updateUserPassword(id, hashPassword(password));
      revokeSessions(id);
    },

    deleteUser(id: number, adminId?: number) {
      db.deleteUser(id);
      revokeSessions(id);
      botManager.stopBot(id);
      if (adminId) db.insertActionLog(id, BOT_ACTIONS.STOP, adminId, ACTION_SOURCES.BACKOFFICE);
    },

    getAllTrades(limit: number) {
      return db.getAllTrades(limit);
    },

    getAllTradesPaginated(page: number, limit: number, filters?: TradeFilters & { userId?: number }) {
      const { data, total } = db.getAllTradesPaginated(page, limit, filters);
      return { data, total, page, totalPages: Math.ceil(total / limit) };
    },

    getAllTradeFilters() {
      return { symbols: db.getAllTradeDistinctSymbols(), strategies: db.getAllTradeDistinctStrategies() };
    },

    getAllPositions() {
      return db.getAllOpenPositions();
    },

    getAllPositionsPaginated(page: number, limit: number) {
      const { data, total } = db.getAllOpenPositionsPaginated(page, limit);
      return { data, total, page, totalPages: Math.ceil(total / limit) };
    },

    getUsersDailyPnl() {
      return db.getUsersDailyPnl();
    },

    getUserBotStatuses(): UserBotStatus[] {
      const users = db.getUsers();
      return users.map((u) => ({
        userId: u.id,
        username: u.username,
        blocked: isBlocked(u.id),
        status: botManager.getStatus(u.id),
        mode: botManager.getConfig(u.id).mode,
        testnet: u.exchangeTestnet,
      }));
    },

    getUserTrades(userId: number, limit: number) {
      return db.getTrades(userId, limit);
    },

    getUserTradesPaginated(userId: number, page: number, limit: number, filters?: TradeFilters) {
      const { data, total } = db.getTradesPaginated(userId, page, limit, filters);
      return { data, total, page, totalPages: Math.ceil(total / limit) };
    },

    getUserTradeFilters(userId: number) {
      return { symbols: db.getTradeDistinctSymbols(userId), strategies: db.getTradeDistinctStrategies(userId) };
    },

    getUserPositions(userId: number) {
      return db.getOpenPositions(userId);
    },

    getUserPositionsPaginated(userId: number, page: number, limit: number) {
      const { data, total } = db.getOpenPositionsPaginated(userId, page, limit);
      return { data, total, page, totalPages: Math.ceil(total / limit) };
    },

    getUserBotStatus(userId: number): UserBotStatus | null {
      const user = db.getUserById(userId);
      if (!user) return null;
      return { userId: user.id, username: user.username, status: botManager.getStatus(userId), mode: botManager.getConfig(userId).mode, blocked: isBlocked(userId), testnet: user.exchangeTestnet };
    },

    getUserActionLogs(userId: number, page: number, limit: number, filters?: { action?: string; source?: string }) {
      const { data, total } = db.getActionLogs(userId, page, limit, filters);
      return { data, total, page, totalPages: Math.ceil(total / limit) };
    },
  };
}
