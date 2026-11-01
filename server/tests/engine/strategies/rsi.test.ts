import { describe, it, expect } from 'vitest';
import { rsiStrategy } from '../../../src/engine/strategies/rsi.js';
import type { Candle } from '../../../src/types/index.js';

function makeCandles(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    timestamp: Date.now() - (closes.length - i) * 60000, open: close, high: close + 5, low: close - 5, close, volume: 1000,
  }));
}

describe('RSI Strategy', () => {
  it('returns buy when RSI is oversold (< 30)', () => {
    const prices: number[] = [];
    let price = 100;
    for (let i = 0; i < 20; i++) { price -= 3; prices.push(price); }
    const signal = rsiStrategy.analyze(makeCandles(prices), rsiStrategy.defaultParams, 'ETH/USDT', 'spot');
    expect(signal.action).toBe('buy');
  });

  it('returns sell when RSI is overbought (> 70)', () => {
    const prices: number[] = [];
    let price = 100;
    for (let i = 0; i < 20; i++) { price += 3; prices.push(price); }
    const signal = rsiStrategy.analyze(makeCandles(prices), rsiStrategy.defaultParams, 'ETH/USDT', 'spot');
    expect(signal.action).toBe('sell');
  });

  it('returns hold when RSI is neutral', () => {
    const prices: number[] = [];
    for (let i = 0; i < 20; i++) { prices.push(100 + (i % 2 === 0 ? 1 : -1)); }
    const signal = rsiStrategy.analyze(makeCandles(prices), rsiStrategy.defaultParams, 'ETH/USDT', 'spot');
    expect(signal.action).toBe('hold');
  });

  it('returns hold with insufficient data', () => {
    const signal = rsiStrategy.analyze(makeCandles([100, 101]), rsiStrategy.defaultParams, 'ETH/USDT', 'spot');
    expect(signal.action).toBe('hold');
  });
});
