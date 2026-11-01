import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb, type Db } from '../../src/db/index.js';
import { BOT_ACTIONS, ACTION_SOURCES } from '../../src/utils/constants.js';
import fs from 'fs';
import path from 'path';

const TEST_DB = path.join(import.meta.dirname, 'action-logs-test.db');

describe('Database — action_logs', () => {
  let db: Db;

  beforeEach(() => {
    db = createDb(TEST_DB);
    db.createUser('admin', null, 'hash', 'admin');
    db.createUser('trader', null, 'hash', 'regular');
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it('creates action_logs table on init', () => {
    const tables = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain('action_logs');
  });

  it('inserts and retrieves action log', () => {
    db.insertActionLog(2, BOT_ACTIONS.START, 2, ACTION_SOURCES.SELF);
    const { data, total } = db.getActionLogs(2, 0, 10);

    expect(total).toBe(1);
    expect(data).toHaveLength(1);
    expect(data[0].userId).toBe(2);
    expect(data[0].action).toBe(BOT_ACTIONS.START);
    expect(data[0].actorId).toBe(2);
    expect(data[0].source).toBe(ACTION_SOURCES.SELF);
    expect(data[0].timestamp).toBeGreaterThan(0);
  });

  it('returns actorUsername from joined users table', () => {
    db.insertActionLog(2, BOT_ACTIONS.STOP, 1, ACTION_SOURCES.BACKOFFICE);
    const { data } = db.getActionLogs(2, 0, 10);

    expect(data[0].actorUsername).toBe('admin');
  });

  it('returns unknown for deleted actor', () => {
    db.insertActionLog(2, BOT_ACTIONS.STOP, 999, ACTION_SOURCES.BACKOFFICE);
    const { data } = db.getActionLogs(2, 0, 10);

    expect(data[0].actorUsername).toBe('unknown');
  });

  it('filters logs by user_id', () => {
    db.insertActionLog(1, BOT_ACTIONS.START, 1, ACTION_SOURCES.SELF);
    db.insertActionLog(2, BOT_ACTIONS.START, 2, ACTION_SOURCES.SELF);
    db.insertActionLog(2, BOT_ACTIONS.STOP, 1, ACTION_SOURCES.BACKOFFICE);

    const user1 = db.getActionLogs(1, 0, 10);
    const user2 = db.getActionLogs(2, 0, 10);

    expect(user1.total).toBe(1);
    expect(user2.total).toBe(2);
  });

  it('paginates results correctly', () => {
    for (let i = 0; i < 5; i++) {
      db.insertActionLog(2, BOT_ACTIONS.START, 2, ACTION_SOURCES.SELF);
    }

    const page0 = db.getActionLogs(2, 0, 2);
    const page1 = db.getActionLogs(2, 1, 2);
    const page2 = db.getActionLogs(2, 2, 2);

    expect(page0.total).toBe(5);
    expect(page0.data).toHaveLength(2);
    expect(page1.data).toHaveLength(2);
    expect(page2.data).toHaveLength(1);
  });

  it('returns logs in reverse chronological order', () => {
    db.insertActionLog(2, BOT_ACTIONS.START, 2, ACTION_SOURCES.SELF);
    db.insertActionLog(2, BOT_ACTIONS.STOP, 2, ACTION_SOURCES.SELF);
    db.insertActionLog(2, BOT_ACTIONS.KILL, 1, ACTION_SOURCES.BACKOFFICE);

    const { data } = db.getActionLogs(2, 0, 10);

    expect(data[0].action).toBe(BOT_ACTIONS.KILL);
    expect(data[2].action).toBe(BOT_ACTIONS.START);
  });

  it('returns empty results for user with no logs', () => {
    const { data, total } = db.getActionLogs(999, 0, 10);
    expect(data).toHaveLength(0);
    expect(total).toBe(0);
  });

  it('filters by action type', () => {
    db.insertActionLog(2, BOT_ACTIONS.START, 2, ACTION_SOURCES.SELF);
    db.insertActionLog(2, BOT_ACTIONS.STOP, 2, ACTION_SOURCES.SELF);
    db.insertActionLog(2, BOT_ACTIONS.KILL, 1, ACTION_SOURCES.BACKOFFICE);

    const killOnly = db.getActionLogs(2, 0, 10, { action: BOT_ACTIONS.KILL });
    expect(killOnly.total).toBe(1);
    expect(killOnly.data[0].action).toBe(BOT_ACTIONS.KILL);

    const startOnly = db.getActionLogs(2, 0, 10, { action: BOT_ACTIONS.START });
    expect(startOnly.total).toBe(1);
    expect(startOnly.data[0].action).toBe(BOT_ACTIONS.START);
  });

  it('filters by source', () => {
    db.insertActionLog(2, BOT_ACTIONS.START, 2, ACTION_SOURCES.SELF);
    db.insertActionLog(2, BOT_ACTIONS.STOP, 1, ACTION_SOURCES.BACKOFFICE);
    db.insertActionLog(2, BOT_ACTIONS.KILL, 1, ACTION_SOURCES.BACKOFFICE);

    const selfOnly = db.getActionLogs(2, 0, 10, { source: ACTION_SOURCES.SELF });
    expect(selfOnly.total).toBe(1);
    expect(selfOnly.data[0].source).toBe(ACTION_SOURCES.SELF);

    const boOnly = db.getActionLogs(2, 0, 10, { source: ACTION_SOURCES.BACKOFFICE });
    expect(boOnly.total).toBe(2);
    expect(boOnly.data.every((l) => l.source === ACTION_SOURCES.BACKOFFICE)).toBe(true);
  });

  it('filters by combined action + source', () => {
    db.insertActionLog(2, BOT_ACTIONS.START, 2, ACTION_SOURCES.SELF);
    db.insertActionLog(2, BOT_ACTIONS.STOP, 1, ACTION_SOURCES.BACKOFFICE);
    db.insertActionLog(2, BOT_ACTIONS.STOP, 2, ACTION_SOURCES.SELF);
    db.insertActionLog(2, BOT_ACTIONS.KILL, 1, ACTION_SOURCES.BACKOFFICE);

    const res = db.getActionLogs(2, 0, 10, { action: BOT_ACTIONS.STOP, source: ACTION_SOURCES.BACKOFFICE });
    expect(res.total).toBe(1);
    expect(res.data[0].action).toBe(BOT_ACTIONS.STOP);
    expect(res.data[0].source).toBe(ACTION_SOURCES.BACKOFFICE);
  });

  it('filters respect user_id boundary', () => {
    db.insertActionLog(1, BOT_ACTIONS.KILL, 1, ACTION_SOURCES.SELF);
    db.insertActionLog(2, BOT_ACTIONS.START, 2, ACTION_SOURCES.SELF);

    const user2Kill = db.getActionLogs(2, 0, 10, { action: BOT_ACTIONS.KILL });
    expect(user2Kill.total).toBe(0);
  });
});
