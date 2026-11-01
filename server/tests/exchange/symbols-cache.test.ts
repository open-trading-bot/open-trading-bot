import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getCachedSymbols,
  setCachedSymbols,
  clearSymbolsCache,
  symbolsCacheKey,
  getOrComputeSymbols,
} from '../../src/exchange/symbols-cache.js';
import { DEFAULTS } from '../../src/utils/constants.js';

describe('symbolsCacheKey', () => {
  it('produces distinct keys for testnet and mainnet on the same exchange', () => {
    expect(symbolsCacheKey('bybit', true)).not.toBe(symbolsCacheKey('bybit', false));
  });

  it('produces distinct keys for different exchanges', () => {
    expect(symbolsCacheKey('bybit', false)).not.toBe(symbolsCacheKey('binance', false));
  });

  it('produces the same key for repeated identical inputs', () => {
    expect(symbolsCacheKey('bybit', false)).toBe(symbolsCacheKey('bybit', false));
  });
});

describe('symbols cache', () => {
  beforeEach(() => {
    clearSymbolsCache();
  });

  it('returns null on cache miss', () => {
    expect(getCachedSymbols('bybit:main')).toBeNull();
  });

  it('returns stored symbols on cache hit', () => {
    setCachedSymbols('bybit:main', ['BTC/USDT', 'ETH/USDT']);
    expect(getCachedSymbols('bybit:main')).toEqual(['BTC/USDT', 'ETH/USDT']);
  });

  it('isolates entries by key — testnet does not leak into mainnet', () => {
    setCachedSymbols('bybit:testnet', ['BTC/USDT']);
    setCachedSymbols('bybit:main', ['BTC/USDT', 'ETH/USDT', 'SOL/USDT']);
    expect(getCachedSymbols('bybit:testnet')).toEqual(['BTC/USDT']);
    expect(getCachedSymbols('bybit:main')).toEqual(['BTC/USDT', 'ETH/USDT', 'SOL/USDT']);
  });

  it('expires entries past the TTL', () => {
    const t0 = 1_000_000;
    setCachedSymbols('bybit:main', ['BTC/USDT'], t0);
    // Still valid just before TTL.
    expect(getCachedSymbols('bybit:main', t0 + DEFAULTS.SYMBOLS_CACHE_TTL_MS - 1)).toEqual(['BTC/USDT']);
    // Expires exactly at TTL.
    expect(getCachedSymbols('bybit:main', t0 + DEFAULTS.SYMBOLS_CACHE_TTL_MS)).toBeNull();
    // And stays expired afterwards.
    expect(getCachedSymbols('bybit:main', t0 + DEFAULTS.SYMBOLS_CACHE_TTL_MS + 1000)).toBeNull();
  });

  it('expired entries are evicted, not reused on a later check', () => {
    const t0 = 1_000_000;
    setCachedSymbols('bybit:main', ['BTC/USDT'], t0);
    // Trigger expiry.
    expect(getCachedSymbols('bybit:main', t0 + DEFAULTS.SYMBOLS_CACHE_TTL_MS)).toBeNull();
    // A subsequent check with a fresh "now" close to t0 still sees it as gone
    // (proving the expired entry was deleted, not just ignored that one call).
    expect(getCachedSymbols('bybit:main', t0 + 1)).toBeNull();
  });

  it('clearSymbolsCache empties every entry', () => {
    setCachedSymbols('bybit:main', ['BTC/USDT']);
    setCachedSymbols('binance:main', ['ETH/USDT']);
    clearSymbolsCache();
    expect(getCachedSymbols('bybit:main')).toBeNull();
    expect(getCachedSymbols('binance:main')).toBeNull();
  });

  it('setCachedSymbols overwrites an existing entry', () => {
    setCachedSymbols('bybit:main', ['BTC/USDT']);
    setCachedSymbols('bybit:main', ['BTC/USDT', 'ETH/USDT']);
    expect(getCachedSymbols('bybit:main')).toEqual(['BTC/USDT', 'ETH/USDT']);
  });
});

describe('getOrComputeSymbols — cold-start dedup', () => {
  beforeEach(() => {
    clearSymbolsCache();
  });

  it('returns cached value without invoking producer on warm cache', async () => {
    setCachedSymbols('bybit:main', ['BTC/USDT']);
    const producer = vi.fn().mockResolvedValue(['NEW/USDT']);
    const result = await getOrComputeSymbols('bybit:main', producer);
    expect(result).toEqual(['BTC/USDT']);
    expect(producer).not.toHaveBeenCalled();
  });

  it('invokes producer once on cold cache and stores the result', async () => {
    const producer = vi.fn().mockResolvedValue(['BTC/USDT', 'ETH/USDT']);
    const result = await getOrComputeSymbols('bybit:main', producer);
    expect(result).toEqual(['BTC/USDT', 'ETH/USDT']);
    expect(producer).toHaveBeenCalledTimes(1);
    // Next call should be a cache hit with no additional producer invocation.
    await getOrComputeSymbols('bybit:main', producer);
    expect(producer).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent cold callers — producer runs exactly once', async () => {
    // Simulates the thundering-herd scenario: N concurrent requests race on a
    // cold cache. Without dedup, each caller fires its own producer. With
    // dedup, they all share the same in-flight Promise.
    let resolveProducer!: (value: string[]) => void;
    const producer = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          resolveProducer = resolve;
        }),
    );

    // Fire 5 concurrent callers before the producer resolves.
    const pending = [
      getOrComputeSymbols('bybit:main', producer),
      getOrComputeSymbols('bybit:main', producer),
      getOrComputeSymbols('bybit:main', producer),
      getOrComputeSymbols('bybit:main', producer),
      getOrComputeSymbols('bybit:main', producer),
    ];

    // Producer is called exactly once even though 5 requests raced.
    expect(producer).toHaveBeenCalledTimes(1);

    // Resolve the single in-flight Promise — all 5 callers get the same result.
    resolveProducer(['BTC/USDT', 'ETH/USDT']);
    const results = await Promise.all(pending);
    for (const r of results) expect(r).toEqual(['BTC/USDT', 'ETH/USDT']);
    expect(producer).toHaveBeenCalledTimes(1);
  });

  it('a call made AFTER the in-flight Promise resolves hits the cache, not the producer', async () => {
    const producer = vi.fn().mockResolvedValue(['BTC/USDT']);
    await getOrComputeSymbols('bybit:main', producer);
    // Cache is now warm, producer should not run again.
    const producer2 = vi.fn().mockResolvedValue(['SHOULD/NOT/APPEAR']);
    const result = await getOrComputeSymbols('bybit:main', producer2);
    expect(result).toEqual(['BTC/USDT']);
    expect(producer2).not.toHaveBeenCalled();
  });

  it('producer failure clears the in-flight entry so the next call retries', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('network down'));
    await expect(getOrComputeSymbols('bybit:main', failing)).rejects.toThrow('network down');

    // The in-flight entry was cleaned up — next call runs the producer again.
    const retrying = vi.fn().mockResolvedValue(['BTC/USDT']);
    const result = await getOrComputeSymbols('bybit:main', retrying);
    expect(result).toEqual(['BTC/USDT']);
    expect(retrying).toHaveBeenCalledTimes(1);
  });

  it('concurrent callers on different keys each get their own producer run', async () => {
    const btcProducer = vi.fn().mockResolvedValue(['BTC/USDT']);
    const ethProducer = vi.fn().mockResolvedValue(['ETH/USDT']);
    const [bybit, binance] = await Promise.all([
      getOrComputeSymbols('bybit:main', btcProducer),
      getOrComputeSymbols('binance:main', ethProducer),
    ]);
    expect(bybit).toEqual(['BTC/USDT']);
    expect(binance).toEqual(['ETH/USDT']);
    expect(btcProducer).toHaveBeenCalledTimes(1);
    expect(ethProducer).toHaveBeenCalledTimes(1);
  });
});
