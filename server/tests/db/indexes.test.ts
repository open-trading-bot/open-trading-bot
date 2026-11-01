import { describe, it, expect } from 'vitest';
import { createDb } from '../../src/db/index.js';

function plan(db: ReturnType<typeof createDb>, sql: string): string {
  return (db.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(1) as { detail: string }[]).map((r) => r.detail).join(' | ');
}

describe('DB indexes (P4)', () => {
  it('uses a (user_id, timestamp) index for per-user trade pages', () => {
    const db = createDb(':memory:');
    const p = plan(db, 'SELECT * FROM trades WHERE user_id = ? ORDER BY timestamp DESC LIMIT 50');
    expect(p).toContain('idx_trades_user_ts');
    expect(p).not.toContain('USE TEMP B-TREE');
    db.close();
  });

  it('uses an index for open positions of a user', () => {
    const db = createDb(':memory:');
    expect(plan(db, 'SELECT * FROM positions WHERE user_id = ?')).toContain('idx_positions_user');
    db.close();
  });

  it('has no candles index that duplicates the primary key', () => {
    const db = createDb(':memory:');
    const names = (db.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'candles'").all() as { name: string }[]).map((r) => r.name);
    expect(names).not.toContain('idx_candles_lookup');
    db.close();
  });
});
