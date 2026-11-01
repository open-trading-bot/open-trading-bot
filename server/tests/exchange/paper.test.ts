import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPaperAdapter } from '../../src/exchange/paper.js';
import type { ExchangeAdapter } from '../../src/exchange/types.js';
import { ERROR_MSG } from '../../src/utils/constants.js';

describe('Paper Trading Adapter', () => {
  let realAdapter: ExchangeAdapter;
  let paper: ExchangeAdapter;

  beforeEach(() => {
    realAdapter = {
      name: 'bybit',
      fetchTicker: vi.fn().mockResolvedValue({
        symbol: 'BTC/USDT', last: 50000, bid: 49999, ask: 50001, volume24h: 1000, timestamp: Date.now(),
      }),
      fetchCandles: vi.fn().mockResolvedValue([]),
      placeOrder: vi.fn(),
      cancelOrder: vi.fn(),
      fetchBalance: vi.fn(),
      closePosition: vi.fn(),
    };
    paper = createPaperAdapter(realAdapter, 10000);
  });

  it('uses real market data for tickers', async () => {
    const ticker = await paper.fetchTicker('BTC/USDT');
    expect(ticker.last).toBe(50000);
    expect(realAdapter.fetchTicker).toHaveBeenCalledWith('BTC/USDT');
  });

  it('simulates orders without hitting the exchange', async () => {
    const result = await paper.placeOrder({
      symbol: 'BTC/USDT', side: 'buy', amount: 100, type: 'market', marketType: 'spot',
    });
    expect(result.orderId).toMatch(/^paper-/);
    expect(result.status).toBe('filled');
    expect(realAdapter.placeOrder).not.toHaveBeenCalled();
  });

  it('tracks virtual balance', async () => {
    const before = await paper.fetchBalance();
    expect(before.total).toBe(10000);
    await paper.placeOrder({
      symbol: 'BTC/USDT', side: 'buy', amount: 100, type: 'market', marketType: 'spot',
    });
    const after = await paper.fetchBalance();
    expect(after.free).toBe(9900);
  });

  it('reports totalEquity equal to total since paper only simulates USDT', async () => {
    const balance = await paper.fetchBalance();
    expect(balance.totalEquity).toBe(balance.total);
    expect(balance.totalEquity).toBe(10000);
  });

  it('delegates candle fetching to real adapter', async () => {
    await paper.fetchCandles('BTC/USDT', '1h', 50);
    expect(realAdapter.fetchCandles).toHaveBeenCalledWith('BTC/USDT', '1h', 50);
  });

  it('mutates totalEquity and free in lockstep as trades execute', async () => {
    await paper.placeOrder({
      symbol: 'BTC/USDT', side: 'buy', amount: 100, type: 'market', marketType: 'spot',
    });
    const after = await paper.fetchBalance();
    expect(after.total).toBe(9900);
    expect(after.free).toBe(9900);
    expect(after.totalEquity).toBe(9900);

    await paper.placeOrder({
      symbol: 'BTC/USDT', side: 'sell', amount: 110, type: 'market', marketType: 'spot',
    });
    const after2 = await paper.fetchBalance();
    expect(after2.total).toBe(10010);
    expect(after2.free).toBe(10010);
    expect(after2.totalEquity).toBe(10010);
  });

  it('closing a short via closePosition debits cash (buy-back), not credits it', async () => {
    // Open a short: sell $500 notional at 50000 → cash 10000 + 500 = 10500, qty 0.01
    await paper.placeOrder({
      symbol: 'BTC/USDT', side: 'sell', amount: 500, type: 'market', marketType: 'futures',
    });
    const mid = await paper.fetchBalance();
    expect(mid.total).toBe(10500);

    // Close the short at the same price. Round-trip should return cash to the
    // original 10000 — closing a short must BUY BACK (debit), not credit again.
    await paper.closePosition('BTC/USDT', 'sell', 0.01, 'futures');
    const after = await paper.fetchBalance();
    expect(after.total).toBe(10000);
  });

  it('closing a long via closePosition credits cash at market', async () => {
    // Open a long: buy $500 at 50000 → cash 9500, qty 0.01
    await paper.placeOrder({
      symbol: 'BTC/USDT', side: 'buy', amount: 500, type: 'market', marketType: 'spot',
    });
    const mid = await paper.fetchBalance();
    expect(mid.total).toBe(9500);

    // Close the long at the same price → proceeds 0.01 * 50000 = 500 → back to 10000
    await paper.closePosition('BTC/USDT', 'buy', 0.01, 'spot');
    const after = await paper.fetchBalance();
    expect(after.total).toBe(10000);
  });

  it('free never drifts negative after back-to-back opens and closes', async () => {
    for (let i = 0; i < 50; i++) {
      await paper.placeOrder({
        symbol: 'BTC/USDT', side: 'buy', amount: 100, type: 'market', marketType: 'spot',
      });
      await paper.placeOrder({
        symbol: 'BTC/USDT', side: 'sell', amount: 100, type: 'market', marketType: 'spot',
      });
    }
    const after = await paper.fetchBalance();
    expect(after.free).toBeGreaterThanOrEqual(0);
    expect(after.total).toBe(10000);
  });

  it('calls onCashChange after every buy/sell/close so bot-manager can persist', async () => {
    const cashLog: number[] = [];
    const withCallback = createPaperAdapter(realAdapter, 1_000, {
      onCashChange: (c) => cashLog.push(c),
    });

    await withCallback.placeOrder({ symbol: 'BTC/USDT', side: 'buy', amount: 200, type: 'market', marketType: 'spot' });
    await withCallback.placeOrder({ symbol: 'BTC/USDT', side: 'sell', amount: 50, type: 'market', marketType: 'futures' });
    await withCallback.closePosition('BTC/USDT', 'buy', 0.004, 'spot');

    expect(cashLog).toEqual([
      800, // 1000 - 200 (buy debit)
      850, // 800 + 50  (sell credit)
      1050, // 850 + 0.004 * 50000 (close long at market → credit 200)
    ]);
  });

  it('reconstructs cash across a pod restart when seeded with the last persisted value', async () => {
    // Pod A: bot opens a $200 long. In the real system this callback
    // writes `cash` back to users.paper_balance via db.updateUser.
    let persisted = 1_000;
    const podA = createPaperAdapter(realAdapter, persisted, {
      onCashChange: (c) => { persisted = c; },
    });
    await podA.placeOrder({ symbol: 'BTC/USDT', side: 'buy', amount: 200, type: 'market', marketType: 'spot' });
    expect((await podA.fetchBalance()).total).toBe(800);
    expect(persisted).toBe(800);

    // Pod B: deploy kills pod A. A fresh adapter is created seeded
    // from the persisted value (what getOrCreateBot will do via
    // db.getUserById(id).paperBalance). Cash must pick up at 800,
    // NOT reset to the admin-set 1000, otherwise the bot mints
    // phantom money on every restart.
    const podB = createPaperAdapter(realAdapter, persisted, {
      onCashChange: (c) => { persisted = c; },
    });
    expect((await podB.fetchBalance()).total).toBe(800);
  });

  it('refuses a buy whose amount would drive cash negative', async () => {
    const small = createPaperAdapter(realAdapter, 50);
    await expect(small.placeOrder({
      symbol: 'BTC/USDT', side: 'buy', amount: 100, type: 'market', marketType: 'spot',
    })).rejects.toThrow(ERROR_MSG.INSUFFICIENT_PAPER_CASH);
    const bal = await small.fetchBalance();
    expect(bal.total).toBe(50);
  });

  it('includes open-position mark-to-market in totalEquity when getPositionsValue is provided', async () => {
    // The paper adapter currently reports cash==total==free==totalEquity.
    // For paper mode that's wrong: when a $200 long is open, cash is
    // 800 but the user's actual equity is still 1000 (cash + market
    // value of the position). Let the bot-manager inject a positions
    // mark-to-market accessor so the dashboard doesn't look like $200
    // evaporated the moment a position opens.
    const withMtm = createPaperAdapter(realAdapter, 1_000, {
      getPositionsValue: () => 200, // simulate $200 worth of open longs at current price
    });
    await withMtm.placeOrder({ symbol: 'BTC/USDT', side: 'buy', amount: 200, type: 'market', marketType: 'spot' });

    const bal = await withMtm.fetchBalance();
    expect(bal.total).toBe(800);        // cash-only
    expect(bal.free).toBe(800);         // cash-only
    expect(bal.totalEquity).toBe(1_000); // cash + open positions MtM
  });
});
