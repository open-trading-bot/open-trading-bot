import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import { createBotRouter } from '../../src/routes/bot.js';
import { createDataRouter } from '../../src/routes/data.js';
import { createBackofficeRouter } from '../../src/routes/backoffice.js';

function mockBotController() {
  return {
    getStatus: vi.fn((_req, res) => res.json({ status: 'stopped' })),
    start: vi.fn((_req, res) => res.json({ ok: true })),
    stop: vi.fn((_req, res) => res.json({ ok: true })),
    kill: vi.fn((_req, res) => res.json({ ok: true })),
  };
}

function mockDataController() {
  return {
    getDailyPnlReport: vi.fn((_req, res) => res.json([])),
    getPositions: vi.fn((_req, res) => res.json([])),
    getTrades: vi.fn((_req, res) => res.json([])),
    exportPositions: vi.fn((_req, res) => res.json([])),
    exportTrades: vi.fn((_req, res) => res.json([])),
    exportPositionsCsv: vi.fn((_req, res) => res.type('text/csv').send('')),
    exportTradesCsv: vi.fn((_req, res) => res.type('text/csv').send('')),
    exportPositionsTxt: vi.fn((_req, res) => res.type('text/plain').send('')),
    exportTradesTxt: vi.fn((_req, res) => res.type('text/plain').send('')),
    getPortfolio: vi.fn((_req, res) => res.json({})),
    getPortfolioBalance: vi.fn((_req, res) => res.json({ totalBalance: 0, availableBalance: 0, totalEquity: 0 })),
    getStrategies: vi.fn((_req, res) => res.json([])),
    toggleStrategy: vi.fn((_req, res) => res.json({ ok: true })),
    getAssets: vi.fn((_req, res) => res.json([])),
    getSymbols: vi.fn((_req, res) => res.json([])),
    updateConfig: vi.fn((_req, res) => res.json({ ok: true })),
    getExchangeKeys: vi.fn((_req, res) => res.json({ hasKeys: false, testnet: true })),
    checkExchangeKeyPermissions: vi.fn((_req, res) => res.json({ hasKeys: false })),
    updateExchangeKeys: vi.fn((_req, res) => res.json({ hasKeys: true, testnet: true })),
    getWallet: vi.fn((_req, res) => res.json({ address: null })),
    connectWallet: vi.fn((_req, res) => res.json({ ok: true })),
    disconnectWallet: vi.fn((_req, res) => res.json({ ok: true })),
    verifyExchangeKeys: vi.fn((_req, res) => res.json({ ok: true, exchange: 'bybit', balance: 0 })),
    clearExchangeKeys: vi.fn((_req, res) => res.json({ hasKeys: false, testnet: true })),
    updateExchangeTestnet: vi.fn((_req, res) => res.json({ ok: true, testnet: true })),
    getTradeFilters: vi.fn((_req, res) => res.json({ symbols: [], strategies: [] })),
    updatePreferences: vi.fn((_req, res) => res.json({ ok: true })),
    closePosition: vi.fn((_req, res) => res.json({ ok: true })),
  };
}

function mockFeatureFlagService() {
  return {
    getAllFlags: vi.fn(() => []),
    getResolvedFlags: vi.fn(() => ({})),
    createFlag: vi.fn(),
    updateFlag: vi.fn(),
    deleteFlag: vi.fn(),
    setOverrides: vi.fn(),
  } as any;
}

function createApp(userRole: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: 1, username: 'testuser', role: userRole };
    next();
  });
  app.use('/api/bot', createBotRouter(mockBotController()));
  app.use('/api', createDataRouter(mockDataController(), mockFeatureFlagService()));
  return app;
}

async function listen(app: express.Application): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      resolve({ server, port });
    });
  });
}

describe('Bot routes — demo can use paper trading', () => {
  let server: http.Server;
  let port: number;

  afterEach(() => server?.close());

  it('demo user gets 200 on POST /api/bot/start', async () => {
    ({ server, port } = await listen(createApp('demo')));
    const res = await fetch(`http://localhost:${port}/api/bot/start`, { method: 'POST' });
    expect(res.status).toBe(200);
  });

  it('demo user gets 200 on POST /api/bot/stop', async () => {
    ({ server, port } = await listen(createApp('demo')));
    const res = await fetch(`http://localhost:${port}/api/bot/stop`, { method: 'POST' });
    expect(res.status).toBe(200);
  });

  it('admin user gets 200 on POST /api/bot/start', async () => {
    ({ server, port } = await listen(createApp('admin')));
    const res = await fetch(`http://localhost:${port}/api/bot/start`, { method: 'POST' });
    expect(res.status).toBe(200);
  });
});

describe('Data routes — demo access', () => {
  let server: http.Server;
  let port: number;

  afterEach(() => server?.close());

  it('demo user gets 200 on PUT /api/config (paper mode)', async () => {
    ({ server, port } = await listen(createApp('demo')));
    const res = await fetch(`http://localhost:${port}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tradeAmount: 50 }),
    });
    expect(res.status).toBe(200);
  });

  it('demo user gets 200 on GET /api/positions', async () => {
    ({ server, port } = await listen(createApp('demo')));
    const res = await fetch(`http://localhost:${port}/api/positions`);
    expect(res.status).toBe(200);
  });

  it('demo user gets 403 on GET /api/exchange-keys', async () => {
    ({ server, port } = await listen(createApp('demo')));
    const res = await fetch(`http://localhost:${port}/api/exchange-keys`);
    expect(res.status).toBe(403);
  });

  it('demo user gets 200 on POST /api/positions/:id/close', async () => {
    ({ server, port } = await listen(createApp('demo')));
    const res = await fetch(`http://localhost:${port}/api/positions/123/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });
});

function mockBackofficeController() {
  const handler = (_req: any, res: any) => res.json({ ok: true });
  return {
    getLeads: vi.fn(handler), deleteLead: vi.fn(handler), getStats: vi.fn(handler),
    getUsers: vi.fn(handler), createUser: vi.fn(handler), updateUser: vi.fn(handler),
    updateUserPassword: vi.fn(handler), deleteUser: vi.fn(handler),
    getAllTrades: vi.fn(handler), getAllTradeFilters: vi.fn(handler), getAllPositions: vi.fn(handler),
    getUserBotStatuses: vi.fn(handler), getUsersDailyPnl: vi.fn(handler), getUserTrades: vi.fn(handler), getUserTradeFilters: vi.fn(handler),
    getUserPositions: vi.fn(handler), getUserBotStatus: vi.fn(handler), getUserActionLogs: vi.fn(handler),
    getFeatureFlags: vi.fn(handler), createFeatureFlag: vi.fn(handler), updateFeatureFlag: vi.fn(handler),
    deleteFeatureFlag: vi.fn(handler), setFeatureFlagOverrides: vi.fn(handler),
    listInvitations: vi.fn((_req, res) => res.json([])),
    createInvitation: vi.fn((_req, res) => res.json({ id: 'mock-id' })),
    resendInvitation: vi.fn((_req, res) => res.json({ id: 'mock-id' })),
    revokeInvitation: vi.fn((_req, res) => res.json({ ok: true })),
  };
}

function createBackofficeApp(userRole: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: 1, username: 'testuser', role: userRole };
    next();
  });
  app.use('/api/backoffice', createBackofficeRouter(mockBackofficeController()));
  return app;
}

describe('Backoffice routes — admin only', () => {
  let server: http.Server;
  let port: number;

  afterEach(() => server?.close());

  it('admin gets 200 on PUT /api/backoffice/users/5/password', async () => {
    ({ server, port } = await listen(createBackofficeApp('admin')));
    const res = await fetch(`http://localhost:${port}/api/backoffice/users/5/password`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'newpass123' }),
    });
    expect(res.status).toBe(200);
  });

  it('regular user gets 403 on PUT /api/backoffice/users/5/password', async () => {
    ({ server, port } = await listen(createBackofficeApp('regular')));
    const res = await fetch(`http://localhost:${port}/api/backoffice/users/5/password`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'newpass123' }),
    });
    expect(res.status).toBe(403);
  });

  it('demo user gets 403 on PUT /api/backoffice/users/5/password', async () => {
    ({ server, port } = await listen(createBackofficeApp('demo')));
    const res = await fetch(`http://localhost:${port}/api/backoffice/users/5/password`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'newpass123' }),
    });
    expect(res.status).toBe(403);
  });

  it('regular user gets 403 on all backoffice routes', async () => {
    ({ server, port } = await listen(createBackofficeApp('regular')));
    const routes = [
      { method: 'GET', path: '/api/backoffice/users' },
      { method: 'POST', path: '/api/backoffice/users' },
      { method: 'PUT', path: '/api/backoffice/users/1' },
      { method: 'DELETE', path: '/api/backoffice/users/1' },
      { method: 'GET', path: '/api/backoffice/users/1/logs' },
    ];
    for (const r of routes) {
      const res = await fetch(`http://localhost:${port}${r.path}`, { method: r.method });
      expect(res.status, `${r.method} ${r.path} should be 403`).toBe(403);
    }
  });

  it('admin gets 200 on GET /api/backoffice/invitations', async () => {
    ({ server, port } = await listen(createBackofficeApp('admin')));
    const res = await fetch(`http://localhost:${port}/api/backoffice/invitations`);
    expect(res.status).toBe(200);
  });

  it('demo user gets 403 on GET /api/backoffice/invitations', async () => {
    ({ server, port } = await listen(createBackofficeApp('demo')));
    const res = await fetch(`http://localhost:${port}/api/backoffice/invitations`);
    expect(res.status).toBe(403);
  });

  it('admin gets 200 on POST /api/backoffice/invitations', async () => {
    ({ server, port } = await listen(createBackofficeApp('admin')));
    const res = await fetch(`http://localhost:${port}/api/backoffice/invitations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'x@y.z' }),
    });
    expect(res.status).toBe(200);
  });

  it('demo user gets 403 on POST /api/backoffice/invitations', async () => {
    ({ server, port } = await listen(createBackofficeApp('demo')));
    const res = await fetch(`http://localhost:${port}/api/backoffice/invitations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'x@y.z' }),
    });
    expect(res.status).toBe(403);
  });
});
