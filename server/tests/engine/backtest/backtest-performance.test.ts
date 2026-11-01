import { describe, it, expect, vi, afterEach } from 'vitest';
import { runBacktest } from '../../../src/engine/backtest/index.js';
import { strategies } from '../../../src/engine/strategies/index.js';
import type { Strategy } from '../../../src/engine/strategies/types.js';
import type { Candle } from '../../../src/types/index.js';
import { createBacktestService } from '../../../src/services/backtest.js';

function candles(n: number, start = Date.now() - n * 60_000, stepMs = 60_000): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const p = 100 + Math.sin(i / 15) * 10;
    return { timestamp: start + i * stepMs, open: p, high: p + 1, low: p - 1, close: p, volume: 1 };
  });
}

afterEach(() => { delete (strategies as Record<string, Strategy>).__spy__; });

describe('Backtest performance (P2)', () => {
  it('passes each strategy call a bounded window, like the live bot', () => {
    const sizes: number[] = [];
    (strategies as Record<string, Strategy>).__spy__ = {
      id: '__spy__', name: 'spy', defaultParams: {},
      analyze: (c, _p, symbol, marketType) => { sizes.push(c.length); return { action: 'hold', confidence: 0, price: 0, symbol, marketType, strategy: '__spy__', reason: '' }; },
    } as Strategy;
    runBacktest({ strategyId: '__spy__', candles: candles(5000), symbol: 'BTC/USDT', marketType: 'spot', tradeAmount: 100, params: {} });
    expect(Math.max(...sizes)).toBeLessThanOrEqual(100);
  });

  // The O(n^2) version took about 126 s. The limit has margin for a loaded
  // CI machine and still catches that regression.
  it('runs 43,000 one-minute candles (30 days) in under 5 seconds', () => {
    const t0 = performance.now();
    runBacktest({ strategyId: 'rsi', candles: candles(43_000), symbol: 'BTC/USDT', marketType: 'spot', tradeAmount: 100, params: { period: 14, oversold: 30, overbought: 70 } });
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});

describe('Backtest data coverage (P2)', () => {
  it('fetches history from the exchange when the DB has only recent candles', async () => {
    const hour = 3_600_000;
    const now = Date.now();
    const recent = candles(100, now - 100 * hour, hour);
    const fetched = candles(720, now - 720 * hour, hour);
    const db = { getCandles: vi.fn().mockReturnValue(recent), insertCandles: vi.fn() } as any;
    const exchange = { fetchCandles: vi.fn().mockResolvedValue(fetched) };
    const botManager = { getReadExchange: vi.fn().mockReturnValue(exchange) } as any;
    await createBacktestService(db, botManager).run(1, 'BTC/USDT', 'rsi', '1h');
    expect(exchange.fetchCandles).toHaveBeenCalledWith('BTC/USDT', '1h', 720);
  });

  it('uses the DB when it covers the requested range', async () => {
    const hour = 3_600_000;
    const now = Date.now();
    const db = { getCandles: vi.fn().mockReturnValue(candles(720, now - 720 * hour, hour)), insertCandles: vi.fn() } as any;
    const exchange = { fetchCandles: vi.fn() };
    const botManager = { getReadExchange: vi.fn().mockReturnValue(exchange) } as any;
    await createBacktestService(db, botManager).run(1, 'BTC/USDT', 'rsi', '1h');
    expect(exchange.fetchCandles).not.toHaveBeenCalled();
  });
});
