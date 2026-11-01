import { describe, it, expect } from 'vitest';
import { bollingerStrategy } from '../../../src/engine/strategies/bollinger.js';
import type { Candle } from '../../../src/types/index.js';

function makeCandles(closes: number[]): Candle[] {
  return closes.map((close, i) => ({
    timestamp: Date.now() - (closes.length - i) * 60000, open: close, high: close + 5, low: close - 5, close, volume: 1000,
  }));
}

describe('Bollinger Bands Strategy', () => {
  it('returns buy when price touches lower band', () => {
    const stable = Array(19).fill(100) as number[];
    const signal = bollingerStrategy.analyze(makeCandles([...stable, 80]), bollingerStrategy.defaultParams, 'SOL/USDT', 'spot');
    expect(signal.action).toBe('buy');
  });

  it('returns sell when price touches upper band', () => {
    const stable = Array(19).fill(100) as number[];
    const signal = bollingerStrategy.analyze(makeCandles([...stable, 120]), bollingerStrategy.defaultParams, 'SOL/USDT', 'spot');
    expect(signal.action).toBe('sell');
  });

  it('returns hold when price is within bands', () => {
    const signal = bollingerStrategy.analyze(makeCandles(Array(20).fill(100)), bollingerStrategy.defaultParams, 'SOL/USDT', 'spot');
    expect(signal.action).toBe('hold');
  });

  it('returns hold with insufficient data', () => {
    const signal = bollingerStrategy.analyze(makeCandles([100, 101, 102]), bollingerStrategy.defaultParams, 'SOL/USDT', 'spot');
    expect(signal.action).toBe('hold');
  });
});
