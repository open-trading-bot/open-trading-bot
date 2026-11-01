import type { Db } from '../db/index.js';
import type { BotManager } from '../engine/bot-manager.js';
import type { MarketType } from '../types/index.js';
import { DEFAULTS } from '../utils/constants.js';
import { runBacktest as executeBacktest, type BacktestResult } from '../engine/backtest/index.js';
import { getStrategy } from '../engine/strategies/index.js';

export interface BacktestService {
  run(userId: number, symbol: string, strategyId: string, interval: string, from?: number, to?: number, marketType?: MarketType): Promise<BacktestResult>;
}

export function createBacktestService(db: Db, botManager: BotManager): BacktestService {
  return {
    async run(userId, symbol, strategyId, interval, from?, to?, marketType = DEFAULTS.MARKET_TYPE as MarketType) {
      const fromTs = from ?? Date.now() - DEFAULTS.BACKTEST_DAYS * 24 * 60 * 60 * 1000;
      const toTs = to ?? Date.now();
      let candles = db.getCandles(symbol, interval, fromTs, toTs);
      if (candles.length === 0) {
        const exchange = botManager.getExchange(userId);
        candles = await exchange.fetchCandles(symbol, interval, DEFAULTS.CANDLE_LIMIT);
        db.insertCandles(symbol, interval, candles);
      }
      const strat = getStrategy(strategyId);
      const defaultParams = strat?.defaultParams ?? {};
      return executeBacktest({ strategyId, candles, symbol, marketType, tradeAmount: DEFAULTS.BACKTEST_TRADE_AMOUNT, params: defaultParams });
    },
  };
}
