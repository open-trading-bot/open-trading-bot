import type { Db, TradeFilters } from '../db/index.js';
import type { BotManager } from '../engine/bot-manager.js';
import type { BotConfig, Position, Trade, StrategyConfig } from '../types/index.js';

export interface PaginatedResult<T> { data: T[]; total: number; page: number; totalPages: number }
export interface PaginatedTradesResult extends PaginatedResult<Trade> { totalPnl: number }

export interface DataService {
  getPositions(userId: number): Position[];
  getPositionsPaginated(userId: number, page: number, limit: number): PaginatedResult<Position>;
  getTrades(userId: number, limit: number, symbol?: string): Trade[];
  getTradesPaginated(userId: number, page: number, limit: number, filters?: TradeFilters, sort?: { by: string; dir: 'asc' | 'desc' }): PaginatedTradesResult;
  getDailyPnlReport(userId: number): { date: string; pnl: number; tradeCount: number; volume: number; balance: number | null }[];
  exportTrades(userId: number, filters?: TradeFilters): Trade[];
  exportPositions(userId: number): Position[];
  iterateTrades(userId: number, filters?: TradeFilters): IterableIterator<Trade>;
  iteratePositions(userId: number): IterableIterator<Position>;
  getPortfolio(userId: number): { positions: Position[]; dailyPnl: number; totalPnl: number };
  getPortfolioBalance(userId: number): Promise<{ totalBalance: number; availableBalance: number; totalEquity: number }>;
  getStrategies(userId: number): StrategyConfig[];
  toggleStrategy(userId: number, strategyId: string): StrategyConfig | null;
  getAssets(userId: number): BotConfig['assets'];
  fetchSymbols(userId: number): Promise<string[]>;
  getTradeFilters(userId: number): { symbols: string[]; strategies: string[] };
  updateConfig(userId: number, update: Partial<BotConfig>): Promise<UpdateConfigResult>;
}

export type UpdateConfigResult =
  | { ok: true; config: BotConfig; closedPositions: Position[] }
  | { ok: false; symbol: string }
  | { ok: false; error: 'close_failed'; symbol: string; message: string };

export function createDataService(db: Db, botManager: BotManager): DataService {
  return {
    getPositions(userId: number) {
      return db.getOpenPositions(userId);
    },

    getPositionsPaginated(userId: number, page: number, limit: number) {
      const { data, total } = db.getOpenPositionsPaginated(userId, page, limit);
      return { data, total, page, totalPages: Math.ceil(total / limit) };
    },

    getTrades(userId: number, limit: number, symbol?: string) {
      return symbol ? db.getTradesBySymbol(userId, symbol) : db.getTrades(userId, limit);
    },

    getTradesPaginated(userId: number, page: number, limit: number, filters?: TradeFilters, sort?: { by: string; dir: 'asc' | 'desc' }) {
      const { data, total, totalPnl } = db.getTradesPaginated(userId, page, limit, filters, sort);
      return { data, total, totalPnl, page, totalPages: Math.ceil(total / limit) };
    },

    getDailyPnlReport(userId: number) {
      return db.getDailyPnlReport(userId);
    },

    exportTrades(userId: number, filters?: TradeFilters) {
      return db.exportTrades(userId, filters);
    },

    exportPositions(userId: number) {
      return db.getOpenPositions(userId);
    },

    iterateTrades(userId: number, filters?: TradeFilters) {
      return db.iterateTrades(userId, filters);
    },

    iteratePositions(userId: number) {
      return db.iteratePositions(userId);
    },

    getPortfolio(userId: number) {
      const positions = db.getOpenPositions(userId);
      const currentMode = botManager.getConfig(userId).mode;
      const user = db.getUserById(userId);
      const dailyTrades = currentMode === 'live'
        ? db.getDailyTrades(userId, {
            mode: 'live',
            exchange: user?.exchangeName ?? '',
            testnet: user?.exchangeTestnet ?? false,
          })
        : db.getDailyTrades(userId, { mode: currentMode });
      const dailyPnl = dailyTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
      return {
        positions,
        dailyPnl,
        totalPnl: positions.reduce((sum, p) => sum + p.pnl, 0),
      };
    },

    async getPortfolioBalance(userId: number) {
      const exchange = botManager.getExchange(userId);
      const balance = await exchange.fetchBalance();
      return {
        totalBalance: balance.total,
        availableBalance: balance.free,
        totalEquity: balance.totalEquity,
      };
    },

    getStrategies(userId: number) {
      return botManager.getConfig(userId).strategies;
    },

    toggleStrategy(userId: number, strategyId: string) {
      const config = botManager.getConfig(userId);
      const strategy = config.strategies.find((s) => s.id === strategyId);
      if (!strategy) return null;
      strategy.enabled = !strategy.enabled;
      botManager.updateConfig(userId, { strategies: config.strategies });
      return strategy;
    },

    getAssets(userId: number) {
      return botManager.getConfig(userId).assets;
    },

    async fetchSymbols(userId: number) {
      const exchange = botManager.getExchange(userId);
      return exchange.fetchSymbols();
    },

    getTradeFilters(userId: number) {
      const symbols = db.getTradeDistinctSymbols(userId);
      const strategies = db.getTradeDistinctStrategies(userId);
      return { symbols, strategies };
    },

    async updateConfig(userId: number, update: Partial<BotConfig>): Promise<UpdateConfigResult> {
      const closedPositions: Position[] = [];
      if (update.assets) {
        const exchange = botManager.getExchange(userId);
        const currentConfig = botManager.getConfig(userId);
        const currentSymbols = new Set(currentConfig.assets.map((a) => a.symbol));
        const newAssets = update.assets.filter((a) => !currentSymbols.has(a.symbol));
        for (const asset of newAssets) {
          try {
            await exchange.fetchTicker(asset.symbol);
          } catch {
            return { ok: false, symbol: asset.symbol };
          }
        }

        // Determine which symbols are being disabled or removed, based on the
        // server's current config (not what the client thought was current).
        // Re-read from memory each time so a stale client request can't
        // disable an asset the user re-enabled in another tab.
        const nextEnabled = new Set(update.assets.filter((a) => a.enabled).map((a) => a.symbol));
        const stoppedSymbols = currentConfig.assets
          .filter((a) => a.enabled && !nextEnabled.has(a.symbol))
          .map((a) => a.symbol);

        if (stoppedSymbols.length > 0) {
          const openPositions = db.getOpenPositions(userId);
          const toClose = openPositions.filter((p) => stoppedSymbols.includes(p.symbol));
          for (const pos of toClose) {
            try {
              await botManager.closePosition(userId, pos.id, 'asset-disabled');
              closedPositions.push(pos);
            } catch (err) {
              return { ok: false, error: 'close_failed', symbol: pos.symbol, message: (err as Error).message };
            }
          }
        }
      }
      botManager.updateConfig(userId, update);
      return { ok: true, config: botManager.getConfig(userId), closedPositions };
    },
  };
}
