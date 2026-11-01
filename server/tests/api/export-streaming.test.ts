import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import express from 'express';
import http from 'http';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { createDb, type Db } from '../../src/db/index.js';
import { createDataService } from '../../src/services/data.js';
import { createDataController } from '../../src/controllers/data.js';
import { createDataRouter } from '../../src/routes/data.js';
import type { BotService } from '../../src/services/bot.js';
import type { Trade } from '../../src/types/index.js';
import { TEST_CIPHER } from '../utils/crypto-fixtures.js';

// Golden output captured from the export code before the streaming change
// (whole result in memory, res.json / res.send). The streamed export must
// produce the same bytes for the same data.
const GOLDEN_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'export-golden.json');

const STRATEGIES = ['rsi', 'ma, with comma', 'say "hi"', 'multi\nline', 'ünïcødé ✓'];

function seed(db: Db, tradeCount: number): void {
  const insert = db.db.transaction(() => {
    for (let i = 0; i < tradeCount; i++) {
      const t: Trade = {
        id: `t${String(i).padStart(5, '0')}`,
        symbol: i % 3 === 0 ? 'ETH/USDT' : 'BTC/USDT',
        side: i % 2 === 0 ? 'buy' : 'sell',
        price: 100 + i / 7,
        quantity: 0.001 * (i + 1),
        amount: 10 + i,
        strategy: STRATEGIES[i % STRATEGIES.length],
        mode: i % 4 === 0 ? 'live' : 'paper',
        marketType: 'spot',
        orderId: `o${i}`,
        pnl: (i % 5 === 0 ? null : (i % 2 === 0 ? 1.25 : -0.5) * i) as number,
        // Three trades share each timestamp, to pin the order of ties.
        timestamp: 1_700_000_000_000 + Math.floor(i / 3) * 1000,
        userId: 1,
        testnet: i % 6 === 0,
        exchange: i % 4 === 0 ? 'bybit' : '',
        closeReason: i % 7 === 0 ? 'stop_loss' : null,
      };
      db.insertTrade(t);
      // Another user's trades must never appear.
      db.insertTrade({ ...t, id: `x${i}`, userId: 2 });
    }
    for (let i = 0; i < 4; i++) {
      db.upsertPosition({
        id: `p${i}`, symbol: i % 2 ? 'BTC/USDT' : 'ETH/USDT', side: 'buy', entryPrice: 100 + i,
        quantity: 0.5 + i, amount: 50 + i, currentPrice: 101 + i, pnl: i - 1.5, pnlPct: (i - 1.5) / 10,
        strategy: STRATEGIES[i], mode: 'paper', marketType: 'spot', stopLoss: i === 2 ? null : 95 + i,
        openedAt: 1_700_000_000_000 + i, userId: 1, testnet: i === 1, exchange: '',
      });
    }
  });
  insert();
}

function controllerFor(db: Db) {
  const service = createDataService(db, {} as any);
  return createDataController(service, db, TEST_CIPHER, {} as BotService);
}

async function serve(db: Db): Promise<{ srv: http.Server; base: string }> {
  const app = express();
  app.use((req, _res, next) => { (req as any).user = { id: 1, username: 'u', role: 'admin' }; next(); });
  const flags = { getResolvedFlags: vi.fn().mockReturnValue({}) } as any;
  app.use('/api', createDataRouter(controllerFor(db), flags));
  const srv = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  return { srv, base: `http://localhost:${(srv.address() as { port: number }).port}/api` };
}

const ENDPOINTS = [
  '/trades/export',
  '/trades/export?symbol=ETH%2FUSDT&pnl=profit',
  '/trades/export.csv',
  '/trades/export.csv?side=sell&excludeZeroPnl=true',
  '/trades/export.txt',
  '/trades/export.txt?mode=live',
  '/positions/export',
  '/positions/export.csv',
  '/positions/export.txt',
];

let db: Db | undefined;
let srv: http.Server | undefined;

afterEach(async () => {
  if (srv) await new Promise<void>((r) => srv!.close(() => r()));
  srv = undefined;
  db?.close();
  db = undefined;
});

describe('export output is unchanged', () => {
  it('matches the golden bytes and content types for every export endpoint', async () => {
    db = createDb(':memory:');
    seed(db, 1300);
    const s = await serve(db);
    srv = s.srv;
    const actual: Record<string, { contentType: string | null; bytes: number; sha256: string }> = {};
    for (const ep of ENDPOINTS) {
      const res = await fetch(s.base + ep);
      expect(res.status).toBe(200);
      const body = Buffer.from(await res.arrayBuffer());
      actual[ep] = {
        contentType: res.headers.get('content-type'),
        bytes: body.length,
        sha256: crypto.createHash('sha256').update(body).digest('hex'),
      };
    }
    if (process.env.WRITE_EXPORT_GOLDEN === '1') {
      fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
      fs.writeFileSync(GOLDEN_PATH, JSON.stringify(actual, null, 1));
    }
    const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));
    expect(actual).toEqual(golden);
  });
});

// A fake response that reports a full buffer on every write, so the export
// must wait for 'drain' after each chunk.
class SlowResponse extends EventEmitter {
  chunks: string[] = [];
  ended = false;
  headersSent = false;
  destroyed = false;
  writableEnded = false;
  setHeader() { /* ignore */ }
  status() { return this; }
  write(chunk: string) { this.headersSent = true; this.chunks.push(chunk); return false; }
  end(chunk?: string) { if (chunk) this.chunks.push(chunk); this.ended = true; this.writableEnded = true; this.emit('finish'); }
  destroy() { this.destroyed = true; this.emit('close'); }
}

const tick = () => new Promise((r) => setImmediate(r));

describe.each([
  ['exportTrades', 'json'],
  ['exportTradesCsv', 'csv'],
  ['exportTradesTxt', 'txt'],
] as const)('%s streams with backpressure', (method) => {
  it('waits for drain between chunks and keeps the database usable while it waits', async () => {
    db = createDb(':memory:');
    seed(db, 3000);
    const res = new SlowResponse();
    const done = (controllerFor(db) as any)[method]({ user: { id: 1 }, query: {} }, res);

    await tick(); await tick();
    expect(res.ended).toBe(false);
    const before = res.chunks.length;
    expect(before).toBeGreaterThan(0);
    // No more writes until the client drains.
    await tick(); await tick();
    expect(res.chunks.length).toBe(before);
    // The export holds no open cursor while it waits, so a write works.
    expect(() => db!.updateTradePnl('t00001', 42)).not.toThrow();

    for (let i = 0; i < 10_000 && !res.ended; i++) { res.emit('drain'); await tick(); }
    await done;
    expect(res.ended).toBe(true);
    expect(res.chunks.length).toBeGreaterThan(before);
  });

  it('stops reading when the client disconnects', async () => {
    db = createDb(':memory:');
    seed(db, 3000);
    const res = new SlowResponse();
    const done = (controllerFor(db) as any)[method]({ user: { id: 1 }, query: {} }, res);
    await tick(); await tick();
    const before = res.chunks.length;
    res.destroy();
    await done;
    expect(res.chunks.length).toBe(before);
    expect(res.ended).toBe(false);
  });
});
