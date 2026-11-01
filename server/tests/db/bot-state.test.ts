import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb, type Db } from '../../src/db/index.js';
import fs from 'fs';
import path from 'path';

const TEST_DB = path.join(import.meta.dirname, 'test-bot-state.db');

describe('Db — bot running-state persistence', () => {
  let db: Db;

  beforeEach(() => {
    db = createDb(TEST_DB);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  function seedUser(name = 'u') {
    return db.createUser(`${name}-${Math.random().toString(36).slice(2, 8)}`, null, 'hash', 'demo');
  }

  it('defaults to empty — no users are marked running', () => {
    expect(db.getEnabledBotUserIds()).toEqual([]);
  });

  it('persists setBotEnabled(true) and returns the user in getEnabledBotUserIds', () => {
    const u = seedUser();
    db.setBotEnabled(u.id, true);
    expect(db.getEnabledBotUserIds()).toEqual([u.id]);
  });

  it('setBotEnabled(false) removes the user from the enabled list', () => {
    const u1 = seedUser();
    const u2 = seedUser();
    db.setBotEnabled(u1.id, true);
    db.setBotEnabled(u2.id, true);
    db.setBotEnabled(u1.id, false);
    expect(db.getEnabledBotUserIds()).toEqual([u2.id]);
  });

  it('is idempotent: toggling the same value twice is a no-op', () => {
    const u = seedUser();
    db.setBotEnabled(u.id, true);
    db.setBotEnabled(u.id, true);
    expect(db.getEnabledBotUserIds()).toEqual([u.id]);
    db.setBotEnabled(u.id, false);
    db.setBotEnabled(u.id, false);
    expect(db.getEnabledBotUserIds()).toEqual([]);
  });

  it('state survives closing and re-opening the database (pod restart simulation)', () => {
    const u1 = seedUser();
    const u2 = seedUser();
    const u3 = seedUser();
    db.setBotEnabled(u1.id, true);
    db.setBotEnabled(u2.id, true);
    db.setBotEnabled(u3.id, false);
    db.close();

    // Re-open: simulates a new pod booting on the same volume.
    db = createDb(TEST_DB);
    expect(db.getEnabledBotUserIds().sort((a, b) => a - b)).toEqual([u1.id, u2.id]);
  });

  it('getBotEnabled returns per-user boolean', () => {
    const u = seedUser();
    db.setBotEnabled(u.id, true);
    expect(db.getBotEnabled(u.id)).toBe(true);
    expect(db.getBotEnabled(999)).toBe(false);
  });

  // Regression for PR review finding: `setUserConfig` used INSERT OR REPLACE
  // which wipes `bot_enabled` on every config save. Any user who tweaked
  // their config while the bot was running would have their persisted
  // flag silently reset to 0, causing resumeAll to skip them on the next
  // pod restart — reintroducing the exact bug this PR was meant to fix.
  it('setUserConfig does NOT reset bot_enabled (the whole reason the row exists)', () => {
    const u = seedUser();
    db.setBotEnabled(u.id, true);
    expect(db.getBotEnabled(u.id)).toBe(true);

    db.setUserConfig(u.id, { mode: 'paper', tradeAmount: 100 } as any);

    // Flag must survive the config write.
    expect(db.getBotEnabled(u.id)).toBe(true);
    expect(db.getEnabledBotUserIds()).toEqual([u.id]);
  });

  it('setUserConfig followed by setBotEnabled still round-trips both values', () => {
    const u = seedUser();
    db.setUserConfig(u.id, { mode: 'paper', tradeAmount: 500 } as any);
    db.setBotEnabled(u.id, true);

    const cfg = db.getUserConfig(u.id);
    expect(cfg).not.toBeNull();
    expect((cfg as any).tradeAmount).toBe(500);
    expect(db.getBotEnabled(u.id)).toBe(true);

    // And the reverse: updating config while enabled must keep the flag.
    db.setUserConfig(u.id, { mode: 'paper', tradeAmount: 999 } as any);
    expect((db.getUserConfig(u.id) as any).tradeAmount).toBe(999);
    expect(db.getBotEnabled(u.id)).toBe(true);
  });

  it('getUserConfig returns null for a row with no usable config (no `mode` field)', () => {
    const u = seedUser();
    db.setBotEnabled(u.id, true);

    // A BotConfig must have at least `mode`. An empty-object stub row
    // is not a valid config and must be treated like a missing row so
    // the bot-manager fallback kicks in.
    expect(db.getUserConfig(u.id)).toBeNull();
  });

  // Regression for PR review finding: resumeAll was happy to start
  // bots for users whose accounts had been soft-deleted or disabled.
  it('getEnabledBotUserIds filters out soft-deleted users', () => {
    // Seed two users, mark one as deleted, enable both.
    const alive = db.createUser('alive', null, 'hash', 'demo');
    const gone = db.createUser('gone', null, 'hash', 'demo');
    db.setBotEnabled(alive.id, true);
    db.setBotEnabled(gone.id, true);
    db.deleteUser(gone.id);

    const ids = db.getEnabledBotUserIds();
    expect(ids).toContain(alive.id);
    expect(ids).not.toContain(gone.id);
  });

  it('getEnabledBotUserIds filters out disabled users', () => {
    const active = db.createUser('active', null, 'hash', 'demo');
    const inactive = db.createUser('inactive', null, 'hash', 'demo');
    db.setBotEnabled(active.id, true);
    db.setBotEnabled(inactive.id, true);
    db.updateUser(inactive.id, { enabled: false });

    const ids = db.getEnabledBotUserIds();
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(inactive.id);
  });
});
