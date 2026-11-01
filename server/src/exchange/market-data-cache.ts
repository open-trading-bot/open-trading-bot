import * as ccxt from 'ccxt';
import type { Candle, Ticker } from '../types/index.js';
import type { ExchangeAdapter } from './types.js';
import logger from '../utils/logger.js';

/**
 * Shares public market data between users and protects the server IP from
 * exchange rate limits.
 *
 * Every user has an own adapter (own API keys), but candles and tickers are
 * the same for every user on one exchange network. Without sharing, N users
 * on BTC/USDT make N identical requests per tick from one IP.
 *
 * `key` identifies the exchange network, for example "bybit|testnet".
 */

const TICKER_TTL_MS = 5_000;
const CANDLE_TTL_MS = 15_000;
const BACKOFF_MIN_MS = 30_000;
const BACKOFF_MAX_MS = 5 * 60_000;

interface Entry<T> { expires: number; value: Promise<T> }

const cache = new Map<string, Entry<unknown>>();
const breakers = new Map<string, { pausedUntil: number; backoffMs: number }>();

export function clearMarketDataCache(): void {
  cache.clear();
  breakers.clear();
}

function isRateLimitError(err: unknown): boolean {
  return err instanceof ccxt.RateLimitExceeded || err instanceof ccxt.DDoSProtection;
}

function assertNotPaused(key: string): void {
  const b = breakers.get(key);
  if (b && Date.now() < b.pausedUntil) {
    throw new Error(`Exchange calls paused after a rate-limit error (${key}); retry in ${Math.ceil((b.pausedUntil - Date.now()) / 1000)}s`);
  }
}

function tripBreaker(key: string): void {
  const prev = breakers.get(key);
  // Double the pause if the previous pause ended less than one backoff ago.
  const backoffMs = prev && Date.now() < prev.pausedUntil + prev.backoffMs
    ? Math.min(prev.backoffMs * 2, BACKOFF_MAX_MS)
    : BACKOFF_MIN_MS;
  breakers.set(key, { pausedUntil: Date.now() + backoffMs, backoffMs });
  logger.warn(`[exchange] Rate limit hit on ${key} — pausing calls for ${backoffMs / 1000}s`);
}

async function guarded<T>(key: string, call: () => Promise<T>, { bypassPause = false } = {}): Promise<T> {
  if (!bypassPause) assertNotPaused(key);
  try {
    return await call();
  } catch (err) {
    if (isRateLimitError(err)) tripBreaker(key);
    throw err;
  }
}

function cached<T>(cacheKey: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(cacheKey) as Entry<T> | undefined;
  if (hit && Date.now() < hit.expires) return hit.value;
  const value = load();
  cache.set(cacheKey, { expires: Date.now() + ttlMs, value });
  // A failure is not cached: the next caller tries again.
  value.catch(() => { if (cache.get(cacheKey)?.value === value) cache.delete(cacheKey); });
  return value;
}

export function withSharedMarketData(adapter: ExchangeAdapter, key: string): ExchangeAdapter {
  return {
    ...adapter,
    name: adapter.name,
    fetchSymbols: () => guarded(key, () => adapter.fetchSymbols()),
    fetchTicker(symbol: string): Promise<Ticker> {
      return cached(`${key}|t|${symbol}`, TICKER_TTL_MS, () => guarded(key, () => adapter.fetchTicker(symbol)));
    },
    async fetchCandles(symbol: string, interval: string, limit?: number): Promise<Candle[]> {
      const candles = await cached(`${key}|c|${symbol}|${interval}|${limit ?? ''}`, CANDLE_TTL_MS,
        () => guarded(key, () => adapter.fetchCandles(symbol, interval, limit)));
      return candles.slice();
    },
    placeOrder: (params) => guarded(key, () => adapter.placeOrder(params)),
    cancelOrder: (orderId, symbol) => guarded(key, () => adapter.cancelOrder(orderId, symbol)),
    fetchBalance: () => guarded(key, () => adapter.fetchBalance()),
    // Exits always go through. A pause must never keep a position open.
    closePosition: (symbol, side, quantity, marketType) =>
      guarded(key, () => adapter.closePosition(symbol, side, quantity, marketType), { bypassPause: true }),
    ...(adapter.fetchPermissions
      ? { fetchPermissions: () => guarded(key, () => adapter.fetchPermissions!()) }
      : {}),
  };
}
