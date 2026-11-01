import { describe, it, expect } from 'vitest';
import { maCrossover } from '../../../src/engine/strategies/ma-crossover.js';
import type { Candle } from '../../../src/types/index.js';

function makeCandles(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    timestamp: Date.now() - (closes.length - i) * 60000,
    open: close, high: close + 10, low: close - 10, close, volume: 1000,
  }));
}

describe('MA Crossover Strategy', () => {
  it('returns buy when short MA crosses above long MA', () => {
    // Flat, then dip (short MA drops below long), then recover so crossover happens at last pair
    const flat = Array(20).fill(100) as number[];
    const dip = [97, 94, 91, 88, 85, 82, 79, 76, 73, 70];
    const recover = [75, 80, 85, 90, 95, 100, 105, 110, 115];
    const candles = makeCandles([...flat, ...dip, ...recover]);
    const signal = maCrossover.analyze(candles, maCrossover.defaultParams, 'BTC/USDT', 'spot');
    expect(signal.action).toBe('buy');
    expect(signal.symbol).toBe('BTC/USDT');
  });

  it('returns sell when short MA crosses below long MA', () => {
    const flat = Array(20).fill(100) as number[];
    const rise = [103, 106, 109, 112, 115, 118, 121, 124, 127, 130];
    const drop = [125, 120, 115, 110, 105, 100, 95, 90, 85];
    const candles = makeCandles([...flat, ...rise, ...drop]);
    const signal = maCrossover.analyze(candles, maCrossover.defaultParams, 'BTC/USDT', 'spot');
    expect(signal.action).toBe('sell');
  });

  it('returns hold when no crossover', () => {
    const flat = Array(40).fill(100) as number[];
    const candles = makeCandles(flat);
    const signal = maCrossover.analyze(candles, maCrossover.defaultParams, 'BTC/USDT', 'spot');
    expect(signal.action).toBe('hold');
  });

  it('returns hold with insufficient data', () => {
    const candles = makeCandles([100, 101, 102]);
    const signal = maCrossover.analyze(candles, maCrossover.defaultParams, 'BTC/USDT', 'spot');
    expect(signal.action).toBe('hold');
  });
});
