import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import { createDataService } from '../../src/services/data.js';
import { createDataController } from '../../src/controllers/data.js';
import { createDataRouter } from '../../src/routes/data.js';
import type { Db } from '../../src/db/index.js';
import type { BotManager } from '../../src/engine/bot-manager.js';
import type { BotService } from '../../src/services/bot.js';
import { TEST_CIPHER } from '../utils/crypto-fixtures.js';

function mockDb(): Db {
  return {
    db: {} as any, close: vi.fn(), insertTrade: vi.fn(), updateTradePnl: vi.fn(),
    getTrades: vi.fn().mockReturnValue([{ id: 't1', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.002, amount: 100, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o1', pnl: 5, timestamp: Date.now(), userId: 1 }]),
    getTradesBySymbol: vi.fn().mockReturnValue([]),
    upsertPosition: vi.fn(),
    getOpenPositions: vi.fn().mockReturnValue([{ id: 'p1', symbol: 'BTC/USDT', side: 'buy', entryPrice: 49000, quantity: 0.002, amount: 100, currentPrice: 50000, pnl: 2, pnlPct: 2.04, strategy: 'ma_crossover', marketType: 'spot', stopLoss: 48000, openedAt: Date.now(), userId: 1 }]),
    removePosition: vi.fn(), setConfig: vi.fn(), getConfig: vi.fn(), insertCandles: vi.fn(),
    getCandles: vi.fn().mockReturnValue([]), getDailyTrades: vi.fn().mockReturnValue([]),
    insertLead: vi.fn(), getLeads: vi.fn().mockReturnValue([]),
    getUserConfig: vi.fn().mockReturnValue(null), setUserConfig: vi.fn(),
    updateUserExchangeKeys: vi.fn(), updateExchangeTestnet: vi.fn(), getAllTrades: vi.fn().mockReturnValue([]),
    getAllOpenPositions: vi.fn().mockReturnValue([]), getUsers: vi.fn().mockReturnValue([{ id: 1, username: 'admin', paperBalance: 10000 }]),
    getUserById: vi.fn().mockReturnValue({ id: 1, username: 'admin', paperBalance: 10000 }),
    getTradesPaginated: vi.fn().mockReturnValue({ data: [{ id: 't1', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.002, amount: 100, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o1', pnl: 5, timestamp: Date.now(), userId: 1 }], total: 1 }),
    getOpenPositionsPaginated: vi.fn().mockReturnValue({ data: [{ id: 'p1', symbol: 'BTC/USDT', side: 'buy', entryPrice: 49000, quantity: 0.002, amount: 100, currentPrice: 50000, pnl: 2, pnlPct: 2.04, strategy: 'ma_crossover', mode: 'paper', marketType: 'spot', stopLoss: 48000, openedAt: Date.now(), userId: 1 }], total: 1 }),
    exportTrades: vi.fn().mockReturnValue([
      { id: 't1', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.002, amount: 100, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o1', pnl: 5, timestamp: 1700000000000, userId: 1 },
      { id: 't2', symbol: 'ETH/USDT', side: 'sell', price: 3000, quantity: 0.01, amount: 30, strategy: 'ma, with comma', mode: 'live', marketType: 'spot', orderId: 'o2', pnl: -2, timestamp: 1700000001000, userId: 1 },
    ]),
    iterateTrades: vi.fn(function* () {
      yield { id: 't1', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.002, amount: 100, strategy: 'rsi', mode: 'paper', marketType: 'spot', orderId: 'o1', pnl: 5, timestamp: 1700000000000, userId: 1, testnet: false, exchange: 'bybit', closeReason: null };
      yield { id: 't2', symbol: 'ETH/USDT', side: 'sell', price: 3000, quantity: 0.01, amount: 30, strategy: 'ma, with comma', mode: 'live', marketType: 'spot', orderId: 'o2', pnl: -2, timestamp: 1700000001000, userId: 1, testnet: true, exchange: 'bybit', closeReason: 'user' };
    }),
    iteratePositions: vi.fn(function* () {
      yield { id: 'p1', symbol: 'BTC/USDT', side: 'buy', entryPrice: 49000, quantity: 0.002, amount: 100, currentPrice: 50000, pnl: 2, pnlPct: 2.04, strategy: 'ma_crossover', mode: 'paper', marketType: 'spot', stopLoss: 48000, openedAt: 1700000000000, userId: 1, testnet: false, exchange: 'bybit' };
    }),
  };
}

function mockBotManager(): BotManager {
  const exchange = { name: 'mock', fetchSymbols: vi.fn().mockResolvedValue([]), fetchTicker: vi.fn(), fetchCandles: vi.fn(), placeOrder: vi.fn(), cancelOrder: vi.fn(), fetchBalance: vi.fn().mockResolvedValue({ total: 10000, free: 9000, totalEquity: 10500 }), closePosition: vi.fn() };
  return {
    startBot: vi.fn(), stopBot: vi.fn(), killBot: vi.fn(),
    getStatus: vi.fn().mockReturnValue('running'),
    getConfig: vi.fn().mockReturnValue({
      mode: 'paper', tradeAmount: 100, stopLossPct: 2, dailyLossLimit: 500, maxOpenPositions: 10, orderType: 'market',
      assets: [{ symbol: 'BTC/USDT', enabled: true, marketType: 'spot' }],
      strategies: [{ id: 'ma_crossover', name: 'MA Crossover', enabled: true, params: {}, interval: '5m', marketType: 'spot' }],
    }),
    updateConfig: vi.fn(), tick: vi.fn(), isRunning: vi.fn().mockReturnValue(true),
    getExchange: vi.fn().mockReturnValue(exchange), stopAll: vi.fn(), ensureBot: vi.fn(), resetBot: vi.fn(),
  };
}

function mockBotService(overrides?: Partial<BotService>): BotService {
  return {
    getStatus: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    kill: vi.fn(),
    closePosition: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

describe('Data Routes', () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    const db = mockDb();
    (globalThis as any).__tradeSpy = db.getTradesPaginated;
    const service = createDataService(db, mockBotManager());
    const controller = createDataController(service, db, TEST_CIPHER, mockBotService());
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).user = { id: 1, username: 'admin', role: 'admin' }; next(); });
    const mockFlagService = { getAllFlags: vi.fn().mockReturnValue([]), getResolvedFlags: vi.fn().mockReturnValue({}), createFlag: vi.fn(), updateFlag: vi.fn(), deleteFlag: vi.fn(), setOverrides: vi.fn() } as any;
    app.use('/api', createDataRouter(controller, mockFlagService));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => { port = (server.address() as { port: number }).port; resolve(); });
    });
  });
  afterEach(() => server?.close());

  it('GET /api/positions returns paginated positions', async () => {
    const res = await fetch(`http://localhost:${port}/api/positions`);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('total');
    expect(body.data[0].symbol).toBe('BTC/USDT');
  });
  it('GET /api/trades returns paginated trades', async () => {
    const res = await fetch(`http://localhost:${port}/api/trades`);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('total');
    expect(body.data).toHaveLength(1);
  });

  it('GET /api/trades/export returns a bare array of all trades', async () => {
    const res = await fetch(`http://localhost:${port}/api/trades/export`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Bare array — no pagination envelope. Client writes this directly to a JSON file.
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe('t1');
    expect(body[1].symbol).toBe('ETH/USDT');
  });

  it('GET /api/trades/export forwards filters to the db', async () => {
    const db = mockDb();
    const exportSpy = db.exportTrades as ReturnType<typeof vi.fn>;
    const service = createDataService(db, mockBotManager());
    const controller = createDataController(service, db, TEST_CIPHER, mockBotService());
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).user = { id: 7, username: 'u', role: 'admin' }; next(); });
    const mockFlagService = { getAllFlags: vi.fn().mockReturnValue([]), getResolvedFlags: vi.fn().mockReturnValue({}), createFlag: vi.fn(), updateFlag: vi.fn(), deleteFlag: vi.fn(), setOverrides: vi.fn() } as any;
    app.use('/api', createDataRouter(controller, mockFlagService));
    const srv = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const p = (srv.address() as { port: number }).port;
    await fetch(`http://localhost:${p}/api/trades/export?symbol=BTC%2FUSDT&pnl=profit&excludeZeroPnl=true`);
    expect(exportSpy).toHaveBeenCalledWith(7, expect.objectContaining({ symbol: 'BTC/USDT', pnl: 'profit', excludeZeroPnl: true }));
    srv.close();
  });

  it('GET /api/trades/export with no filters passes undefined', async () => {
    const db = mockDb();
    const exportSpy = db.exportTrades as ReturnType<typeof vi.fn>;
    const service = createDataService(db, mockBotManager());
    const controller = createDataController(service, db, TEST_CIPHER, mockBotService());
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).user = { id: 7, username: 'u', role: 'admin' }; next(); });
    const mockFlagService = { getAllFlags: vi.fn().mockReturnValue([]), getResolvedFlags: vi.fn().mockReturnValue({}), createFlag: vi.fn(), updateFlag: vi.fn(), deleteFlag: vi.fn(), setOverrides: vi.fn() } as any;
    app.use('/api', createDataRouter(controller, mockFlagService));
    const srv = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const p = (srv.address() as { port: number }).port;
    await fetch(`http://localhost:${p}/api/trades/export`);
    expect(exportSpy).toHaveBeenCalledWith(7, undefined);
    srv.close();
  });

  it('GET /api/positions/export returns a bare array of open positions', async () => {
    const res = await fetch(`http://localhost:${port}/api/positions/export`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Bypasses pagination — no "data/total/page" envelope.
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('p1');
  });

  it('GET /api/trades/export.csv streams CSV with headers and escaped cells', async () => {
    const res = await fetch(`http://localhost:${port}/api/trades/export.csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="trades-\d{4}-\d{2}-\d{2}\.csv"/);
    const body = await res.text();
    const lines = body.trim().split('\n');
    // 1 header row + 2 data rows from iterateTrades mock
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('id,symbol,side,price,quantity,amount,strategy,mode,marketType,orderId,pnl,timestamp,testnet,exchange,closeReason');
    // First trade: plain cells, no quoting
    expect(lines[1]).toContain('t1,BTC/USDT,buy,50000,0.002,100,rsi,paper,spot,o1,5,1700000000000,false,bybit,');
    // Second trade: strategy contains a comma → must be RFC 4180-quoted
    expect(lines[2]).toContain('"ma, with comma"');
    expect(lines[2]).toContain('true'); // testnet boolean
    expect(lines[2]).toContain('user'); // closeReason
  });

  it('GET /api/trades/export.csv with filters forwards them to iterateTrades', async () => {
    const db = mockDb();
    const iterSpy = db.iterateTrades as ReturnType<typeof vi.fn>;
    const service = createDataService(db, mockBotManager());
    const controller = createDataController(service, db, TEST_CIPHER, mockBotService());
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).user = { id: 9, username: 'u', role: 'admin' }; next(); });
    const mockFlagService = { getAllFlags: vi.fn().mockReturnValue([]), getResolvedFlags: vi.fn().mockReturnValue({}), createFlag: vi.fn(), updateFlag: vi.fn(), deleteFlag: vi.fn(), setOverrides: vi.fn() } as any;
    app.use('/api', createDataRouter(controller, mockFlagService));
    const srv = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const p = (srv.address() as { port: number }).port;
    await fetch(`http://localhost:${p}/api/trades/export.csv?symbol=BTC%2FUSDT&pnl=loss`);
    expect(iterSpy).toHaveBeenCalledWith(9, expect.objectContaining({ symbol: 'BTC/USDT', pnl: 'loss' }));
    srv.close();
  });

  it('GET /api/positions/export.csv streams position CSV', async () => {
    const res = await fetch(`http://localhost:${port}/api/positions/export.csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="open-positions-\d{4}-\d{2}-\d{2}\.csv"/);
    const body = await res.text();
    const lines = body.trim().split('\n');
    expect(lines).toHaveLength(2); // header + 1 row
    expect(lines[0]).toBe('id,symbol,side,entryPrice,quantity,amount,currentPrice,pnl,pnlPct,strategy,mode,marketType,stopLoss,openedAt,testnet,exchange');
    expect(lines[1]).toBe('p1,BTC/USDT,buy,49000,0.002,100,50000,2,2.04,ma_crossover,paper,spot,48000,1700000000000,false,bybit');
  });
  it('GET /api/portfolio returns fast DB-only shape', async () => {
    const res = await fetch(`http://localhost:${port}/api/portfolio`);
    const body = await res.json();
    expect(body.positions).toHaveLength(1);
    expect(body).toHaveProperty('dailyPnl');
    expect(body).toHaveProperty('totalPnl');
    expect(body).not.toHaveProperty('totalBalance');
    expect(body).not.toHaveProperty('availableBalance');
    expect(body).not.toHaveProperty('dailyPnlPct');
  });

  it('GET /api/portfolio does not call exchange.fetchBalance', async () => {
    const manager = mockBotManager();
    const fetchBalanceSpy = (manager.getExchange(1) as any).fetchBalance;
    const db = mockDb();
    const service = createDataService(db, manager);
    service.getPortfolio(1);
    expect(fetchBalanceSpy).toHaveBeenCalledTimes(0);
  });
  it('GET /api/portfolio/balance returns balance with exact shape', async () => {
    const res = await fetch(`http://localhost:${port}/api/portfolio/balance`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ totalBalance: 10000, availableBalance: 9000, totalEquity: 10500 });
  });
  it('GET /api/portfolio/balance calls dataService with user id', async () => {
    const dbMock = mockDb();
    const manager = mockBotManager();
    const mockExchange = { name: 'mock', fetchBalance: vi.fn().mockResolvedValue({ total: 10000, free: 9000, totalEquity: 10500 }) };
    (manager.getExchange as any).mockReturnValue(mockExchange);
    const service = createDataService(dbMock, manager);
    const spyBalance = vi.spyOn(service, 'getPortfolioBalance');
    const controller = createDataController(service, dbMock, TEST_CIPHER);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).user = { id: 88, username: 'testuser', role: 'admin' }; next(); });
    const mockFlagService = { getAllFlags: vi.fn().mockReturnValue([]), getResolvedFlags: vi.fn().mockReturnValue({}), createFlag: vi.fn(), updateFlag: vi.fn(), deleteFlag: vi.fn(), setOverrides: vi.fn() } as any;
    app.use('/api', createDataRouter(controller, mockFlagService));
    const testServer = await new Promise<http.Server>((resolve) => {
      const srv = app.listen(0, () => resolve(srv));
    });
    const testPort = (testServer.address() as { port: number }).port;
    const res = await fetch(`http://localhost:${testPort}/api/portfolio/balance`);
    expect(res.status).toBe(200);
    expect(spyBalance).toHaveBeenCalledWith(88);
    testServer.close();
  });
  it('GET /api/strategies returns strategy list', async () => {
    const res = await fetch(`http://localhost:${port}/api/strategies`);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('ma_crossover');
  });
  it('PUT /api/config updates config', async () => {
    const res = await fetch(`http://localhost:${port}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeAmount: 200 }) });
    expect(res.status).toBe(200);
  });
  it('GET /api/trades with explicit page/limit', async () => {
    const res = await fetch(`http://localhost:${port}/api/trades?page=0&limit=10`);
    const body = await res.json();
    expect(body).toHaveProperty('page', 0);
    expect(body).toHaveProperty('totalPages');
    expect(body.data).toHaveLength(1);
  });
  it('GET /api/positions with explicit page/limit', async () => {
    const res = await fetch(`http://localhost:${port}/api/positions?page=0&limit=10`);
    const body = await res.json();
    expect(body).toHaveProperty('page', 0);
    expect(body).toHaveProperty('totalPages');
    expect(body.data).toHaveLength(1);
  });
  it('GET /api/trades pipes testnet query param through to db', async () => {
    // Find the db mock on this server's context
    const spy = (globalThis as any).__tradeSpy as any;
    const res = await fetch(`http://localhost:${port}/api/trades?testnet=true`);
    expect(res.status).toBe(200);
    const call = spy.mock.calls.at(-1);
    expect(call[3]).toMatchObject({ testnet: 'true' });
  });
  it('GET /api/trades pipes exchange query param through to db', async () => {
    const spy = (globalThis as any).__tradeSpy as any;
    const res = await fetch(`http://localhost:${port}/api/trades?exchange=bybit`);
    expect(res.status).toBe(200);
    const call = spy.mock.calls.at(-1);
    expect(call[3]).toMatchObject({ exchange: 'bybit' });
  });
  it('GET /api/trades pipes combined testnet + exchange + mode query params', async () => {
    const spy = (globalThis as any).__tradeSpy as any;
    const res = await fetch(`http://localhost:${port}/api/trades?testnet=false&exchange=binance&mode=live`);
    expect(res.status).toBe(200);
    const call = spy.mock.calls.at(-1);
    expect(call[3]).toMatchObject({ testnet: 'false', exchange: 'binance', mode: 'live' });
  });
  it('PUT /api/config rejects tradeAmount exceeding balance', async () => {
    const res = await fetch(`http://localhost:${port}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeAmount: 50000 }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Trade amount exceeds');
  });
  it('PUT /api/config rejects dailyLossLimit exceeding balance', async () => {
    const res = await fetch(`http://localhost:${port}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dailyLossLimit: 20000 }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Daily loss limit exceeds');
  });
  it('PUT /api/config allows values within balance', async () => {
    const res = await fetch(`http://localhost:${port}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeAmount: 500, dailyLossLimit: 5000 }) });
    expect(res.status).toBe(200);
  });
});

describe('Data Routes — live mode requires exchange keys invariant', () => {
  let server: http.Server;
  let port: number;
  let db: Db;

  beforeEach(async () => {
    db = mockDb();
    const service = createDataService(db, mockBotManager());
    const controller = createDataController(service, db, TEST_CIPHER, mockBotService());
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).user = { id: 1, username: 'admin', role: 'admin' }; next(); });
    const mockFlagService = { getAllFlags: vi.fn().mockReturnValue([]), getResolvedFlags: vi.fn().mockReturnValue({}), createFlag: vi.fn(), updateFlag: vi.fn(), deleteFlag: vi.fn(), setOverrides: vi.fn() } as any;
    app.use('/api', createDataRouter(controller, mockFlagService));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => { port = (server.address() as { port: number }).port; resolve(); });
    });
  });
  afterEach(() => server?.close());

  it('PUT /api/config rejects mode=live when exchange keys are missing (NULL)', async () => {
    (db.getUserById as any).mockReturnValue({ id: 1, username: 'admin', paperBalance: 10000, exchangeKey: null, exchangeSecret: null });
    const res = await fetch(`http://localhost:${port}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'live' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Live trading requires saved exchange API keys');
  });

  it('PUT /api/config rejects mode=live when exchange key is an empty string (post-clear state)', async () => {
    (db.getUserById as any).mockReturnValue({ id: 1, username: 'admin', paperBalance: 10000, exchangeKey: '', exchangeSecret: '' });
    const res = await fetch(`http://localhost:${port}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'live' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Live trading requires saved exchange API keys');
  });

  it('PUT /api/config allows mode=live when exchange keys are present', async () => {
    (db.getUserById as any).mockReturnValue({ id: 1, username: 'admin', paperBalance: 10000, exchangeKey: 'enc-key', exchangeSecret: 'enc-secret' });
    const res = await fetch(`http://localhost:${port}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'live' }) });
    expect(res.status).toBe(200);
  });

  it('PUT /api/config allows mode=paper without exchange keys', async () => {
    (db.getUserById as any).mockReturnValue({ id: 1, username: 'admin', paperBalance: 10000, exchangeKey: null, exchangeSecret: null });
    const res = await fetch(`http://localhost:${port}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'paper' }) });
    expect(res.status).toBe(200);
  });

  it('PUT /api/config allows non-mode updates without exchange keys', async () => {
    (db.getUserById as any).mockReturnValue({ id: 1, username: 'admin', paperBalance: 10000, exchangeKey: null, exchangeSecret: null });
    const res = await fetch(`http://localhost:${port}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeAmount: 200 }) });
    expect(res.status).toBe(200);
  });
});

describe('Data Routes — live mode skips paper balance validation', () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    const db = mockDb();
    (db.getUserConfig as any).mockReturnValue({ mode: 'live' });
    const manager = mockBotManager();
    (manager.getConfig as any).mockReturnValue({ mode: 'live', tradeAmount: 100 });
    const service = createDataService(db, manager);
    const controller = createDataController(service, db, TEST_CIPHER, mockBotService());
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).user = { id: 1, username: 'admin', role: 'admin' }; next(); });
    const mockFlagService = { getAllFlags: vi.fn().mockReturnValue([]), getResolvedFlags: vi.fn().mockReturnValue({}), createFlag: vi.fn(), updateFlag: vi.fn(), deleteFlag: vi.fn(), setOverrides: vi.fn() } as any;
    app.use('/api', createDataRouter(controller, mockFlagService));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => { port = (server.address() as { port: number }).port; resolve(); });
    });
  });
  afterEach(() => server?.close());

  it('PUT /api/config allows tradeAmount exceeding paper balance in live mode', async () => {
    const res = await fetch(`http://localhost:${port}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradeAmount: 50000 }) });
    expect(res.status).toBe(200);
  });
  it('PUT /api/config allows dailyLossLimit exceeding paper balance in live mode', async () => {
    const res = await fetch(`http://localhost:${port}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dailyLossLimit: 50000 }) });
    expect(res.status).toBe(200);
  });
});

describe('Data Routes — POST /api/positions/:id/close', () => {
  let server: http.Server;
  let port: number;
  let botSvc: BotService;

  async function buildApp(svc: BotService) {
    const db = mockDb();
    const service = createDataService(db, mockBotManager());
    const controller = createDataController(service, db, TEST_CIPHER, svc);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).user = { id: 1, username: 'admin', role: 'admin' }; next(); });
    const mockFlagService = { getAllFlags: vi.fn().mockReturnValue([]), getResolvedFlags: vi.fn().mockReturnValue({}), createFlag: vi.fn(), updateFlag: vi.fn(), deleteFlag: vi.fn(), setOverrides: vi.fn() } as any;
    app.use('/api', createDataRouter(controller, mockFlagService));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => { port = (server.address() as { port: number }).port; resolve(); });
    });
  }

  afterEach(() => server?.close());

  it('closes the position and returns ok', async () => {
    botSvc = mockBotService();
    await buildApp(botSvc);
    const res = await fetch(`http://localhost:${port}/api/positions/pos-1/close`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(botSvc.closePosition).toHaveBeenCalledWith(1, 'pos-1');
  });

  it('returns 404 when the position is not found', async () => {
    botSvc = mockBotService({
      closePosition: vi.fn().mockRejectedValue(new Error('Position pos-x not found')),
    });
    await buildApp(botSvc);
    const res = await fetch(`http://localhost:${port}/api/positions/pos-x/close`, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
