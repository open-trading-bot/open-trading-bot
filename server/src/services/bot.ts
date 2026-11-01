import type { BotManager } from '../engine/bot-manager.js';
import type { Db } from '../db/index.js';
import { BOT_ACTIONS, ACTION_SOURCES, ERROR_MSG, DEFAULTS } from '../utils/constants.js';
import logger from '../utils/logger.js';
import { PublicError } from '../utils/errors.js';

export interface BotService {
  getStatus(userId: number): { status: string; lastTickAt: number | null; config: any };
  start(userId: number): Promise<{ status: string }>;
  stop(userId: number): { status: string };
  kill(userId: number): Promise<{ status: string }>;
  closePosition(userId: number, positionId: string): Promise<{ ok: true }>;
}

export function createBotService(botManager: BotManager, db: Db): BotService {
  return {
    getStatus(userId: number) {
      const user = db.getUserById(userId);
      return { status: botManager.getStatus(userId), lastTickAt: null, config: botManager.getConfig(userId), testnet: user?.exchangeTestnet ?? true };
    },
    async start(userId: number) {
      const exchange = botManager.getExchange(userId);
      const balance = await exchange.fetchBalance();
      if (balance.totalEquity < DEFAULTS.MIN_START_BALANCE) {
        logger.warn(`[bot-service] userId=${userId} blocked start: total equity ${balance.totalEquity} below minimum`);
        throw new PublicError(ERROR_MSG.ZERO_BALANCE);
      }
      // Block starts in live mode when the saved key is read-only. Otherwise
      // every tick would fail with a Bybit 10005 error. Defense-in-depth:
      // the client also gates the start button, but a direct API call would
      // bypass that — this guard catches it.
      const cfg = botManager.getConfig(userId);
      if (cfg.mode === 'live' && exchange.fetchPermissions) {
        try {
          const perms = await exchange.fetchPermissions();
          if (perms.readOnly || !perms.canTrade) {
            logger.warn(`[bot-service] userId=${userId} blocked start: API key is read-only`);
            throw new PublicError(ERROR_MSG.READ_ONLY_KEY);
          }
        } catch (err: any) {
          // If the error was our own READ_ONLY_KEY throw, propagate it.
          if (err?.message === ERROR_MSG.READ_ONLY_KEY) throw err;
          // Otherwise the permissions check itself failed — log and proceed
          // rather than hard-blocking on a transient network issue.
          logger.warn(`[bot-service] userId=${userId} permission check failed during start, proceeding: ${err?.message || err}`);
        }
      }
      botManager.startBot(userId);
      db.insertActionLog(userId, BOT_ACTIONS.START, userId, ACTION_SOURCES.SELF);
      return { status: botManager.getStatus(userId) };
    },
    stop(userId: number) {
      botManager.stopBot(userId);
      db.insertActionLog(userId, BOT_ACTIONS.STOP, userId, ACTION_SOURCES.SELF);
      return { status: botManager.getStatus(userId) };
    },
    async kill(userId: number) {
      await botManager.killBot(userId, 'user');
      db.insertActionLog(userId, BOT_ACTIONS.KILL, userId, ACTION_SOURCES.SELF);
      return { status: botManager.getStatus(userId) };
    },
    async closePosition(userId: number, positionId: string) {
      await botManager.closePosition(userId, positionId);
      db.insertActionLog(userId, BOT_ACTIONS.CLOSE_POSITION, userId, ACTION_SOURCES.SELF);
      return { ok: true as const };
    },
  };
}
