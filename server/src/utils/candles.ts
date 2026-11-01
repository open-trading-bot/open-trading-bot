import type { Candle } from '../types/index.js';

const UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000, M: 2_592_000_000 };

/** Length of one candle in ms, or null when the interval format is unknown. */
export function intervalToMs(interval: string): number | null {
  const m = /^(\d+)([mhdwM])$/.exec(interval);
  return m ? Number(m[1]) * UNIT_MS[m[2]] : null;
}

/**
 * Removes the last candle when it is still forming. A forming candle changes
 * until it closes, so a signal on it can flip inside one bar. Backtests only
 * see closed candles, so live trading must do the same to match them.
 */
export function closedCandlesOnly<T extends Pick<Candle, 'timestamp'>>(candles: T[], interval: string, now = Date.now()): T[] {
  const step = intervalToMs(interval);
  const last = candles[candles.length - 1];
  if (step === null || !last || last.timestamp + step <= now) return candles;
  return candles.slice(0, -1);
}
