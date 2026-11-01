import type { Strategy } from './types.js';
import { maCrossover } from './ma-crossover.js';
import { rsiStrategy } from './rsi.js';
import { macdStrategy } from './macd.js';
import { bollingerStrategy } from './bollinger.js';
import { wyckoffStrategy } from './wyckoff.js';

export type { Strategy } from './types.js';

export const strategies: Record<string, Strategy> = {
  ma_crossover: maCrossover,
  rsi: rsiStrategy,
  macd: macdStrategy,
  bollinger: bollingerStrategy,
  wyckoff: wyckoffStrategy,
};

export function getStrategy(id: string): Strategy | undefined {
  return strategies[id];
}

export function getAllStrategies(): Strategy[] {
  return Object.values(strategies);
}
