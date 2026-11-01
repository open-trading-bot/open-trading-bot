import type { Request, Response } from 'express';
import { HTTP_STATUS, ERROR_MSG } from '../utils/constants.js';
import { DEFAULTS } from '../utils/constants.js';
import type { MarketType } from '../types/index.js';
import type { BacktestService } from '../services/backtest.js';

export function createBacktestController(backtestService: BacktestService) {
  return {
    async run(req: Request, res: Response) {
      const { symbol, strategy, interval, from, to, marketType } = req.query;
      if (!symbol || !strategy || !interval) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.MISSING_BACKTEST_PARAMS });
        return;
      }
      const userId = (req as any).user.id;
      const result = await backtestService.run(
        userId, symbol as string, strategy as string, interval as string,
        from ? Number(from) : undefined, to ? Number(to) : undefined,
        (marketType as MarketType) ?? DEFAULTS.MARKET_TYPE,
      );
      res.json(result);
    },
  };
}
