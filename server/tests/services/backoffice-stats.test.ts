import { describe, it, expect, afterEach } from 'vitest';
import { createDb, type Db } from '../../src/db/index.js';
import { createBackofficeService } from '../../src/services/backoffice.js';

let db: Db | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

const botManager = {} as any;

function insertTrades(target: Db, count: number, pnlFor: (i: number) => number | null): void {
  const insertAll = target.db.transaction(() => {
    for (let i = 0; i < count; i++) {
      target.insertTrade({
        id: `t${i}`, symbol: 'BTC/USDT', side: 'sell', price: 100, quantity: 1, amount: 100,
        strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: `o${i}`,
        pnl: pnlFor(i) as number, timestamp: 1_700_000_000_000 + i, userId: 1,
        testnet: false, exchange: '', closeReason: null,
      });
    }
  });
  insertAll();
}

describe('BackofficeService.getStats', () => {
  it('counts every trade and sums every pnl, also above 10,000 trades', async () => {
    db = createDb(':memory:');
    insertTrades(db, 12_345, (i) => (i % 2 === 0 ? 1 : 0.5));
    const stats = await createBackofficeService(db, botManager).getStats();
    expect(stats.totalTrades).toBe(12_345);
    // 6173 even indexes x 1 + 6172 odd indexes x 0.5
    expect(stats.totalPnl).toBeCloseTo(6173 + 3086, 6);
  });

  it('treats a null pnl as zero and returns zeros for an empty table', async () => {
    db = createDb(':memory:');
    const empty = await createBackofficeService(db, botManager).getStats();
    expect(empty).toEqual({ totalTrades: 0, openPositions: 0, totalPnl: 0 });

    insertTrades(db, 3, (i) => (i === 1 ? null : 2));
    const stats = await createBackofficeService(db, botManager).getStats();
    expect(stats.totalTrades).toBe(3);
    expect(stats.totalPnl).toBe(4);
  });
});
