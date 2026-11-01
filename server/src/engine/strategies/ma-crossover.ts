import { SMA } from 'technicalindicators';
import type { Candle, Signal, StrategyParams, MarketType } from '../../types/index.js';
import type { Strategy } from './types.js';

function holdSignal(symbol: string, price: number, marketType: MarketType): Signal {
  return { action: 'hold', symbol, strategy: 'ma_crossover', confidence: 0, price, timestamp: Date.now(), marketType };
}

export const maCrossover: Strategy = {
  id: 'ma_crossover',
  name: 'Moving Average Crossover',
  defaultParams: { shortPeriod: 10, longPeriod: 20 },
  defaultInterval: '5m',

  analyze(candles: Candle[], params: StrategyParams, symbol: string, marketType: MarketType): Signal {
    const shortPeriod = params.shortPeriod as number;
    const longPeriod = params.longPeriod as number;

    if (candles.length < longPeriod + 1) {
      return holdSignal(symbol, candles.at(-1)?.close ?? 0, marketType);
    }

    const closes = candles.map((c) => c.close);
    const shortMA = SMA.calculate({ period: shortPeriod, values: closes });
    const longMA = SMA.calculate({ period: longPeriod, values: closes });

    const currentShort = shortMA[shortMA.length - 1];
    const prevShort = shortMA[shortMA.length - 2];
    const currentLong = longMA[longMA.length - 1];
    const prevLong = longMA[longMA.length - 2];

    if (currentShort === undefined || prevShort === undefined || currentLong === undefined || prevLong === undefined) {
      return holdSignal(symbol, candles.at(-1)!.close, marketType);
    }

    const price = candles.at(-1)!.close;
    const base = { symbol, strategy: 'ma_crossover', price, timestamp: Date.now(), marketType };

    // Spread as percentage of price — typical crossover spread is 0-2%
    // Map 0-1% spread → 0.3-0.8 confidence, capped at 1.0
    const spreadPct = Math.abs(currentShort - currentLong) / currentLong * 100;
    const confidence = Math.min(0.3 + spreadPct * 0.5, 1);

    // Bullish crossover: short crosses above long
    if (prevShort <= prevLong && currentShort > currentLong) {
      return { ...base, action: 'buy', confidence };
    }

    // Bearish crossover: short crosses below long
    if (prevShort >= prevLong && currentShort < currentLong) {
      return { ...base, action: 'sell', confidence };
    }

    return { ...base, action: 'hold', confidence: 0 };
  },
};
