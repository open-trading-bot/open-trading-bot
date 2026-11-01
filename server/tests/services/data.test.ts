import { describe, it, expect, vi } from 'vitest';
import { createDataService } from '../../src/services/data.js';
import type { Db } from '../../src/db/index.js';
import type { BotManager } from '../../src/engine/bot-manager.js';

function mockDb(): Db {
  return {
    getOpenPositions: vi.fn().mockReturnValue([]),
    getDailyTrades: vi.fn().mockReturnValue([]),
    getUserById: vi.fn().mockReturnValue({ id: 1, exchangeName: 'bybit', exchangeTestnet: false }),
    getTrades: vi.fn().mockReturnValue([]),
    getTradesBySymbol: vi.fn().mockReturnValue([]),
    getTradesPaginated: vi.fn().mockReturnValue({ data: [], total: 0 }),
    getOpenPositionsPaginated: vi.fn().mockReturnValue({ data: [], total: 0 }),
    getCandles: vi.fn().mockReturnValue([]),
    getTradeDistinctSymbols: vi.fn().mockReturnValue([]),
    getTradeDistinctStrategies: vi.fn().mockReturnValue([]),
  } as any;
}

function mockBotManager(): BotManager {
  return {
    getExchange: vi.fn().mockReturnValue({
      fetchBalance: vi.fn().mockResolvedValue({ total: 10000, free: 8500, totalEquity: 10500 }),
    }),
    getConfig: vi.fn().mockReturnValue({
      mode: 'paper',
      strategies: [],
      assets: [],
    }),
  } as any;
}

describe('DataService.getPortfolioBalance', () => {
  it('returns balance from exchange with correct shape', async () => {
    const mockExchange = {
      fetchBalance: vi.fn().mockResolvedValue({ total: 10000, free: 8500, totalEquity: 10500 }),
    };
    const manager = mockBotManager();
    (manager.getExchange as any).mockReturnValue(mockExchange);

    const db = mockDb();
    const service = createDataService(db, manager);

    const result = await service.getPortfolioBalance(42);

    expect(result).toEqual({ totalBalance: 10000, availableBalance: 8500, totalEquity: 10500 });
    expect(mockExchange.fetchBalance).toHaveBeenCalledTimes(1);
  });

  it('calls fetchBalance exactly once per call', async () => {
    const mockExchange = {
      fetchBalance: vi.fn().mockResolvedValue({ total: 5000, free: 4000, totalEquity: 5200 }),
    };
    const manager = mockBotManager();
    (manager.getExchange as any).mockReturnValue(mockExchange);

    const db = mockDb();
    const service = createDataService(db, manager);

    await service.getPortfolioBalance(42);
    await service.getPortfolioBalance(42);

    expect(mockExchange.fetchBalance).toHaveBeenCalledTimes(2);
  });
});

describe('DataService.getPortfolio regression — does NOT call fetchBalance', () => {
  it('returns DB-only shape without calling exchange', () => {
    const mockExchange = {
      fetchBalance: vi.fn().mockResolvedValue({ total: 10000, free: 8500, totalEquity: 10500 }),
    };
    const manager = mockBotManager();
    (manager.getExchange as any).mockReturnValue(mockExchange);

    const db = mockDb();
    (db.getOpenPositions as any).mockReturnValue([
      { id: 'p1', symbol: 'BTC/USDT', pnl: 100 },
      { id: 'p2', symbol: 'ETH/USDT', pnl: 50 },
    ]);
    (db.getDailyTrades as any).mockReturnValue([
      { pnl: 25 },
      { pnl: 15 },
    ]);

    const service = createDataService(db, manager);
    const result = service.getPortfolio(42);

    expect(mockExchange.fetchBalance).toHaveBeenCalledTimes(0);
    expect(result).toHaveProperty('positions');
    expect(result).toHaveProperty('dailyPnl');
    expect(result).toHaveProperty('totalPnl');
    expect(result).not.toHaveProperty('totalBalance');
    expect(result).not.toHaveProperty('availableBalance');
    expect(result).not.toHaveProperty('totalEquity');
    expect(result).not.toHaveProperty('dailyPnlPct');
  });

  it('returns correct daily/total PnL sums', () => {
    const mockExchange = {
      fetchBalance: vi.fn(),
    };
    const manager = mockBotManager();
    (manager.getExchange as any).mockReturnValue(mockExchange);

    const db = mockDb();
    (db.getOpenPositions as any).mockReturnValue([
      { id: 'p1', symbol: 'BTC/USDT', pnl: 100 },
      { id: 'p2', symbol: 'ETH/USDT', pnl: 50 },
    ]);
    (db.getDailyTrades as any).mockReturnValue([
      { pnl: 25 },
      { pnl: 15 },
    ]);

    const service = createDataService(db, manager);
    const result = service.getPortfolio(42);

    expect(result.totalPnl).toBe(150);
    expect(result.dailyPnl).toBe(40);
    expect(mockExchange.fetchBalance).not.toHaveBeenCalled();
  });
});

describe('DataService.updateConfig — auto-close positions when assets are disabled/removed', () => {
  function setup(currentAssets: { symbol: string; enabled: boolean }[], openPositions: any[]) {
    const manager = mockBotManager();
    const exchange = { fetchTicker: vi.fn().mockResolvedValue({ last: 100 }) };
    (manager.getExchange as any).mockReturnValue(exchange);
    (manager.getConfig as any).mockReturnValue({
      mode: 'paper', strategies: [], assets: currentAssets,
    });
    (manager as any).closePosition = vi.fn().mockResolvedValue(undefined);
    (manager as any).updateConfig = vi.fn();
    const db = mockDb();
    (db.getOpenPositions as any).mockReturnValue(openPositions);
    const service = createDataService(db, manager);
    return { service, manager, exchange, db };
  }

  it('closes positions on disabled assets with asset-disabled reason', async () => {
    const { service, manager } = setup(
      [{ symbol: 'BTC/USDT', enabled: true, marketType: 'spot' }],
      [{ id: 'p1', symbol: 'BTC/USDT' }],
    );
    const result = await service.updateConfig(1, {
      assets: [{ symbol: 'BTC/USDT', enabled: false, marketType: 'spot' }] as any,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.closedPositions).toHaveLength(1);
      expect(result.closedPositions[0].id).toBe('p1');
    }
    expect(manager.closePosition).toHaveBeenCalledWith(1, 'p1', 'asset-disabled');
  });

  it('closes positions on removed assets (not present in new list)', async () => {
    const { service, manager } = setup(
      [
        { symbol: 'BTC/USDT', enabled: true, marketType: 'spot' },
        { symbol: 'ETH/USDT', enabled: true, marketType: 'spot' },
      ],
      [
        { id: 'p1', symbol: 'BTC/USDT' },
        { id: 'p2', symbol: 'ETH/USDT' },
      ],
    );
    const result = await service.updateConfig(1, {
      assets: [{ symbol: 'BTC/USDT', enabled: true, marketType: 'spot' }] as any,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.closedPositions.map((p) => p.id)).toEqual(['p2']);
    }
    expect(manager.closePosition).toHaveBeenCalledTimes(1);
    expect(manager.closePosition).toHaveBeenCalledWith(1, 'p2', 'asset-disabled');
  });

  it('ignores positions on assets that remain enabled', async () => {
    const { service, manager } = setup(
      [
        { symbol: 'BTC/USDT', enabled: true, marketType: 'spot' },
        { symbol: 'ETH/USDT', enabled: true, marketType: 'spot' },
      ],
      [
        { id: 'p1', symbol: 'BTC/USDT' }, // stays enabled
        { id: 'p2', symbol: 'ETH/USDT' }, // being disabled
      ],
    );
    const result = await service.updateConfig(1, {
      assets: [
        { symbol: 'BTC/USDT', enabled: true, marketType: 'spot' },
        { symbol: 'ETH/USDT', enabled: false, marketType: 'spot' },
      ] as any,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.closedPositions.map((p) => p.id)).toEqual(['p2']);
    }
    expect(manager.closePosition).toHaveBeenCalledTimes(1);
  });

  it('uses server current config — client-thought-enabled does not matter', async () => {
    // Server thinks BTC is already disabled. Client sends update with BTC
    // still enabled → no close needed. Prevents stale-client state from
    // re-triggering closes on already-disabled assets.
    const { service, manager } = setup(
      [{ symbol: 'BTC/USDT', enabled: false, marketType: 'spot' }],
      [{ id: 'p1', symbol: 'BTC/USDT' }],
    );
    const result = await service.updateConfig(1, {
      assets: [{ symbol: 'BTC/USDT', enabled: true, marketType: 'spot' }] as any,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.closedPositions).toHaveLength(0);
    }
    expect(manager.closePosition).not.toHaveBeenCalled();
  });

  it('returns close_failed error and does NOT apply the config update when a close fails', async () => {
    const { service, manager } = setup(
      [{ symbol: 'BTC/USDT', enabled: true, marketType: 'spot' }],
      [{ id: 'p1', symbol: 'BTC/USDT' }],
    );
    (manager as any).closePosition = vi.fn().mockRejectedValue(new Error('exchange offline'));
    const result = await service.updateConfig(1, {
      assets: [{ symbol: 'BTC/USDT', enabled: false, marketType: 'spot' }] as any,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && 'error' in result) {
      expect(result.error).toBe('close_failed');
      expect(result.symbol).toBe('BTC/USDT');
      expect(result.message).toBe('exchange offline');
    }
    expect(manager.updateConfig).not.toHaveBeenCalled();
  });

  it('partial close: already-closed positions are NOT reverted when a later close fails', async () => {
    const { service, manager } = setup(
      [{ symbol: 'BTC/USDT', enabled: true, marketType: 'spot' }],
      [
        { id: 'p1', symbol: 'BTC/USDT' },
        { id: 'p2', symbol: 'BTC/USDT' },
      ],
    );
    // First close succeeds (p1 is gone from the exchange and DB), second throws.
    const closeSpy = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('exchange timeout'));
    (manager as any).closePosition = closeSpy;

    const result = await service.updateConfig(1, {
      assets: [{ symbol: 'BTC/USDT', enabled: false, marketType: 'spot' }] as any,
    });

    // Both positions were attempted.
    expect(closeSpy).toHaveBeenCalledTimes(2);
    expect(closeSpy).toHaveBeenNthCalledWith(1, 1, 'p1', 'asset-disabled');
    expect(closeSpy).toHaveBeenNthCalledWith(2, 1, 'p2', 'asset-disabled');

    // Config update is aborted (caller can retry).
    expect(result.ok).toBe(false);
    if (!result.ok && 'error' in result) {
      expect(result.error).toBe('close_failed');
      expect(result.symbol).toBe('BTC/USDT');
    }
    expect(manager.updateConfig).not.toHaveBeenCalled();

    // p1 is NOT rolled back — the service does not revert successful closes.
    // The caller on retry will see only p2 remaining to close.
  });

  it('closedPositions carries pre-close DB snapshot, not exchange fill', async () => {
    // The snapshot reflects the row at check-time, used for local UI
    // reconciliation — realized PnL for accounting comes from the trades table
    // written by the close path, not from this field.
    const { service } = setup(
      [{ symbol: 'BTC/USDT', enabled: true, marketType: 'spot' }],
      [{ id: 'p1', symbol: 'BTC/USDT', pnl: 12.34, currentPrice: 50000 }],
    );
    const result = await service.updateConfig(1, {
      assets: [{ symbol: 'BTC/USDT', enabled: false, marketType: 'spot' }] as any,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.closedPositions).toHaveLength(1);
      expect(result.closedPositions[0].pnl).toBe(12.34);
      expect(result.closedPositions[0].currentPrice).toBe(50000);
    }
  });

  it('returns no closed positions when no assets change', async () => {
    const { service, manager } = setup(
      [{ symbol: 'BTC/USDT', enabled: true, marketType: 'spot' }],
      [{ id: 'p1', symbol: 'BTC/USDT' }],
    );
    const result = await service.updateConfig(1, { tradeAmount: 200 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.closedPositions).toHaveLength(0);
    }
    expect(manager.closePosition).not.toHaveBeenCalled();
    expect(manager.updateConfig).toHaveBeenCalledWith(1, { tradeAmount: 200 });
  });

  it('validates new symbols before closing anything', async () => {
    const { service, manager, exchange } = setup(
      [{ symbol: 'BTC/USDT', enabled: true, marketType: 'spot' }],
      [{ id: 'p1', symbol: 'BTC/USDT' }],
    );
    (exchange.fetchTicker as any).mockRejectedValue(new Error('no such symbol'));
    const result = await service.updateConfig(1, {
      assets: [
        { symbol: 'BTC/USDT', enabled: false, marketType: 'spot' },
        { symbol: 'FAKE/USDT', enabled: true, marketType: 'spot' },
      ] as any,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result as { symbol: string }).symbol).toBe('FAKE/USDT');
    }
    // Symbol validation runs before the close loop — nothing should be closed.
    expect(manager.closePosition).not.toHaveBeenCalled();
    expect(manager.updateConfig).not.toHaveBeenCalled();
  });
});
