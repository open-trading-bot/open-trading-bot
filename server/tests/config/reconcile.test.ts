import { describe, it, expect } from 'vitest';
import { reconcileStrategies, createBotConfig } from '../../src/config/index.js';
import { getAllStrategies } from '../../src/engine/strategies/index.js';
import type { BotConfig } from '../../src/types/index.js';

const registryIds = getAllStrategies().map((s) => s.id);

function staleConfig(keepIds: string[]): BotConfig {
  const base = createBotConfig('paper');
  return { ...base, strategies: base.strategies.filter((s) => keepIds.includes(s.id)) };
}

describe('reconcileStrategies', () => {
  it('adds a newly-registered strategy missing from a stored config', () => {
    const stale = staleConfig(['ma_crossover', 'rsi', 'macd', 'bollinger']);
    const reconciled = reconcileStrategies(stale);
    const ids = reconciled.strategies.map((s) => s.id);
    for (const id of registryIds) expect(ids).toContain(id);
  });

  it('adds newly-registered strategies as DISABLED so a live bot does not auto-trade them', () => {
    const stale = staleConfig(['ma_crossover', 'rsi', 'macd', 'bollinger']);
    const newId = registryIds.find((id) => !['ma_crossover', 'rsi', 'macd', 'bollinger'].includes(id));
    const added = reconcileStrategies(stale).strategies.find((s) => s.id === newId);
    expect(added).toBeDefined();
    expect(added!.enabled).toBe(false);
  });

  it("preserves an existing strategy's enabled state and params", () => {
    const stale = staleConfig(['ma_crossover']);
    stale.strategies[0] = { ...stale.strategies[0], enabled: false, params: { fast: 99 } };
    const kept = reconcileStrategies(stale).strategies.find((s) => s.id === 'ma_crossover');
    expect(kept!.enabled).toBe(false);
    expect(kept!.params).toEqual({ fast: 99 });
  });

  it('drops strategies no longer present in the registry', () => {
    const stale = createBotConfig('paper');
    stale.strategies.push({
      id: 'ghost', name: 'Ghost', enabled: true, params: {}, interval: '1h', marketType: 'spot',
    });
    const ids = reconcileStrategies(stale).strategies.map((s) => s.id);
    expect(ids).not.toContain('ghost');
  });

  it('is idempotent on a freshly built config', () => {
    const fresh = createBotConfig('paper');
    expect(reconcileStrategies(fresh).strategies).toEqual(fresh.strategies);
  });
});
