import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchCandles = vi.fn().mockResolvedValue([{ timestamp: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }]);
vi.mock('../../src/exchange/bybit.js', () => ({
  createBybitAdapter: () => ({
    name: 'bybit', fetchSymbols: vi.fn(), fetchTicker: vi.fn(), fetchCandles,
    placeOrder: vi.fn(), cancelOrder: vi.fn(), fetchBalance: vi.fn(), closePosition: vi.fn(),
  }),
}));

import { createDb } from '../../src/db/index.js';
import { createBotManager } from '../../src/engine/bot-manager.js';
import { clearMarketDataCache } from '../../src/exchange/market-data-cache.js';

const ws = () => ({ broadcast: vi.fn(), broadcastToUser: vi.fn(), clientCount: vi.fn(), close: vi.fn() });

describe('Bot manager shares market data between users (P1)', () => {
  beforeEach(() => { clearMarketDataCache(); fetchCandles.mockClear(); });

  it('makes one candle request for two users on the same symbol', async () => {
    const db = createDb(':memory:');
    const a = db.createUser('a', null, 'h', 'regular');
    const b = db.createUser('b', null, 'h', 'regular');
    const manager = createBotManager(db, ws() as any, 'test-secret');
    await manager.getExchange(a.id).fetchCandles('BTC/USDT', '5m');
    await manager.getExchange(b.id).fetchCandles('BTC/USDT', '5m');
    expect(fetchCandles).toHaveBeenCalledTimes(1);
    manager.stopAll();
    db.close();
  });
});
