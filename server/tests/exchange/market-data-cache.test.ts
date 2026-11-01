import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as ccxt from 'ccxt';
import { withSharedMarketData, clearMarketDataCache } from '../../src/exchange/market-data-cache.js';
import type { ExchangeAdapter } from '../../src/exchange/types.js';

function adapter(): ExchangeAdapter {
  return {
    name: 'bybit',
    fetchSymbols: vi.fn().mockResolvedValue([]),
    fetchTicker: vi.fn().mockResolvedValue({ symbol: 'BTC/USDT', last: 1, bid: 1, ask: 1, volume24h: 0, timestamp: 0 }),
    fetchCandles: vi.fn().mockResolvedValue([{ timestamp: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }]),
    placeOrder: vi.fn().mockResolvedValue({}),
    cancelOrder: vi.fn(),
    fetchBalance: vi.fn().mockResolvedValue({ total: 1, free: 1, totalEquity: 1 }),
    closePosition: vi.fn().mockResolvedValue({}),
  };
}

beforeEach(() => { clearMarketDataCache(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('Shared market data (P1)', () => {
  it('shares candles between users on the same exchange and network', async () => {
    const a = adapter(); const b = adapter();
    const ua = withSharedMarketData(a, 'bybit|mainnet');
    const ub = withSharedMarketData(b, 'bybit|mainnet');
    await Promise.all([ua.fetchCandles('BTC/USDT', '5m'), ub.fetchCandles('BTC/USDT', '5m')]);
    await ub.fetchCandles('BTC/USDT', '5m');
    expect((a.fetchCandles as any).mock.calls.length + (b.fetchCandles as any).mock.calls.length).toBe(1);
  });

  it('does not share data between networks', async () => {
    const a = adapter(); const b = adapter();
    await withSharedMarketData(a, 'bybit|mainnet').fetchTicker('BTC/USDT');
    await withSharedMarketData(b, 'bybit|testnet').fetchTicker('BTC/USDT');
    expect(a.fetchTicker).toHaveBeenCalledTimes(1);
    expect(b.fetchTicker).toHaveBeenCalledTimes(1);
  });

  it('fetches again after the cache entry expires', async () => {
    const a = adapter();
    const u = withSharedMarketData(a, 'k');
    await u.fetchCandles('BTC/USDT', '5m');
    vi.advanceTimersByTime(60_000);
    await u.fetchCandles('BTC/USDT', '5m');
    expect(a.fetchCandles).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failure', async () => {
    const a = adapter();
    (a.fetchTicker as any).mockRejectedValueOnce(new Error('network'));
    const u = withSharedMarketData(a, 'k');
    await expect(u.fetchTicker('BTC/USDT')).rejects.toThrow('network');
    await expect(u.fetchTicker('BTC/USDT')).resolves.toBeDefined();
  });

  it('never caches private calls', async () => {
    const a = adapter();
    const u = withSharedMarketData(a, 'k');
    await u.fetchBalance(); await u.fetchBalance();
    expect(a.fetchBalance).toHaveBeenCalledTimes(2);
  });
});

describe('Rate-limit circuit breaker (P1)', () => {
  it('pauses calls to the exchange after a rate-limit error', async () => {
    const a = adapter();
    (a.fetchTicker as any).mockRejectedValueOnce(new ccxt.RateLimitExceeded('slow down'));
    const u = withSharedMarketData(a, 'k');
    await expect(u.fetchTicker('BTC/USDT')).rejects.toThrow();
    await expect(u.fetchBalance()).rejects.toThrow(/paused/i);
    await expect(u.placeOrder({ symbol: 'BTC/USDT', side: 'buy', amount: 1, type: 'market', marketType: 'spot' })).rejects.toThrow(/paused/i);
    expect(a.fetchBalance).not.toHaveBeenCalled();
    expect(a.placeOrder).not.toHaveBeenCalled();
  });

  it('pauses every user on the same exchange and network', async () => {
    const a = adapter(); const b = adapter();
    (a.fetchCandles as any).mockRejectedValueOnce(new ccxt.DDoSProtection('ban'));
    await expect(withSharedMarketData(a, 'k').fetchCandles('BTC/USDT', '5m')).rejects.toThrow();
    await expect(withSharedMarketData(b, 'k').fetchBalance()).rejects.toThrow(/paused/i);
  });

  it('still lets position closes through during a pause', async () => {
    const a = adapter();
    (a.fetchTicker as any).mockRejectedValueOnce(new ccxt.RateLimitExceeded('slow down'));
    const u = withSharedMarketData(a, 'k');
    await expect(u.fetchTicker('BTC/USDT')).rejects.toThrow();
    await u.closePosition('BTC/USDT', 'buy', 1, 'spot');
    expect(a.closePosition).toHaveBeenCalledTimes(1);
  });

  it('resumes after the pause', async () => {
    const a = adapter();
    (a.fetchTicker as any).mockRejectedValueOnce(new ccxt.RateLimitExceeded('slow down'));
    const u = withSharedMarketData(a, 'k');
    await expect(u.fetchTicker('BTC/USDT')).rejects.toThrow();
    vi.advanceTimersByTime(31_000);
    await expect(u.fetchBalance()).resolves.toBeDefined();
  });
});
