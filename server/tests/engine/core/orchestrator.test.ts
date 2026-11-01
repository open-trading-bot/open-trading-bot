import { describe, it, expect, vi, afterEach } from 'vitest';
import { createOrchestrator } from '../../../src/engine/core/orchestrator.js';
import { createPaperAdapter } from '../../../src/exchange/paper.js';
import { strategies } from '../../../src/engine/strategies/index.js';
import type { Strategy } from '../../../src/engine/strategies/types.js';
import type { ExchangeAdapter } from '../../../src/exchange/types.js';
import type { Db } from '../../../src/db/index.js';
import type { WsBroadcaster } from '../../../src/websocket/index.js';
import type { BotConfig } from '../../../src/types/index.js';

function mockExchange(): ExchangeAdapter {
  return {
    name: 'mock',
    fetchTicker: vi.fn().mockResolvedValue({ symbol: 'BTC/USDT', last: 50000, bid: 49999, ask: 50001, volume24h: 1000, timestamp: Date.now() }),
    fetchCandles: vi.fn().mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({
        timestamp: Date.now() - (30 - i) * 60000, open: 49000 + i * 100, high: 49500 + i * 100,
        low: 48500 + i * 100, close: 49000 + i * 100, volume: 1000,
      })),
    ),
    placeOrder: vi.fn().mockResolvedValue({ orderId: 'ord-1', symbol: 'BTC/USDT', side: 'buy', price: 50000, quantity: 0.002, status: 'filled' }),
    cancelOrder: vi.fn(),
    fetchBalance: vi.fn().mockResolvedValue({ total: 10000, free: 9000, totalEquity: 10000 }),
    closePosition: vi.fn().mockResolvedValue({ orderId: 'ord-2', symbol: 'BTC/USDT', side: 'sell', price: 50000, quantity: 0.002, status: 'filled' }),
  };
}

function mockDb(): Db {
  return {
    db: {} as any, close: vi.fn(), insertTrade: vi.fn(), getTrades: vi.fn().mockReturnValue([]),
    getTradesBySymbol: vi.fn().mockReturnValue([]), upsertPosition: vi.fn(), getOpenPositions: vi.fn().mockReturnValue([]),
    removePosition: vi.fn(), setConfig: vi.fn(), getConfig: vi.fn(), insertCandles: vi.fn(),
    getCandles: vi.fn().mockReturnValue([]), getDailyTrades: vi.fn().mockReturnValue([]),
    getUserConfig: vi.fn().mockReturnValue(null), setUserConfig: vi.fn(),
    updateUserExchangeKeys: vi.fn(), getAllTrades: vi.fn().mockReturnValue([]),
    getAllOpenPositions: vi.fn().mockReturnValue([]),
    upsertDailyEquitySnapshot: vi.fn(),
  };
}

function mockBroadcaster(): WsBroadcaster {
  return { broadcast: vi.fn(), broadcastToUser: vi.fn(), clientCount: vi.fn().mockReturnValue(0), close: vi.fn() };
}

const testConfig: BotConfig = {
  mode: 'paper', riskLevel: 'moderate', tradeAmount: 100, stopLossPct: 2, dailyLossLimit: 500, maxOpenPositions: 10, minConfidence: 0.5, tickInterval: 60, orderType: 'market',
  assets: [{ symbol: 'BTC/USDT', enabled: true, marketType: 'spot' }],
  strategies: [{ id: 'ma_crossover', name: 'MA Crossover', enabled: true, params: { shortPeriod: 10, longPeriod: 20 }, interval: '5m', marketType: 'spot' }],
};

describe('Orchestrator', () => {
  it('starts and stops', () => {
    const orch = createOrchestrator(mockExchange(), mockDb(), mockBroadcaster(), testConfig);
    expect(orch.getStatus()).toBe('stopped');
    orch.start();
    expect(orch.getStatus()).toBe('running');
    orch.stop();
    expect(orch.getStatus()).toBe('stopped');
  });

  it('runs a tick cycle', async () => {
    const exchange = mockExchange();
    const db = mockDb();
    const ws = mockBroadcaster();
    const orch = createOrchestrator(exchange, db, ws, testConfig);
    orch.start();
    await orch.tick();
    orch.stop();
    expect(exchange.fetchCandles).toHaveBeenCalled();
    expect(ws.broadcast).toHaveBeenCalled();
  });

  it('fetches candles once per unique interval even with multiple strategies sharing it', async () => {
    const exchange = mockExchange();
    const db = mockDb();
    // Two strategies that both exist in the registry on the same interval,
    // plus one on a different interval.
    const cfg: BotConfig = {
      ...testConfig,
      strategies: [
        { id: 'rsi', name: 'RSI', enabled: true, params: { period: 14, oversold: 30, overbought: 70 }, interval: '15m', marketType: 'spot' },
        { id: 'bollinger', name: 'Bollinger', enabled: true, params: { period: 20, stdDev: 2 }, interval: '15m', marketType: 'spot' },
        { id: 'macd', name: 'MACD', enabled: true, params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }, interval: '1h', marketType: 'spot' },
      ],
    };
    const orch = createOrchestrator(exchange, db, mockBroadcaster(), cfg);
    orch.start();
    await orch.tick();

    // Per asset (1 asset in testConfig) we expect 2 unique intervals → 2 calls,
    // NOT 3 (one per strategy).
    const calls = (exchange.fetchCandles as any).mock.calls;
    expect(calls.length).toBe(2);
    const seen = new Set(calls.map((c: any[]) => `${c[0]}|${c[1]}`));
    expect(seen).toEqual(new Set(['BTC/USDT|15m', 'BTC/USDT|1h']));
  });

  it('broadcasts the tick signals in one signals:batch event', async () => {
    const exchange = mockExchange();
    const db = mockDb();
    const ws = mockBroadcaster();
    const orch = createOrchestrator(exchange, db, ws, testConfig);
    orch.start();
    await orch.tick();
    orch.stop();
    const signalCalls = (ws.broadcast as any).mock.calls.filter(
      (call: any[]) => call[0]?.type === 'signals:batch'
    );
    expect(signalCalls.length).toBe(1);
    expect(signalCalls[0][0].data[0]).toHaveProperty('symbol');
    expect(signalCalls[0][0].data[0]).toHaveProperty('action');
    expect(signalCalls[0][0].data[0]).toHaveProperty('confidence');
  });

  it('broadcasts tick:complete after tick', async () => {
    const exchange = mockExchange();
    const db = mockDb();
    const ws = mockBroadcaster();
    const orch = createOrchestrator(exchange, db, ws, testConfig);
    orch.start();
    await orch.tick();
    orch.stop();
    const tickCalls = (ws.broadcast as any).mock.calls.filter(
      (call: any[]) => call[0]?.type === 'tick:complete'
    );
    expect(tickCalls.length).toBe(1);
    expect(tickCalls[0][0].data).toHaveProperty('lastTickAt');
  });

  it('kill switch closes all positions', async () => {
    const exchange = mockExchange();
    const db = mockDb();
    db.getOpenPositions = vi.fn().mockReturnValue([
      { id: 'pos-1', symbol: 'BTC/USDT', side: 'buy', quantity: 0.002, marketType: 'spot', entryPrice: 49000, amount: 100, currentPrice: 50000, pnl: 2, pnlPct: 2, strategy: 'ma_crossover', stopLoss: 48000, openedAt: Date.now() },
    ]);
    const ws = mockBroadcaster();
    const orch = createOrchestrator(exchange, db, ws, testConfig);
    orch.start();
    await orch.killSwitch('user');
    expect(exchange.closePosition).toHaveBeenCalledWith('BTC/USDT', 'buy', 0.002, 'spot');
    expect(db.removePosition).toHaveBeenCalledWith(0, 'pos-1');
    expect(orch.getStatus()).toBe('stopped');
  });

  it('kill switch closes multiple positions in parallel', async () => {
    const exchange = mockExchange();
    const closeOrder: string[] = [];
    exchange.closePosition = vi.fn().mockImplementation(async (symbol: string) => {
      closeOrder.push(`start:${symbol}`);
      await new Promise((r) => setTimeout(r, 10));
      closeOrder.push(`end:${symbol}`);
      return { orderId: 'ord', symbol, side: 'sell', price: 50000, quantity: 0.001, status: 'filled' };
    });
    const db = mockDb();
    db.getOpenPositions = vi.fn().mockReturnValue([
      { id: 'pos-1', symbol: 'BTC/USDT', side: 'buy', quantity: 0.001, marketType: 'spot', entryPrice: 49000, amount: 49, currentPrice: 50000, pnl: 1, pnlPct: 2, strategy: 'rsi', stopLoss: null, openedAt: Date.now() },
      { id: 'pos-2', symbol: 'ETH/USDT', side: 'buy', quantity: 0.01, marketType: 'spot', entryPrice: 3000, amount: 30, currentPrice: 3100, pnl: 1, pnlPct: 3, strategy: 'rsi', stopLoss: null, openedAt: Date.now() },
      { id: 'pos-3', symbol: 'SOL/USDT', side: 'sell', quantity: 1, marketType: 'spot', entryPrice: 100, amount: 100, currentPrice: 95, pnl: 5, pnlPct: 5, strategy: 'rsi', stopLoss: null, openedAt: Date.now() },
    ]);
    const ws = mockBroadcaster();
    const orch = createOrchestrator(exchange, db, ws, testConfig);
    orch.start();
    await orch.killSwitch('user');
    expect(exchange.closePosition).toHaveBeenCalledTimes(3);
    expect(db.removePosition).toHaveBeenCalledTimes(3);
    // All starts should happen before any end (parallel execution)
    const starts = closeOrder.filter((e) => e.startsWith('start:'));
    const firstEnd = closeOrder.findIndex((e) => e.startsWith('end:'));
    expect(starts.length).toBe(3);
    expect(firstEnd).toBeGreaterThanOrEqual(3);
  });

  it('kill switch in paper mode credits cash with the full position value + unrealized profit', async () => {
    // Scenario: user opens a $100 position at price 100. Price moves to 120.
    // Position now has +$20 unrealized PnL. Kill switch should credit the
    // paper cash by (quantity * currentPrice) per position, realizing the
    // profit. If initial cash was $10,000 and one $100 buy went up by $20,
    // final cash should be exactly $10,020 — not $9,900 (stale) nor $9,000.
    let currentPrice = 100;
    const realAdapter: ExchangeAdapter = {
      name: 'mock',
      fetchSymbols: vi.fn().mockResolvedValue(['SOL/USDT']),
      fetchTicker: vi.fn().mockImplementation(async () => ({
        symbol: 'SOL/USDT', last: currentPrice, bid: currentPrice, ask: currentPrice,
        volume24h: 0, timestamp: Date.now(),
      })),
      fetchCandles: vi.fn().mockResolvedValue([]),
      placeOrder: vi.fn(),
      cancelOrder: vi.fn(),
      fetchBalance: vi.fn().mockResolvedValue({ total: 0, free: 0, totalEquity: 0 }),
      closePosition: vi.fn(),
    };
    const paper = createPaperAdapter(realAdapter, 10_000);

    // Entry: buy $100 at price 100 → 1 unit.
    await paper.placeOrder({ symbol: 'SOL/USDT', side: 'buy', amount: 100, type: 'market', marketType: 'spot' });
    const balAfterBuy = await paper.fetchBalance();
    expect(balAfterBuy.total).toBe(9900);

    // Price rises to 120 — unrealized PnL is now (120-100)*1 = $20.
    currentPrice = 120;

    // Orchestrator's killSwitch reads positions from the db and calls
    // exchange.closePosition for each. Seed the mock db with our position.
    const db = mockDb();
    db.getOpenPositions = vi.fn().mockReturnValue([
      { id: 'pos-profit', symbol: 'SOL/USDT', side: 'buy', quantity: 1, marketType: 'spot',
        entryPrice: 100, amount: 100, currentPrice: 120, pnl: 20, pnlPct: 20,
        strategy: 'rsi', mode: 'paper', stopLoss: null, openedAt: Date.now(),
        userId: 0, testnet: false, exchange: '' },
    ]);

    const orch = createOrchestrator(paper, db, mockBroadcaster(), testConfig);
    orch.start();
    await orch.killSwitch('user');

    // After close the paper cash should be exactly:
    //   pre-close cash (9,900) + quantity × currentPrice (1 × 120) = 10,020
    // which equals initial balance ($10,000) + realized profit ($20).
    const balAfterClose = await paper.fetchBalance();
    expect(balAfterClose.total).toBe(10_020);
    expect(balAfterClose.totalEquity).toBe(10_020);
    expect(db.removePosition).toHaveBeenCalledWith(0, 'pos-profit');
  });

  it('kill switch in paper mode across multiple profitable positions realizes sum of P&L', async () => {
    // User's scenario: multiple open positions with total unrealized P&L of $200.
    // After killSwitch the cash should be (pre-close cash + locked amounts + $200).
    let solPrice = 120;
    let btcPrice = 55_000;
    const realAdapter: ExchangeAdapter = {
      name: 'mock',
      fetchSymbols: vi.fn().mockResolvedValue([]),
      fetchTicker: vi.fn().mockImplementation(async (symbol: string) => {
        const last = symbol === 'SOL/USDT' ? solPrice : btcPrice;
        return { symbol, last, bid: last, ask: last, volume24h: 0, timestamp: Date.now() };
      }),
      fetchCandles: vi.fn().mockResolvedValue([]),
      placeOrder: vi.fn(),
      cancelOrder: vi.fn(),
      fetchBalance: vi.fn().mockResolvedValue({ total: 0, free: 0, totalEquity: 0 }),
      closePosition: vi.fn(),
    };
    // Start: $3,000 paper balance.
    const paper = createPaperAdapter(realAdapter, 3_000);

    // Two buys that lock up $1,600 of cash.
    solPrice = 100; btcPrice = 50_000;
    await paper.placeOrder({ symbol: 'SOL/USDT', side: 'buy', amount: 1_000, type: 'market', marketType: 'spot' });
    await paper.placeOrder({ symbol: 'BTC/USDT', side: 'buy', amount: 600, type: 'market', marketType: 'spot' });
    const balBefore = await paper.fetchBalance();
    expect(balBefore.total).toBe(1_400); // 3,000 - 1,000 - 600

    // Price moves: SOL up 12% → +$120, BTC up ~13.33% → +$80. Total +$200.
    solPrice = 112;
    btcPrice = 56_666.6667; // 600 * (56666.667/50000) ≈ 680 → +$80

    const db = mockDb();
    db.getOpenPositions = vi.fn().mockReturnValue([
      { id: 'sol', symbol: 'SOL/USDT', side: 'buy', quantity: 10, marketType: 'spot',
        entryPrice: 100, amount: 1_000, currentPrice: 112, pnl: 120, pnlPct: 12,
        strategy: 'rsi', mode: 'paper', stopLoss: null, openedAt: Date.now(),
        userId: 0, testnet: false, exchange: '' },
      { id: 'btc', symbol: 'BTC/USDT', side: 'buy', quantity: 0.012, marketType: 'spot',
        entryPrice: 50_000, amount: 600, currentPrice: 56_666.6667, pnl: 80, pnlPct: 13.33,
        strategy: 'rsi', mode: 'paper', stopLoss: null, openedAt: Date.now(),
        userId: 0, testnet: false, exchange: '' },
    ]);

    const orch = createOrchestrator(paper, db, mockBroadcaster(), testConfig);
    orch.start();
    await orch.killSwitch('user');

    // Cash should end at 1,400 (free) + 1,120 (SOL proceeds) + 680 (BTC proceeds) = 3,200
    // Which equals initial $3,000 + realized $200 profit.
    const balAfter = await paper.fetchBalance();
    expect(balAfter.total).toBeCloseTo(3_200, 2);
  });

  it('kill switch records a sell trade per closed position with realized PnL', async () => {
    const exchange = mockExchange();
    // Both closes succeed. SOL closes at 112 (entry 100) → +$120 PnL.
    // BTC closes at 56666.6667 (entry 50000) → +$80 PnL.
    exchange.closePosition = vi.fn()
      .mockResolvedValueOnce({ orderId: 'ord-sol', symbol: 'SOL/USDT', side: 'sell', price: 112, quantity: 10, status: 'filled' })
      .mockResolvedValueOnce({ orderId: 'ord-btc', symbol: 'BTC/USDT', side: 'sell', price: 56_666.6667, quantity: 0.012, status: 'filled' });
    const db = mockDb();
    db.getOpenPositions = vi.fn().mockReturnValue([
      { id: 'sol', symbol: 'SOL/USDT', side: 'buy', quantity: 10, marketType: 'spot',
        entryPrice: 100, amount: 1_000, currentPrice: 112, pnl: 120, pnlPct: 12,
        strategy: 'rsi', mode: 'paper', stopLoss: null, openedAt: Date.now(),
        userId: 0, testnet: false, exchange: '' },
      { id: 'btc', symbol: 'BTC/USDT', side: 'buy', quantity: 0.012, marketType: 'spot',
        entryPrice: 50_000, amount: 600, currentPrice: 56_666.6667, pnl: 80, pnlPct: 13.33,
        strategy: 'rsi', mode: 'paper', stopLoss: null, openedAt: Date.now(),
        userId: 0, testnet: false, exchange: '' },
    ]);
    const ws = mockBroadcaster();
    const orch = createOrchestrator(exchange, db, ws, testConfig);
    orch.start();
    await orch.killSwitch('user');

    expect(db.insertTrade).toHaveBeenCalledTimes(2);
    const trades = (db.insertTrade as any).mock.calls.map((c: any[]) => c[0]);
    const solTrade = trades.find((t: any) => t.symbol === 'SOL/USDT');
    const btcTrade = trades.find((t: any) => t.symbol === 'BTC/USDT');
    expect(solTrade.side).toBe('sell');
    expect(solTrade.pnl).toBeCloseTo(120, 4);
    expect(solTrade.price).toBe(112);
    expect(btcTrade.side).toBe('sell');
    expect(btcTrade.pnl).toBeCloseTo(80, 2);
    // Total realized P&L recorded == sum of all open P&L before killSwitch.
    const totalRealized = trades.reduce((s: number, t: any) => s + t.pnl, 0);
    expect(totalRealized).toBeCloseTo(200, 2);
  });

  it('kill switch records the trade BEFORE removing the position row (audit safety)', async () => {
    const exchange = mockExchange();
    exchange.closePosition = vi.fn().mockResolvedValue({
      orderId: 'ord-ks', symbol: 'SOL/USDT', side: 'sell', price: 112, quantity: 10, status: 'filled',
    });
    const db = mockDb();
    db.getOpenPositions = vi.fn().mockReturnValue([
      { id: 'pos-audit', symbol: 'SOL/USDT', side: 'buy', quantity: 10, marketType: 'spot',
        entryPrice: 100, amount: 1_000, currentPrice: 112, pnl: 120, pnlPct: 12,
        strategy: 'rsi', mode: 'paper', stopLoss: null, openedAt: Date.now(),
        userId: 0, testnet: false, exchange: '' },
    ]);
    const callOrder: string[] = [];
    db.insertTrade = vi.fn().mockImplementation(() => { callOrder.push('insertTrade'); });
    db.removePosition = vi.fn().mockImplementation(() => { callOrder.push('removePosition'); });
    const orch = createOrchestrator(exchange, db, mockBroadcaster(), testConfig);
    orch.start();
    await orch.killSwitch('user');
    expect(callOrder).toEqual(['insertTrade', 'removePosition']);
  });

  it('kill switch broadcasts a trade:executed event for each successful close', async () => {
    const exchange = mockExchange();
    exchange.closePosition = vi.fn().mockResolvedValue({
      orderId: 'ord-ws', symbol: 'SOL/USDT', side: 'sell', price: 112, quantity: 10, status: 'filled',
    });
    const db = mockDb();
    db.getOpenPositions = vi.fn().mockReturnValue([
      { id: 'pos-ws', symbol: 'SOL/USDT', side: 'buy', quantity: 10, marketType: 'spot',
        entryPrice: 100, amount: 1_000, currentPrice: 112, pnl: 120, pnlPct: 12,
        strategy: 'rsi', mode: 'paper', stopLoss: null, openedAt: Date.now(),
        userId: 0, testnet: false, exchange: '' },
    ]);
    const ws = mockBroadcaster();
    const orch = createOrchestrator(exchange, db, ws, testConfig);
    orch.start();
    await orch.killSwitch('user');

    const tradeEvents = (ws.broadcast as any).mock.calls
      .map((c: any) => c[0])
      .filter((e: any) => e.type === 'trade:executed');
    expect(tradeEvents).toHaveLength(1);
    expect(tradeEvents[0].data.symbol).toBe('SOL/USDT');
    expect(tradeEvents[0].data.pnl).toBeCloseTo(120);
  });

  it('kill switch inserts an estimated trade row when closePosition throws', async () => {
    const exchange = mockExchange();
    exchange.closePosition = vi.fn().mockRejectedValue(new Error('exchange down'));
    const db = mockDb();
    db.getOpenPositions = vi.fn().mockReturnValue([
      { id: 'pos-fail', symbol: 'SOL/USDT', side: 'buy', quantity: 10, marketType: 'spot',
        entryPrice: 100, amount: 1_000, currentPrice: 112, pnl: 120, pnlPct: 12,
        strategy: 'rsi', mode: 'paper', stopLoss: null, openedAt: Date.now(),
        userId: 0, testnet: false, exchange: '' },
    ]);
    const orch = createOrchestrator(exchange, db, mockBroadcaster(), testConfig);
    orch.start();
    await orch.killSwitch('user');

    // Audit row written with currentPrice as estimated exit price.
    expect(db.insertTrade).toHaveBeenCalledTimes(1);
    const trade = (db.insertTrade as any).mock.calls[0][0];
    expect(trade.price).toBe(112);
    expect(trade.closeReason).toBe('user');
    // The local row is still wiped (killSwitch's "get me out now" contract).
    expect(db.removePosition).toHaveBeenCalledWith(0, 'pos-fail');
  });

  it('kill switch continues closing other positions if one fails', async () => {
    const exchange = mockExchange();
    exchange.closePosition = vi.fn()
      .mockRejectedValueOnce(new Error('exchange error'))
      .mockResolvedValue({ orderId: 'ord', symbol: 'ETH/USDT', side: 'sell', price: 3000, quantity: 0.01, status: 'filled' });
    const db = mockDb();
    db.getOpenPositions = vi.fn().mockReturnValue([
      { id: 'pos-1', symbol: 'BTC/USDT', side: 'buy', quantity: 0.001, marketType: 'spot', entryPrice: 49000, amount: 49, currentPrice: 50000, pnl: 1, pnlPct: 2, strategy: 'rsi', stopLoss: null, openedAt: Date.now() },
      { id: 'pos-2', symbol: 'ETH/USDT', side: 'buy', quantity: 0.01, marketType: 'spot', entryPrice: 3000, amount: 30, currentPrice: 3100, pnl: 1, pnlPct: 3, strategy: 'rsi', stopLoss: null, openedAt: Date.now() },
    ]);
    const ws = mockBroadcaster();
    const orch = createOrchestrator(exchange, db, ws, testConfig);
    orch.start();
    await orch.killSwitch('user');
    expect(exchange.closePosition).toHaveBeenCalledTimes(2);
    expect(db.removePosition).toHaveBeenCalledTimes(2);
  });

  it('kill switch stops bot immediately before closing positions', async () => {
    const statusDuringClose: string[] = [];
    const exchange = mockExchange();
    exchange.closePosition = vi.fn().mockImplementation(async () => {
      // Record status while closing positions
      statusDuringClose.push(orch.getStatus());
      return { orderId: 'ord-close', symbol: 'BTC/USDT', side: 'sell', price: 50000, quantity: 0.002, status: 'filled' };
    });
    const db = mockDb();
    db.getOpenPositions = vi.fn().mockReturnValue([
      { id: 'pos-1', symbol: 'BTC/USDT', side: 'buy', quantity: 0.002, marketType: 'spot', entryPrice: 49000, amount: 100, currentPrice: 50000, pnl: 2, pnlPct: 2, strategy: 'ma_crossover', stopLoss: 48000, openedAt: Date.now() },
    ]);
    const ws = mockBroadcaster();
    const orch = createOrchestrator(exchange, db, ws, testConfig);
    orch.start();
    expect(orch.getStatus()).toBe('running');
    await orch.killSwitch('user');
    // Bot should have been stopped BEFORE closePosition was called
    expect(statusDuringClose).toEqual(['stopped']);
  });

  it('triggers stop-loss when current price crosses the SL threshold', async () => {
    const exchange = mockExchange();
    // Ticker returns 47000 — below the position's SL at 48000.
    exchange.fetchTicker = vi.fn().mockResolvedValue({
      symbol: 'BTC/USDT', last: 47000, bid: 46999, ask: 47001, volume24h: 1000, timestamp: Date.now(),
    });
    exchange.closePosition = vi.fn().mockResolvedValue({
      orderId: 'ord-sl', symbol: 'BTC/USDT', side: 'sell', price: 47000, quantity: 0.002, status: 'filled',
    });
    const db = mockDb();
    db.getOpenPositions = vi.fn().mockReturnValue([
      { id: 'pos-sl', symbol: 'BTC/USDT', side: 'buy', quantity: 0.002, marketType: 'spot', entryPrice: 50000, amount: 100, currentPrice: 50000, pnl: 0, pnlPct: 0, strategy: 'ma_crossover', mode: 'paper', stopLoss: 48000, openedAt: Date.now(), userId: 0, testnet: false, exchange: '' },
    ]);
    const ws = mockBroadcaster();
    const orch = createOrchestrator(exchange, db, ws, testConfig);
    orch.start();
    await orch.tick();

    expect(exchange.closePosition).toHaveBeenCalledWith('BTC/USDT', 'buy', 0.002, 'spot');
    expect(db.removePosition).toHaveBeenCalledWith(0, 'pos-sl');
    expect(db.insertTrade).toHaveBeenCalled();
    const savedTrade = (db.insertTrade as any).mock.calls[0][0];
    expect(savedTrade.side).toBe('sell');
    expect(savedTrade.pnl).toBeCloseTo((47000 - 50000) * 0.002);
    // Alert event fires so the UI knows why the position was closed.
    const alertCalls = (ws.broadcast as any).mock.calls
      .map((c: any) => c[0])
      .filter((e: any) => e.type === 'alert' && String(e.data?.message ?? '').includes('Stop-loss'));
    expect(alertCalls.length).toBeGreaterThan(0);
  });

  it('records the stop-loss sell trade before removing the position row', async () => {
    // Regression: if insertTrade threw, the old code had already removed the
    // position — audit trail permanently lost. Verify insertTrade runs first.
    const exchange = mockExchange();
    exchange.fetchTicker = vi.fn().mockResolvedValue({
      symbol: 'BTC/USDT', last: 47000, bid: 46999, ask: 47001, volume24h: 1000, timestamp: Date.now(),
    });
    exchange.closePosition = vi.fn().mockResolvedValue({
      orderId: 'ord-sl', symbol: 'BTC/USDT', side: 'sell', price: 47000, quantity: 0.002, status: 'filled',
    });
    const db = mockDb();
    db.getOpenPositions = vi.fn().mockReturnValue([
      { id: 'pos-order', symbol: 'BTC/USDT', side: 'buy', quantity: 0.002, marketType: 'spot', entryPrice: 50000, amount: 100, currentPrice: 50000, pnl: 0, pnlPct: 0, strategy: 'ma_crossover', mode: 'paper', stopLoss: 48000, openedAt: Date.now(), userId: 0, testnet: false, exchange: '' },
    ]);
    const calls: string[] = [];
    db.insertTrade = vi.fn().mockImplementation(() => { calls.push('insertTrade'); });
    db.removePosition = vi.fn().mockImplementation(() => { calls.push('removePosition'); });
    const orch = createOrchestrator(exchange, db, mockBroadcaster(), testConfig);
    orch.start();
    await orch.tick();
    expect(calls).toEqual(['insertTrade', 'removePosition']);
  });

  it('stamps closeReason="bot" when stop-loss closes a position', async () => {
    const exchange = mockExchange();
    const db = mockDb();
    const ws = mockBroadcaster();

    // Preload one open position whose SL is above current price -> SL triggers
    (db.getOpenPositions as any).mockReturnValue([{
      id: 'pos1', symbol: 'BTC/USDT', side: 'buy',
      entryPrice: 50000, quantity: 0.002, amount: 100,
      currentPrice: 50000, pnl: 0, pnlPct: 0,
      strategy: 'ma_crossover', mode: 'paper', marketType: 'spot',
      stopLoss: 60000, openedAt: Date.now(), userId: 0,
      testnet: false, exchange: '',
    }]);
    // fetchTicker returns 50000 which is below stopLoss 60000 -> triggers SL
    (exchange.fetchTicker as any).mockResolvedValue({
      symbol: 'BTC/USDT', last: 50000, bid: 49999, ask: 50001, volume24h: 1000, timestamp: Date.now(),
    });

    const orch = createOrchestrator(exchange, db, ws, testConfig);
    orch.start();
    await orch.tick();

    const inserted = (db.insertTrade as any).mock.calls.map((c: any[]) => c[0]);
    const closeTrade = inserted.find((t: any) => t.side === 'sell');
    expect(closeTrade).toBeDefined();
    expect(closeTrade.closeReason).toBe('bot');
  });

  it('stop-loss cooldown prevents re-firing within 60 seconds after closePosition failure', async () => {
    const exchange = mockExchange();
    exchange.fetchTicker = vi.fn().mockResolvedValue({
      symbol: 'BTC/USDT', last: 47000, bid: 46999, ask: 47001, volume24h: 1000, timestamp: Date.now(),
    });
    // First close attempt fails with a 429-like error.
    exchange.closePosition = vi.fn().mockRejectedValue(new Error('429 rate limited'));
    const db = mockDb();
    db.getOpenPositions = vi.fn().mockReturnValue([
      { id: 'pos-retry', symbol: 'BTC/USDT', side: 'buy', quantity: 0.002, marketType: 'spot', entryPrice: 50000, amount: 100, currentPrice: 50000, pnl: 0, pnlPct: 0, strategy: 'ma_crossover', mode: 'paper', stopLoss: 48000, openedAt: Date.now(), userId: 0, testnet: false, exchange: '' },
    ]);
    const orch = createOrchestrator(exchange, db, mockBroadcaster(), testConfig);
    orch.start();
    await orch.tick();
    expect(exchange.closePosition).toHaveBeenCalledTimes(1);
    // Second tick immediately after: the cooldown window should block a retry.
    await orch.tick();
    expect(exchange.closePosition).toHaveBeenCalledTimes(1);
  });

  it('does not trigger stop-loss when current price is above SL', async () => {
    const exchange = mockExchange();
    exchange.fetchTicker = vi.fn().mockResolvedValue({
      symbol: 'BTC/USDT', last: 49000, bid: 48999, ask: 49001, volume24h: 1000, timestamp: Date.now(),
    });
    const db = mockDb();
    db.getOpenPositions = vi.fn().mockReturnValue([
      { id: 'pos-ok', symbol: 'BTC/USDT', side: 'buy', quantity: 0.002, marketType: 'spot', entryPrice: 50000, amount: 100, currentPrice: 50000, pnl: 0, pnlPct: 0, strategy: 'ma_crossover', mode: 'paper', stopLoss: 48000, openedAt: Date.now(), userId: 0, testnet: false, exchange: '' },
    ]);
    const orch = createOrchestrator(exchange, db, mockBroadcaster(), testConfig);
    orch.start();
    await orch.tick();
    expect(exchange.closePosition).not.toHaveBeenCalled();
    expect(db.removePosition).not.toHaveBeenCalled();
  });

  it('risk manager rejects buy when tradeAmount exceeds free USDT', async () => {
    const exchange = mockExchange();
    exchange.fetchBalance = vi.fn().mockResolvedValue({ total: 50, free: 50, totalEquity: 50 });
    const db = mockDb();
    const orch = createOrchestrator(exchange, db, mockBroadcaster(), { ...testConfig, tradeAmount: 100 });
    orch.start();
    await orch.tick();
    // Signal may or may not have fired, but even if it did, placeOrder must
    // not be called because the risk manager sees 100 > 50.
    expect(exchange.placeOrder).not.toHaveBeenCalled();
  });

  it('writes a daily equity snapshot after each successful tick', async () => {
    const exchange = mockExchange();
    // Override fetchBalance with a specific totalEquity to assert on
    (exchange.fetchBalance as any).mockResolvedValue({ total: 100, free: 50, totalEquity: 123.45 });
    const db = mockDb();
    const orch = createOrchestrator(exchange, db, mockBroadcaster(), testConfig, 42);
    orch.start();
    await orch.tick();
    expect(db.upsertDailyEquitySnapshot).toHaveBeenCalledWith(42, 123.45);
  });

  it('does not write a snapshot when fetchBalance throws', async () => {
    const exchange = mockExchange();
    (exchange.fetchBalance as any).mockRejectedValue(new Error('network'));
    const db = mockDb();
    const orch = createOrchestrator(exchange, db, mockBroadcaster(), testConfig, 42);
    orch.start();
    await orch.tick();
    expect(db.upsertDailyEquitySnapshot).not.toHaveBeenCalled();
  });

  it('stamps closeReason="bot" when a strategy sell signal closes an open position', async () => {
    const exchange = mockExchange();
    const db = mockDb();
    const ws = mockBroadcaster();

    // Open position that the sell signal will close.
    (db.getOpenPositions as any).mockReturnValue([{
      id: 'pos1', symbol: 'BTC/USDT', side: 'buy',
      entryPrice: 49000, quantity: 0.002, amount: 100,
      currentPrice: 50000, pnl: 0, pnlPct: 0,
      strategy: 'ma_crossover', mode: 'paper', marketType: 'spot',
      stopLoss: null, openedAt: Date.now(), userId: 0,
      testnet: false, exchange: '',
    }]);

    // Craft candles that deterministically produce a bearish MA crossover.
    // With shortPeriod=10, longPeriod=20: 25 bars at 100, then 1 bar at 10.
    // At bar 25: shortMA=100, longMA=100 (equal, so prevShort >= prevLong holds).
    // At bar 26: shortMA=(9*100+10)/10=91, longMA=(19*100+10)/20=95.5 → short < long.
    // This is exactly one tick of bearish crossover at the tip.
    const cfg: BotConfig = {
      ...testConfig,
      strategies: [{ id: 'ma_crossover', name: 'MA', enabled: true, params: { shortPeriod: 10, longPeriod: 20 }, interval: '5m', marketType: 'spot' }],
    };
    (exchange.placeOrder as any).mockResolvedValue({
      orderId: 'ord-sell', symbol: 'BTC/USDT', side: 'sell', price: 100, quantity: 0.002, status: 'filled',
    });
    (exchange.fetchCandles as any).mockResolvedValue([
      ...Array.from({ length: 25 }, (_, i) => ({
        timestamp: Date.now() - (26 - i) * 60000,
        open: 100, high: 101, low: 99, close: 100, volume: 1000,
      })),
      { timestamp: Date.now() - 60000, open: 10, high: 11, low: 9, close: 10, volume: 1000 },
    ]);

    const orch = createOrchestrator(exchange, db, ws, cfg);
    orch.start();
    await orch.tick();

    const inserted = (db.insertTrade as any).mock.calls.map((c: any[]) => c[0]);
    const closeTrade = inserted.find((t: any) => t.side === 'sell');
    expect(closeTrade).toBeDefined();
    expect(closeTrade.closeReason).toBe('bot');
  });

  it('kill switch does not execute ticks while closing positions', async () => {
    const exchange = mockExchange();
    exchange.closePosition = vi.fn().mockImplementation(async () => {
      // Try to tick during kill — should be ignored since status is stopped
      await orch.tick();
      return { orderId: 'ord-close', symbol: 'BTC/USDT', side: 'sell', price: 50000, quantity: 0.002, status: 'filled' };
    });
    const db = mockDb();
    db.getOpenPositions = vi.fn().mockReturnValue([
      { id: 'pos-1', symbol: 'BTC/USDT', side: 'buy', quantity: 0.002, marketType: 'spot', entryPrice: 49000, amount: 100, currentPrice: 50000, pnl: 2, pnlPct: 2, strategy: 'ma_crossover', stopLoss: 48000, openedAt: Date.now() },
    ]);
    const ws = mockBroadcaster();
    const orch = createOrchestrator(exchange, db, ws, testConfig);
    orch.start();
    await orch.killSwitch('user');
    // fetchCandles should NOT have been called during kill (tick was rejected)
    expect(exchange.fetchCandles).not.toHaveBeenCalled();
  });

  it('killSwitch("user") stamps closeReason="user" on all closed trades', async () => {
    const exchange = mockExchange();
    const db = mockDb();
    const ws = mockBroadcaster();

    (db.getOpenPositions as any).mockReturnValue([
      { id: 'p1', symbol: 'BTC/USDT', side: 'buy', entryPrice: 50000, quantity: 0.002, amount: 100, currentPrice: 51000, pnl: 2, pnlPct: 2, strategy: 'x', mode: 'paper', marketType: 'spot', stopLoss: null, openedAt: Date.now(), userId: 0, testnet: false, exchange: '' },
      { id: 'p2', symbol: 'ETH/USDT', side: 'buy', entryPrice: 3000, quantity: 0.1, amount: 300, currentPrice: 3100, pnl: 10, pnlPct: 3.3, strategy: 'x', mode: 'paper', marketType: 'spot', stopLoss: null, openedAt: Date.now(), userId: 0, testnet: false, exchange: '' },
    ]);

    const orch = createOrchestrator(exchange, db, ws, testConfig);
    orch.start();
    await orch.killSwitch('user');

    const inserted = (db.insertTrade as any).mock.calls.map((c: any[]) => c[0]);
    expect(inserted).toHaveLength(2);
    for (const t of inserted) expect(t.closeReason).toBe('user');
  });

  it('killSwitch("admin") stamps closeReason="admin"', async () => {
    const exchange = mockExchange();
    const db = mockDb();
    const ws = mockBroadcaster();
    (db.getOpenPositions as any).mockReturnValue([
      { id: 'p1', symbol: 'BTC/USDT', side: 'buy', entryPrice: 50000, quantity: 0.002, amount: 100, currentPrice: 51000, pnl: 2, pnlPct: 2, strategy: 'x', mode: 'paper', marketType: 'spot', stopLoss: null, openedAt: Date.now(), userId: 0, testnet: false, exchange: '' },
    ]);
    const orch = createOrchestrator(exchange, db, ws, testConfig);
    orch.start();
    await orch.killSwitch('admin');
    const inserted = (db.insertTrade as any).mock.calls.map((c: any[]) => c[0]);
    expect(inserted[0].closeReason).toBe('admin');
  });

  it('closePositionManually closes one position and stamps closeReason="user"', async () => {
    const exchange = mockExchange();
    const db = mockDb();
    const ws = mockBroadcaster();

    const pos = {
      id: 'pm1', symbol: 'BTC/USDT', side: 'buy' as const,
      entryPrice: 50000, quantity: 0.002, amount: 100,
      currentPrice: 51000, pnl: 2, pnlPct: 2,
      strategy: 'x', mode: 'paper' as const, marketType: 'spot' as const,
      stopLoss: null, openedAt: Date.now(), userId: 0,
      testnet: false, exchange: '',
    };
    (db.getOpenPositions as any).mockReturnValue([pos]);
    (exchange.closePosition as any).mockResolvedValue({
      orderId: 'ord-manual', symbol: 'BTC/USDT', side: 'sell', price: 51500, quantity: 0.002, status: 'filled',
    });

    const orch = createOrchestrator(exchange, db, ws, testConfig);
    await orch.closePositionManually('pm1');

    expect(exchange.closePosition).toHaveBeenCalledWith('BTC/USDT', 'buy', 0.002, 'spot');
    const inserted = (db.insertTrade as any).mock.calls.map((c: any[]) => c[0]);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].closeReason).toBe('user');
    expect(inserted[0].price).toBe(51500);
    // Insert BEFORE remove ordering
    const insertOrder = (db.insertTrade as any).mock.invocationCallOrder[0];
    const removeOrder = (db.removePosition as any).mock.invocationCallOrder[0];
    expect(insertOrder).toBeLessThan(removeOrder);
  });

  it('closePositionManually throws when the position is not found', async () => {
    const exchange = mockExchange();
    const db = mockDb();
    const ws = mockBroadcaster();
    (db.getOpenPositions as any).mockReturnValue([]);
    const orch = createOrchestrator(exchange, db, ws, testConfig);
    await expect(orch.closePositionManually('nope')).rejects.toThrow(/not found/i);
  });

  it('closePositionManually broadcasts a critical alert and rethrows when exchange.closePosition fails', async () => {
    const exchange = mockExchange();
    const db = mockDb();
    const ws = mockBroadcaster();

    (db.getOpenPositions as any).mockReturnValue([{
      id: 'pm-fail', symbol: 'BTC/USDT', side: 'buy' as const,
      entryPrice: 50000, quantity: 0.002, amount: 100,
      currentPrice: 51000, pnl: 2, pnlPct: 2,
      strategy: 'x', mode: 'paper' as const, marketType: 'spot' as const,
      stopLoss: null, openedAt: Date.now(), userId: 0,
      testnet: false, exchange: '',
    }]);
    (exchange.closePosition as any).mockRejectedValue(new Error('exchange down'));

    const orch = createOrchestrator(exchange, db, ws, testConfig);
    await expect(orch.closePositionManually('pm-fail')).rejects.toThrow(/exchange down/);

    // No estimated trade row — different contract from killSwitch
    expect(db.insertTrade).not.toHaveBeenCalled();
    // Position stays open in the DB
    expect(db.removePosition).not.toHaveBeenCalled();
    // A critical alert must have been broadcast
    const alertCalls = (ws.broadcast as any).mock.calls
      .map((c: any) => c[0])
      .filter((e: any) => e.type === 'alert' && e.data?.severity === 'critical');
    expect(alertCalls.length).toBeGreaterThan(0);
  });

  it('closePositionManually rejects immediately if the same position is already being closed (race guard)', async () => {
    const exchange = mockExchange();
    const db = mockDb();
    const ws = mockBroadcaster();

    const pos = {
      id: 'pm1', symbol: 'BTC/USDT', side: 'buy' as const,
      entryPrice: 50000, quantity: 0.002, amount: 100,
      currentPrice: 51000, pnl: 2, pnlPct: 2,
      strategy: 'x', mode: 'paper' as const, marketType: 'spot' as const,
      stopLoss: null, openedAt: Date.now(), userId: 0,
      testnet: false, exchange: '',
    };
    (db.getOpenPositions as any).mockReturnValue([pos]);

    // Deferred promise — the first close will hang, letting us fire a second call
    let resolveFirst!: (v: any) => void;
    const firstClosePromise = new Promise((res) => { resolveFirst = res; });
    (exchange.closePosition as any).mockReturnValueOnce(firstClosePromise);

    const orch = createOrchestrator(exchange, db, ws, testConfig);

    // Start first call (does not await yet)
    const firstCall = orch.closePositionManually('pm1');
    // Second call for the same position should reject with the guard error
    await expect(orch.closePositionManually('pm1')).rejects.toThrow(/already closing/i);

    // Clean up — resolve the deferred so the test doesn't leak
    resolveFirst({ orderId: 'ord-ok', symbol: 'BTC/USDT', side: 'sell', price: 51000, quantity: 0.002, status: 'filled' });
    await firstCall;
  });
});

/**
 * Regression coverage for a paper-mode balance bug: a strategy firing a
 * `sell` signal on a symbol where no long is currently held was going all
 * the way through `exchange.placeOrder({side:'sell'})`. In the paper adapter
 * that credits cash unconditionally, so every spurious sell minted free
 * money. The fix: in the tick loop, reject sell signals that don't match
 * an open long BEFORE submitting the order.
 *
 * This also prevents a latent live-mode bug where the same bare sell would
 * submit a real non-reduceOnly order — on futures that would OPEN a short
 * position the bot never tracks.
 */
describe('Orchestrator — bare sell (no matching long)', () => {
  const STUB_ID = '__test_forced_sell__';
  const forcedSellStrategy: Strategy = {
    id: STUB_ID,
    name: 'Forced Sell (test)',
    analyze: (_candles, _params, symbol, marketType) => ({
      action: 'sell',
      confidence: 0.99,
      price: 50000,
      symbol,
      marketType,
      strategy: STUB_ID,
      reason: 'forced by test',
    }),
  };

  afterEach(() => {
    delete (strategies as Record<string, Strategy>)[STUB_ID];
  });

  function installStub() {
    (strategies as Record<string, Strategy>)[STUB_ID] = forcedSellStrategy;
  }

  function bareSellConfig(): BotConfig {
    return {
      ...testConfig,
      strategies: [{
        id: STUB_ID, name: 'Forced Sell', enabled: true, params: {},
        interval: '5m', marketType: 'spot',
      }],
    };
  }

  it('does NOT place an order when a sell signal has no matching long position', async () => {
    installStub();
    const realAdapter: ExchangeAdapter = {
      name: 'mock',
      fetchSymbols: vi.fn().mockResolvedValue(['BTC/USDT']),
      fetchTicker: vi.fn().mockResolvedValue({
        symbol: 'BTC/USDT', last: 50000, bid: 49999, ask: 50001, volume24h: 0, timestamp: Date.now(),
      }),
      fetchCandles: vi.fn().mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({
          timestamp: Date.now() - (30 - i) * 60000, open: 50000, high: 50000,
          low: 50000, close: 50000, volume: 1000,
        })),
      ),
      placeOrder: vi.fn(),
      cancelOrder: vi.fn(),
      fetchBalance: vi.fn(),
      closePosition: vi.fn(),
    };
    const paper = createPaperAdapter(realAdapter, 10_000);
    const placeOrderSpy = vi.spyOn(paper, 'placeOrder');

    const db = mockDb();
    // No open positions — the forced sell is a bare sell.
    db.getOpenPositions = vi.fn().mockReturnValue([]);
    const ws = mockBroadcaster();

    const orch = createOrchestrator(paper, db, ws, bareSellConfig());
    orch.start();
    await orch.tick();
    orch.stop();

    // No order should have been submitted — there was nothing to close.
    expect(placeOrderSpy).not.toHaveBeenCalled();
    expect(db.insertTrade).not.toHaveBeenCalled();

    // Paper cash must be untouched.
    const bal = await paper.fetchBalance();
    expect(bal.total).toBe(10_000);
  });

  it('bare sells across 6 ticks do not inflate paper cash', async () => {
    installStub();
    const realAdapter: ExchangeAdapter = {
      name: 'mock',
      fetchSymbols: vi.fn().mockResolvedValue(['BTC/USDT']),
      fetchTicker: vi.fn().mockResolvedValue({
        symbol: 'BTC/USDT', last: 50000, bid: 49999, ask: 50001, volume24h: 0, timestamp: Date.now(),
      }),
      fetchCandles: vi.fn().mockResolvedValue(
        Array.from({ length: 30 }, (_, i) => ({
          timestamp: Date.now() - (30 - i) * 60000, open: 50000, high: 50000,
          low: 50000, close: 50000, volume: 1000,
        })),
      ),
      placeOrder: vi.fn(),
      cancelOrder: vi.fn(),
      fetchBalance: vi.fn(),
      closePosition: vi.fn(),
    };
    const paper = createPaperAdapter(realAdapter, 1_000);

    const db = mockDb();
    db.getOpenPositions = vi.fn().mockReturnValue([]);

    // tradeAmount 500 — mirrors the reported incident's numbers.
    const cfg: BotConfig = { ...bareSellConfig(), tradeAmount: 500 };
    const orch = createOrchestrator(paper, db, mockBroadcaster(), cfg);
    orch.start();
    for (let i = 0; i < 6; i++) await orch.tick();
    orch.stop();

    const bal = await paper.fetchBalance();
    // Previously this would have been 1000 + 6*500 = 4000. Post-fix it must
    // remain at 1000 — bare sells can't mint money.
    expect(bal.total).toBe(1_000);
  });
});
