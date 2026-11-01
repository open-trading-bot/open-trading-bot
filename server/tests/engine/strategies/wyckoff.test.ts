import { describe, it, expect } from 'vitest';
import { wyckoffStrategy } from '../../../src/engine/strategies/wyckoff.js';
import type { Candle } from '../../../src/types/index.js';

type Spec = { close: number; high?: number; low?: number; volume?: number };

function candle(s: Spec, i: number): Candle {
  return {
    timestamp: Date.now() + i * 60000,
    open: s.close,
    high: s.high ?? s.close,
    low: s.low ?? s.close,
    close: s.close,
    volume: s.volume ?? 1000,
  };
}

function build(specs: Spec[]): Candle[] {
  return specs.map(candle);
}

// 20-candle sideways trading range: support 99, resistance 101, avg volume 1000.
const RANGE: Spec[] = Array(20).fill(null).map(() => ({ close: 100, high: 101, low: 99, volume: 1000 }));

const params = wyckoffStrategy.defaultParams;

describe('Wyckoff Spring/Upthrust Strategy', () => {
  it('returns buy on a spring (false breakdown below support that recovers)', () => {
    const candles = build([...RANGE, { close: 100, high: 100.5, low: 98, volume: 1000 }]);
    const signal = wyckoffStrategy.analyze(candles, params, 'SOL/USDT', 'spot');
    expect(signal.action).toBe('buy');
    expect(signal.confidence).toBeGreaterThan(0.4);
  });

  it('returns sell on an upthrust (false breakout above resistance that fails)', () => {
    const candles = build([...RANGE, { close: 100, high: 102, low: 99.5, volume: 1000 }]);
    const signal = wyckoffStrategy.analyze(candles, params, 'SOL/USDT', 'spot');
    expect(signal.action).toBe('sell');
    expect(signal.confidence).toBeGreaterThan(0.4);
  });

  it('returns hold when price stays inside the range', () => {
    const candles = build([...RANGE, { close: 100, high: 100.5, low: 99.5, volume: 1000 }]);
    const signal = wyckoffStrategy.analyze(candles, params, 'SOL/USDT', 'spot');
    expect(signal.action).toBe('hold');
  });

  it('returns hold when the range is too wide to be consolidation', () => {
    const wide: Spec[] = Array(20).fill(null).map(() => ({ close: 100, high: 120, low: 80, volume: 1000 }));
    // Penetrates below support (80) and recovers, but range is 40% of price → not a trading range.
    const candles = build([...wide, { close: 100, high: 100.5, low: 79, volume: 1000 }]);
    const signal = wyckoffStrategy.analyze(candles, params, 'SOL/USDT', 'spot');
    expect(signal.action).toBe('hold');
  });

  it('returns hold with insufficient data', () => {
    const candles = build([{ close: 100, high: 101, low: 99 }, { close: 100, high: 101, low: 98 }]);
    const signal = wyckoffStrategy.analyze(candles, params, 'SOL/USDT', 'spot');
    expect(signal.action).toBe('hold');
  });

  it('returns hold on a double-wick candle that pierces both support and resistance', () => {
    const candles = build([...RANGE, { close: 100, high: 102, low: 98, volume: 1000 }]);
    const signal = wyckoffStrategy.analyze(candles, params, 'SOL/USDT', 'spot');
    expect(signal.action).toBe('hold');
  });

  it('returns hold on a perfectly flat range (zero range height)', () => {
    const flat: Spec[] = Array(20).fill(null).map(() => ({ close: 100, high: 100, low: 100, volume: 1000 }));
    const candles = build([...flat, { close: 100, high: 100, low: 100, volume: 1000 }]);
    const signal = wyckoffStrategy.analyze(candles, params, 'SOL/USDT', 'spot');
    expect(signal.action).toBe('hold');
  });

  it('returns hold when the spring bar closes exactly at support (not strictly inside)', () => {
    const candles = build([...RANGE, { close: 99, high: 100, low: 98, volume: 1000 }]);
    const signal = wyckoffStrategy.analyze(candles, params, 'SOL/USDT', 'spot');
    expect(signal.action).toBe('hold');
  });

  it('returns hold when the upthrust bar closes exactly at resistance (not strictly inside)', () => {
    const candles = build([...RANGE, { close: 101, high: 102, low: 99.5, volume: 1000 }]);
    const signal = wyckoffStrategy.analyze(candles, params, 'SOL/USDT', 'spot');
    expect(signal.action).toBe('hold');
  });

  it('applies no volume boost when volumeFactor is 0', () => {
    const candles = build([...RANGE, { close: 100, high: 100.5, low: 98, volume: 5000 }]);
    const signal = wyckoffStrategy.analyze(candles, { ...params, volumeFactor: 0 }, 'SOL/USDT', 'spot');
    expect(signal.action).toBe('buy');
    // Price-only confidence: 0.4 + (recovery 1 / rangeHeight 2) * 0.3 = 0.55, no volume contribution.
    expect(signal.confidence).toBeCloseTo(0.55, 5);
  });

  it('raises confidence when the spring bar has higher volume', () => {
    const lowVol = build([...RANGE, { close: 100, high: 100.5, low: 98, volume: 500 }]);
    const highVol = build([...RANGE, { close: 100, high: 100.5, low: 98, volume: 2000 }]);
    const low = wyckoffStrategy.analyze(lowVol, params, 'SOL/USDT', 'spot');
    const high = wyckoffStrategy.analyze(highVol, params, 'SOL/USDT', 'spot');
    expect(high.confidence).toBeGreaterThan(low.confidence);
  });
});
