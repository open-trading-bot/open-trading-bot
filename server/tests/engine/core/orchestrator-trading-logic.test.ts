import { describe, it, expect, vi, afterEach } from 'vitest';
import { createOrchestrator } from '../../../src/engine/core/orchestrator.js';
import { createPaperAdapter } from '../../../src/exchange/paper.js';
import { strategies } from '../../../src/engine/strategies/index.js';
import type { Strategy } from '../../../src/engine/strategies/types.js';
import type { ExchangeAdapter } from '../../../src/exchange/types.js';
import type { Db } from '../../../src/db/index.js';
import type { WsBroadcaster } from '../../../src/websocket/index.js';
import type { BotConfig, Position } from '../../../src/types/index.js';

const STUB_ID = '__test_forced__';
let forcedAction: 'buy' | 'sell' = 'buy';

const forcedStrategy: Strategy = {
  id: STUB_ID,
  name: 'Forced (test)',
  analyze: (_candles, _params, symbol, marketType) => ({
    action: forcedAction, confidence: 0.99, price: 50000, symbol, marketType,
    strategy: STUB_ID, reason: 'forced by test',
  }),
};

afterEach(() => {
  delete (strategies as Record<string, Strategy>)[STUB_ID];
});

function install(action: 'buy' | 'sell') {
  forcedAction = action;
  (strategies as Record<string, Strategy>)[STUB_ID] = forcedStrategy;
}

const config: BotConfig = {
  mode: 'paper', riskLevel: 'moderate', tradeAmount: 100, stopLossPct: 2, dailyLossLimit: 500,
  maxOpenPositions: 2, minConfidence: 0.5, tickInterval: 60, orderType: 'market',
  assets: [{ symbol: 'BTC/USDT', enabled: true, marketType: 'spot' }],
  strategies: [{ id: STUB_ID, name: 'Forced', enabled: true, params: {}, interval: '5m', marketType: 'spot' }],
};

function exchangeMock(lastPrice = 50000): ExchangeAdapter {
  return {
    name: 'mock',
    fetchTicker: vi.fn().mockResolvedValue({ symbol: 'BTC/USDT', last: lastPrice, bid: lastPrice, ask: lastPrice, volume24h: 0, timestamp: Date.now() }),
    fetchCandles: vi.fn().mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ timestamp: Date.now() - (30 - i) * 60000, open: 50000, high: 50000, low: 50000, close: 50000, volume: 1 })),
    ),
    placeOrder: vi.fn().mockResolvedValue({ orderId: 'ord-1', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.002, status: 'filled' }),
    cancelOrder: vi.fn(),
    fetchBalance: vi.fn().mockResolvedValue({ total: 10000, free: 10000, totalEquity: 10000 }),
    closePosition: vi.fn().mockResolvedValue({ orderId: 'ord-2', symbol: 'BTC/USDT', side: 'sell', price: lastPrice, quantity: 0.002, status: 'filled' }),
  };
}

function dbMock(positions: Position[] = []): Db {
  return {
    insertTrade: vi.fn(), upsertPosition: vi.fn(), removePosition: vi.fn(), insertCandles: vi.fn(),
    getOpenPositions: vi.fn().mockReturnValue(positions), getDailyTrades: vi.fn().mockReturnValue([]),
    upsertDailyEquitySnapshot: vi.fn(), getUserById: vi.fn().mockReturnValue(null),
  } as unknown as Db;
}

const ws = (): WsBroadcaster => ({ broadcast: vi.fn(), broadcastToUser: vi.fn(), clientCount: vi.fn(), close: vi.fn() });

function longPosition(over: Partial<Position> = {}): Position {
  return {
    id: 'pos-1', symbol: 'BTC/USDT', side: 'buy', entryPrice: 40000, quantity: 0.0025, amount: 100,
    currentPrice: 50000, pnl: 0, pnlPct: 0, strategy: STUB_ID, mode: 'paper', marketType: 'spot',
    stopLoss: 39200, openedAt: Date.now(), userId: 0, testnet: false, exchange: '', ...over,
  };
}

describe('Orchestrator trading logic', () => {
  it('T1: does not buy again when a long is already open on the symbol', async () => {
    install('buy');
    const ex = exchangeMock();
    const orch = createOrchestrator(ex, dbMock([longPosition()]), ws(), config);
    orch.start();
    await orch.tick();
    expect(ex.placeOrder).not.toHaveBeenCalled();
  });

  it('T2: a sell signal closes the full position quantity, not tradeAmount', async () => {
    install('sell');
    const ex = exchangeMock(60000);
    const db = dbMock([longPosition({ quantity: 0.0025 })]);
    const orch = createOrchestrator(ex, db, ws(), config);
    orch.start();
    await orch.tick();
    expect(ex.placeOrder).not.toHaveBeenCalled();
    expect(ex.closePosition).toHaveBeenCalledWith('BTC/USDT', 'buy', 0.0025, 'spot');
    expect(db.removePosition).toHaveBeenCalledWith(0, 'pos-1');
    const trade = (db.insertTrade as any).mock.calls[0][0];
    expect(trade.side).toBe('sell');
    expect(trade.pnl).toBeCloseTo((60000 - 40000) * 0.0025);
    expect(trade.closeReason).toBe('bot');
  });

  it('T2: paper cash is credited with quantity x exit price on a sell signal', async () => {
    install('sell');
    const real = exchangeMock(60000);
    const paper = createPaperAdapter(real, 1000);
    const orch = createOrchestrator(paper, dbMock([longPosition({ quantity: 0.0025 })]), ws(), config);
    orch.start();
    await orch.tick();
    expect((await paper.fetchBalance()).total).toBeCloseTo(1000 + 0.0025 * 60000);
  });

  it('T3: a sell signal still closes when max positions are reached', async () => {
    install('sell');
    const ex = exchangeMock();
    const full = [longPosition(), longPosition({ id: 'pos-2', symbol: 'ETH/USDT' })];
    const orch = createOrchestrator(ex, dbMock(full), ws(), { ...config, maxOpenPositions: 2 });
    orch.start();
    await orch.tick();
    expect(ex.closePosition).toHaveBeenCalledTimes(1);
  });

  it('T3: a sell signal still closes when the daily loss limit is hit', async () => {
    install('sell');
    const ex = exchangeMock();
    const db = dbMock([longPosition()]);
    (db.getDailyTrades as any).mockReturnValue([{ pnl: -1000 }]);
    const orch = createOrchestrator(ex, db, ws(), config);
    orch.start();
    await orch.tick();
    expect(ex.closePosition).toHaveBeenCalledTimes(1);
  });

  it('T4: a tick that is running when the bot stops places no new order', async () => {
    install('buy');
    const ex = exchangeMock();
    let release!: () => void;
    (ex.fetchCandles as any).mockImplementation(() => new Promise((r) => {
      release = () => r(Array.from({ length: 30 }, (_, i) => ({ timestamp: i, open: 1, high: 1, low: 1, close: 1, volume: 1 })));
    }));
    const orch = createOrchestrator(ex, dbMock([]), ws(), config);
    orch.start();
    const tick = orch.tick();
    await vi.waitFor(() => expect(ex.fetchCandles).toHaveBeenCalled());
    orch.stop();
    release();
    await tick;
    expect(ex.placeOrder).not.toHaveBeenCalled();
  });

  it('T4: kill switch waits for the running tick before it closes positions', async () => {
    install('buy');
    const ex = exchangeMock();
    const positions: Position[] = [];
    const db = dbMock();
    (db.getOpenPositions as any).mockImplementation(() => positions);
    (db.upsertPosition as any).mockImplementation((p: Position) => positions.push(p));
    (db.removePosition as any).mockImplementation((_u: number, id: string) => {
      const i = positions.findIndex((p) => p.id === id); if (i >= 0) positions.splice(i, 1);
    });
    let release!: () => void;
    (ex.placeOrder as any).mockImplementation(() => new Promise((r) => {
      release = () => r({ orderId: 'ord-1', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.002, status: 'filled' });
    }));
    const orch = createOrchestrator(ex, db, ws(), config);
    orch.start();
    const tick = orch.tick();
    await vi.waitFor(() => expect(ex.placeOrder).toHaveBeenCalled());
    const kill = orch.killSwitch('user');
    release();
    await Promise.all([tick, kill]);
    // The buy that was in flight is filled, and the kill switch must close it.
    expect(ex.closePosition).toHaveBeenCalledTimes(1);
    expect(positions).toHaveLength(0);
  });
});

describe('Orchestrator uses closed candles only', () => {
  it('does not pass the forming candle to strategies', async () => {
    const seen: number[][] = [];
    (strategies as Record<string, Strategy>)[STUB_ID] = {
      ...forcedStrategy,
      analyze: (candles, p, s, m) => { seen.push(candles.map((x) => x.timestamp)); return forcedStrategy.analyze(candles, p, s, m); },
    };
    const step = 300_000; // 5m, same as the test config interval
    const now = Date.now();
    const formingStart = Math.floor(now / step) * step;
    const ex = exchangeMock();
    (ex.fetchCandles as any).mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ timestamp: formingStart - (29 - i) * step, open: 1, high: 1, low: 1, close: 1, volume: 1 })),
    );
    const orch = createOrchestrator(ex, dbMock([longPosition()]), ws(), config);
    orch.start();
    await orch.tick();
    expect(seen[0]).toHaveLength(29);
    expect(seen[0]).not.toContain(formingStart);
  });
});
