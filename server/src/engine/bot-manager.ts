import type { Db } from '../db/index.js';
import type { WsBroadcaster } from '../websocket/index.js';
import type { ExchangeAdapter } from '../exchange/types.js';
import type { BotConfig, BotMode, BotStatus, CloseReason } from '../types/index.js';
import type { DbUser } from '../db/index.js';
import { createOrchestrator, type Orchestrator } from './core/orchestrator.js';
import { createTickLoop } from './tick-loop.js';
import { createBybitAdapter } from '../exchange/bybit.js';
import { createBinanceAdapter } from '../exchange/binance.js';
import { createPaperAdapter } from '../exchange/paper.js';
import { withSharedMarketData } from '../exchange/market-data-cache.js';
import { createBotConfig, reconcileStrategies } from '../config/index.js';
import type { ExchangeKeyCipher } from '../utils/crypto.js';
import { DEFAULTS, DEFAULT_EXCHANGE } from '../utils/constants.js';
import logger from '../utils/logger.js';

interface UserBot {
  orchestrator: Orchestrator & { updateConfig(update: Partial<BotConfig>): void; stop(): void; start(): void };
  exchange: ExchangeAdapter;
  lastUsedAt: number;
  /** Kill or manual-close calls in progress. A busy bot is never evicted. */
  busy: number;
}

/** A real exchange adapter for read-only calls, cached while it is in use. */
interface ReadAdapter {
  fingerprint: string;
  adapter: ExchangeAdapter;
  lastUsedAt: number;
}

export interface BotManagerOptions {
  /** A stopped, idle bot or an unused read adapter is removed after this time. */
  idleTtlMs?: number;
  /** How often the eviction sweep runs. */
  sweepIntervalMs?: number;
  /** Clock, for tests. */
  now?: () => number;
}

export const BOT_MANAGER_DEFAULTS = {
  IDLE_TTL_MS: 15 * 60_000,
  SWEEP_INTERVAL_MS: 60_000,
} as const;

export interface BotManager {
  startBot(userId: number): void;
  stopBot(userId: number): void;
  killBot(userId: number, reason: 'user' | 'admin'): Promise<void>;
  closePosition(userId: number, positionId: string, reason?: CloseReason): Promise<void>;
  getStatus(userId: number): BotStatus;
  getConfig(userId: number): BotConfig;
  updateConfig(userId: number, update: Partial<BotConfig>): void;
  tick(userId: number): Promise<void>;
  isRunning(userId: number): boolean;
  /** The bot's exchange. Creates the bot if it does not exist. */
  getExchange(userId: number): ExchangeAdapter;
  /**
   * An exchange for read-only calls (balance, symbols, candles). It never
   * creates a bot. If a bot exists, this is the bot's exchange.
   */
  getReadExchange(userId: number): ExchangeAdapter;
  /** Removes stopped, idle bots and unused read adapters. Returns the number of bots removed. */
  evictIdle(): number;
  botCount(): number;
  stopAll(): void;
  ensureBot(userId: number): void;
  resetBot(userId: number): void;
  resumeAll(): void;
  runningCount(): number;
}

export function createBotManager(
  db: Db, broadcaster: WsBroadcaster, keyCipher: ExchangeKeyCipher, options: BotManagerOptions = {},
): BotManager {
  const bots = new Map<number, UserBot>();
  const readAdapters = new Map<number, ReadAdapter>();
  const idleTtlMs = options.idleTtlMs ?? BOT_MANAGER_DEFAULTS.IDLE_TTL_MS;
  const now = options.now ?? Date.now;
  const sweep = setInterval(() => {
    try { evictIdle(); } catch (err) { logger.error(`[bot-manager] eviction sweep failed: ${err}`); }
  }, options.sweepIntervalMs ?? BOT_MANAGER_DEFAULTS.SWEEP_INTERVAL_MS);
  sweep.unref();

  function createAdapter(name: string, config: { apiKey: string; secret: string; testnet: boolean }): ExchangeAdapter {
    const adapter = name === 'binance' ? createBinanceAdapter(config) : createBybitAdapter(config);
    // One cache and one rate-limit breaker per exchange network, shared by all users.
    return withSharedMarketData(adapter, `${adapter.name}|${config.testnet ? 'testnet' : 'mainnet'}`);
  }

  function createExchangeForUser(userId: number, mode: BotMode): ExchangeAdapter {
    const user = db.getUserById(userId);
    return wrapForMode(userId, user, createRealAdapter(userId, user), mode);
  }

  function createRealAdapter(userId: number, user: DbUser | null): ExchangeAdapter {
    const exchangeName = user?.exchangeName ?? DEFAULT_EXCHANGE;
    let realAdapter: ExchangeAdapter;
    if (user?.exchangeKey && user?.exchangeSecret) {
      try {
        const apiKey = keyCipher.decrypt(user.exchangeKey);
        const apiSecret = keyCipher.decrypt(user.exchangeSecret);
        realAdapter = createAdapter(exchangeName, { apiKey, secret: apiSecret, testnet: user.exchangeTestnet });
      } catch (err) {
        logger.error(`[bot-manager] Failed to create exchange for user ${userId}: ${err}`);
        realAdapter = createAdapter(exchangeName, { apiKey: '', secret: '', testnet: true });
      }
    } else {
      realAdapter = createAdapter(exchangeName, { apiKey: '', secret: '', testnet: true });
    }
    return realAdapter;
  }

  function wrapForMode(userId: number, user: DbUser | null, realAdapter: ExchangeAdapter, mode: BotMode): ExchangeAdapter {
    if (mode === 'paper') {
      const balance = user?.paperBalance ?? DEFAULTS.PAPER_BALANCE;
      return createPaperAdapter(realAdapter, balance, {
        onCashChange: (cash) => db.updateUser(userId, { paperBalance: cash }),
        getPositionsValue: () => db.getOpenPositions(userId)
          .filter((p) => p.mode === 'paper')
          .reduce((sum, p) => sum + p.quantity * (p.currentPrice ?? p.entryPrice), 0),
      });
    }
    return realAdapter;
  }

  /** Same key, secret, exchange and network give the same fingerprint. */
  function adapterFingerprint(user: DbUser | null): string {
    return [user?.exchangeName ?? DEFAULT_EXCHANGE, user?.exchangeKey ?? '', user?.exchangeSecret ?? '', user?.exchangeTestnet ? 1 : 0].join('|');
  }

  function getOrCreateBot(userId: number): UserBot {
    let bot = bots.get(userId);
    if (bot) { bot.lastUsedAt = now(); return bot; }

    let config = reconcileStrategies(db.getUserConfig(userId) ?? createBotConfig('paper'));
    if (config.mode === 'live') {
      const user = db.getUserById(userId);
      if (!(user?.exchangeKey && user?.exchangeSecret)) {
        logger.warn(`[bot-manager] User ${userId} has mode=live but no exchange keys; forcing paper mode`);
        config = { ...config, mode: 'paper' };
        db.setUserConfig(userId, config);
      }
    }
    const exchange = createExchangeForUser(userId, config.mode);
    const userBroadcaster: WsBroadcaster = {
      broadcast(event) { broadcaster.broadcastToUser(userId, event); },
      broadcastToUser(uid, event) { broadcaster.broadcastToUser(uid, event); },
      clientCount() { return broadcaster.clientCount(); },
      close() { /* no-op */ },
    };
    const orchestrator = createTickLoop(createOrchestrator(exchange, db, userBroadcaster, config, userId));
    bot = { orchestrator, exchange, lastUsedAt: now(), busy: 0 };
    bots.set(userId, bot);
    // The bot has its own adapter now. Reads go to it.
    readAdapters.delete(userId);
    logger.info(`[bot-manager] Created bot for user ${userId}`);
    return bot;
  }

  function getReadExchange(userId: number): ExchangeAdapter {
    const bot = bots.get(userId);
    if (bot) { bot.lastUsedAt = now(); return bot.exchange; }

    const user = db.getUserById(userId);
    const fingerprint = adapterFingerprint(user);
    let cached = readAdapters.get(userId);
    if (!cached || cached.fingerprint !== fingerprint) {
      cached = { fingerprint, adapter: createRealAdapter(userId, user), lastUsedAt: now() };
      readAdapters.set(userId, cached);
    }
    cached.lastUsedAt = now();
    // Same rule as getOrCreateBot: live mode without keys acts as paper.
    const savedMode = db.getUserConfig(userId)?.mode ?? 'paper';
    const mode: BotMode = savedMode === 'live' && user?.exchangeKey && user?.exchangeSecret ? 'live' : 'paper';
    // A new paper wrapper for each call reads the current paper balance from
    // the database, so a cached wrapper cannot show an old balance.
    return wrapForMode(userId, user, cached.adapter, mode);
  }

  function evictIdle(): number {
    const t = now();
    let evicted = 0;
    for (const [userId, bot] of bots) {
      const idle = t - bot.lastUsedAt > idleTtlMs;
      const stopped = bot.orchestrator.getStatus() !== 'running';
      if (idle && stopped && bot.busy === 0 && bot.orchestrator.isIdle()) {
        bots.delete(userId);
        evicted++;
      }
    }
    for (const [userId, read] of readAdapters) {
      if (t - read.lastUsedAt > idleTtlMs) readAdapters.delete(userId);
    }
    if (evicted > 0) logger.info(`[bot-manager] Evicted ${evicted} idle stopped bot(s); ${bots.size} in memory`);
    return evicted;
  }

  async function whileBusy<T>(bot: UserBot, work: () => Promise<T>): Promise<T> {
    bot.busy++;
    try {
      return await work();
    } finally {
      bot.busy--;
      bot.lastUsedAt = now();
    }
  }

  return {
    getReadExchange,
    evictIdle,
    botCount() { return bots.size; },

    ensureBot(userId: number) {
      getOrCreateBot(userId);
    },

    startBot(userId: number) {
      const bot = getOrCreateBot(userId);
      bot.orchestrator.start();
      db.setBotEnabled(userId, true);
    },

    stopBot(userId: number) {
      db.setBotEnabled(userId, false);
      const bot = bots.get(userId);
      if (bot) bot.orchestrator.stop();
    },

    resetBot(userId: number) {
      db.setBotEnabled(userId, false);
      const bot = bots.get(userId);
      if (bot) bot.orchestrator.stop();
      bots.delete(userId);
    },

    async killBot(userId: number, reason: 'user' | 'admin') {
      db.setBotEnabled(userId, false);
      const bot = bots.get(userId);
      if (bot) await whileBusy(bot, () => bot.orchestrator.killSwitch(reason));
    },

    async closePosition(userId: number, positionId: string, reason?: CloseReason) {
      const bot = getOrCreateBot(userId);
      await whileBusy(bot, () => bot.orchestrator.closePositionManually(positionId, reason));
    },

    getStatus(userId: number): BotStatus {
      const bot = bots.get(userId);
      return bot ? bot.orchestrator.getStatus() : 'stopped';
    },

    getConfig(userId: number): BotConfig {
      const bot = bots.get(userId);
      // A running bot's in-memory config was already reconciled at creation
      // (getOrCreateBot), so only the not-in-memory path needs reconciling here.
      if (bot) return bot.orchestrator.getConfig();
      return reconcileStrategies(db.getUserConfig(userId) ?? createBotConfig('paper'));
    },

    updateConfig(userId: number, update: Partial<BotConfig>) {
      const bot = getOrCreateBot(userId);
      const prevMode = bot.orchestrator.getConfig().mode;
      bot.orchestrator.updateConfig(update);
      db.setUserConfig(userId, bot.orchestrator.getConfig());
      if (update.mode && update.mode !== prevMode) {
        const wasRunning = bot.orchestrator.getStatus() === 'running';
        bot.orchestrator.stop();
        bots.delete(userId);
        if (wasRunning) {
          const newBot = getOrCreateBot(userId);
          newBot.orchestrator.start();
        }
        logger.info(`[bot-manager] Recreated bot for user ${userId} after mode change: ${prevMode} → ${update.mode}`);
      }
    },

    async tick(userId: number) {
      const bot = bots.get(userId);
      if (bot) await bot.orchestrator.tick();
    },

    isRunning(userId: number): boolean {
      const bot = bots.get(userId);
      return bot ? bot.orchestrator.getStatus() === 'running' : false;
    },

    getExchange(userId: number): ExchangeAdapter {
      const bot = getOrCreateBot(userId);
      return bot.exchange;
    },

    stopAll() {
      clearInterval(sweep);
      readAdapters.clear();
      for (const [userId, bot] of bots) {
        bot.orchestrator.stop();
        logger.info(`[bot-manager] Stopped bot for user ${userId}`);
      }
      bots.clear();
    },

    runningCount() {
      let n = 0;
      for (const b of bots.values()) if (b.orchestrator.getStatus() === 'running') n++;
      return n;
    },

    resumeAll() {
      const enabledIds = db.getEnabledBotUserIds();
      if (enabledIds.length === 0) {
        logger.info('[bot-manager] resumeAll: no users with bot_enabled=1');
        return;
      }
      logger.info(`[bot-manager] resumeAll: restoring ${enabledIds.length} bot(s)`);
      for (const userId of enabledIds) {
        try {
          const bot = getOrCreateBot(userId);
          bot.orchestrator.start();
          logger.info(`[bot-manager] resumeAll: resumed user ${userId}`);
        } catch (err) {
          logger.error(`[bot-manager] resumeAll: failed to resume user ${userId}: ${err}`);
        }
      }
    },
  };
}
