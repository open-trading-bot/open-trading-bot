import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Count the real (ccxt) adapters the bot manager creates. Market calls never
// resolve unless a test says so, so no tick reaches the network.
const created: { name: string }[] = [];
vi.mock('../../src/exchange/bybit.js', () => ({
  createBybitAdapter: () => {
    const adapter = {
      name: 'bybit', fetchSymbols: vi.fn().mockResolvedValue(['BTC/USDT']),
      fetchTicker: vi.fn().mockResolvedValue({ symbol: 'BTC/USDT', last: 100, bid: 100, ask: 100, volume24h: 0, timestamp: 0 }),
      fetchCandles: vi.fn(() => new Promise(() => {})),
      placeOrder: vi.fn(), cancelOrder: vi.fn(),
      fetchBalance: vi.fn().mockResolvedValue({ total: 5, free: 5, totalEquity: 5 }),
      closePosition: vi.fn(),
    };
    created.push(adapter);
    return adapter;
  },
}));

import { createDb, type Db } from '../../src/db/index.js';
import { createBotManager, type BotManager } from '../../src/engine/bot-manager.js';
import { clearMarketDataCache } from '../../src/exchange/market-data-cache.js';
import { TEST_CIPHER } from '../utils/crypto-fixtures.js';

const ws = () => ({ broadcast: vi.fn(), broadcastToUser: vi.fn(), clientCount: vi.fn(), close: vi.fn() });

const IDLE_MS = 10 * 60_000;
let db: Db;
let manager: BotManager;
let clock: number;
let userId: number;

beforeEach(() => {
  clearMarketDataCache();
  created.length = 0;
  db = createDb(':memory:');
  userId = db.createUser('reader', null, 'h', 'regular').id;
  db.updateUser(userId, { paperBalance: 1234 });
  clock = 1_000_000;
  manager = createBotManager(db, ws() as any, TEST_CIPHER, { idleTtlMs: IDLE_MS, now: () => clock });
});

afterEach(() => {
  manager.stopAll();
  db.close();
});

describe('BotManager read-only exchange access', () => {
  it('reads the balance and symbols without creating a bot', async () => {
    const exchange = manager.getReadExchange(userId);
    expect((await exchange.fetchBalance()).total).toBe(1234);
    expect(await manager.getReadExchange(userId).fetchSymbols()).toEqual(['BTC/USDT']);
    expect(manager.botCount()).toBe(0);
  });

  it('reuses one real adapter for repeated reads', () => {
    manager.getReadExchange(userId);
    manager.getReadExchange(userId);
    manager.getReadExchange(userId);
    expect(created).toHaveLength(1);
  });

  it('shows the current paper balance after it changes in the database', async () => {
    expect((await manager.getReadExchange(userId).fetchBalance()).total).toBe(1234);
    db.updateUser(userId, { paperBalance: 777 });
    expect((await manager.getReadExchange(userId).fetchBalance()).total).toBe(777);
  });

  it('returns the bot exchange when a bot exists, so reads see its live state', () => {
    manager.ensureBot(userId);
    expect(manager.getReadExchange(userId)).toBe(manager.getExchange(userId));
  });
});

describe('BotManager idle eviction', () => {
  it('evicts a stopped bot that is idle for longer than the TTL', () => {
    manager.ensureBot(userId);
    expect(manager.botCount()).toBe(1);
    clock += IDLE_MS - 1;
    expect(manager.evictIdle()).toBe(0);
    clock += 2;
    expect(manager.evictIdle()).toBe(1);
    expect(manager.botCount()).toBe(0);
  });

  it('keeps a recently used bot', () => {
    manager.ensureBot(userId);
    clock += IDLE_MS - 1;
    manager.getExchange(userId);
    clock += IDLE_MS - 1;
    manager.evictIdle();
    expect(manager.botCount()).toBe(1);
  });

  it('never evicts a running bot, or a stopped bot whose tick is still in flight', async () => {
    manager.startBot(userId); // the first tick waits forever on fetchCandles
    await new Promise((r) => setImmediate(r));
    clock += IDLE_MS * 10;
    manager.evictIdle();
    expect(manager.botCount()).toBe(1);

    manager.stopBot(userId);
    manager.evictIdle();
    expect(manager.botCount()).toBe(1);
  });

  it('never evicts a bot while a manual close is in progress', async () => {
    db.upsertPosition({
      id: 'pos-1', symbol: 'BTC/USDT', side: 'buy', entryPrice: 100, quantity: 1, amount: 100,
      currentPrice: 100, pnl: 0, pnlPct: 0, strategy: 'rsi', mode: 'paper', marketType: 'spot',
      stopLoss: null, openedAt: 0, userId, testnet: false, exchange: '',
    });
    const exchange = manager.getExchange(userId);
    let release!: (v: unknown) => void;
    vi.spyOn(exchange, 'closePosition').mockReturnValue(new Promise((r) => { release = r; }) as any);

    const closing = manager.closePosition(userId, 'pos-1');
    await new Promise((r) => setImmediate(r));
    clock += IDLE_MS * 10;
    expect(manager.evictIdle()).toBe(0);

    release({ orderId: 'o', symbol: 'BTC/USDT', side: 'sell', price: 100, quantity: 1, status: 'filled' });
    await closing;
    clock += IDLE_MS + 1;
    expect(manager.evictIdle()).toBe(1);
  });

  it('keeps the paper balance after eviction', async () => {
    const exchange = manager.getExchange(userId);
    await exchange.placeOrder({ symbol: 'BTC/USDT', side: 'buy', amount: 200, price: 100, type: 'market', marketType: 'spot' });
    clock += IDLE_MS + 1;
    expect(manager.evictIdle()).toBe(1);
    expect((await manager.getReadExchange(userId).fetchBalance()).total).toBe(1034);
  });

  it('evicts idle read adapters', () => {
    manager.getReadExchange(userId);
    clock += IDLE_MS + 1;
    manager.evictIdle();
    manager.getReadExchange(userId);
    expect(created).toHaveLength(2);
  });

  it('resumeAll still restores enabled bots', () => {
    db.setBotEnabled(userId, true);
    const fresh = createBotManager(db, ws() as any, TEST_CIPHER, { idleTtlMs: IDLE_MS, now: () => clock });
    fresh.resumeAll();
    expect(fresh.isRunning(userId)).toBe(true);
    fresh.stopAll();
  });
});
