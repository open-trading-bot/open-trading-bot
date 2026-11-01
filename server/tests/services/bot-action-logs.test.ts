import { describe, it, expect, vi } from 'vitest';
import { createBotService } from '../../src/services/bot.js';
import { BOT_ACTIONS, ACTION_SOURCES } from '../../src/utils/constants.js';
import type { BotManager } from '../../src/engine/bot-manager.js';
import type { Db } from '../../src/db/index.js';

function mockDb(): Db {
  return { insertActionLog: vi.fn(), getUsers: vi.fn().mockReturnValue([]), getUserById: vi.fn().mockReturnValue(null) } as any;
}

function mockBotManager(): BotManager {
  return {
    startBot: vi.fn(),
    stopBot: vi.fn(),
    killBot: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockReturnValue('stopped'),
    getConfig: vi.fn().mockReturnValue({ mode: 'paper' }),
    getExchange: vi.fn().mockReturnValue({ fetchBalance: vi.fn().mockResolvedValue({ total: 10000, free: 10000 }) }),
  } as any;
}

describe('BotService — action logging', () => {
  it('logs start action with self source', async () => {
    const db = mockDb();
    const service = createBotService(mockBotManager(), db);

    await service.start(42);

    expect(db.insertActionLog).toHaveBeenCalledWith(42, BOT_ACTIONS.START, 42, ACTION_SOURCES.SELF);
  });

  it('logs stop action with self source', () => {
    const db = mockDb();
    const service = createBotService(mockBotManager(), db);

    service.stop(42);

    expect(db.insertActionLog).toHaveBeenCalledWith(42, BOT_ACTIONS.STOP, 42, ACTION_SOURCES.SELF);
  });

  it('logs kill action with self source', async () => {
    const db = mockDb();
    const service = createBotService(mockBotManager(), db);

    await service.kill(42);

    expect(db.insertActionLog).toHaveBeenCalledWith(42, BOT_ACTIONS.KILL, 42, ACTION_SOURCES.SELF);
  });

  it('does not log on getStatus', () => {
    const db = mockDb();
    const service = createBotService(mockBotManager(), db);

    service.getStatus(42);

    expect(db.insertActionLog).not.toHaveBeenCalled();
  });

  it('uses constants not hardcoded strings', async () => {
    const db = mockDb();
    const service = createBotService(mockBotManager(), db);

    await service.start(1);
    service.stop(1);

    const calls = (db.insertActionLog as any).mock.calls;
    for (const call of calls) {
      expect(Object.values(BOT_ACTIONS)).toContain(call[1]);
      expect(Object.values(ACTION_SOURCES)).toContain(call[3]);
    }
  });
});

describe('BotService — read-only key guard on start', () => {
  function baseManager(cfg: any = { mode: 'live' }): BotManager {
    return {
      startBot: vi.fn(),
      stopBot: vi.fn(),
      killBot: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue('stopped'),
      getConfig: vi.fn().mockReturnValue(cfg),
      getExchange: vi.fn(),
    } as any;
  }

  it('blocks start in live mode when the key is read-only', async () => {
    const manager = baseManager({ mode: 'live' });
    (manager.getExchange as any).mockReturnValue({
      fetchBalance: vi.fn().mockResolvedValue({ total: 10000, free: 10000 }),
      fetchPermissions: vi.fn().mockResolvedValue({ readOnly: true, canTrade: false }),
    });
    const db = mockDb();
    const service = createBotService(manager, db);

    await expect(service.start(1)).rejects.toThrow(/read-only/);
    expect(manager.startBot).not.toHaveBeenCalled();
    expect(db.insertActionLog).not.toHaveBeenCalled();
  });

  it('blocks start in live mode when canTrade is false', async () => {
    const manager = baseManager({ mode: 'live' });
    (manager.getExchange as any).mockReturnValue({
      fetchBalance: vi.fn().mockResolvedValue({ total: 10000, free: 10000 }),
      fetchPermissions: vi.fn().mockResolvedValue({ readOnly: false, canTrade: false }),
    });
    const db = mockDb();
    const service = createBotService(manager, db);

    await expect(service.start(1)).rejects.toThrow(/read-only/);
    expect(manager.startBot).not.toHaveBeenCalled();
  });

  it('allows start in live mode when canTrade is true', async () => {
    const manager = baseManager({ mode: 'live' });
    (manager.getExchange as any).mockReturnValue({
      fetchBalance: vi.fn().mockResolvedValue({ total: 10000, free: 10000 }),
      fetchPermissions: vi.fn().mockResolvedValue({ readOnly: false, canTrade: true }),
    });
    const db = mockDb();
    const service = createBotService(manager, db);

    await service.start(1);

    expect(manager.startBot).toHaveBeenCalledWith(1);
    expect(db.insertActionLog).toHaveBeenCalled();
  });

  it('allows start in paper mode without checking permissions', async () => {
    const manager = baseManager({ mode: 'paper' });
    const fetchPermissions = vi.fn();
    (manager.getExchange as any).mockReturnValue({
      fetchBalance: vi.fn().mockResolvedValue({ total: 10000, free: 10000 }),
      fetchPermissions,
    });
    const db = mockDb();
    const service = createBotService(manager, db);

    await service.start(1);

    expect(manager.startBot).toHaveBeenCalledWith(1);
    expect(fetchPermissions).not.toHaveBeenCalled();
  });

  it('proceeds with start when fetchPermissions itself throws (non-fatal)', async () => {
    const manager = baseManager({ mode: 'live' });
    (manager.getExchange as any).mockReturnValue({
      fetchBalance: vi.fn().mockResolvedValue({ total: 10000, free: 10000 }),
      fetchPermissions: vi.fn().mockRejectedValue(new Error('network down')),
    });
    const db = mockDb();
    const service = createBotService(manager, db);

    await service.start(1);

    expect(manager.startBot).toHaveBeenCalledWith(1);
  });

  it('allows start when adapter has no fetchPermissions method', async () => {
    const manager = baseManager({ mode: 'live' });
    (manager.getExchange as any).mockReturnValue({
      fetchBalance: vi.fn().mockResolvedValue({ total: 10000, free: 10000 }),
      // No fetchPermissions
    });
    const db = mockDb();
    const service = createBotService(manager, db);

    await service.start(1);

    expect(manager.startBot).toHaveBeenCalledWith(1);
  });
});
