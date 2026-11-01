import { describe, it, expect } from 'vitest';
import { intervalToMs, closedCandlesOnly } from '../../src/utils/candles.js';

const c = (timestamp: number) => ({ timestamp, open: 1, high: 1, low: 1, close: 1, volume: 1 });

describe('intervalToMs', () => {
  it.each([['1m', 60_000], ['5m', 300_000], ['1h', 3_600_000], ['4h', 14_400_000], ['1d', 86_400_000], ['1w', 604_800_000]])('%s', (i, ms) => {
    expect(intervalToMs(i)).toBe(ms);
  });
  it('returns null for an unknown format', () => { expect(intervalToMs('abc')).toBeNull(); });
});

describe('closedCandlesOnly', () => {
  const now = 10 * 300_000 + 120_000; // two minutes into a 5m candle

  it('drops the last candle when it is still forming', () => {
    const candles = [c(8 * 300_000), c(9 * 300_000), c(10 * 300_000)];
    expect(closedCandlesOnly(candles, '5m', now).map((x) => x.timestamp)).toEqual([8 * 300_000, 9 * 300_000]);
  });

  it('keeps all candles when the last one is closed', () => {
    const candles = [c(8 * 300_000), c(9 * 300_000)];
    expect(closedCandlesOnly(candles, '5m', now)).toHaveLength(2);
  });

  it('keeps the candles unchanged for an unknown interval', () => {
    const candles = [c(1), c(2)];
    expect(closedCandlesOnly(candles, 'abc', now)).toHaveLength(2);
  });

  it('does not change the input array', () => {
    const candles = [c(9 * 300_000), c(10 * 300_000)];
    closedCandlesOnly(candles, '5m', now);
    expect(candles).toHaveLength(2);
  });
});
