import { DEFAULTS } from '../utils/constants.js';

interface CacheEntry {
  symbols: string[];
  at: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string[]>>();

export function getCachedSymbols(key: string, now: number = Date.now()): string[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at >= DEFAULTS.SYMBOLS_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.symbols;
}

export function setCachedSymbols(key: string, symbols: string[], now: number = Date.now()): void {
  cache.set(key, { symbols, at: now });
}

export function clearSymbolsCache(): void {
  cache.clear();
  inflight.clear();
}

export function symbolsCacheKey(exchangeName: string, testnet: boolean): string {
  return `${exchangeName}:${testnet ? 'testnet' : 'main'}`;
}

export async function getOrComputeSymbols(
  key: string,
  producer: () => Promise<string[]>,
): Promise<string[]> {
  const cached = getCachedSymbols(key);
  if (cached) return cached;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    try {
      const symbols = await producer();
      setCachedSymbols(key, symbols);
      return symbols;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}
