import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrations.js';

describe('migrations', () => {
  it('adds close_reason column to trades', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const cols = db.prepare("PRAGMA table_info(trades)").all() as { name: string }[];
    const names = cols.map((c) => c.name);
    expect(names).toContain('close_reason');
    db.close();
  });

  it('migration is idempotent', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    runMigrations(db); // must not throw
    const cols = db.prepare("PRAGMA table_info(trades)").all() as { name: string }[];
    expect(cols.filter((c) => c.name === 'close_reason')).toHaveLength(1);
    db.close();
  });

  it('adds close_reason index on trades', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const indexes = db.prepare("PRAGMA index_list(trades)").all() as { name: string }[];
    expect(indexes.some((i) => i.name === 'idx_trades_close_reason')).toBe(true);
    db.close();
  });
});
