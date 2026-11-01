import { describe, it, expect } from 'vitest';
import { runBacktest } from '../../../src/engine/backtest/index.js';
import type { Candle } from '../../../src/types/index.js';

function makeCandles(count: number): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    price += Math.sin(i / 5) * 3;
    candles.push({ timestamp: Date.now() - (count - i) * 60000, open: price - 1, high: price + 2, low: price - 2, close: price, volume: 1000 });
  }
  return candles;
}

describe('Backtest Engine', () => {
  it('runs a backtest and returns results', () => {
    const result = runBacktest({ strategyId: 'rsi', candles: makeCandles(100), symbol: 'BTC/USDT', marketType: 'spot', tradeAmount: 100, params: { period: 14, oversold: 30, overbought: 70 } });
    expect(result.trades).toBeDefined();
    expect(result.totalReturn).toBeDefined();
    expect(result.winRate).toBeDefined();
    expect(result.maxDrawdown).toBeDefined();
    expect(result.equity.length).toBeGreaterThan(0);
  });

  it('returns zero results for hold-only signals', () => {
    const candles = Array.from({ length: 50 }, (_, i) => ({ timestamp: Date.now() - (50 - i) * 60000, open: 100, high: 100.5, low: 99.5, close: 100, volume: 1000 }));
    const result = runBacktest({ strategyId: 'rsi', candles, symbol: 'BTC/USDT', marketType: 'spot', tradeAmount: 100, params: { period: 14, oversold: 30, overbought: 70 } });
    expect(result.trades).toHaveLength(0);
    expect(result.totalReturn).toBe(0);
  });
});
