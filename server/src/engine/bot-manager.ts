import type { Db } from '../db/index.js';
import type { WsBroadcaster } from '../websocket/index.js';
import type { ExchangeAdapter } from '../exchange/types.js';
import type { BotConfig, BotMode, BotStatus, CloseReason } from '../types/index.js';
import { createOrchestrator, type Orchestrator } from './core/orchestrator.js';
import { createTickLoop } from './tick-loop.js';
import { createBybitAdapter } from '../exchange/bybit.js';
import { createBinanceAdapter } from '../exchange/binance.js';
import { createPaperAdapter } from '../exchange/paper.js';
import { withSharedMarketData } from '../exchange/market-data-cache.js';
import { createBotConfig, reconcileStrategies } from '../config/index.js';
import { decrypt } from '../utils/crypto.js';
import { DEFAULTS, DEFAULT_EXCHANGE } from '../utils/constants.js';
import logger from '../utils/logger.js';

interface UserBot {
  orchestrator: Orchestrator & { updateConfig(update: Partial<BotConfig>): void; stop(): void; start(): void };
  exchange: ExchangeAdapter;
}

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
  getExchange(userId: number): ExchangeAdapter;
  stopAll(): void;
  ensureBot(userId: number): void;
  resetBot(userId: number): void;
  resumeAll(): void;
  runningCount(): number;
}

export function createBotManager(db: Db, broadcaster: WsBroadcaster, jwtSecret: string): BotManager {
  const bots = new Map<number, UserBot>();

  function createAdapter(name: string, config: { apiKey: string; secret: string; testnet: boolean }): ExchangeAdapter {
    const adapter = name === 'binance' ? createBinanceAdapter(config) : createBybitAdapter(config);
    // One cache and one rate-limit breaker per exchange network, shared by all users.
    return withSharedMarketData(adapter, `${adapter.name}|${config.testnet ? 'testnet' : 'mainnet'}`);
  }

  function createExchangeForUser(userId: number, mode: BotMode): ExchangeAdapter {
    const user = db.getUserById(userId);
    const exchangeName = user?.exchangeName ?? DEFAULT_EXCHANGE;

    let realAdapter: ExchangeAdapter;
    if (user?.exchangeKey && user?.exchangeSecret) {
      try {
        const apiKey = decrypt(user.exchangeKey, jwtSecret);
        const apiSecret = decrypt(user.exchangeSecret, jwtSecret);
        realAdapter = createAdapter(exchangeName, { apiKey, secret: apiSecret, testnet: user.exchangeTestnet });
      } catch (err) {
        logger.error(`[bot-manager] Failed to create exchange for user ${userId}: ${err}`);
        realAdapter = createAdapter(exchangeName, { apiKey: '', secret: '', testnet: true });
      }
    } else {
      realAdapter = createAdapter(exchangeName, { apiKey: '', secret: '', testnet: true });
    }

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

  function getOrCreateBot(userId: number): UserBot {
    let bot = bots.get(userId);
    if (bot) return bot;

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
    bot = { orchestrator, exchange };
    bots.set(userId, bot);
    logger.info(`[bot-manager] Created bot for user ${userId}`);
    return bot;
  }

  return {
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
      if (bot) await bot.orchestrator.killSwitch(reason);
    },

    async closePosition(userId: number, positionId: string, reason?: CloseReason) {
      const bot = getOrCreateBot(userId);
      await bot.orchestrator.closePositionManually(positionId, reason);
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
