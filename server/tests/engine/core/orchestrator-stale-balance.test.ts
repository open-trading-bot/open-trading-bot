// Regression test for the "stale availableBalance within a tick" bug.
//
// The orchestrator used to fetch the balance once at the top of executeTick
// and reuse that snapshot for every asset in the loop. With N enabled assets
// all signalling buy, the risk manager approved every buy against the SAME
// cached balance, allowing paper cash to go arbitrarily negative.
//
// After the fix, each asset's risk check sees a fresh balance reflecting any
// in-tick spend, so once cash drops below tradeAmount the remaining assets
// are rejected.
import { describe, it, expect, vi } from 'vitest';
import type { Db } from '../../../src/db/index.js';
import type { WsBroadcaster } from '../../../src/websocket/index.js';
import type { ExchangeAdapter } from '../../../src/exchange/types.js';
import type { BotConfig, Signal, MarketType, Candle } from '../../../src/types/index.js';

// Mock the strategies registry BEFORE importing the orchestrator so every
// asset reliably produces a high-confidence buy signal regardless of candle
// shape. This keeps the test focused on the balance-reuse bug, not on
// whether ma_crossover happens to emit a crossover against mock data.
vi.mock('../../../src/engine/strategies/index.js', () => {
  const alwaysBuy = {
    id: 'always_buy',
    name: 'Always Buy (test)',
    defaultParams: {},
    defaultInterval: '5m',
    analyze(_candles: Candle[], _params: any, symbol: string, marketType: MarketType): Signal {
      return {
        action: 'buy', symbol, strategy: 'always_buy', confidence: 1,
        price: 100, timestamp: Date.now(), marketType,
      };
    },
  };
  return {
    strategies: { always_buy: alwaysBuy },
    getStrategy: (id: string) => (id === 'always_buy' ? alwaysBuy : undefined),
    getAllStrategies: () => [alwaysBuy],
  };
});

// Import AFTER mocking.
import { createOrchestrator } from '../../../src/engine/core/orchestrator.js';
import { createPaperAdapter } from '../../../src/exchange/paper.js';

function fakeRealAdapter(): ExchangeAdapter {
  return {
    name: 'mock',
    fetchSymbols: vi.fn().mockResolvedValue(['BTC/USDT', 'ETH/USDT', 'SOL/USDT']),
    fetchTicker: vi.fn().mockImplementation(async (symbol: string) => ({
      symbol, last: 100, bid: 100, ask: 100, volume24h: 0, timestamp: Date.now(),
    })),
    // Candle shape doesn't matter — strategy is mocked to always buy.
    fetchCandles: vi.fn().mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({
        timestamp: Date.now() - (30 - i) * 60_000,
        open: 100, high: 100, low: 100, close: 100, volume: 1,
      })),
    ),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
    fetchBalance: vi.fn().mockResolvedValue({ total: 0, free: 0, totalEquity: 0 }),
    closePosition: vi.fn(),
  };
}

function mockDb(): Db {
  const positions: any[] = [];
  return {
    db: {} as any,
    close: vi.fn(),
    insertTrade: vi.fn(),
    getTrades: vi.fn().mockReturnValue([]),
    getTradesBySymbol: vi.fn().mockReturnValue([]),
    upsertPosition: vi.fn((p: any) => { positions.push(p); }),
    getOpenPositions: vi.fn(() => positions),
    removePosition: vi.fn(),
    setConfig: vi.fn(),
    getConfig: vi.fn(),
    insertCandles: vi.fn(),
    getCandles: vi.fn().mockReturnValue([]),
    getDailyTrades: vi.fn().mockReturnValue([]),
    getUserConfig: vi.fn().mockReturnValue(null),
    setUserConfig: vi.fn(),
    updateUserExchangeKeys: vi.fn(),
    getAllTrades: vi.fn().mockReturnValue([]),
    getAllOpenPositions: vi.fn().mockReturnValue([]),
  } as unknown as Db;
}

function mockBroadcaster(): WsBroadcaster {
  return {
    broadcast: vi.fn(), broadcastToUser: vi.fn(),
    clientCount: vi.fn().mockReturnValue(0), close: vi.fn(),
  };
}

const baseCfg: BotConfig = {
  mode: 'paper',
  riskLevel: 'moderate',
  tradeAmount: 50,
  stopLossPct: 2,
  dailyLossLimit: 500,
  maxOpenPositions: 10,
  minConfidence: 0.5,
  tickInterval: 60,
  orderType: 'market',
  assets: [
    { symbol: 'BTC/USDT', enabled: true, marketType: 'spot' },
    { symbol: 'ETH/USDT', enabled: true, marketType: 'spot' },
    { symbol: 'SOL/USDT', enabled: true, marketType: 'spot' },
  ],
  strategies: [
    { id: 'always_buy', name: 'Always Buy', enabled: true, params: {}, interval: '5m', marketType: 'spot' },
  ],
};

// Wrap paper.placeOrder with a manual spy that still delegates to the real
// paper-adapter implementation (so cash actually moves). Returns the spy array
// and the instrumented adapter.
function spyPaper(initialCash: number) {
  const real = fakeRealAdapter();
  const paper = createPaperAdapter(real, initialCash);
  const placeCalls: any[] = [];
  const origPlace = paper.placeOrder.bind(paper);
  paper.placeOrder = async (params: any) => {
    placeCalls.push(params);
    return origPlace(params);
  };
  return { paper, placeCalls };
}

describe('Orchestrator — balance reuse across assets (regression)', () => {
  it('does not over-spend when multiple assets want to buy in the same tick', async () => {
    // Starting cash: $75. Each buy costs $50. The bot should be able to
    // place exactly 1 buy (cash → $25), then the second and third assets
    // should be rejected because the risk manager sees only $25 available.
    const { paper, placeCalls } = spyPaper(75);
    const orch = createOrchestrator(paper, mockDb(), mockBroadcaster(), baseCfg);
    orch.start();
    await orch.tick();
    orch.stop();

    const buys = placeCalls.filter((c) => c.side === 'buy');
    // Bug: 3 buys placed on a stale $75 snapshot → cash = -$75.
    // Fixed: 1 buy placed, remaining 2 rejected → cash = $25.
    expect(buys.length).toBe(1);

    const bal = await paper.fetchBalance();
    expect(bal.total).toBeGreaterThanOrEqual(0);
    expect(bal.total).toBe(25);
  });

  it('places all affordable buys when cash is sufficient', async () => {
    // Starting cash: $200. Each buy $50. All 3 assets can afford a buy.
    const { paper, placeCalls } = spyPaper(200);
    const orch = createOrchestrator(paper, mockDb(), mockBroadcaster(), baseCfg);
    orch.start();
    await orch.tick();
    orch.stop();

    const buys = placeCalls.filter((c) => c.side === 'buy');
    expect(buys.length).toBe(3);

    const bal = await paper.fetchBalance();
    expect(bal.total).toBe(50);
  });
});
