import type { Db } from '../db/index.js';
import type { BotManager } from '../engine/bot-manager.js';
import type { MarketType } from '../types/index.js';
import { DEFAULTS, ERROR_MSG } from '../utils/constants.js';
import { PublicError } from '../utils/errors.js';
import { runBacktest as executeBacktest, type BacktestResult } from '../engine/backtest/index.js';
import { getStrategy } from '../engine/strategies/index.js';

export interface BacktestService {
  run(userId: number, symbol: string, strategyId: string, interval: string, from?: number, to?: number, marketType?: MarketType): Promise<BacktestResult>;
}

const UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000, M: 2_592_000_000 };

/** Number of candles of `interval` in [fromTs, toTs], or null for an unknown interval format. */
export function expectedCandleCount(interval: string, fromTs: number, toTs: number): number | null {
  const m = /^(\d+)([mhdwM])$/.exec(interval);
  if (!m) return null;
  const step = Number(m[1]) * UNIT_MS[m[2]];
  return Math.max(1, Math.ceil((toTs - fromTs) / step));
}

export function createBacktestService(db: Db, botManager: BotManager): BacktestService {
  return {
    async run(userId, symbol, strategyId, interval, from?, to?, marketType = DEFAULTS.MARKET_TYPE as MarketType) {
      const strat = getStrategy(strategyId);
      if (!strat) throw new PublicError(ERROR_MSG.STRATEGY_NOT_FOUND);
      const fromTs = from ?? Date.now() - DEFAULTS.BACKTEST_DAYS * 24 * 60 * 60 * 1000;
      const toTs = to ?? Date.now();
      let candles = db.getCandles(symbol, interval, fromTs, toTs);
      // The live bot stores only its last ticks' candles. Fetch history when the
      // DB covers less than 90% of the range, or the result uses partial data.
      const expected = expectedCandleCount(interval, fromTs, toTs);
      if (candles.length === 0 || (expected !== null && candles.length < expected * 0.9)) {
        const exchange = botManager.getReadExchange(userId);
        const limit = Math.min(expected ?? DEFAULTS.CANDLE_LIMIT, DEFAULTS.CANDLE_LIMIT);
        candles = await exchange.fetchCandles(symbol, interval, limit);
        db.insertCandles(symbol, interval, candles);
      }
      const defaultParams = strat.defaultParams ?? {};
      return executeBacktest({ strategyId, candles, symbol, marketType, tradeAmount: DEFAULTS.BACKTEST_TRADE_AMOUNT, params: defaultParams });
    },
  };
}
