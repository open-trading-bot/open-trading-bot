import { describe, it, expect } from 'vitest';
import { macdStrategy } from '../../../src/engine/strategies/macd.js';
import type { Candle } from '../../../src/types/index.js';

function makeCandles(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    timestamp: Date.now() - (closes.length - i) * 60000, open: close, high: close + 5, low: close - 5, close, volume: 1000,
  }));
}

describe('MACD Strategy', () => {
  it('returns buy on bullish MACD crossover', () => {
    const decline = Array.from({ length: 40 }, (_, i) => 100 - i * 1.0);
    const recoveries = Array.from({ length: 2 }, (_, i) => 60 + i * 5);
    const signal = macdStrategy.analyze(makeCandles([...decline, ...recoveries]), macdStrategy.defaultParams, 'BTC/USDT', 'futures');
    expect(signal.action).toBe('buy');
  });

  it('returns sell on bearish MACD crossover', () => {
    const rise = Array.from({ length: 40 }, (_, i) => 100 + i * 1.0);
    const declines = Array.from({ length: 2 }, (_, i) => 140 - i * 5);
    const signal = macdStrategy.analyze(makeCandles([...rise, ...declines]), macdStrategy.defaultParams, 'BTC/USDT', 'futures');
    expect(signal.action).toBe('sell');
  });

  it('returns hold with insufficient data', () => {
    const signal = macdStrategy.analyze(makeCandles([100, 101, 102, 103, 104]), macdStrategy.defaultParams, 'BTC/USDT', 'futures');
    expect(signal.action).toBe('hold');
  });
});
