import { BollingerBands } from 'technicalindicators';
import type { Candle, Signal, StrategyParams, MarketType } from '../../types/index.js';
import type { Strategy } from './types.js';

export const bollingerStrategy: Strategy = {
  id: 'bollinger',
  name: 'Bollinger Bands',
  defaultParams: { period: 20, stdDev: 2 },
  defaultInterval: '15m',

  analyze(candles: Candle[], params: StrategyParams, symbol: string, marketType: MarketType): Signal {
    const period = params.period as number;
    const stdDev = params.stdDev as number;
    const base = { symbol, strategy: 'bollinger', price: candles.at(-1)?.close ?? 0, timestamp: Date.now(), marketType };
    if (candles.length < period) return { ...base, action: 'hold', confidence: 0 };
    const closes = candles.map((c) => c.close);
    const bb = BollingerBands.calculate({ period, values: closes, stdDev });
    const current = bb.at(-1);
    if (!current) return { ...base, action: 'hold', confidence: 0 };
    const price = candles.at(-1)!.close;
    const bandwidth = current.upper - current.lower;
    if (bandwidth === 0) return { ...base, action: 'hold', confidence: 0 };
    // Distance outside band as fraction of bandwidth → 0.4-1.0 confidence
    // Touching the band = 0.4, far outside = up to 1.0
    if (price <= current.lower) return { ...base, action: 'buy', confidence: Math.min(0.4 + ((current.lower - price) / bandwidth) * 3, 1) };
    if (price >= current.upper) return { ...base, action: 'sell', confidence: Math.min(0.4 + ((price - current.upper) / bandwidth) * 3, 1) };
    return { ...base, action: 'hold', confidence: 0 };
  },
};
