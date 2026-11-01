import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBybitAdapter } from '../../src/exchange/bybit.js';
import { clearSymbolsCache } from '../../src/exchange/symbols-cache.js';

const mockExchange: any = {
  fetchTicker: vi.fn(),
  fetchOHLCV: vi.fn(),
  createOrder: vi.fn(),
  fetchOrder: vi.fn(),
  cancelOrder: vi.fn(),
  fetchBalance: vi.fn(),
  privateGetV5UserQueryApi: vi.fn(),
  loadMarkets: vi.fn().mockResolvedValue({}),
  amountToPrecision: vi.fn((_symbol: string, qty: number) => String(qty)),
  markets: {},
};

vi.mock('ccxt', () => ({
  pro: {
    bybit: class {
      sandbox = false;
      setSandboxMode() {}
      constructor() {
        Object.assign(mockExchange, { setSandboxMode: vi.fn() });
        return mockExchange;
      }
    },
  },
}));

describe('Bybit Adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSymbolsCache();
    mockExchange.markets = {};
  });

  it('enables sandbox mode when testnet is true', () => {
    createBybitAdapter({ apiKey: 'test', secret: 'test', testnet: true });
    expect(mockExchange.setSandboxMode).toHaveBeenCalledWith(true);
  });

  it('does not enable sandbox mode when testnet is false', () => {
    createBybitAdapter({ apiKey: 'test', secret: 'test', testnet: false });
    expect(mockExchange.setSandboxMode).not.toHaveBeenCalled();
  });

  it('fetches and transforms ticker', async () => {
    mockExchange.fetchTicker.mockResolvedValue({
      symbol: 'BTC/USDT',
      last: 50000,
      bid: 49999,
      ask: 50001,
      baseVolume: 1234,
      timestamp: 1000,
    });

    const adapter = createBybitAdapter({ apiKey: 'test', secret: 'test', testnet: true });
    const ticker = await adapter.fetchTicker('BTC/USDT');

    expect(ticker.symbol).toBe('BTC/USDT');
    expect(ticker.last).toBe(50000);
    expect(ticker.bid).toBe(49999);
    expect(ticker.ask).toBe(50001);
  });

  it('fetches and transforms candles', async () => {
    mockExchange.fetchOHLCV.mockResolvedValue([
      [1000, 50000, 51000, 49000, 50500, 100],
    ]);

    const adapter = createBybitAdapter({ apiKey: 'test', secret: 'test', testnet: true });
    const candles = await adapter.fetchCandles('BTC/USDT', '1h', 1);

    expect(candles).toHaveLength(1);
    expect(candles[0]).toEqual({
      timestamp: 1000,
      open: 50000,
      high: 51000,
      low: 49000,
      close: 50500,
      volume: 100,
    });
  });

  it('places order and returns result', async () => {
    mockExchange.createOrder.mockResolvedValue({
      id: 'ord-123',
      symbol: 'BTC/USDT',
      side: 'buy',
      price: 50000,
      filled: 0.002,
      status: 'closed',
    });
    mockExchange.fetchTicker.mockResolvedValue({
      symbol: 'BTC/USDT', last: 50000, bid: 49999, ask: 50001, baseVolume: 0, timestamp: 0,
    });

    const adapter = createBybitAdapter({ apiKey: 'test', secret: 'test', testnet: true });
    const result = await adapter.placeOrder({
      symbol: 'BTC/USDT',
      side: 'buy',
      amount: 100,
      type: 'market',
      marketType: 'spot',
    });

    expect(result.orderId).toBe('ord-123');
    expect(result.status).toBe('filled');
  });

  describe('placeOrder quote→base conversion', () => {
    it('market order: converts quote USDT amount to base quantity using ticker.last', async () => {
      mockExchange.fetchTicker.mockResolvedValue({
        symbol: 'SOL/USDT', last: 150, bid: 149.9, ask: 150.1, baseVolume: 0, timestamp: 0,
      });
      mockExchange.createOrder.mockResolvedValue({
        id: 'ord-1', symbol: 'SOL/USDT', side: 'sell', price: 150, filled: 6.6667, status: 'closed',
      });

      const adapter = createBybitAdapter({ apiKey: 'k', secret: 's', testnet: false });
      await adapter.placeOrder({
        symbol: 'SOL/USDT',
        side: 'sell',
        amount: 1000, // 1000 USDT of SOL
        type: 'market',
        marketType: 'spot',
      });

      // Regression: old bug divided amount by 1 for market orders, sending
      // 1000 SOL (~$150k) instead of 1000/150 ≈ 6.67 SOL.
      expect(mockExchange.fetchTicker).toHaveBeenCalledWith('SOL/USDT');
      const [symbol, type, side, quantity, price] = mockExchange.createOrder.mock.calls[0];
      expect(symbol).toBe('SOL/USDT');
      expect(type).toBe('market');
      expect(side).toBe('sell');
      expect(quantity).toBeCloseTo(1000 / 150, 6);
      expect(price).toBeUndefined();
    });

    it('limit order: divides amount by explicit price (does not fetch ticker)', async () => {
      mockExchange.createOrder.mockResolvedValue({
        id: 'ord-2', symbol: 'BTC/USDT', side: 'buy', price: 40000, filled: 0.025, status: 'closed',
      });

      const adapter = createBybitAdapter({ apiKey: 'k', secret: 's', testnet: false });
      await adapter.placeOrder({
        symbol: 'BTC/USDT',
        side: 'buy',
        amount: 1000,
        price: 40000,
        type: 'limit',
        marketType: 'spot',
      });

      expect(mockExchange.fetchTicker).not.toHaveBeenCalled();
      const [, , , quantity, price] = mockExchange.createOrder.mock.calls[0];
      expect(quantity).toBeCloseTo(1000 / 40000, 10);
      expect(price).toBe(40000);
    });

    it('rounds computed base quantity to exchange precision (lot size)', async () => {
      // SOL/USDT spot on Bybit uses qtyStep ≈ 0.1, so 1000/150 = 6.6666…
      // must be rounded to 6.6 before submission or the order is rejected.
      mockExchange.fetchTicker.mockResolvedValue({
        symbol: 'SOL/USDT', last: 150, bid: 149.9, ask: 150.1, baseVolume: 0, timestamp: 0,
      });
      mockExchange.amountToPrecision.mockImplementation((_symbol: string, qty: number) => {
        // Simulate exchange rounding to 1 decimal place.
        return (Math.floor(qty * 10) / 10).toString();
      });
      mockExchange.createOrder.mockResolvedValue({
        id: 'ord-p', symbol: 'SOL/USDT', side: 'buy', price: 150, filled: 6.6, status: 'closed',
      });

      const adapter = createBybitAdapter({ apiKey: 'k', secret: 's', testnet: false });
      await adapter.placeOrder({
        symbol: 'SOL/USDT',
        side: 'buy',
        amount: 1000,
        type: 'market',
        marketType: 'spot',
      });

      expect(mockExchange.loadMarkets).toHaveBeenCalled();
      expect(mockExchange.amountToPrecision).toHaveBeenCalledWith('SOL/USDT', 1000 / 150);
      const quantityArg = mockExchange.createOrder.mock.calls[0][3];
      // Accept number or numeric string; must equal the rounded value, not the raw 6.66…
      expect(Number(quantityArg)).toBeCloseTo(6.6, 10);
      expect(Number(quantityArg)).not.toBeCloseTo(1000 / 150, 6);
    });

    it('futures market order: passes linear category option', async () => {
      mockExchange.fetchTicker.mockResolvedValue({
        symbol: 'SOL/USDT', last: 150, bid: 149.9, ask: 150.1, baseVolume: 0, timestamp: 0,
      });
      mockExchange.createOrder.mockResolvedValue({
        id: 'ord-3', symbol: 'SOL/USDT', side: 'buy', price: 150, filled: 6.6667, status: 'closed',
      });

      const adapter = createBybitAdapter({ apiKey: 'k', secret: 's', testnet: false });
      await adapter.placeOrder({
        symbol: 'SOL/USDT',
        side: 'buy',
        amount: 1000,
        type: 'market',
        marketType: 'futures',
      });

      const opts = mockExchange.createOrder.mock.calls[0][5];
      expect(opts).toEqual({ category: 'linear' });
    });
  });

  describe('placeOrder reconciles fire-and-acknowledge responses', () => {
    // Bybit v5 market orders return only { orderId } from createOrder —
    // status and fill info must be fetched via fetchOrder afterwards.

    it('passes acknowledged + category params to fetchOrder (ccxt requires them)', async () => {
      // ccxt's bybit adapter refuses fetchOrder without params.acknowledged=true,
      // and Bybit v5 needs category to route spot vs linear lookups.
      mockExchange.fetchTicker.mockResolvedValue({
        symbol: 'SOL/USDT', last: 150, bid: 149.9, ask: 150.1, baseVolume: 0, timestamp: 0,
      });
      mockExchange.createOrder.mockResolvedValue({
        id: 'ord-ack', symbol: 'SOL/USDT', side: 'buy', status: undefined, filled: 0,
        info: { orderId: 'ord-ack' },
      });
      mockExchange.fetchOrder.mockResolvedValue({
        id: 'ord-ack', symbol: 'SOL/USDT', side: 'buy', status: 'closed',
        filled: 8.5, price: 0, average: 150.2,
      });

      const adapter = createBybitAdapter({ apiKey: 'k', secret: 's', testnet: false });
      await adapter.placeOrder({
        symbol: 'SOL/USDT', side: 'buy', amount: 1000, type: 'market', marketType: 'spot',
      });

      expect(mockExchange.fetchOrder).toHaveBeenCalledWith(
        'ord-ack',
        'SOL/USDT',
        expect.objectContaining({ acknowledged: true, category: 'spot' }),
      );
    });

    it('passes category=linear to fetchOrder for futures', async () => {
      mockExchange.fetchTicker.mockResolvedValue({
        symbol: 'SOL/USDT', last: 150, bid: 149.9, ask: 150.1, baseVolume: 0, timestamp: 0,
      });
      mockExchange.createOrder.mockResolvedValue({
        id: 'ord-f', symbol: 'SOL/USDT', side: 'buy', status: undefined, filled: 0,
        info: { orderId: 'ord-f' },
      });
      mockExchange.fetchOrder.mockResolvedValue({
        id: 'ord-f', symbol: 'SOL/USDT', side: 'buy', status: 'closed',
        filled: 8.5, average: 150.2,
      });

      const adapter = createBybitAdapter({ apiKey: 'k', secret: 's', testnet: false });
      await adapter.placeOrder({
        symbol: 'SOL/USDT', side: 'buy', amount: 1000, type: 'market', marketType: 'futures',
      });

      expect(mockExchange.fetchOrder).toHaveBeenCalledWith(
        'ord-f',
        'SOL/USDT',
        expect.objectContaining({ acknowledged: true, category: 'linear' }),
      );
    });

    it('calls fetchOrder when createOrder returns undefined status + orderId', async () => {
      mockExchange.fetchTicker.mockResolvedValue({
        symbol: 'SOL/USDT', last: 150, bid: 149.9, ask: 150.1, baseVolume: 0, timestamp: 0,
      });
      mockExchange.createOrder.mockResolvedValue({
        id: '2191692719892826368',
        symbol: 'SOL/USDT',
        side: 'buy',
        status: undefined,
        filled: 0,
        info: { orderId: '2191692719892826368', orderLinkId: '2191692719892826369' },
      });
      mockExchange.fetchOrder.mockResolvedValue({
        id: '2191692719892826368',
        symbol: 'SOL/USDT',
        side: 'buy',
        status: 'closed',
        filled: 8.24,
        price: 0,
        average: 150.2,
        info: { orderStatus: 'Filled', cumExecQty: '8.24', avgPrice: '150.2' },
      });

      const adapter = createBybitAdapter({ apiKey: 'k', secret: 's', testnet: false });
      const result = await adapter.placeOrder({
        symbol: 'SOL/USDT',
        side: 'buy',
        amount: 1000,
        type: 'market',
        marketType: 'spot',
      });

      expect(mockExchange.fetchOrder).toHaveBeenCalledWith(
        '2191692719892826368',
        'SOL/USDT',
        expect.objectContaining({ acknowledged: true, category: 'spot' }),
      );
      expect(result.status).toBe('filled');
      expect(result.quantity).toBe(8.24);
      expect(result.price).toBe(150.2);
    });

    it('does not call fetchOrder when createOrder already reports filled', async () => {
      mockExchange.fetchTicker.mockResolvedValue({
        symbol: 'SOL/USDT', last: 150, bid: 149.9, ask: 150.1, baseVolume: 0, timestamp: 0,
      });
      mockExchange.createOrder.mockResolvedValue({
        id: 'ord-sync', symbol: 'SOL/USDT', side: 'buy', status: 'closed', filled: 6.6, price: 150,
      });

      const adapter = createBybitAdapter({ apiKey: 'k', secret: 's', testnet: false });
      await adapter.placeOrder({
        symbol: 'SOL/USDT', side: 'buy', amount: 1000, type: 'market', marketType: 'spot',
      });

      expect(mockExchange.fetchOrder).not.toHaveBeenCalled();
    });

  });

  describe('closePosition', () => {
    it('submits the exact base quantity (not quote USDT) directly to ccxt', async () => {
      mockExchange.createOrder.mockResolvedValue({
        id: 'ord-close', symbol: 'SOL/USDT', side: 'sell', price: 150, filled: 6.6667, status: 'closed',
      });

      const adapter = createBybitAdapter({ apiKey: 'k', secret: 's', testnet: false });
      await adapter.closePosition('SOL/USDT', 'buy', 6.6667, 'spot');

      // Must NOT fetch ticker — closePosition knows the quantity already.
      expect(mockExchange.fetchTicker).not.toHaveBeenCalled();
      const [symbol, , side, quantity, price] = mockExchange.createOrder.mock.calls[0];
      expect(symbol).toBe('SOL/USDT');
      expect(side).toBe('sell'); // opposite of original 'buy'
      expect(quantity).toBe(6.6667);
      expect(price).toBeUndefined();
    });

    it('sets reduceOnly=true for futures closes', async () => {
      mockExchange.createOrder.mockResolvedValue({
        id: 'ord-close-f', symbol: 'SOL/USDT', side: 'buy', price: 150, filled: 3, status: 'closed',
      });

      const adapter = createBybitAdapter({ apiKey: 'k', secret: 's', testnet: false });
      await adapter.closePosition('SOL/USDT', 'sell', 3, 'futures');

      const opts = mockExchange.createOrder.mock.calls[0][5];
      expect(opts).toEqual({ category: 'linear', reduceOnly: true });
      expect(mockExchange.createOrder.mock.calls[0][2]).toBe('buy'); // flipped from sell
    });

    it('returns the fill VWAP via average when price is 0 (market close)', async () => {
      // Regression: bybit market orders return price=0 with the real fill
      // VWAP under `average`. The old `price ?? average ?? 0` resolved to 0.
      mockExchange.createOrder.mockResolvedValue({
        id: 'ord-close-vwap', symbol: 'SOL/USDT', side: 'sell',
        price: 0, average: 150.25, filled: 6.6, status: 'closed',
      });

      const adapter = createBybitAdapter({ apiKey: 'k', secret: 's', testnet: false });
      const result = await adapter.closePosition('SOL/USDT', 'buy', 6.6, 'spot');

      expect(result.price).toBe(150.25);
    });
  });

  describe('fetchBalance', () => {
    it('reads totalEquity from Bybit v5 unified info.result.list[0]', async () => {
      mockExchange.fetchBalance.mockResolvedValue({
        total: { USDT: 1553.11 },
        free: { USDT: 1553.11 },
        info: { result: { list: [{ totalEquity: '9880.65' }] } },
      });

      const adapter = createBybitAdapter({ apiKey: 'k', secret: 's', testnet: false });
      const balance = await adapter.fetchBalance();

      expect(balance.total).toBe(1553.11);
      expect(balance.free).toBe(1553.11);
      expect(balance.totalEquity).toBe(9880.65);
    });

    it('falls back to USDT total when info.result.list is missing', async () => {
      mockExchange.fetchBalance.mockResolvedValue({
        total: { USDT: 500 },
        free: { USDT: 500 },
      });

      const adapter = createBybitAdapter({ apiKey: 'k', secret: 's', testnet: false });
      const balance = await adapter.fetchBalance();

      expect(balance.totalEquity).toBe(500);
    });

    it('falls back to USDT total when info.result.list[0].totalEquity is empty', async () => {
      mockExchange.fetchBalance.mockResolvedValue({
        total: { USDT: 200 },
        free: { USDT: 200 },
        info: { result: { list: [{ totalEquity: '' }] } },
      });

      const adapter = createBybitAdapter({ apiKey: 'k', secret: 's', testnet: false });
      const balance = await adapter.fetchBalance();

      expect(balance.totalEquity).toBe(200);
    });
  });

  describe('fetchPermissions', () => {
    it('reports readOnly=true when response readOnly flag is 1', async () => {
      mockExchange.privateGetV5UserQueryApi.mockResolvedValue({
        retCode: 0,
        result: {
          readOnly: 1,
          permissions: {
            ContractTrade: ['Order', 'Position'],
            Spot: ['SpotTrade'],
            Wallet: ['AccountTransfer'],
          },
        },
      });

      const adapter = createBybitAdapter({ apiKey: 'k', secret: 's', testnet: false });
      const perms = await adapter.fetchPermissions!();

      expect(perms.readOnly).toBe(true);
      expect(perms.canTrade).toBe(false);
    });

    it('reports canTrade=true when readOnly=0 and permissions include a Trade entry', async () => {
      mockExchange.privateGetV5UserQueryApi.mockResolvedValue({
        retCode: 0,
        result: {
          readOnly: 0,
          permissions: {
            ContractTrade: ['Order', 'Position', 'Trade'],
            Spot: ['SpotTrade'],
          },
        },
      });

      const adapter = createBybitAdapter({ apiKey: 'k', secret: 's', testnet: false });
      const perms = await adapter.fetchPermissions!();

      expect(perms.readOnly).toBe(false);
      expect(perms.canTrade).toBe(true);
    });

    it('reports canTrade=true when only UnifiedTrade is granted', async () => {
      mockExchange.privateGetV5UserQueryApi.mockResolvedValue({
        retCode: 0,
        result: {
          readOnly: 0,
          permissions: {
            ContractTrade: ['Order', 'Position'],
            UnifiedTrade: ['UnifiedTrade'],
          },
        },
      });

      const adapter = createBybitAdapter({ apiKey: 'k', secret: 's', testnet: false });
      const perms = await adapter.fetchPermissions!();

      expect(perms.canTrade).toBe(true);
    });

    it('reports canTrade=false when readOnly=0 but no Trade entries exist', async () => {
      mockExchange.privateGetV5UserQueryApi.mockResolvedValue({
        retCode: 0,
        result: {
          readOnly: 0,
          permissions: {
            ContractTrade: ['Order', 'Position'],
            Wallet: ['AccountTransfer'],
            Exchange: ['ExchangeHistory'],
          },
        },
      });

      const adapter = createBybitAdapter({ apiKey: 'k', secret: 's', testnet: false });
      const perms = await adapter.fetchPermissions!();

      expect(perms.readOnly).toBe(false);
      expect(perms.canTrade).toBe(false);
    });

    it('handles missing permissions object gracefully', async () => {
      mockExchange.privateGetV5UserQueryApi.mockResolvedValue({ retCode: 0, result: { readOnly: 1 } });

      const adapter = createBybitAdapter({ apiKey: 'k', secret: 's', testnet: false });
      const perms = await adapter.fetchPermissions!();

      expect(perms.readOnly).toBe(true);
      expect(perms.canTrade).toBe(false);
    });
  });

  describe('fetchSymbols cache', () => {
    it('hits the exchange on the first call and returns USDT-quoted markets sorted', async () => {
      mockExchange.markets = { 'BTC/USDT': {}, 'ETH/USDT': {}, 'BTC/USD': {}, 'ADA/USDT': {} };

      const adapter = createBybitAdapter({ apiKey: 'k', secret: 's', testnet: false });
      const symbols = await adapter.fetchSymbols();

      expect(mockExchange.loadMarkets).toHaveBeenCalledTimes(1);
      // USDT filter drops BTC/USD, sorted alphabetically.
      expect(symbols).toEqual(['ADA/USDT', 'BTC/USDT', 'ETH/USDT']);
    });

    it('reuses the cache on the second call — loadMarkets is not called again', async () => {
      mockExchange.markets = { 'BTC/USDT': {} };
      const adapter = createBybitAdapter({ apiKey: 'k', secret: 's', testnet: false });

      await adapter.fetchSymbols();
      await adapter.fetchSymbols();
      await adapter.fetchSymbols();

      expect(mockExchange.loadMarkets).toHaveBeenCalledTimes(1);
    });

    it('cache is shared across adapter instances with the same exchange+testnet', async () => {
      mockExchange.markets = { 'BTC/USDT': {} };

      const a = createBybitAdapter({ apiKey: 'k1', secret: 's1', testnet: false });
      await a.fetchSymbols();
      // Second adapter instance for the same exchange+testnet — should hit cache.
      const b = createBybitAdapter({ apiKey: 'k2', secret: 's2', testnet: false });
      const symbols = await b.fetchSymbols();

      expect(mockExchange.loadMarkets).toHaveBeenCalledTimes(1);
      expect(symbols).toEqual(['BTC/USDT']);
    });

    it('testnet and mainnet keep separate cache entries', async () => {
      // Mainnet adapter warms the mainnet key.
      mockExchange.markets = { 'BTC/USDT': {}, 'ETH/USDT': {} };
      const main = createBybitAdapter({ apiKey: 'k', secret: 's', testnet: false });
      const mainSymbols = await main.fetchSymbols();
      expect(mainSymbols).toEqual(['BTC/USDT', 'ETH/USDT']);
      expect(mockExchange.loadMarkets).toHaveBeenCalledTimes(1);

      // Testnet adapter on a different market set. Should NOT see the mainnet
      // cache — it must fetch its own, preventing symbol leakage across nets.
      mockExchange.markets = { 'BTC/USDT': {} };
      const test = createBybitAdapter({ apiKey: 'k', secret: 's', testnet: true });
      const testSymbols = await test.fetchSymbols();
      expect(testSymbols).toEqual(['BTC/USDT']);
      expect(mockExchange.loadMarkets).toHaveBeenCalledTimes(2);
    });
  });
});
