import { describe, it, expect } from 'vitest';
import { parseConfigUpdate } from '../../src/utils/config-schema.js';

describe('parseConfigUpdate (S3)', () => {
  it('accepts a valid partial update', () => {
    const r = parseConfigUpdate({ tickInterval: 60, tradeAmount: 100, mode: 'paper' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ tickInterval: 60, tradeAmount: 100, mode: 'paper' });
  });

  it.each([
    [{ tickInterval: 0.001 }],
    [{ tickInterval: 0 }],
    [{ tickInterval: 'x' }],
    [{ dailyLossLimit: 'x' }],
    [{ maxOpenPositions: 'x' }],
    [{ tradeAmount: -5 }],
    [{ tradeAmount: 1e12 }],
    [{ minConfidence: 2 }],
    [{ stopLossPct: 0 }],
    [{ mode: 'yolo' }],
    [{ orderType: 'stop' }],
    [{ riskLevel: 'insane' }],
    [{ strategies: [{ id: 'rsi', name: 'RSI', enabled: true, interval: '5m', marketType: 'spot', params: { period: 1e7 } }] }],
    [{ assets: [{ symbol: 'BTC/USDT', enabled: 'yes', marketType: 'spot' }] }],
  ])('rejects %j', (body) => {
    expect(parseConfigUpdate(body).ok).toBe(false);
  });

  it('drops unknown keys instead of saving them', () => {
    const r = parseConfigUpdate({ tradeAmount: 50, isAdmin: true, __proto__: { x: 1 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ tradeAmount: 50 });
  });

  it('rejects a body that is not an object', () => {
    expect(parseConfigUpdate(null).ok).toBe(false);
    expect(parseConfigUpdate([1, 2]).ok).toBe(false);
  });
});
