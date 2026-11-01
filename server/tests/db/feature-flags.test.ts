import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb, type Db } from '../../src/db/index.js';
import fs from 'fs';
import path from 'path';

const TEST_DB = path.join(import.meta.dirname, 'test-flags.db');

describe('Feature Flags DB', () => {
  let db: Db;

  beforeEach(() => {
    db = createDb(TEST_DB);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it('creates feature_flags and feature_flag_overrides tables after migration', () => {
    const tables = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('feature_flags');
    expect(names).toContain('feature_flag_overrides');
  });

  it('seeds connectWallet flag with enabled=true', () => {
    const flags = db.getActiveFlags();
    const connectWallet = flags.find((f) => f.id === 'connectWallet');
    expect(connectWallet).toBeDefined();
    expect(connectWallet!.enabled).toBe(true);
  });

  it('createFlag creates a new flag and getActiveFlags returns it', () => {
    db.createFlag('newFeature', 'A brand new feature', false, 1);
    const flags = db.getActiveFlags();
    const flag = flags.find((f) => f.id === 'newFeature');
    expect(flag).toBeDefined();
    expect(flag!.description).toBe('A brand new feature');
    expect(flag!.enabled).toBe(false);
    expect(flag!.createdBy).toBe(1);
  });

  it('updateFlag updates description and enabled state, and updates updated_at', async () => {
    db.createFlag('flagToUpdate', 'Original description', false, 1);
    const before = db.getActiveFlags().find((f) => f.id === 'flagToUpdate')!;

    // Small delay to ensure updated_at changes
    await new Promise((r) => setTimeout(r, 5));

    db.updateFlag('flagToUpdate', { description: 'Updated description', enabled: true });
    const after = db.getActiveFlags().find((f) => f.id === 'flagToUpdate')!;

    expect(after.description).toBe('Updated description');
    expect(after.enabled).toBe(true);
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
  });

  it('deleteFlag soft-deletes the flag so it no longer appears in getActiveFlags', () => {
    db.createFlag('flagToDelete', 'Will be deleted', true, 1);
    expect(db.getActiveFlags().find((f) => f.id === 'flagToDelete')).toBeDefined();

    db.deleteFlag('flagToDelete');

    expect(db.getActiveFlags().find((f) => f.id === 'flagToDelete')).toBeUndefined();

    // Confirm it's still in the raw table (soft delete)
    const raw = db.db
      .prepare('SELECT * FROM feature_flags WHERE id = ?')
      .get('flagToDelete') as { deleted_at: number | null } | undefined;
    expect(raw).toBeDefined();
    expect(raw!.deleted_at).not.toBeNull();
  });

  it('replaceFlagOverrides adds overrides and replaces them on second call', () => {
    db.createFlag('overrideFlag', 'Flag with overrides', true, 1);

    db.replaceFlagOverrides('overrideFlag', [
      { targetType: 'role', targetValue: 'demo', enabled: false },
      { targetType: 'user', targetValue: '42', enabled: true },
    ]);

    const firstSet = db.getFlagOverrides('overrideFlag');
    expect(firstSet).toHaveLength(2);

    db.replaceFlagOverrides('overrideFlag', [
      { targetType: 'role', targetValue: 'admin', enabled: true },
    ]);

    const secondSet = db.getFlagOverrides('overrideFlag');
    expect(secondSet).toHaveLength(1);
    expect(secondSet[0].targetType).toBe('role');
    expect(secondSet[0].targetValue).toBe('admin');
    expect(secondSet[0].enabled).toBe(true);
  });

  it('getFlagOverrides returns overrides for a specific flag only', () => {
    db.createFlag('flagA', 'Flag A', true, 1);
    db.createFlag('flagB', 'Flag B', true, 1);

    db.replaceFlagOverrides('flagA', [{ targetType: 'role', targetValue: 'demo', enabled: false }]);
    db.replaceFlagOverrides('flagB', [{ targetType: 'user', targetValue: '5', enabled: true }]);

    const overridesA = db.getFlagOverrides('flagA');
    expect(overridesA).toHaveLength(1);
    expect(overridesA[0].flagId).toBe('flagA');

    const overridesB = db.getFlagOverrides('flagB');
    expect(overridesB).toHaveLength(1);
    expect(overridesB[0].flagId).toBe('flagB');
  });

  it('getAllFlagOverrides returns only overrides for active (non-deleted) flags', () => {
    db.createFlag('activeFlag', 'Still alive', true, 1);
    db.createFlag('deadFlag', 'Will be deleted', true, 1);

    db.replaceFlagOverrides('activeFlag', [{ targetType: 'role', targetValue: 'admin', enabled: false }]);
    db.replaceFlagOverrides('deadFlag', [{ targetType: 'role', targetValue: 'demo', enabled: false }]);

    db.deleteFlag('deadFlag');

    const allOverrides = db.getAllFlagOverrides();
    expect(allOverrides.some((o) => o.flagId === 'activeFlag')).toBe(true);
    expect(allOverrides.some((o) => o.flagId === 'deadFlag')).toBe(false);
  });
});
