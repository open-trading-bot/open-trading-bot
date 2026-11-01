import { RSI } from 'technicalindicators';
import type { Candle, Signal, StrategyParams, MarketType } from '../../types/index.js';
import type { Strategy } from './types.js';

export const rsiStrategy: Strategy = {
  id: 'rsi',
  name: 'RSI',
  defaultParams: { period: 14, oversold: 30, overbought: 70 },
  defaultInterval: '15m',

  analyze(candles: Candle[], params: StrategyParams, symbol: string, marketType: MarketType): Signal {
    const period = params.period as number;
    const oversold = params.oversold as number;
    const overbought = params.overbought as number;
    const base = { symbol, strategy: 'rsi', price: candles.at(-1)?.close ?? 0, timestamp: Date.now(), marketType };
    if (candles.length < period + 1) return { ...base, action: 'hold', confidence: 0 };
    const closes = candles.map((c) => c.close);
    const rsiValues = RSI.calculate({ period, values: closes });
    const current = rsiValues.at(-1);
    if (current === undefined) return { ...base, action: 'hold', confidence: 0 };
    // RSI distance into oversold/overbought zone → 0.4-1.0 confidence
    // e.g. RSI=25 with oversold=30: (30-25)/30 = 0.17 → 0.4 + 0.17*3.5 = 1.0
    if (current <= oversold) return { ...base, action: 'buy', confidence: Math.min(0.4 + ((oversold - current) / oversold) * 3.5, 1) };
    if (current >= overbought) return { ...base, action: 'sell', confidence: Math.min(0.4 + ((current - overbought) / (100 - overbought)) * 3.5, 1) };
    return { ...base, action: 'hold', confidence: 0 };
  },
};
