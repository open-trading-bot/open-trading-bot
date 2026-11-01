import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb, type Db } from '../../src/db/index.js';
import fs from 'fs';
import path from 'path';

const TEST_DB = path.join(import.meta.dirname, 'test.db');

describe('Database', () => {
  let db: Db;

  beforeEach(() => {
    db = createDb(TEST_DB);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it('creates all tables on init', () => {
    const tables = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('trades');
    expect(names).toContain('candles');
    expect(names).toContain('positions');
    expect(names).toContain('config');
  });

  it('inserts and retrieves a trade', () => {
    db.insertTrade({
      id: 'test-1',
      symbol: 'BTC/USDT',
      side: 'buy',
      price: 50000,
      quantity: 0.002,
      amount: 100,
      strategy: 'ma_cross',
      mode: 'paper',
      marketType: 'spot',
      orderId: 'ord-1',
      pnl: null,
      timestamp: Date.now(),
      userId: 1, testnet: false, exchange: 'bybit',
    });
    const trades = db.getTrades(1);
    expect(trades).toHaveLength(1);
    expect(trades[0].symbol).toBe('BTC/USDT');
  });

  it('inserts and retrieves positions', () => {
    db.upsertPosition({
      id: 'pos-1',
      symbol: 'ETH/USDT',
      side: 'buy',
      entryPrice: 3000,
      quantity: 0.033,
      amount: 100,
      currentPrice: 3100,
      pnl: 3.33,
      pnlPct: 3.33,
      strategy: 'rsi',
      mode: 'paper',
      marketType: 'spot',
      stopLoss: 2940,
      openedAt: Date.now(),
      userId: 1, testnet: false, exchange: 'bybit',
    });
    const positions = db.getOpenPositions(1);
    expect(positions).toHaveLength(1);
    expect(positions[0].symbol).toBe('ETH/USDT');
    expect(positions[0].mode).toBe('paper');
  });

  it('stores position mode as live', () => {
    db.upsertPosition({
      id: 'pos-live', symbol: 'BTC/USDT', side: 'buy', entryPrice: 50000,
      quantity: 0.001, amount: 50, currentPrice: 51000, pnl: 1, pnlPct: 2,
      strategy: 'ma_crossover', mode: 'live', marketType: 'spot',
      stopLoss: 49000, openedAt: Date.now(), userId: 1, testnet: false, exchange: 'bybit',
    });
    const positions = db.getOpenPositions(1);
    const live = positions.find((p) => p.id === 'pos-live');
    expect(live).toBeDefined();
    expect(live!.mode).toBe('live');
  });

  it('filters trades by exchange', () => {
    db.insertTrade({ id: 't-by', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'live', marketType: 'spot', orderId: 'o1', pnl: 1, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-bi', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'live', marketType: 'spot', orderId: 'o2', pnl: 1, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'binance' });
    db.insertTrade({ id: 't-paper', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o3', pnl: 1, timestamp: Date.now(), userId: 1, testnet: false, exchange: '' });
    const bybit = db.getTradesPaginated(1, 0, 10, { exchange: 'bybit' });
    expect(bybit.total).toBe(1);
    expect(bybit.data[0].id).toBe('t-by');
    const binance = db.getTradesPaginated(1, 0, 10, { exchange: 'binance' });
    expect(binance.total).toBe(1);
    expect(binance.data[0].id).toBe('t-bi');
  });

  it('filters trades by testnet and exchange combined', () => {
    db.insertTrade({ id: 't-by-test', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'live', marketType: 'spot', orderId: 'o1', pnl: 1, timestamp: Date.now(), userId: 1, testnet: true, exchange: 'bybit' });
    db.insertTrade({ id: 't-by-main', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'live', marketType: 'spot', orderId: 'o2', pnl: 1, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-bi-test', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'live', marketType: 'spot', orderId: 'o3', pnl: 1, timestamp: Date.now(), userId: 1, testnet: true, exchange: 'binance' });
    const res = db.getTradesPaginated(1, 0, 10, { exchange: 'bybit', testnet: 'true' });
    expect(res.total).toBe(1);
    expect(res.data[0].id).toBe('t-by-test');
  });

  it('persists and returns exchange and testnet on trades', () => {
    db.insertTrade({
      id: 'tr-bybit-mainnet',
      symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50,
      strategy: 'rsi', mode: 'live', marketType: 'spot', orderId: 'o1',
      pnl: 1, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit',
    });
    db.insertTrade({
      id: 'tr-binance-testnet',
      symbol: 'ETH/USDT', side: 'sell', price: 3000, quantity: 0.01, amount: 30,
      strategy: 'ma_crossover', mode: 'live', marketType: 'futures', orderId: 'o2',
      pnl: -2, timestamp: Date.now(), userId: 1, testnet: true, exchange: 'binance',
    });
    const trades = db.getTrades(1);
    const byId = Object.fromEntries(trades.map((t) => [t.id, t]));
    expect(byId['tr-bybit-mainnet'].exchange).toBe('bybit');
    expect(byId['tr-bybit-mainnet'].testnet).toBe(false);
    expect(byId['tr-binance-testnet'].exchange).toBe('binance');
    expect(byId['tr-binance-testnet'].testnet).toBe(true);
  });

  it('persists and returns exchange and testnet on positions', () => {
    db.upsertPosition({
      id: 'pos-bybit',
      symbol: 'BTC/USDT', side: 'buy', entryPrice: 50000, quantity: 0.001,
      amount: 50, currentPrice: 51000, pnl: 1, pnlPct: 2, strategy: 'rsi',
      mode: 'live', marketType: 'spot', stopLoss: 49000, openedAt: Date.now(),
      userId: 1, testnet: false, exchange: 'bybit',
    });
    db.upsertPosition({
      id: 'pos-binance-testnet',
      symbol: 'ETH/USDT', side: 'buy', entryPrice: 3000, quantity: 0.01,
      amount: 30, currentPrice: 3100, pnl: 1, pnlPct: 3, strategy: 'ma_crossover',
      mode: 'paper', marketType: 'futures', stopLoss: null, openedAt: Date.now(),
      userId: 1, testnet: true, exchange: 'binance',
    });
    const positions = db.getOpenPositions(1);
    const byId = Object.fromEntries(positions.map((p) => [p.id, p]));
    expect(byId['pos-bybit'].exchange).toBe('bybit');
    expect(byId['pos-bybit'].testnet).toBe(false);
    expect(byId['pos-binance-testnet'].exchange).toBe('binance');
    expect(byId['pos-binance-testnet'].testnet).toBe(true);
  });

  it('stores and retrieves config', () => {
    db.setConfig('tradeAmount', '200');
    expect(db.getConfig('tradeAmount')).toBe('200');
  });

  it('creates user with default paper balance of 10000', () => {
    const user = db.createUser('testuser', null, 'hash123', 'demo');
    const fetched = db.getUserByUsername('testuser');
    expect(fetched).not.toBeNull();
    expect(fetched!.paperBalance).toBe(10000);
  });

  it('updates user paper balance', () => {
    const user = db.createUser('baluser', null, 'hash123', 'demo');
    db.updateUser(user.id, { paperBalance: 50000 });
    const fetched = db.getUserByUsername('baluser');
    expect(fetched!.paperBalance).toBe(50000);
  });

  it('updates exchange testnet flag independently', () => {
    const user = db.createUser('testnetuser', null, 'hash123', 'regular');
    expect(db.getUserByUsername('testnetuser')!.exchangeTestnet).toBe(true);
    db.updateExchangeTestnet(user.id, false);
    expect(db.getUserByUsername('testnetuser')!.exchangeTestnet).toBe(false);
    db.updateExchangeTestnet(user.id, true);
    expect(db.getUserByUsername('testnetuser')!.exchangeTestnet).toBe(true);
  });

  it('defaults user lang and theme', () => {
    const user = db.createUser('prefuser', null, 'hash123', 'demo');
    const fetched = db.getUserByUsername('prefuser');
    expect(fetched!.lang).toBe('en');
    expect(fetched!.theme).toBe('dark');
  });

  it('updates user preferences (lang and theme)', () => {
    const user = db.createUser('prefuser2', null, 'hash123', 'demo');
    db.updateUserPreferences(user.id, 'he', 'light');
    const fetched = db.getUserByUsername('prefuser2');
    expect(fetched!.lang).toBe('he');
    expect(fetched!.theme).toBe('light');
  });

  it('paginates trades', () => {
    for (let i = 0; i < 5; i++) {
      db.insertTrade({
        id: `t-${i}`, symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001,
        amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: `o-${i}`,
        pnl: i, timestamp: Date.now() - i * 1000, userId: 1,
        testnet: false, exchange: 'bybit',
      });
    }
    const page0 = db.getTradesPaginated(1, 0, 2);
    expect(page0.total).toBe(5);
    expect(page0.data).toHaveLength(2);
    const page1 = db.getTradesPaginated(1, 1, 2);
    expect(page1.data).toHaveLength(2);
    const page2 = db.getTradesPaginated(1, 2, 2);
    expect(page2.data).toHaveLength(1);
  });

  it('filters trades by symbol', () => {
    db.insertTrade({ id: 't-btc', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-1', pnl: 10, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-eth', symbol: 'ETH/USDT', side: 'sell', price: 3000, quantity: 0.01, amount: 30, strategy: 'ma_crossover', mode: 'live', marketType: 'spot', orderId: 'o-2', pnl: -5, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    const all = db.getTradesPaginated(1, 0, 10);
    expect(all.total).toBe(2);
    const btcOnly = db.getTradesPaginated(1, 0, 10, { symbol: 'BTC/USDT' });
    expect(btcOnly.total).toBe(1);
    expect(btcOnly.data[0].symbol).toBe('BTC/USDT');
  });

  it('filters trades by side', () => {
    db.insertTrade({ id: 't-buy', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-1', pnl: 10, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-sell', symbol: 'BTC/USDT', side: 'sell', price: 51000, quantity: 0.001, amount: 51, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-2', pnl: -5, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    const buys = db.getTradesPaginated(1, 0, 10, { side: 'buy' });
    expect(buys.total).toBe(1);
    expect(buys.data[0].side).toBe('buy');
  });

  it('filters trades by strategy', () => {
    db.insertTrade({ id: 't-rsi', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-1', pnl: 10, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-ma', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'ma_crossover', mode: 'paper', marketType: 'spot', orderId: 'o-2', pnl: 5, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    const rsiOnly = db.getTradesPaginated(1, 0, 10, { strategy: 'rsi' });
    expect(rsiOnly.total).toBe(1);
    expect(rsiOnly.data[0].strategy).toBe('rsi');
  });

  it('filters trades by mode', () => {
    db.insertTrade({ id: 't-paper', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-1', pnl: 10, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-live', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'live', marketType: 'spot', orderId: 'o-2', pnl: 5, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    const paperOnly = db.getTradesPaginated(1, 0, 10, { mode: 'paper' });
    expect(paperOnly.total).toBe(1);
    expect(paperOnly.data[0].mode).toBe('paper');
  });

  it('filters trades by pnl profit/loss', () => {
    db.insertTrade({ id: 't-win', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-1', pnl: 10, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-lose', symbol: 'BTC/USDT', side: 'sell', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-2', pnl: -5, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-zero', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-3', pnl: 0, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    const profits = db.getTradesPaginated(1, 0, 10, { pnl: 'profit' });
    expect(profits.total).toBe(1); // pnl > 0 (strictly positive)
    expect(profits.data[0].pnl).toBe(10);
    const losses = db.getTradesPaginated(1, 0, 10, { pnl: 'loss' });
    expect(losses.total).toBe(1);
    expect(losses.data[0].pnl).toBe(-5);
  });

  it('returns totalPnl aggregated across all matching trades (not just the current page)', () => {
    db.insertTrade({ id: 't-1', symbol: 'BTC/USDT', side: 'buy',  price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-1', pnl:  10,  timestamp: 1000, userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-2', symbol: 'BTC/USDT', side: 'sell', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-2', pnl: -5,   timestamp: 2000, userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-3', symbol: 'ETH/USDT', side: 'buy',  price: 3000,  quantity: 0.01,  amount: 30, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-3', pnl:  20,  timestamp: 3000, userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-4', symbol: 'ETH/USDT', side: 'buy',  price: 3000,  quantity: 0.01,  amount: 30, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-4', pnl: null, timestamp: 4000, userId: 1, testnet: false, exchange: 'bybit' });

    // Page size 2 — totalPnl must reflect all 4 matching trades, not
    // just the 2 returned on the current page.
    const page0 = db.getTradesPaginated(1, 0, 2);
    expect(page0.data).toHaveLength(2);
    expect(page0.total).toBe(4);
    expect(page0.totalPnl).toBe(25); // 10 - 5 + 20 + 0 (null treated as 0)

    // Filter respects the same WHERE clause as count/data.
    const profits = db.getTradesPaginated(1, 0, 10, { pnl: 'profit' });
    expect(profits.total).toBe(2);
    expect(profits.totalPnl).toBe(30); // 10 + 20

    const losses = db.getTradesPaginated(1, 0, 10, { pnl: 'loss' });
    expect(losses.total).toBe(1);
    expect(losses.totalPnl).toBe(-5);

    // Empty result → totalPnl is 0, not null/undefined.
    const none = db.getTradesPaginated(1, 0, 10, { symbol: 'SOL/USDT' });
    expect(none.total).toBe(0);
    expect(none.totalPnl).toBe(0);
  });

  it('excludes zero pnl trades', () => {
    db.insertTrade({ id: 't-win', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-1', pnl: 10, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-zero', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-2', pnl: 0, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-lose', symbol: 'BTC/USDT', side: 'sell', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-3', pnl: -5, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-null', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-4', pnl: null, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    const withZero = db.getTradesPaginated(1, 0, 10);
    expect(withZero.total).toBe(4);
    const withoutZero = db.getTradesPaginated(1, 0, 10, { excludeZeroPnl: true });
    expect(withoutZero.total).toBe(3); // keeps pnl=10, pnl=-5, pnl=null; excludes pnl=0
    expect(withoutZero.data.every((t: any) => t.pnl !== 0)).toBe(true);
  });

  it('combines multiple trade filters', () => {
    db.insertTrade({ id: 't-1', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-1', pnl: 10, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-2', symbol: 'BTC/USDT', side: 'sell', price: 51000, quantity: 0.001, amount: 51, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-2', pnl: -5, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-3', symbol: 'ETH/USDT', side: 'buy', price: 3000, quantity: 0.01, amount: 30, strategy: 'ma_crossover', mode: 'live', marketType: 'spot', orderId: 'o-3', pnl: 20, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    const result = db.getTradesPaginated(1, 0, 10, { symbol: 'BTC/USDT', side: 'buy', pnl: 'profit' });
    expect(result.total).toBe(1);
    expect(result.data[0].id).toBe('t-1');
  });

  it('exportTrades returns all trades for a user with no filters', () => {
    for (let i = 0; i < 7; i++) {
      db.insertTrade({
        id: `t-${i}`, symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001,
        amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: `o-${i}`,
        pnl: i, timestamp: Date.now() - i * 1000, userId: 1, testnet: false, exchange: 'bybit',
      });
    }
    // Noise from another user — must not appear in user 1's export.
    db.insertTrade({ id: 't-other', symbol: 'ETH/USDT', side: 'buy', price: 3000, quantity: 0.01, amount: 30, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-x', pnl: 1, timestamp: Date.now(), userId: 2, testnet: false, exchange: 'bybit' });
    const all = db.exportTrades(1);
    expect(all).toHaveLength(7);
    expect(all.every((t) => t.userId === 1)).toBe(true);
    // Ordered newest-first, same as the paginated endpoint.
    const timestamps = all.map((t) => t.timestamp);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });

  it('exportTrades respects filters identically to getTradesPaginated', () => {
    db.insertTrade({ id: 't-1', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-1', pnl: 10, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-2', symbol: 'BTC/USDT', side: 'sell', price: 51000, quantity: 0.001, amount: 51, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-2', pnl: -5, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-3', symbol: 'ETH/USDT', side: 'buy', price: 3000, quantity: 0.01, amount: 30, strategy: 'ma_crossover', mode: 'live', marketType: 'spot', orderId: 'o-3', pnl: 20, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-4', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-4', pnl: 0, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });

    // Same filter: symbol=BTC/USDT, side=buy, pnl=profit → only t-1
    const exported = db.exportTrades(1, { symbol: 'BTC/USDT', side: 'buy', pnl: 'profit' });
    const paginated = db.getTradesPaginated(1, 0, 100, { symbol: 'BTC/USDT', side: 'buy', pnl: 'profit' });
    expect(exported.map((t) => t.id)).toEqual(paginated.data.map((t) => t.id));
    expect(exported).toHaveLength(1);
    expect(exported[0].id).toBe('t-1');

    // excludeZeroPnl should drop t-4 but keep the rest
    const nonZero = db.exportTrades(1, { excludeZeroPnl: true });
    expect(nonZero).toHaveLength(3);
    expect(nonZero.every((t) => t.pnl !== 0)).toBe(true);
  });

  it('exportTrades bypasses the 200-row pagination cap', () => {
    // Insert 250 rows — more than MAX_PAGE_SIZE (200). exportTrades must return all of them.
    for (let i = 0; i < 250; i++) {
      db.insertTrade({
        id: `t-${i}`, symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001,
        amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: `o-${i}`,
        pnl: i, timestamp: Date.now() - i * 1000, userId: 1, testnet: false, exchange: 'bybit',
      });
    }
    const all = db.exportTrades(1);
    expect(all).toHaveLength(250);
  });

  it('iterateTrades streams mapped rows respecting filters', () => {
    db.insertTrade({ id: 't-1', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-1', pnl: 10, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-2', symbol: 'ETH/USDT', side: 'buy', price: 3000, quantity: 0.01, amount: 30, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-2', pnl: -5, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-3', symbol: 'BTC/USDT', side: 'sell', price: 51000, quantity: 0.001, amount: 51, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-3', pnl: 2, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    const iter = db.iterateTrades(1, { symbol: 'BTC/USDT' });
    // Pull rows one at a time — verifies the iterator contract, not just the final array.
    const first = iter.next();
    expect(first.done).toBe(false);
    expect(first.value.symbol).toBe('BTC/USDT');
    const collected = [first.value];
    for (const t of iter) collected.push(t);
    expect(collected).toHaveLength(2);
    expect(collected.every((t) => t.symbol === 'BTC/USDT')).toBe(true);
    // Field mapping (snake → camel) — `closeReason` must be present after mapTrade.
    expect(collected[0]).toHaveProperty('closeReason');
  });

  it('iteratePositions streams only the requested user rows', () => {
    db.upsertPosition({ id: 'p-1', symbol: 'BTC/USDT', side: 'buy', entryPrice: 50000, quantity: 0.001, amount: 50, currentPrice: 50500, pnl: 0.5, pnlPct: 1, strategy: 'rsi', mode: 'paper', marketType: 'spot', stopLoss: 49000, openedAt: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.upsertPosition({ id: 'p-2', symbol: 'ETH/USDT', side: 'buy', entryPrice: 3000, quantity: 0.01, amount: 30, currentPrice: 3100, pnl: 1, pnlPct: 3.33, strategy: 'rsi', mode: 'paper', marketType: 'spot', stopLoss: 2900, openedAt: Date.now(), userId: 2, testnet: false, exchange: 'bybit' });
    const rows = [...db.iteratePositions(1)];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('p-1');
  });

  it('returns distinct trade symbols for a user', () => {
    db.insertTrade({ id: 't-1', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-1', pnl: 10, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-2', symbol: 'ETH/USDT', side: 'buy', price: 3000, quantity: 0.01, amount: 30, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-2', pnl: 5, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-3', symbol: 'BTC/USDT', side: 'sell', price: 51000, quantity: 0.001, amount: 51, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-3', pnl: -5, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-4', symbol: 'SOL/USDT', side: 'buy', price: 100, quantity: 1, amount: 100, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-4', pnl: 2, timestamp: Date.now(), userId: 2, testnet: false, exchange: 'bybit' });
    const symbols = db.getTradeDistinctSymbols(1);
    expect(symbols).toEqual(['BTC/USDT', 'ETH/USDT']);
    const symbols2 = db.getTradeDistinctSymbols(2);
    expect(symbols2).toEqual(['SOL/USDT']);
  });

  it('returns distinct trade strategies for a user', () => {
    db.insertTrade({ id: 't-1', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-1', pnl: 10, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-2', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'ma_crossover', mode: 'paper', marketType: 'spot', orderId: 'o-2', pnl: 5, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-3', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-3', pnl: -5, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    const strategies = db.getTradeDistinctStrategies(1);
    expect(strategies).toEqual(['ma_crossover', 'rsi']);
  });

  it('filters all trades (admin) with combined filters', () => {
    db.insertTrade({ id: 't-1', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-1', pnl: 10, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-2', symbol: 'ETH/USDT', side: 'sell', price: 3000, quantity: 0.01, amount: 30, strategy: 'ma_crossover', mode: 'live', marketType: 'spot', orderId: 'o-2', pnl: -5, timestamp: Date.now(), userId: 2, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-3', symbol: 'BTC/USDT', side: 'buy', price: 49000, quantity: 0.002, amount: 98, strategy: 'rsi', mode: 'live', marketType: 'spot', orderId: 'o-3', pnl: 15, timestamp: Date.now(), userId: 2, testnet: false, exchange: 'bybit' });
    const byUser = db.getAllTradesPaginated(0, 10, { userId: 2, testnet: false, exchange: 'bybit' });
    expect(byUser.total).toBe(2);
    const bySymbolAndMode = db.getAllTradesPaginated(0, 10, { symbol: 'BTC/USDT', mode: 'live' });
    expect(bySymbolAndMode.total).toBe(1);
    expect(bySymbolAndMode.data[0].id).toBe('t-3');
    const byPnl = db.getAllTradesPaginated(0, 10, { pnl: 'loss' });
    expect(byPnl.total).toBe(1);
    expect(byPnl.data[0].id).toBe('t-2');
  });

  it('returns all distinct symbols and strategies (admin)', () => {
    db.insertTrade({ id: 't-1', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.001, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o-1', pnl: 10, timestamp: Date.now(), userId: 1, testnet: false, exchange: 'bybit' });
    db.insertTrade({ id: 't-2', symbol: 'ETH/USDT', side: 'buy', price: 3000, quantity: 0.01, amount: 30, strategy: 'ma_crossover', mode: 'paper', marketType: 'spot', orderId: 'o-2', pnl: 5, timestamp: Date.now(), userId: 2, testnet: false, exchange: 'bybit' });
    const symbols = db.getAllTradeDistinctSymbols();
    expect(symbols).toEqual(['BTC/USDT', 'ETH/USDT']);
    const strategies = db.getAllTradeDistinctStrategies();
    expect(strategies).toEqual(['ma_crossover', 'rsi']);
  });

  it('paginates positions', () => {
    for (let i = 0; i < 3; i++) {
      db.upsertPosition({
        id: `p-${i}`, symbol: 'ETH/USDT', side: 'buy', entryPrice: 3000, quantity: 0.01,
        amount: 30, currentPrice: 3100, pnl: 1, pnlPct: 3, strategy: 'ma_crossover',
        mode: 'paper', marketType: 'spot', stopLoss: null, openedAt: Date.now() - i * 1000, userId: 1,
        testnet: false, exchange: 'bybit',
      });
    }
    const page0 = db.getOpenPositionsPaginated(1, 0, 2);
    expect(page0.total).toBe(3);
    expect(page0.data).toHaveLength(2);
    const page1 = db.getOpenPositionsPaginated(1, 1, 2);
    expect(page1.data).toHaveLength(1);
  });

  it('stores and retrieves candles', () => {
    db.insertCandles('BTC/USDT', '1h', [
      { timestamp: 1000, open: 50000, high: 51000, low: 49000, close: 50500, volume: 100 },
    ]);
    const candles = db.getCandles('BTC/USDT', '1h', 0, Date.now());
    expect(candles).toHaveLength(1);
    expect(candles[0].close).toBe(50500);
  });

  it('round-trips closeReason', () => {
    db.insertTrade({
      id: 't1', symbol: 'BTC/USDT', side: 'sell',
      price: 50000, quantity: 0.01, amount: 500,
      strategy: 'ma_crossover', mode: 'paper', marketType: 'spot',
      orderId: 'o1', pnl: 25, timestamp: Date.now(), userId: 1,
      testnet: false, exchange: '', closeReason: 'user',
    });
    const got = db.getTrades(1, 10);
    expect(got).toHaveLength(1);
    expect(got[0].closeReason).toBe('user');
  });

  it('stores null closeReason as null', () => {
    db.insertTrade({
      id: 't2', symbol: 'BTC/USDT', side: 'buy',
      price: 50000, quantity: 0.01, amount: 500,
      strategy: 'ma_crossover', mode: 'paper', marketType: 'spot',
      orderId: 'o2', pnl: null, timestamp: Date.now(), userId: 1,
      testnet: false, exchange: '',
      // closeReason omitted
    });
    const got = db.getTrades(1, 10);
    expect(got[0].closeReason).toBeNull();
  });

  it('getTradesPaginated sorts by whitelisted columns', () => {
    db.insertTrade({ id: 't1', symbol: 'BTC/USDT', side: 'buy', price: 100, quantity: 1, amount: 100, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o1', pnl: 10, timestamp: 1000, userId: 1, testnet: false, exchange: '' });
    db.insertTrade({ id: 't2', symbol: 'ETH/USDT', side: 'sell', price: 200, quantity: 2, amount: 200, strategy: 'macd', mode: 'paper', marketType: 'spot', orderId: 'o2', pnl: -5, timestamp: 2000, userId: 1, testnet: false, exchange: '' });
    db.insertTrade({ id: 't3', symbol: 'SOL/USDT', side: 'buy', price: 50, quantity: 3, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o3', pnl: 20, timestamp: 3000, userId: 1, testnet: false, exchange: '' });

    const byPriceAsc = db.getTradesPaginated(1, 0, 10, undefined, { by: 'price', dir: 'asc' });
    expect(byPriceAsc.data.map((t) => t.price)).toEqual([50, 100, 200]);

    const byPriceDesc = db.getTradesPaginated(1, 0, 10, undefined, { by: 'price', dir: 'desc' });
    expect(byPriceDesc.data.map((t) => t.price)).toEqual([200, 100, 50]);

    const byPnlAsc = db.getTradesPaginated(1, 0, 10, undefined, { by: 'pnl', dir: 'asc' });
    expect(byPnlAsc.data.map((t) => t.pnl)).toEqual([-5, 10, 20]);

    const bySymbol = db.getTradesPaginated(1, 0, 10, undefined, { by: 'symbol', dir: 'asc' });
    expect(bySymbol.data.map((t) => t.symbol)).toEqual(['BTC/USDT', 'ETH/USDT', 'SOL/USDT']);
  });

  it('getTradesPaginated ignores non-whitelisted sort columns and falls back to timestamp', () => {
    db.insertTrade({ id: 't1', symbol: 'A', side: 'buy', price: 1, quantity: 1, amount: 1, strategy: 's', mode: 'paper', marketType: 'spot', orderId: 'o1', pnl: 0, timestamp: 2000, userId: 1, testnet: false, exchange: '' });
    db.insertTrade({ id: 't2', symbol: 'B', side: 'buy', price: 2, quantity: 1, amount: 2, strategy: 's', mode: 'paper', marketType: 'spot', orderId: 'o2', pnl: 0, timestamp: 1000, userId: 1, testnet: false, exchange: '' });

    const result = db.getTradesPaginated(1, 0, 10, undefined, { by: 'DROP TABLE trades; --', dir: 'asc' });
    expect(result.data).toHaveLength(2);
    expect(result.data[0].timestamp).toBe(1000);
    expect(result.data[1].timestamp).toBe(2000);
  });

  it('getTradesPaginated defaults to timestamp DESC when no sort is specified', () => {
    db.insertTrade({ id: 't1', symbol: 'A', side: 'buy', price: 1, quantity: 1, amount: 1, strategy: 's', mode: 'paper', marketType: 'spot', orderId: 'o1', pnl: 0, timestamp: 1000, userId: 1, testnet: false, exchange: '' });
    db.insertTrade({ id: 't2', symbol: 'B', side: 'buy', price: 2, quantity: 1, amount: 2, strategy: 's', mode: 'paper', marketType: 'spot', orderId: 'o2', pnl: 0, timestamp: 2000, userId: 1, testnet: false, exchange: '' });

    const result = db.getTradesPaginated(1, 0, 10);
    expect(result.data[0].timestamp).toBe(2000);
    expect(result.data[1].timestamp).toBe(1000);
  });

  it('getDailyPnlReport aggregates P&L by calendar date', () => {
    const day1 = new Date('2026-04-15T10:00:00').getTime();
    const day1b = new Date('2026-04-15T14:00:00').getTime();
    const day2 = new Date('2026-04-16T09:00:00').getTime();
    db.insertTrade({ id: 'r1', symbol: 'BTC/USDT', side: 'buy', price: 100, quantity: 1, amount: 100, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o1', pnl: 10, timestamp: day1, userId: 1, testnet: false, exchange: '' });
    db.insertTrade({ id: 'r2', symbol: 'ETH/USDT', side: 'sell', price: 50, quantity: 1, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o2', pnl: -3, timestamp: day1b, userId: 1, testnet: false, exchange: '' });
    db.insertTrade({ id: 'r3', symbol: 'SOL/USDT', side: 'buy', price: 80, quantity: 1, amount: 80, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o3', pnl: 20, timestamp: day2, userId: 1, testnet: false, exchange: '' });
    // User 2 trade should NOT appear in user 1's report
    db.insertTrade({ id: 'r4', symbol: 'BTC/USDT', side: 'buy', price: 100, quantity: 1, amount: 100, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o4', pnl: 50, timestamp: day1, userId: 2, testnet: false, exchange: '' });

    const report = db.getDailyPnlReport(1);
    expect(report).toHaveLength(2);
    // Newest first
    expect(report[0].date).toBe('2026-04-16');
    expect(report[0].pnl).toBe(20);
    expect(report[0].tradeCount).toBe(1);
    // Day 1: 10 + (-3) = 7, 2 trades
    expect(report[1].date).toBe('2026-04-15');
    expect(report[1].pnl).toBe(7);
    expect(report[1].tradeCount).toBe(2);
  });

  it('getDailyPnlReport excludes trades with null pnl', () => {
    const ts = new Date('2026-04-15T10:00:00').getTime();
    db.insertTrade({ id: 'n1', symbol: 'BTC/USDT', side: 'buy', price: 100, quantity: 1, amount: 100, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o1', pnl: null, timestamp: ts, userId: 1, testnet: false, exchange: '' });
    db.insertTrade({ id: 'n2', symbol: 'ETH/USDT', side: 'sell', price: 50, quantity: 1, amount: 50, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o2', pnl: 5, timestamp: ts, userId: 1, testnet: false, exchange: '' });

    const report = db.getDailyPnlReport(1);
    expect(report).toHaveLength(1);
    expect(report[0].pnl).toBe(5);
    expect(report[0].tradeCount).toBe(1);
  });

  it('getDailyPnlReport returns empty array for user with no trades', () => {
    expect(db.getDailyPnlReport(999)).toEqual([]);
  });

  it('getDailyPnlReport returns balance from matching snapshot', () => {
    const now = Date.now();
    db.insertTrade({
      id: 'bal-t1', symbol: 'BTC/USDT', side: 'sell', price: 1, quantity: 1, amount: 1,
      strategy: 'ma', mode: 'paper', marketType: 'spot', orderId: 'o1',
      pnl: 10, timestamp: now, userId: 1, testnet: false, exchange: 'bybit',
    });
    db.upsertDailyEquitySnapshot(1, 5000);

    const report = db.getDailyPnlReport(1);
    expect(report).toHaveLength(1);
    expect(report[0].balance).toBe(5000);
  });

  it('getDailyPnlReport returns null balance when no snapshot exists', () => {
    // Trade on a date with no corresponding snapshot
    const oldTs = new Date('2020-01-15T12:00:00Z').getTime();
    db.insertTrade({
      id: 'bal-t2', symbol: 'BTC/USDT', side: 'sell', price: 1, quantity: 1, amount: 1,
      strategy: 'ma', mode: 'paper', marketType: 'spot', orderId: 'o2',
      pnl: 10, timestamp: oldTs, userId: 1, testnet: false, exchange: 'bybit',
    });

    const report = db.getDailyPnlReport(1);
    expect(report).toHaveLength(1);
    expect(report[0].balance).toBeNull();
  });

  it('creates daily_equity_snapshots table on init', () => {
    const tables = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain('daily_equity_snapshots');
  });

  it('daily_equity_snapshots has primary key on (user_id, date)', () => {
    const cols = db.db
      .prepare("PRAGMA table_info(daily_equity_snapshots)")
      .all() as { name: string; pk: number }[];
    const pkCols = cols.filter((c) => c.pk > 0).map((c) => c.name).sort();
    expect(pkCols).toEqual(['date', 'user_id']);
  });

  it('upsertDailyEquitySnapshot writes a snapshot for today', () => {
    db.upsertDailyEquitySnapshot(1, 1234.56);
    const rows = db.db
      .prepare('SELECT user_id, date, total_equity FROM daily_equity_snapshots')
      .all() as { user_id: number; date: string; total_equity: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(1);
    expect(rows[0].total_equity).toBe(1234.56);
    expect(rows[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('upsertDailyEquitySnapshot replaces the value for the same user+date', () => {
    db.upsertDailyEquitySnapshot(1, 1000);
    db.upsertDailyEquitySnapshot(1, 2500);
    const rows = db.db
      .prepare('SELECT total_equity FROM daily_equity_snapshots WHERE user_id = 1')
      .all() as { total_equity: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].total_equity).toBe(2500);
  });

  it('upsertDailyEquitySnapshot keeps snapshots for different users separate', () => {
    db.upsertDailyEquitySnapshot(1, 1000);
    db.upsertDailyEquitySnapshot(2, 9999);
    const rows = db.db
      .prepare('SELECT user_id, total_equity FROM daily_equity_snapshots ORDER BY user_id')
      .all() as { user_id: number; total_equity: number }[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ user_id: 1, total_equity: 1000 });
    expect(rows[1]).toEqual({ user_id: 2, total_equity: 9999 });
  });
});
