import { z } from 'zod';
import type { BotConfig } from '../types/index.js';

/** Minimum seconds between ticks. Shorter intervals risk an exchange rate-limit ban for the shared server IP. */
export const MIN_TICK_INTERVAL_SECONDS = 10;
const MAX_TICK_INTERVAL_SECONDS = 24 * 60 * 60;
const MAX_MONEY = 1e9;
const MAX_STRATEGY_PARAM = 10_000;

const finite = () => z.number().finite();

const strategySchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(128),
  enabled: z.boolean(),
  params: z.record(z.string().max(64), finite().min(-MAX_STRATEGY_PARAM).max(MAX_STRATEGY_PARAM)),
  interval: z.string().regex(/^\d{1,3}[mhdwM]$/),
  marketType: z.enum(['spot', 'futures']),
});

const assetSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9]{1,20}\/[A-Z0-9]{1,20}(:[A-Z0-9]{1,20})?$/),
  enabled: z.boolean(),
  marketType: z.enum(['spot', 'futures']),
});

// Unknown keys are dropped, not stored. Every number must be finite and in range,
// because a NaN limit makes every risk comparison pass.
const configUpdateSchema = z.object({
  mode: z.enum(['paper', 'live']),
  riskLevel: z.enum(['conservative', 'moderate', 'aggressive', 'very-aggressive', 'extreme', 'custom']),
  tradeAmount: finite().positive().max(MAX_MONEY),
  stopLossPct: finite().positive().max(100),
  dailyLossLimit: finite().positive().max(MAX_MONEY),
  maxOpenPositions: z.number().int().min(1).max(100),
  minConfidence: finite().min(0).max(1),
  tickInterval: z.number().int().min(MIN_TICK_INTERVAL_SECONDS).max(MAX_TICK_INTERVAL_SECONDS),
  orderType: z.enum(['market', 'limit']),
  assets: z.array(assetSchema).max(200),
  strategies: z.array(strategySchema).max(50),
}).partial();

export type ConfigUpdate = Partial<BotConfig>;

export function parseConfigUpdate(body: unknown):
  | { ok: true; value: ConfigUpdate }
  | { ok: false; error: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Config update must be a JSON object' };
  }
  const result = configUpdateSchema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { ok: false, error: `Invalid config: ${issue.path.join('.') || 'body'} — ${issue.message}` };
  }
  return { ok: true, value: result.data as ConfigUpdate };
}
