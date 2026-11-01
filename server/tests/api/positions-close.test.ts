/**
 * Test E — end-to-end integration for POST /api/positions/:id/close
 *
 * Wires a real botService → real botManager → real orchestrator (but with a
 * fully stubbed exchange adapter so no network calls are made).  Every layer
 * above the exchange is exercised with real code, so a route or factory-wiring
 * regression will be caught here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import { createBotService } from '../../src/services/bot.js';
import { createBotManager } from '../../src/engine/bot-manager.js';
import { createBotConfig } from '../../src/config/index.js';
import { createDataService } from '../../src/services/data.js';
import { createDataController } from '../../src/controllers/data.js';
import { createDataRouter } from '../../src/routes/data.js';
import { BOT_ACTIONS, ACTION_SOURCES } from '../../src/utils/constants.js';
import type { Db } from '../../src/db/index.js';
import type { WsBroadcaster } from '../../src/websocket/index.js';
import type { Position } from '../../src/types/index.js';
import { TEST_CIPHER } from '../utils/crypto-fixtures.js';

const TEST_POSITION_ID = 'test-pos-1';
const USER_ID = 1;

function mockBroadcaster(): WsBroadcaster {
  return {
    broadcast: vi.fn(),
    broadcastToUser: vi.fn(),
    clientCount: vi.fn().mockReturnValue(0),
    close: vi.fn(),
  };
}

/** Minimal position fixture that satisfies the orchestrator's closePositionManually path. */
const TEST_POSITION: Position = {
  id: TEST_POSITION_ID,
  symbol: 'BTC/USDT',
  side: 'buy',
  entryPrice: 50000,
  currentPrice: 51000,
  quantity: 0.001,
  amount: 50,
  pnl: 1,
  pnlPct: 2,
  strategy: 'rsi',
  mode: 'paper',
  marketType: 'spot',
  stopLoss: null,
  openedAt: Date.now(),
  userId: USER_ID,
  testnet: true,
  exchange: 'bybit',
};

function makeIntegrationDb(): Db {
  const defaultUser = {
    id: USER_ID,
    username: 'user',
    exchangeKey: null,
    exchangeSecret: null,
    exchangeTestnet: true,
    exchangeName: 'bybit',
    paperBalance: 10000,
  };
  return {
    db: {} as any,
    close: vi.fn(),
    getUserById: vi.fn().mockReturnValue(defaultUser),
    getUserConfig: vi.fn().mockReturnValue(createBotConfig('paper')),
    setUserConfig: vi.fn(),
    getOpenPositions: vi.fn().mockReturnValue([TEST_POSITION]),
    getOpenPositionsPaginated: vi.fn().mockReturnValue({ data: [TEST_POSITION], total: 1 }),
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
    getUsers: vi.fn().mockReturnValue([defaultUser]),
    insertActionLog: vi.fn(),
  } as unknown as Db;
}

describe('POST /api/positions/:id/close — end-to-end integration', () => {
  let server: http.Server;
  let port: number;
  let db: Db;

  beforeEach(async () => {
    db = makeIntegrationDb();

    const broadcaster = mockBroadcaster();
    const botManager = createBotManager(db, broadcaster, TEST_CIPHER);

    // Stub the paper exchange adapter's closePosition so the orchestrator
    // can complete the close without hitting any real exchange.  We access
    // the exchange through botManager.getExchange() which also triggers the
    // lazy bot creation (getOrCreateBot).
    const exchange = botManager.getExchange(USER_ID);
    vi.spyOn(exchange, 'closePosition').mockResolvedValue({
      orderId: 'mock-order-1',
      price: 51000,
      quantity: 0.001,
    });

    const botService = createBotService(botManager, db);

    // Build the minimal Express app matching the data.test.ts pattern.
    const dataService = createDataService(db, botManager);
    const controller = createDataController(dataService, db, TEST_CIPHER, botService);
    const app = express();
    app.use(express.json());
    // Inject authenticated user (no real JWT middleware needed in unit tests).
    app.use((req, _res, next) => {
      (req as any).user = { id: USER_ID, username: 'user', role: 'regular' };
      next();
    });
    const mockFlagService = {
      getAllFlags: vi.fn().mockReturnValue([]),
      getResolvedFlags: vi.fn().mockReturnValue({}),
      createFlag: vi.fn(),
      updateFlag: vi.fn(),
      deleteFlag: vi.fn(),
      setOverrides: vi.fn(),
    } as any;
    app.use('/api', createDataRouter(controller, mockFlagService));

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterEach(() => server?.close());

  it('returns 200 { ok: true } and calls insertActionLog with CLOSE_POSITION', async () => {
    const res = await fetch(`http://localhost:${port}/api/positions/${TEST_POSITION_ID}/close`, {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    // Verify the action log was recorded with the correct constants (commit 08c0df2).
    expect(db.insertActionLog).toHaveBeenCalledWith(
      USER_ID,
      BOT_ACTIONS.CLOSE_POSITION,
      USER_ID,
      ACTION_SOURCES.SELF,
    );
  });
});
