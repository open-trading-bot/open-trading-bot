import { describe, it, expect, vi } from 'vitest';
import { createBackofficeService } from '../../src/services/backoffice.js';
import { BOT_ACTIONS, ACTION_SOURCES } from '../../src/utils/constants.js';
import type { Db } from '../../src/db/index.js';

function createMockDb(): Db {
  return {
    getUsers: vi.fn().mockReturnValue([]),
    getUserByUsername: vi.fn().mockReturnValue(null),
    createUser: vi.fn().mockReturnValue({ id: 1, username: 'new', role: 'demo' }),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
    bumpTokenVersion: vi.fn(),
    getLeads: vi.fn().mockReturnValue([]),
    getTrades: vi.fn().mockReturnValue([]),
    getOpenPositions: vi.fn().mockReturnValue([]),
    getUserConfig: vi.fn().mockReturnValue(null),
    setUserConfig: vi.fn(),
    insertActionLog: vi.fn(),
    getActionLogs: vi.fn().mockReturnValue({ data: [], total: 0 }),
  } as any;
}

function mockBotManager(): any {
  return {
    getConfig: vi.fn().mockReturnValue({ mode: 'paper' }),
    getStatus: vi.fn().mockReturnValue('stopped'),
    stopBot: vi.fn(),
    killBot: vi.fn().mockResolvedValue(undefined),
    resetBot: vi.fn(),
  };
}

describe('BackofficeService — action logging', () => {
  it('logs stop when user is disabled via backoffice', async () => {
    const db = createMockDb();
    const service = createBackofficeService(db, mockBotManager());

    await service.updateUser(5, { enabled: false }, 1);

    expect(db.insertActionLog).toHaveBeenCalledWith(5, BOT_ACTIONS.STOP, 1, ACTION_SOURCES.BACKOFFICE);
  });

  it('logs kill when paperBalance changes via backoffice', async () => {
    const db = createMockDb();
    const service = createBackofficeService(db, mockBotManager());

    await service.updateUser(5, { paperBalance: 50000 }, 1);

    expect(db.insertActionLog).toHaveBeenCalledWith(5, BOT_ACTIONS.KILL, 1, ACTION_SOURCES.BACKOFFICE);
  });

  it('logs stop when user is deleted via backoffice', () => {
    const db = createMockDb();
    const service = createBackofficeService(db, mockBotManager());

    service.deleteUser(5, 1);

    expect(db.insertActionLog).toHaveBeenCalledWith(5, BOT_ACTIONS.STOP, 1, ACTION_SOURCES.BACKOFFICE);
  });

  it('does not log when adminId is not provided', async () => {
    const db = createMockDb();
    const service = createBackofficeService(db, mockBotManager());

    await service.updateUser(5, { enabled: false });

    expect(db.insertActionLog).not.toHaveBeenCalled();
  });

  it('does not log when enabling user (no bot action)', async () => {
    const db = createMockDb();
    const service = createBackofficeService(db, mockBotManager());

    await service.updateUser(5, { enabled: true }, 1);

    expect(db.insertActionLog).not.toHaveBeenCalled();
  });

  it('does not log when updating email only', async () => {
    const db = createMockDb();
    const service = createBackofficeService(db, mockBotManager());

    await service.updateUser(5, { email: 'new@test.com' }, 1);

    expect(db.insertActionLog).not.toHaveBeenCalled();
  });

  it('logs both stop and kill when disabling user with paperBalance change', async () => {
    const db = createMockDb();
    const service = createBackofficeService(db, mockBotManager());

    await service.updateUser(5, { enabled: false, paperBalance: 20000 }, 1);

    expect(db.insertActionLog).toHaveBeenCalledWith(5, BOT_ACTIONS.STOP, 1, ACTION_SOURCES.BACKOFFICE);
    expect(db.insertActionLog).toHaveBeenCalledWith(5, BOT_ACTIONS.KILL, 1, ACTION_SOURCES.BACKOFFICE);
  });

  it('getUserActionLogs returns paginated results', () => {
    const mockLogs = [
      { id: 1, userId: 2, action: BOT_ACTIONS.START, actorId: 2, actorUsername: 'trader', source: ACTION_SOURCES.SELF, timestamp: 1000 },
    ];
    const db = createMockDb();
    (db.getActionLogs as any).mockReturnValue({ data: mockLogs, total: 1 });
    const service = createBackofficeService(db, mockBotManager());

    const result = service.getUserActionLogs(2, 0, 20);

    expect(result.data).toEqual(mockLogs);
    expect(result.total).toBe(1);
    expect(result.page).toBe(0);
    expect(result.totalPages).toBe(1);
  });

  it('getUserActionLogs calculates totalPages correctly', () => {
    const db = createMockDb();
    (db.getActionLogs as any).mockReturnValue({ data: [], total: 45 });
    const service = createBackofficeService(db, mockBotManager());

    const result = service.getUserActionLogs(2, 0, 20);

    expect(result.totalPages).toBe(3);
  });

  it('uses constants not hardcoded strings', async () => {
    const db = createMockDb();
    const service = createBackofficeService(db, mockBotManager());

    await service.updateUser(5, { enabled: false, paperBalance: 1000 }, 1);

    const calls = (db.insertActionLog as any).mock.calls;
    for (const call of calls) {
      expect(Object.values(BOT_ACTIONS)).toContain(call[1]);
      expect(Object.values(ACTION_SOURCES)).toContain(call[3]);
    }
  });
});
