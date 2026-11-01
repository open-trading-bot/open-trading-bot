import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOrchestrator } from '../../../src/engine/core/orchestrator.js';
import type { ExchangeAdapter } from '../../../src/exchange/types.js';
import type { Db } from '../../../src/db/index.js';
import type { WsBroadcaster } from '../../../src/websocket/index.js';
import type { BotConfig } from '../../../src/types/index.js';

// Candles engineered to trigger a bullish ma_crossover at the final candle:
// 28 flat candles at 50000, then 1 big-jump candle at 100000. At candle 28
// short(5) == long(10), at candle 29 short(5) > long(10), producing a
// bullish crossover signal with very high confidence.
function bullishCrossoverCandles() {
  const candles = [];
  const now = Date.now();
  for (let i = 0; i < 28; i++) {
    candles.push({
      timestamp: now - (30 - i) * 60_000,
      open: 50000, high: 50100, low: 49900, close: 50000, volume: 1000,
    });
  }
  candles.push({
    timestamp: now - 60_000,
    open: 50000, high: 100100, low: 49900, close: 100000, volume: 1000,
  });
  return candles;
}

function mockExchange(): ExchangeAdapter {
  return {
    name: 'bybit',
    fetchSymbols: vi.fn().mockResolvedValue(['BTC/USDT']),
    fetchTicker: vi.fn().mockResolvedValue({
      symbol: 'BTC/USDT', last: 100000, bid: 99999, ask: 100001, volume24h: 1000, timestamp: Date.now(),
    }),
    fetchCandles: vi.fn().mockResolvedValue(bullishCrossoverCandles()),
    placeOrder: vi.fn().mockResolvedValue({
      orderId: 'ord-1', symbol: 'BTC/USDT', side: 'buy', price: 100000, quantity: 0.001, status: 'filled',
    }),
    cancelOrder: vi.fn(),
    fetchBalance: vi.fn().mockResolvedValue({ total: 10000, free: 9000 }),
    closePosition: vi.fn(),
  };
}

function mockDb(userOverrides: Partial<{ exchangeTestnet: boolean }> = {}): Db {
  return {
    db: {} as any,
    close: vi.fn(),
    insertTrade: vi.fn(),
    updateTradePnl: vi.fn(),
    getTrades: vi.fn().mockReturnValue([]),
    getTradesBySymbol: vi.fn().mockReturnValue([]),
    upsertPosition: vi.fn(),
    getOpenPositions: vi.fn().mockReturnValue([]),
    removePosition: vi.fn(),
    setConfig: vi.fn(),
    getConfig: vi.fn(),
    insertCandles: vi.fn(),
    getCandles: vi.fn().mockReturnValue([]),
    getDailyTrades: vi.fn().mockReturnValue([]),
    insertLead: vi.fn(),
    getLeads: vi.fn().mockReturnValue([]),
    getUserConfig: vi.fn().mockReturnValue(null),
    setUserConfig: vi.fn(),
    getUserById: vi.fn().mockReturnValue({
      id: 1, exchangeTestnet: true, exchangeName: 'bybit', ...userOverrides,
    }),
    updateUserExchangeKeys: vi.fn(),
    getAllTrades: vi.fn().mockReturnValue([]),
    getAllOpenPositions: vi.fn().mockReturnValue([]),
  } as unknown as Db;
}

function mockBroadcaster(): WsBroadcaster {
  return {
    broadcast: vi.fn(),
    broadcastToUser: vi.fn(),
    clientCount: vi.fn().mockReturnValue(0),
    close: vi.fn(),
  };
}

function baseConfig(mode: 'paper' | 'live'): BotConfig {
  return {
    mode,
    riskLevel: 'moderate',
    tradeAmount: 100,
    stopLossPct: 2,
    dailyLossLimit: 500,
    maxOpenPositions: 10,
    minConfidence: 0.1,
    tickInterval: 60,
    orderType: 'market',
    assets: [{ symbol: 'BTC/USDT', enabled: true, marketType: 'spot' }],
    strategies: [{
      id: 'ma_crossover', name: 'MA Crossover', enabled: true,
      params: { shortPeriod: 5, longPeriod: 10 }, interval: '5m', marketType: 'spot',
    }],
  };
}

describe('Orchestrator — exchange/testnet stamping on trades and positions', () => {
  let exchange: ExchangeAdapter;
  let ws: WsBroadcaster;

  beforeEach(() => {
    exchange = mockExchange();
    ws = mockBroadcaster();
  });

  it('paper mode: inserted trade has empty exchange and testnet=false (even when user.exchangeTestnet=true)', async () => {
    const db = mockDb({ exchangeTestnet: true });
    const orch = createOrchestrator(exchange, db, ws, baseConfig('paper'), 1);
    orch.start();
    await orch.tick();

    expect((db.insertTrade as any).mock.calls.length).toBe(1);
    const trade = (db.insertTrade as any).mock.calls[0][0];
    expect(trade.mode).toBe('paper');
    expect(trade.exchange).toBe('');
    expect(trade.testnet).toBe(false);
  });

  it('paper mode: upserted position has empty exchange and testnet=false', async () => {
    const db = mockDb({ exchangeTestnet: true });
    const orch = createOrchestrator(exchange, db, ws, baseConfig('paper'), 1);
    orch.start();
    await orch.tick();

    // When a new position is opened, upsertPosition is called with the new
    // position. (It may also be called once per existing open position as
    // part of updatePositionPnl, but openPositions is mocked to [].)
    expect((db.upsertPosition as any).mock.calls.length).toBeGreaterThanOrEqual(1);
    const pos = (db.upsertPosition as any).mock.calls[0][0];
    expect(pos.mode).toBe('paper');
    expect(pos.exchange).toBe('');
    expect(pos.testnet).toBe(false);
  });

  it('live mode + mainnet: inserted trade has exchange=bybit and testnet=false', async () => {
    const db = mockDb({ exchangeTestnet: false });
    const orch = createOrchestrator(exchange, db, ws, baseConfig('live'), 1);
    orch.start();
    await orch.tick();

    expect((db.insertTrade as any).mock.calls.length).toBe(1);
    const trade = (db.insertTrade as any).mock.calls[0][0];
    expect(trade.mode).toBe('live');
    expect(trade.exchange).toBe('bybit');
    expect(trade.testnet).toBe(false);
  });

  it('live mode + testnet: inserted trade has exchange=bybit and testnet=true', async () => {
    const db = mockDb({ exchangeTestnet: true });
    const orch = createOrchestrator(exchange, db, ws, baseConfig('live'), 1);
    orch.start();
    await orch.tick();

    expect((db.insertTrade as any).mock.calls.length).toBe(1);
    const trade = (db.insertTrade as any).mock.calls[0][0];
    expect(trade.mode).toBe('live');
    expect(trade.exchange).toBe('bybit');
    expect(trade.testnet).toBe(true);
  });

  it('live mode + testnet: upserted position has exchange=bybit and testnet=true', async () => {
    const db = mockDb({ exchangeTestnet: true });
    const orch = createOrchestrator(exchange, db, ws, baseConfig('live'), 1);
    orch.start();
    await orch.tick();

    expect((db.upsertPosition as any).mock.calls.length).toBeGreaterThanOrEqual(1);
    const pos = (db.upsertPosition as any).mock.calls[0][0];
    expect(pos.mode).toBe('live');
    expect(pos.exchange).toBe('bybit');
    expect(pos.testnet).toBe(true);
  });
});
