import { describe, it, expect, vi } from 'vitest';
import { createFeatureFlagService } from '../../src/services/featureFlags.js';
import type { Db, DbFeatureFlag, DbFeatureFlagOverride } from '../../src/db/index.js';

let overrideIdSeq = 0;

function createMockDb(
  initialFlags: DbFeatureFlag[] = [],
  initialOverrides: DbFeatureFlagOverride[] = [],
): Db {
  const flags: DbFeatureFlag[] = [...initialFlags];
  const overrides: DbFeatureFlagOverride[] = [...initialOverrides];

  return {
    getActiveFlags: vi.fn(() => [...flags]),
    getAllFlagOverrides: vi.fn(() => [...overrides]),
    getFlagOverrides: vi.fn((flagId: string) => overrides.filter((o) => o.flagId === flagId)),
    createFlag: vi.fn((id: string, description: string, enabled: boolean, createdBy: number) => {
      const now = Date.now();
      flags.push({ id, description, enabled, createdBy, createdAt: now, updatedAt: now });
    }),
    updateFlag: vi.fn((id: string, updates: Partial<{ description: string; enabled: boolean }>) => {
      const flag = flags.find((f) => f.id === id);
      if (!flag) return;
      if (updates.description !== undefined) flag.description = updates.description;
      if (updates.enabled !== undefined) flag.enabled = updates.enabled;
      flag.updatedAt = Date.now();
    }),
    deleteFlag: vi.fn((id: string) => {
      const idx = flags.findIndex((f) => f.id === id);
      if (idx !== -1) flags.splice(idx, 1);
    }),
    replaceFlagOverrides: vi.fn((flagId: string, newOverrides: { targetType: string; targetValue: string; enabled: boolean }[]) => {
      const idx = overrides.reduce((acc: number[], o, i) => { if (o.flagId === flagId) acc.push(i); return acc; }, []);
      for (let i = idx.length - 1; i >= 0; i--) overrides.splice(idx[i], 1);
      for (const o of newOverrides) {
        overrides.push({
          id: ++overrideIdSeq,
          flagId,
          targetType: o.targetType as 'user' | 'role',
          targetValue: o.targetValue,
          enabled: o.enabled,
        });
      }
    }),
  } as any as Db;
}

function makeFlag(id: string, enabled: boolean, overrides?: { createdBy?: number }): DbFeatureFlag {
  return { id, description: `${id} flag`, enabled, createdBy: overrides?.createdBy ?? 1, createdAt: 1000, updatedAt: 1000 };
}

function makeOverride(flagId: string, targetType: 'user' | 'role', targetValue: string, enabled: boolean): DbFeatureFlagOverride {
  return { id: ++overrideIdSeq, flagId, targetType, targetValue, enabled };
}

describe('FeatureFlagService', () => {
  describe('getResolvedFlags', () => {
    it('returns global default when no overrides exist', () => {
      const db = createMockDb([makeFlag('featureA', true)]);
      const service = createFeatureFlagService(db);

      const result = service.getResolvedFlags(1, 'regular');
      expect(result).toEqual({ featureA: true });
    });

    it('user override takes priority over role override', () => {
      const flag = makeFlag('featureB', true);
      const roleOverride = makeOverride('featureB', 'role', 'regular', false);
      const userOverride = makeOverride('featureB', 'user', '7', true);
      const db = createMockDb([flag], [roleOverride, userOverride]);
      const service = createFeatureFlagService(db);

      // User 7 has an explicit true override; role override says false
      const result = service.getResolvedFlags(7, 'regular');
      expect(result['featureB']).toBe(true);
    });

    it('role override takes priority over global default', () => {
      const flag = makeFlag('featureC', true); // global: enabled
      const roleOverride = makeOverride('featureC', 'role', 'demo', false);
      const db = createMockDb([flag], [roleOverride]);
      const service = createFeatureFlagService(db);

      // Demo role override disables despite global default being enabled
      const result = service.getResolvedFlags(99, 'demo');
      expect(result['featureC']).toBe(false);
    });

    it('resolves multiple flags independently', () => {
      const flag1 = makeFlag('alpha', true);
      const flag2 = makeFlag('beta', false);
      const flag3 = makeFlag('gamma', true);
      const userOverride = makeOverride('beta', 'user', '3', true);
      const roleOverride = makeOverride('gamma', 'role', 'admin', false);
      const db = createMockDb([flag1, flag2, flag3], [userOverride, roleOverride]);
      const service = createFeatureFlagService(db);

      const result = service.getResolvedFlags(3, 'admin');
      expect(result['alpha']).toBe(true);   // global default
      expect(result['beta']).toBe(true);    // user override
      expect(result['gamma']).toBe(false);  // role override
    });
  });

  describe('getAllFlags', () => {
    it('returns flags with their overrides grouped by flag', () => {
      const flag1 = makeFlag('featureX', true);
      const flag2 = makeFlag('featureY', false);
      const override1 = makeOverride('featureX', 'role', 'demo', false);
      const override2 = makeOverride('featureX', 'user', '5', true);
      const db = createMockDb([flag1, flag2], [override1, override2]);
      const service = createFeatureFlagService(db);

      const result = service.getAllFlags();
      expect(result).toHaveLength(2);

      const x = result.find((f) => f.id === 'featureX')!;
      expect(x.overrides).toHaveLength(2);
      expect(x.overrides[0]).not.toHaveProperty('id');
      expect(x.overrides[0]).not.toHaveProperty('flagId');

      const y = result.find((f) => f.id === 'featureY')!;
      expect(y.overrides).toHaveLength(0);
    });
  });

  describe('createFlag', () => {
    it('delegates to db.createFlag', () => {
      const db = createMockDb();
      const service = createFeatureFlagService(db);

      service.createFlag('newFlag', 'A new flag', false, 1);

      expect(db.createFlag).toHaveBeenCalledOnce();
      expect(db.createFlag).toHaveBeenCalledWith('newFlag', 'A new flag', false, 1);
    });
  });

  describe('deleteFlag', () => {
    it('delegates to db.deleteFlag', () => {
      const db = createMockDb([makeFlag('toDelete', true)]);
      const service = createFeatureFlagService(db);

      service.deleteFlag('toDelete');

      expect(db.deleteFlag).toHaveBeenCalledOnce();
      expect(db.deleteFlag).toHaveBeenCalledWith('toDelete');
    });
  });

  describe('setOverrides', () => {
    it('delegates to db.replaceFlagOverrides', () => {
      const db = createMockDb([makeFlag('flagZ', true)]);
      const service = createFeatureFlagService(db);

      const overrides = [
        { targetType: 'role', targetValue: 'demo', enabled: false },
        { targetType: 'user', targetValue: '10', enabled: true },
      ];
      service.setOverrides('flagZ', overrides);

      expect(db.replaceFlagOverrides).toHaveBeenCalledOnce();
      expect(db.replaceFlagOverrides).toHaveBeenCalledWith('flagZ', overrides);
    });
  });
});
