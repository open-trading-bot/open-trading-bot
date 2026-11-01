import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBotManager } from '../../src/engine/bot-manager.js';
import { createBotConfig } from '../../src/config/index.js';
import { createDb, type Db } from '../../src/db/index.js';
import type { WsBroadcaster } from '../../src/websocket/index.js';
import fs from 'fs';
import path from 'path';

function mockBroadcaster(): WsBroadcaster {
  return {
    broadcast: vi.fn(),
    broadcastToUser: vi.fn(),
    clientCount: vi.fn().mockReturnValue(0),
    close: vi.fn(),
  };
}

function mockDbForBotManager(overrides: Partial<{
  user: any;
  config: any;
  enabledUserIds: number[];
}> = {}): Db {
  const defaultUser = {
    id: 1,
    username: 'user',
    exchangeKey: null,
    exchangeSecret: null,
    exchangeTestnet: true,
    exchangeName: 'bybit',
    paperBalance: 10000,
  };
  const user = { ...defaultUser, ...(overrides.user ?? {}) };
  // In-memory simulation of the persisted bot_enabled flag so tests can
  // assert calls AND observe the round-trip (set → get → resume).
  const botEnabled = new Map<number, boolean>(
    (overrides.enabledUserIds ?? []).map((id) => [id, true]),
  );
  return {
    db: {} as any,
    close: vi.fn(),
    getUserById: vi.fn().mockReturnValue(user),
    getUserConfig: vi.fn().mockReturnValue(overrides.config ?? null),
    setUserConfig: vi.fn(),
    setBotEnabled: vi.fn((userId: number, enabled: boolean) => {
      if (enabled) botEnabled.set(userId, true); else botEnabled.delete(userId);
    }),
    getBotEnabled: vi.fn((userId: number) => botEnabled.get(userId) === true),
    getEnabledBotUserIds: vi.fn(() => Array.from(botEnabled.keys())),
    getOpenPositions: vi.fn().mockReturnValue([]),
    getOpenPositionsPaginated: vi.fn().mockReturnValue({ data: [], total: 0 }),
    insertTrade: vi.fn(),
    updateTradePnl: vi.fn(),
    getTrades: vi.fn().mockReturnValue([]),
    getTradesBySymbol: vi.fn().mockReturnValue([]),
    getTradesPaginated: vi.fn().mockReturnValue({ data: [], total: 0 }),
    upsertPosition: vi.fn(),
    removePosition: vi.fn(),
    setConfig: vi.fn(),
    getConfig: vi.fn(),
    insertCandles: vi.fn(),
    getCandles: vi.fn().mockReturnValue([]),
    getDailyTrades: vi.fn().mockReturnValue([]),
    insertLead: vi.fn(),
    getLeads: vi.fn().mockReturnValue([]),
    updateUserExchangeKeys: vi.fn(),
    updateExchangeTestnet: vi.fn(),
    getAllTrades: vi.fn().mockReturnValue([]),
    getAllOpenPositions: vi.fn().mockReturnValue([]),
    getUsers: vi.fn().mockReturnValue([user]),
  } as unknown as Db;
}

describe('BotManager — cold-start closePosition', () => {
  it('closePosition lazily creates a bot (does not throw "Bot not initialized")', async () => {
    // Simulate a cold server: BotManager has no bots pre-populated.
    // Previously closePosition used bots.get(userId) which returned undefined
    // after a restart. The fix (commit 0b14e8d) uses getOrCreateBot(userId).
    const broadcaster = mockBroadcaster();
    const savedConfig = createBotConfig('paper');
    const db = mockDbForBotManager({ config: savedConfig });
    const manager = createBotManager(db, broadcaster, 'test-secret');

    // closePosition calls getOrCreateBot → createOrchestrator → createTickLoop.
    // The orchestrator's closePositionManually looks up the position from
    // db.getOpenPositions (returns [] in this mock) and throws "not found".
    //
    // The critical property being tested: the error must be the domain-level
    // "not found" error from the orchestrator, NOT a "Bot not initialized" or
    // TypeError caused by closePosition calling bots.get() on an empty map
    // (the cold-start regression fixed in commit 0b14e8d).
    await expect(manager.closePosition(1, 'some-position-id')).rejects.toThrow(/not found/i);
    await expect(manager.closePosition(1, 'some-position-id')).rejects.not.toThrow(/not initialized/i);

    // Verify the bot was lazily created and is now cached: getUserConfig should
    // NOT be called again on the second closePosition call — the bot is already
    // in the internal map so getOrCreateBot returns it without hitting the DB.
    const callsAfterFirst = (db.getUserConfig as any).mock.calls.length;
    await manager.closePosition(1, 'some-position-id').catch(() => { /* expected */ });
    const callsAfterSecond = (db.getUserConfig as any).mock.calls.length;
    expect(callsAfterSecond).toBe(callsAfterFirst); // no extra lookup — bot was cached
  });
});

describe('BotManager — mode=live + missing keys self-heal invariant', () => {
  let broadcaster: WsBroadcaster;

  beforeEach(() => {
    broadcaster = mockBroadcaster();
  });

  it('forces paper mode when user has mode=live but no exchange keys', () => {
    const savedLiveConfig = { ...createBotConfig('paper'), mode: 'live' as const };
    const db = mockDbForBotManager({
      user: { exchangeKey: null, exchangeSecret: null },
      config: savedLiveConfig,
    });
    const manager = createBotManager(db, broadcaster, 'test-secret');

    manager.ensureBot(1);

    // setUserConfig must have been called with mode=paper (self-heal persisted)
    expect(db.setUserConfig).toHaveBeenCalledTimes(1);
    const rewrittenConfig = (db.setUserConfig as any).mock.calls[0][1];
    expect(rewrittenConfig.mode).toBe('paper');
  });

  it('forces paper mode when exchange key is an empty string (post-clear state)', () => {
    const savedLiveConfig = { ...createBotConfig('paper'), mode: 'live' as const };
    const db = mockDbForBotManager({
      user: { exchangeKey: '', exchangeSecret: '' },
      config: savedLiveConfig,
    });
    const manager = createBotManager(db, broadcaster, 'test-secret');

    manager.ensureBot(1);

    expect(db.setUserConfig).toHaveBeenCalledTimes(1);
    const rewrittenConfig = (db.setUserConfig as any).mock.calls[0][1];
    expect(rewrittenConfig.mode).toBe('paper');
  });

  it('does NOT rewrite config when user has mode=live AND valid exchange keys', () => {
    // We cannot use real encrypted keys here because the adapter decrypts them;
    // but the self-heal check runs before decryption, so we can use any truthy
    // strings. The adapter creation path may error on decrypt, but that's
    // handled inside createExchangeForUser and does not affect the invariant.
    const savedLiveConfig = { ...createBotConfig('paper'), mode: 'live' as const };
    const db = mockDbForBotManager({
      user: { exchangeKey: 'some-encrypted-key', exchangeSecret: 'some-encrypted-secret' },
      config: savedLiveConfig,
    });
    const manager = createBotManager(db, broadcaster, 'test-secret');

    manager.ensureBot(1);

    // setUserConfig must NOT have been called — config was not rewritten
    expect(db.setUserConfig).not.toHaveBeenCalled();
  });

  it('does NOT rewrite config when user has mode=paper (even without keys)', () => {
    const savedPaperConfig = createBotConfig('paper');
    const db = mockDbForBotManager({
      user: { exchangeKey: null, exchangeSecret: null },
      config: savedPaperConfig,
    });
    const manager = createBotManager(db, broadcaster, 'test-secret');

    manager.ensureBot(1);

    expect(db.setUserConfig).not.toHaveBeenCalled();
  });

  it('uses the paper adapter in paper mode even when user has live keys stored', async () => {
    // Regression: previously createExchangeForUser ignored mode and returned
    // the raw Bybit adapter whenever keys existed, causing the dashboard to
    // show live USDT / total equity while the user was in paper mode.
    const savedPaperConfig = createBotConfig('paper');
    const db = mockDbForBotManager({
      user: {
        // Real-looking encrypted blobs — decrypt will fail harmlessly and the
        // createExchangeForUser catch branch still proceeds to wrap with paper.
        exchangeKey: 'encrypted-key-bytes',
        exchangeSecret: 'encrypted-secret-bytes',
        paperBalance: 7777,
      },
      config: savedPaperConfig,
    });
    const manager = createBotManager(db, broadcaster, 'test-secret');

    const exchange = manager.getExchange(1);
    // Paper adapter's name is `paper(<wrapped>)`.
    expect(exchange.name).toMatch(/^paper\(/);

    const balance = await exchange.fetchBalance();
    expect(balance.total).toBe(7777);
    expect(balance.totalEquity).toBe(7777);
  });

  it('is idempotent on repeated ensureBot calls (bot is cached)', () => {
    const savedLiveConfig = { ...createBotConfig('paper'), mode: 'live' as const };
    const db = mockDbForBotManager({
      user: { exchangeKey: null, exchangeSecret: null },
      config: savedLiveConfig,
    });
    const manager = createBotManager(db, broadcaster, 'test-secret');

    manager.ensureBot(1);
    manager.ensureBot(1);
    manager.ensureBot(1);

    // Self-heal should only persist once — the second and third calls hit the
    // cached bot and skip getOrCreateBot's creation path entirely.
    expect(db.setUserConfig).toHaveBeenCalledTimes(1);
  });
});

describe('BotManager — persistent running-state', () => {
  it('startBot persists bot_enabled=true', () => {
    const db = mockDbForBotManager();
    const manager = createBotManager(db, mockBroadcaster(), 'test-secret');

    manager.startBot(1);

    expect(db.setBotEnabled).toHaveBeenCalledWith(1, true);
    expect(db.getBotEnabled(1)).toBe(true);
  });

  it('stopBot clears bot_enabled (user-initiated stop)', () => {
    const db = mockDbForBotManager({ enabledUserIds: [1] });
    const manager = createBotManager(db, mockBroadcaster(), 'test-secret');

    manager.startBot(1);
    manager.stopBot(1);

    expect(db.setBotEnabled).toHaveBeenLastCalledWith(1, false);
    expect(db.getBotEnabled(1)).toBe(false);
  });

  it('killBot clears bot_enabled (user-initiated kill switch)', async () => {
    const db = mockDbForBotManager();
    const manager = createBotManager(db, mockBroadcaster(), 'test-secret');

    manager.startBot(1);
    await manager.killBot(1, 'user');

    expect(db.getBotEnabled(1)).toBe(false);
  });

  it('stopAll does NOT clear bot_enabled (pod shutdown preserves intent)', () => {
    const db = mockDbForBotManager();
    const manager = createBotManager(db, mockBroadcaster(), 'test-secret');

    manager.startBot(1);
    expect(db.getBotEnabled(1)).toBe(true);

    manager.stopAll();

    // Shutdown must not touch the persisted flag — the next pod will
    // read it in resumeAll() and restart the bot automatically.
    expect(db.getBotEnabled(1)).toBe(true);
  });

  it('resumeAll starts every user with bot_enabled=1 at boot', () => {
    const db = mockDbForBotManager({ enabledUserIds: [1, 2, 3] });
    const manager = createBotManager(db, mockBroadcaster(), 'test-secret');

    manager.resumeAll();

    expect(manager.isRunning(1)).toBe(true);
    expect(manager.isRunning(2)).toBe(true);
    expect(manager.isRunning(3)).toBe(true);
  });

  it('runningCount returns the number of bots whose orchestrator status is running', () => {
    const db = mockDbForBotManager({ enabledUserIds: [1, 2, 3] });
    const manager = createBotManager(db, mockBroadcaster(), 'test-secret');

    expect(manager.runningCount()).toBe(0);

    manager.resumeAll();
    expect(manager.runningCount()).toBe(3);

    manager.stopBot(2);
    expect(manager.runningCount()).toBe(2);

    manager.stopBot(1);
    manager.stopBot(3);
    expect(manager.runningCount()).toBe(0);
  });

  it('startBot does NOT persist bot_enabled when creation fails', () => {
    const db = mockDbForBotManager();
    // Simulate a transient failure in the bot-creation path. getUserById
    // throwing bubbles up through createExchangeForUser, so getOrCreateBot
    // itself throws. The flag must stay false — otherwise resumeAll would
    // retry the failing creation on every pod restart forever.
    (db.getUserById as any) = vi.fn(() => { throw new Error('simulated creation failure'); });
    const manager = createBotManager(db, mockBroadcaster(), 'test-secret');

    expect(() => manager.startBot(1)).toThrow();
    expect(db.getBotEnabled(1)).toBe(false);
  });

  it('resumeAll is idempotent across multiple calls', () => {
    const db = mockDbForBotManager({ enabledUserIds: [1] });
    const manager = createBotManager(db, mockBroadcaster(), 'test-secret');

    manager.resumeAll();
    expect(manager.isRunning(1)).toBe(true);

    // A second call must be safe — orchestrator.start() is idempotent
    // (guards against double-start), but the resumeAll interface is
    // public and could be invoked twice during a race (e.g. two health
    // checks triggering a warm-up path).
    expect(() => manager.resumeAll()).not.toThrow();
    expect(manager.isRunning(1)).toBe(true);
  });

  it('resumeAll is a no-op when no users are enabled', () => {
    const db = mockDbForBotManager({ enabledUserIds: [] });
    const manager = createBotManager(db, mockBroadcaster(), 'test-secret');

    expect(() => manager.resumeAll()).not.toThrow();
    expect(manager.isRunning(1)).toBe(false);
  });

  it('killBot with reason=admin also clears bot_enabled (admin actions require user reconfirm to resume)', async () => {
    const db = mockDbForBotManager();
    const manager = createBotManager(db, mockBroadcaster(), 'test-secret');

    manager.startBot(1);
    expect(db.getBotEnabled(1)).toBe(true);

    await manager.killBot(1, 'admin');

    // Admin-initiated kill must also clear the persisted flag so the
    // next pod restart does not silently resume a bot an admin just
    // stopped (e.g. after a paper balance change invalidated config).
    expect(db.getBotEnabled(1)).toBe(false);
  });

  it('resetBot clears bot_enabled defensively', () => {
    const db = mockDbForBotManager();
    const manager = createBotManager(db, mockBroadcaster(), 'test-secret');

    manager.startBot(1);
    expect(db.getBotEnabled(1)).toBe(true);

    manager.resetBot(1);

    // resetBot is today only reached via killBot in the backoffice
    // admin flow, but it's a public interface method — calling it in
    // isolation must not leave a stale bot_enabled=1 that resumeAll
    // would then restart on the next boot.
    expect(db.getBotEnabled(1)).toBe(false);
  });

  it('resumeAll survives an individual user failure and still starts the rest', () => {
    // If one user's bot creation throws (e.g. corrupt decrypt key), the
    // resume loop must log and continue rather than aborting the whole
    // pod boot. We simulate this by making getUserById throw for one id.
    const db = mockDbForBotManager({ enabledUserIds: [1, 2] });
    let callCount = 0;
    (db.getUserById as any) = vi.fn((id: number) => {
      callCount++;
      if (id === 1) throw new Error('simulated decrypt failure');
      return { id, username: 'u2', exchangeKey: null, exchangeSecret: null, exchangeTestnet: true, exchangeName: 'bybit', paperBalance: 10000 };
    });
    const manager = createBotManager(db, mockBroadcaster(), 'test-secret');

    expect(() => manager.resumeAll()).not.toThrow();
    expect(callCount).toBeGreaterThanOrEqual(2);
    // User 2 must still be running despite user 1's failure.
    expect(manager.isRunning(2)).toBe(true);
  });
});

describe('BotManager — paper cash persistence across adapter recreation', () => {
  const TEST_DB = path.join(import.meta.dirname, 'test-paper-persist.db');
  let db: Db;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    db = createDb(TEST_DB);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it('pod restart scenario: paper cash survives a full bot-manager teardown and rebuild', async () => {
    const user = db.createUser('trader', null, 'hash', 'demo');
    db.updateUser(user.id, { paperBalance: 1000 });

    // Pod A — create manager, grab paper adapter, run a buy.
    const managerA = createBotManager(db, mockBroadcaster(), 'test-secret');
    const exchangeA = managerA.getExchange(user.id);
    expect(exchangeA.name).toMatch(/^paper\(/);

    (exchangeA as any).fetchTicker = vi.fn().mockResolvedValue({
      symbol: 'BTC/USDT', last: 50000, bid: 50000, ask: 50000, volume24h: 0, timestamp: Date.now(),
    });
    await exchangeA.placeOrder({ symbol: 'BTC/USDT', side: 'buy', amount: 200, price: 50000, type: 'market', marketType: 'spot' });

    const balA = await exchangeA.fetchBalance();
    expect(balA.total).toBe(800);

    const userAfterBuy = db.getUserById(user.id);
    expect(userAfterBuy?.paperBalance).toBe(800);

    // Pod B — destroy the first manager, build a new one against the same DB.
    managerA.stopAll();
    const managerB = createBotManager(db, mockBroadcaster(), 'test-secret');
    const exchangeB = managerB.getExchange(user.id);
    const balB = await exchangeB.fetchBalance();

    expect(balB.total).toBe(800);
  });

  it('totalEquity on paper includes the mark-to-market value of open positions', async () => {
    const user = db.createUser('trader2', null, 'hash', 'demo');
    db.updateUser(user.id, { paperBalance: 800 });
    db.upsertPosition({
      id: 'pos-mtm', symbol: 'BTC/USDT', side: 'buy', entryPrice: 50000,
      quantity: 0.004, amount: 200, currentPrice: 52000,
      pnl: 8, pnlPct: 4, strategy: 'test', mode: 'paper',
      marketType: 'spot', stopLoss: null, openedAt: Date.now(),
      userId: user.id, testnet: false, exchange: '',
    });

    const manager = createBotManager(db, mockBroadcaster(), 'test-secret');
    const exchange = manager.getExchange(user.id);
    const bal = await exchange.fetchBalance();

    expect(bal.total).toBe(800);
    expect(bal.free).toBe(800);
    // 0.004 * 52000 = 208 → total equity = 800 + 208 = 1008
    expect(bal.totalEquity).toBe(1008);
  });
});
