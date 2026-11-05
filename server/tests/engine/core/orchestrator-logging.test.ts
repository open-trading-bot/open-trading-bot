import { describe, it, expect, vi, afterEach } from 'vitest';
import { createOrchestrator } from '../../../src/engine/core/orchestrator.js';
import { strategies } from '@open-trading-bot/strategies';
import type { Strategy } from '@open-trading-bot/strategies';
import type { ExchangeAdapter } from '../../../src/exchange/types.js';
import type { Db } from '../../../src/db/index.js';
import type { WsBroadcaster } from '../../../src/websocket/index.js';
import type { BotConfig } from '../../../src/types/index.js';
import logger from '../../../src/utils/logger.js';

const STUB_ID = '__test_log_buy__';

const buyStrategy: Strategy = {
  id: STUB_ID,
  name: 'Always buy (test)',
  analyze: (_candles, _params, symbol, marketType) => ({
    action: 'buy', confidence: 0.99, price: 50000, symbol, marketType, strategy: STUB_ID, reason: 'test',
  }),
};

const HOLD_ID = '__test_log_hold__';
const holdStrategy: Strategy = {
  id: HOLD_ID,
  name: 'Always hold (test)',
  analyze: (_candles, _params, symbol, marketType) => ({
    action: 'hold', confidence: 0, price: 50000, symbol, marketType, strategy: HOLD_ID, reason: 'test',
  }),
};
(strategies as Record<string, Strategy>)[HOLD_ID] = holdStrategy;

afterEach(() => {
  delete (strategies as Record<string, Strategy>)[STUB_ID];
  vi.restoreAllMocks();
});

const config: BotConfig = {
  mode: 'paper', riskLevel: 'moderate', tradeAmount: 100, stopLossPct: 2, dailyLossLimit: 500,
  maxOpenPositions: 10, minConfidence: 0.5, tickInterval: 60, orderType: 'market',
  assets: [
    { symbol: 'BTC/USDT', enabled: true, marketType: 'spot' },
    { symbol: 'ETH/USDT', enabled: true, marketType: 'spot' },
  ],
  strategies: [
    { id: STUB_ID, name: 'Buy', enabled: true, params: {}, interval: '5m', marketType: 'spot' },
    { id: HOLD_ID, name: 'Hold', enabled: true, params: {}, interval: '5m', marketType: 'spot' },
  ],
};

function exchangeMock(): ExchangeAdapter {
  return {
    name: 'mock',
    fetchTicker: vi.fn(),
    fetchCandles: vi.fn().mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ timestamp: Date.now() - (30 - i) * 60000, open: 50000, high: 50000, low: 50000, close: 50000, volume: 1 })),
    ),
    placeOrder: vi.fn().mockResolvedValue({ orderId: 'o', symbol: 'X', side: 'buy', price: 50000, quantity: 0.002, status: 'filled' }),
    cancelOrder: vi.fn(),
    fetchBalance: vi.fn().mockResolvedValue({ total: 10000, free: 10000, totalEquity: 10000 }),
    closePosition: vi.fn(),
  };
}

function dbMock(): Db {
  return {
    insertTrade: vi.fn(), upsertPosition: vi.fn(), removePosition: vi.fn(), insertCandles: vi.fn(),
    getOpenPositions: vi.fn().mockReturnValue([]), getDailyTrades: vi.fn().mockReturnValue([]),
    upsertDailyEquitySnapshot: vi.fn(), getUserById: vi.fn().mockReturnValue(null),
  } as unknown as Db;
}

const ws = (): WsBroadcaster => ({ broadcast: vi.fn(), broadcastToUser: vi.fn(), clientCount: vi.fn(), close: vi.fn() });

describe('Orchestrator tick logging', () => {
  it('writes exactly one info line per tick: a summary with assets, signals, orders and duration', async () => {
    (strategies as Record<string, Strategy>)[STUB_ID] = buyStrategy;
    const info = vi.spyOn(logger, 'info');
    const orch = createOrchestrator(exchangeMock(), dbMock(), ws(), config, 7);
    orch.start();
    info.mockClear();

    await orch.tick();

    const tickLines = info.mock.calls.map((c) => String(c[0])).filter((m) => m.startsWith('[tick]'));
    expect(tickLines).toHaveLength(1);
    expect(tickLines[0]).toMatch(/user=7/);
    expect(tickLines[0]).toMatch(/assets=2/);
    expect(tickLines[0]).toMatch(/signals=4/);
    expect(tickLines[0]).toMatch(/orders=2/);
    expect(tickLines[0]).toMatch(/errors=0/);
    expect(tickLines[0]).toMatch(/duration=\d+ms/);
  });

  it('moves the per-asset and per-strategy lines to debug', async () => {
    (strategies as Record<string, Strategy>)[STUB_ID] = buyStrategy;
    const debug = vi.spyOn(logger, 'debug');
    const orch = createOrchestrator(exchangeMock(), dbMock(), ws(), config);
    orch.start();
    await orch.tick();

    const debugLines = debug.mock.calls.map((c) => String(c[0]));
    expect(debugLines.some((m) => m.includes('Fetching candles for BTC/USDT'))).toBe(true);
    expect(debugLines.some((m) => m.includes('Hold → ETH/USDT'))).toBe(true);
  });

  it('counts a failed asset as an error in the summary', async () => {
    (strategies as Record<string, Strategy>)[STUB_ID] = buyStrategy;
    const ex = exchangeMock();
    (ex.fetchCandles as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const info = vi.spyOn(logger, 'info');
    const orch = createOrchestrator(ex, dbMock(), ws(), config);
    orch.start();
    await orch.tick();

    const summary = info.mock.calls.map((c) => String(c[0])).find((m) => m.startsWith('[tick]'));
    expect(summary).toMatch(/errors=1/);
    expect(summary).toMatch(/orders=1/);
  });
});

describe('Orchestrator signal broadcast', () => {
  it('sends all signals of a tick in one signals:batch event', async () => {
    (strategies as Record<string, Strategy>)[STUB_ID] = buyStrategy;
    const broadcaster = ws();
    const orch = createOrchestrator(exchangeMock(), dbMock(), broadcaster, config);
    orch.start();
    await orch.tick();

    const events = (broadcaster.broadcast as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(events.filter((e) => e.type === 'signal:generated')).toHaveLength(0);
    const batches = events.filter((e) => e.type === 'signals:batch');
    expect(batches).toHaveLength(1);
    expect(batches[0].data).toHaveLength(4);
    expect(batches[0].data.map((s: { symbol: string }) => s.symbol)).toEqual(['BTC/USDT', 'BTC/USDT', 'ETH/USDT', 'ETH/USDT']);
  });
});
