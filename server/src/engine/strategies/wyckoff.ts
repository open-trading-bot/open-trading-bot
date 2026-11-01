import type { Candle, Signal, StrategyParams, MarketType } from '../../types/index.js';
import type { Strategy } from './types.js';

export const wyckoffStrategy: Strategy = {
  id: 'wyckoff',
  name: 'Wyckoff Spring/Upthrust',
  defaultParams: { rangePeriod: 20, maxRangePct: 0.05, volumeFactor: 1.5 },
  defaultInterval: '1h',

  analyze(candles: Candle[], params: StrategyParams, symbol: string, marketType: MarketType): Signal {
    const rangePeriod = params.rangePeriod as number;
    const maxRangePct = params.maxRangePct as number;
    const volumeFactor = params.volumeFactor as number;
    const base = { symbol, strategy: 'wyckoff', price: candles.at(-1)?.close ?? 0, timestamp: Date.now(), marketType };
    if (candles.length < rangePeriod + 1) return { ...base, action: 'hold', confidence: 0 };

    // Trading range from the bars leading up to (but excluding) the current bar.
    const window = candles.slice(-(rangePeriod + 1), -1);
    const support = Math.min(...window.map((c) => c.low));
    const resistance = Math.max(...window.map((c) => c.high));
    const avgVolume = window.reduce((sum, c) => sum + c.volume, 0) / window.length;
    const rangeHeight = resistance - support;
    const current = candles.at(-1)!;
    const price = current.close;
    if (rangeHeight <= 0 || price <= 0) return { ...base, action: 'hold', confidence: 0 };

    // Only treat tight consolidation as a Wyckoff range; a wide range means the market is trending.
    if (rangeHeight / price > maxRangePct) return { ...base, action: 'hold', confidence: 0 };

    const volBoost = avgVolume > 0 && volumeFactor > 0 ? Math.min(current.volume / (avgVolume * volumeFactor), 1) * 0.3 : 0;

    // Spring: false breakdown below support that closes back inside the range.
    // Require the bar to stay below resistance so a double-wick candle (pierces both ends) is not read as a spring.
    if (current.low < support && current.high <= resistance && current.close > support) {
      const recoveryRatio = Math.min((current.close - support) / rangeHeight, 1);
      const confidence = Math.min(0.4 + recoveryRatio * 0.3 + volBoost, 1);
      return { ...base, action: 'buy', confidence };
    }

    // Upthrust: false breakout above resistance that closes back inside the range.
    // Require the bar to stay above support so a double-wick candle is not read as an upthrust.
    if (current.high > resistance && current.low >= support && current.close < resistance) {
      const recoveryRatio = Math.min((resistance - current.close) / rangeHeight, 1);
      const confidence = Math.min(0.4 + recoveryRatio * 0.3 + volBoost, 1);
      return { ...base, action: 'sell', confidence };
    }

    return { ...base, action: 'hold', confidence: 0 };
  },
};
