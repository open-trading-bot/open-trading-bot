import { MACD } from 'technicalindicators';
import type { Candle, Signal, StrategyParams, MarketType } from '../../types/index.js';
import type { Strategy } from './types.js';

export const macdStrategy: Strategy = {
  id: 'macd',
  name: 'MACD',
  defaultParams: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
  defaultInterval: '1h',

  analyze(candles: Candle[], params: StrategyParams, symbol: string, marketType: MarketType): Signal {
    const fastPeriod = params.fastPeriod as number;
    const slowPeriod = params.slowPeriod as number;
    const signalPeriod = params.signalPeriod as number;
    const base = { symbol, strategy: 'macd', price: candles.at(-1)?.close ?? 0, timestamp: Date.now(), marketType };
    if (candles.length < slowPeriod + signalPeriod) return { ...base, action: 'hold', confidence: 0 };
    const closes = candles.map((c) => c.close);
    const macdValues = MACD.calculate({ values: closes, fastPeriod, slowPeriod, signalPeriod, SimpleMAOscillator: false, SimpleMASignal: false });
    const current = macdValues.at(-1);
    const prev = macdValues.at(-2);
    if (!current?.MACD || !current?.signal || !prev?.MACD || !prev?.signal) return { ...base, action: 'hold', confidence: 0 };
    const currentHistogram = current.MACD - current.signal;
    const prevHistogram = prev.MACD - prev.signal;
    // Histogram as percentage of price — typical values are 0-0.5%
    // Map 0-0.3% → 0.3-0.9 confidence, capped at 1.0
    const histPct = Math.abs(currentHistogram) / base.price * 100;
    const confidence = Math.min(0.3 + histPct * 2, 1);
    if (prevHistogram <= 0 && currentHistogram > 0) return { ...base, action: 'buy', confidence };
    if (prevHistogram >= 0 && currentHistogram < 0) return { ...base, action: 'sell', confidence };
    return { ...base, action: 'hold', confidence: 0 };
  },
};
