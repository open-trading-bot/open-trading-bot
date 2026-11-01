import { describe, it, expect, vi } from 'vitest';
import { createBackofficeService } from '../../src/services/backoffice.js';
import { hashPassword, verifyPassword } from '../../src/db/seed.js';
import { ERROR_MSG } from '../../src/utils/constants.js';
import type { Db, DbUser } from '../../src/db/index.js';
import logger from '../../src/utils/logger.js';

function createMockDb(users: DbUser[] = []): Db {
  const store = new Map<string, DbUser>();
  for (const u of users) store.set(u.username, u);

  return {
    getUsers: vi.fn().mockReturnValue(users),
    getUserByUsername: vi.fn((username: string) => store.get(username) ?? null),
    createUser: vi.fn((username: string, email: string | null, passwordHash: string, role: string) => {
      const user = { id: users.length + 1, username, role };
      return user;
    }),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
    bumpTokenVersion: vi.fn(),
    getLeads: vi.fn().mockReturnValue([]),
    getTrades: vi.fn().mockReturnValue([]),
    getOpenPositions: vi.fn().mockReturnValue([]),
    getUserConfig: vi.fn().mockReturnValue(null),
    setUserConfig: vi.fn(),
  } as any as Db;
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

describe('BackofficeService — user management', () => {
  it('getUsers returns users from DB', () => {
    const users: DbUser[] = [
      { id: 1, username: 'admin', email: null, passwordHash: 'h', role: 'admin', enabled: true, createdAt: 0, lastLogin: null },
    ];
    const db = createMockDb(users);
    const service = createBackofficeService(db, mockBotManager());

    const result = service.getUsers();
    expect(result).toEqual(users);
    expect(db.getUsers).toHaveBeenCalled();
  });

  it('createUser creates a user with hashed password', () => {
    const db = createMockDb();
    const service = createBackofficeService(db, mockBotManager());

    const result = service.createUser('newuser', 'pass123', null, 'regular');

    const passedHash = (db.createUser as any).mock.calls[0][2];
    expect(verifyPassword('pass123', passedHash)).toBe(true);
    expect(result).toEqual({ id: 1, username: 'newuser', role: 'regular' });
  });

  it('createUser throws when username is taken', () => {
    const existing: DbUser = {
      id: 1, username: 'taken', email: null, passwordHash: 'h',
      role: 'admin', enabled: true, createdAt: 0, lastLogin: null,
    };
    const db = createMockDb([existing]);
    const service = createBackofficeService(db, mockBotManager());

    expect(() => service.createUser('taken', 'pass', null, 'demo')).toThrow(ERROR_MSG.USERNAME_TAKEN);
  });

  it('updateUser calls db.updateUser', async () => {
    const db = createMockDb();
    const service = createBackofficeService(db, mockBotManager());

    await service.updateUser(5, { role: 'admin', enabled: false });
    expect(db.updateUser).toHaveBeenCalledWith(5, { role: 'admin', enabled: false });
  });

  it('deleteUser calls db.deleteUser', () => {
    const db = createMockDb();
    const service = createBackofficeService(db, mockBotManager());

    service.deleteUser(3);
    expect(db.deleteUser).toHaveBeenCalledWith(3);
  });

  it('updateUser kills and resets bot when paperBalance changes', async () => {
    const db = createMockDb();
    const bm = mockBotManager();
    const service = createBackofficeService(db, bm);

    await service.updateUser(5, { paperBalance: 50000 });
    expect(db.updateUser).toHaveBeenCalledWith(5, { paperBalance: 50000 });
    expect(bm.killBot).toHaveBeenCalledWith(5, 'admin');
    expect(bm.resetBot).toHaveBeenCalledWith(5);
  });

  it('paperBalance admin change writes the final value AFTER killBot+resetBot', async () => {
    // Pins the fix for the paper-cash-persistence bug: killBot runs
    // through orchestrator.killSwitch which closes all positions via
    // exchange.closePosition. For paper adapters those closes mutate
    // cash → onCashChange callback fires → db.updateUser rewrites
    // paperBalance with the in-flight cash value. Without the final
    // re-write, the admin's intended balance would be silently
    // clobbered by the callback. The sequence must end with the
    // admin's value.
    const db = createMockDb();
    const bm = mockBotManager();
    // Track the literal call order rather than timestamps — synchronous
    // JS calls can easily land in the same millisecond, which would
    // make a `>=` time comparison pass for the wrong reason.
    const callOrder: string[] = [];

    (bm.killBot as any) = vi.fn(async () => { callOrder.push('killBot'); });
    (bm.resetBot as any) = vi.fn(() => { callOrder.push('resetBot'); });
    (db.updateUser as any) = vi.fn(() => { callOrder.push('updateUser'); });

    const service = createBackofficeService(db, bm);
    await service.updateUser(5, { paperBalance: 50000 });

    // updateUser is called at least twice: once at the top (with all
    // updates), and once at the end after resetBot (with just paperBalance
    // as the final word).
    expect((db.updateUser as any).mock.calls.length).toBeGreaterThanOrEqual(2);
    const lastCall = (db.updateUser as any).mock.calls.at(-1);
    expect(lastCall[0]).toBe(5);
    expect(lastCall[1]).toEqual({ paperBalance: 50000 });

    // The final event in the whole sequence must be the DB write —
    // not killBot or resetBot. That's the invariant that keeps the
    // admin's value from being clobbered.
    expect(callOrder.at(-1)).toBe('updateUser');
    // And the ordering through killBot → resetBot → (final) updateUser
    // must hold: the last resetBot call precedes the last updateUser.
    const lastReset = callOrder.lastIndexOf('resetBot');
    const lastUpdate = callOrder.lastIndexOf('updateUser');
    expect(lastUpdate).toBeGreaterThan(lastReset);
  });

  it('updateUser does not kill/reset bot when paperBalance is not changed', async () => {
    const db = createMockDb();
    const bm = mockBotManager();
    const service = createBackofficeService(db, bm);

    await service.updateUser(5, { email: 'test@test.com' });
    expect(bm.killBot).not.toHaveBeenCalled();
    expect(bm.resetBot).not.toHaveBeenCalled();
  });

  it('updateUser stops and kills/resets bot when both enabled=false and paperBalance change', async () => {
    const db = createMockDb();
    const bm = mockBotManager();
    const service = createBackofficeService(db, bm);

    await service.updateUser(5, { enabled: false, paperBalance: 20000 });
    expect(bm.stopBot).toHaveBeenCalledWith(5);
    expect(bm.killBot).toHaveBeenCalledWith(5, 'admin');
    expect(bm.resetBot).toHaveBeenCalledWith(5);
  });

  it('updateUser resets bot even if killBot fails', async () => {
    const db = createMockDb();
    const bm = mockBotManager();
    bm.killBot = vi.fn().mockRejectedValue(new Error('exchange down'));
    const service = createBackofficeService(db, bm);

    await service.updateUser(5, { paperBalance: 30000 });
    expect(bm.killBot).toHaveBeenCalledWith(5, 'admin');
    expect(bm.resetBot).toHaveBeenCalledWith(5);
  });

  it('updateUser logs killBot failure and stale-position count', async () => {
    const errSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    const db = createMockDb();
    db.getOpenPositions = vi.fn().mockReturnValue([
      { id: 'p1' }, { id: 'p2' }, { id: 'p3' },
    ]) as any;
    const bm = mockBotManager();
    bm.killBot = vi.fn().mockRejectedValue(new Error('exchange down'));
    const service = createBackofficeService(db, bm);

    await service.updateUser(5, { paperBalance: 30000 });

    const errOutput = errSpy.mock.calls.flat().join(' ');
    expect(errOutput).toMatch(/killBot threw for user 5/);
    expect(errOutput).toMatch(/exchange down/);

    const warnOutput = warnSpy.mock.calls.flat().join(' ');
    expect(warnOutput).toMatch(/user 5 has 3 open positions left after killBot/);

    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('updateUser warns about stale positions even when killBot returns success', async () => {
    // The user-very-aggresive incident: killBot returned ok but the
    // closePosition calls inside killSwitch failed silently per-position
    // (they're wrapped in their own try/catch), leaving 15 positions in
    // the DB. This verifies the warning fires unconditionally after
    // killBot, not only on outer killBot rejection.
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    const db = createMockDb();
    db.getOpenPositions = vi.fn().mockReturnValue(
      Array.from({ length: 15 }, (_, i) => ({ id: `p${i}` })),
    ) as any;
    const bm = mockBotManager();
    const service = createBackofficeService(db, bm);

    await service.updateUser(5, { paperBalance: 30000 });

    const warnOutput = warnSpy.mock.calls.flat().join(' ');
    expect(warnOutput).toMatch(/user 5 has 15 open positions left after killBot/);

    warnSpy.mockRestore();
  });

  it('updateUser does not warn when killBot succeeds and no positions remain', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    const db = createMockDb();
    db.getOpenPositions = vi.fn().mockReturnValue([]) as any;
    const bm = mockBotManager();
    const service = createBackofficeService(db, bm);

    await service.updateUser(5, { paperBalance: 30000 });

    const warnOutput = warnSpy.mock.calls.flat().join(' ');
    expect(warnOutput).not.toMatch(/open positions left/);

    warnSpy.mockRestore();
  });

  it('updateUser recalculates config from risk level when balance changes', async () => {
    const db = createMockDb();
    db.getUserConfig = vi.fn().mockReturnValue({ riskLevel: 'extreme', tradeAmount: 2500, dailyLossLimit: 12500, stopLossPct: 8, maxOpenPositions: 25, minConfidence: 0.1, mode: 'paper' });
    const bm = mockBotManager();
    const service = createBackofficeService(db, bm);

    await service.updateUser(5, { paperBalance: 1000 });
    // extreme: 10% trade, 50% daily loss → $100 trade, $500 daily loss
    expect(db.setUserConfig).toHaveBeenCalledWith(5, expect.objectContaining({ tradeAmount: 100, dailyLossLimit: 500 }));
  });

  it('updateUser recalculates config when balance is increased', async () => {
    const db = createMockDb();
    db.getUserConfig = vi.fn().mockReturnValue({ riskLevel: 'moderate', tradeAmount: 100, dailyLossLimit: 500, stopLossPct: 2, maxOpenPositions: 5, minConfidence: 0.5, mode: 'paper' });
    const bm = mockBotManager();
    const service = createBackofficeService(db, bm);

    await service.updateUser(5, { paperBalance: 50000 });
    // moderate: 1% trade, 5% daily loss → $500 trade, $2500 daily loss
    expect(db.setUserConfig).toHaveBeenCalledWith(5, expect.objectContaining({ tradeAmount: 500, dailyLossLimit: 2500 }));
  });

  it('updateUser caps custom config when balance is lowered', async () => {
    const db = createMockDb();
    db.getUserConfig = vi.fn().mockReturnValue({ riskLevel: 'custom', tradeAmount: 2500, dailyLossLimit: 12500, stopLossPct: 5, maxOpenPositions: 15, minConfidence: 0.2, mode: 'paper' });
    const bm = mockBotManager();
    const service = createBackofficeService(db, bm);

    await service.updateUser(5, { paperBalance: 1000 });
    expect(db.setUserConfig).toHaveBeenCalledWith(5, expect.objectContaining({ tradeAmount: 1000, dailyLossLimit: 1000 }));
  });

  it('updateUser custom config never persists tradeAmount=0 or dailyLossLimit=0', async () => {
    const db = createMockDb();
    db.getUserConfig = vi.fn().mockReturnValue({ riskLevel: 'custom', tradeAmount: 100, dailyLossLimit: 500, stopLossPct: 5, maxOpenPositions: 15, minConfidence: 0.2, mode: 'paper' });
    const bm = mockBotManager();
    const service = createBackofficeService(db, bm);

    await service.updateUser(5, { paperBalance: 0 });
    expect(db.setUserConfig).toHaveBeenCalledWith(5, expect.objectContaining({ tradeAmount: 1, dailyLossLimit: 1 }));
  });

  it('updateUser does not modify custom config when values are within new balance', async () => {
    const db = createMockDb();
    db.getUserConfig = vi.fn().mockReturnValue({ riskLevel: 'custom', tradeAmount: 100, dailyLossLimit: 500, stopLossPct: 2, maxOpenPositions: 5, minConfidence: 0.5, mode: 'paper' });
    const bm = mockBotManager();
    const service = createBackofficeService(db, bm);

    await service.updateUser(5, { paperBalance: 10000 });
    expect(db.setUserConfig).not.toHaveBeenCalled();
  });

  it('updateUser does not modify config when no config exists', async () => {
    const db = createMockDb();
    db.getUserConfig = vi.fn().mockReturnValue(null);
    const bm = mockBotManager();
    const service = createBackofficeService(db, bm);

    await service.updateUser(5, { paperBalance: 1000 });
    expect(db.setUserConfig).not.toHaveBeenCalled();
  });

  it('updateUser executes in order: kill positions → update config → reset bot', async () => {
    const order: string[] = [];
    const db = createMockDb();
    db.getUserConfig = vi.fn(() => { order.push('getUserConfig'); return { riskLevel: 'moderate', tradeAmount: 500, dailyLossLimit: 2500, stopLossPct: 2, maxOpenPositions: 5, minConfidence: 0.5, mode: 'paper' }; });
    db.setUserConfig = vi.fn(() => { order.push('setUserConfig'); });
    const bm = mockBotManager();
    bm.killBot = vi.fn(async () => { order.push('killBot'); });
    bm.resetBot = vi.fn(() => { order.push('resetBot'); });
    const service = createBackofficeService(db, bm);

    await service.updateUser(5, { paperBalance: 1000 });
    expect(bm.killBot).toHaveBeenCalledWith(5, 'admin');
    expect(order).toEqual(['killBot', 'getUserConfig', 'setUserConfig', 'resetBot']);
  });

  it('updateUser blocks paperBalance change when bot mode is live', async () => {
    const db = createMockDb();
    const bm = mockBotManager();
    bm.getConfig = vi.fn().mockReturnValue({ mode: 'live' });
    const service = createBackofficeService(db, bm);

    await service.updateUser(5, { paperBalance: 50000 });
    expect(db.updateUser).not.toHaveBeenCalled();
    expect(bm.killBot).not.toHaveBeenCalled();
    expect(bm.resetBot).not.toHaveBeenCalled();
  });

  it('updateUser allows other updates when bot mode is live', async () => {
    const db = createMockDb();
    const bm = mockBotManager();
    bm.getConfig = vi.fn().mockReturnValue({ mode: 'live' });
    const service = createBackofficeService(db, bm);

    await service.updateUser(5, { email: 'new@test.com' });
    expect(db.updateUser).toHaveBeenCalledWith(5, { email: 'new@test.com' });
  });

  it('updateUser allows paperBalance change when bot mode is paper', async () => {
    const db = createMockDb();
    const bm = mockBotManager();
    bm.getConfig = vi.fn().mockReturnValue({ mode: 'paper' });
    const service = createBackofficeService(db, bm);

    await service.updateUser(5, { paperBalance: 50000 });
    expect(db.updateUser).toHaveBeenCalledWith(5, { paperBalance: 50000 });
    expect(bm.killBot).toHaveBeenCalledWith(5, 'admin');
  });

  it('updateUserPassword hashes password and blocks user', () => {
    const db = createMockDb();
    (db as any).updateUserPassword = vi.fn();
    const service = createBackofficeService(db, mockBotManager());

    service.updateUserPassword(5, 'newPass123');

    const passedHash = (db.updateUserPassword as any).mock.calls[0][1];
    expect(verifyPassword('newPass123', passedHash)).toBe(true);
  });

  it('updateUserPassword forces re-login by blocking user', () => {
    const db = createMockDb();
    (db as any).updateUserPassword = vi.fn();
    const service = createBackofficeService(db, mockBotManager());

    service.updateUserPassword(5, 'newPass123');

    expect(db.updateUserPassword).toHaveBeenCalledTimes(1);
    // Revocation must survive a restart, so it goes through the database.
    expect(db.bumpTokenVersion).toHaveBeenCalledWith(5);
  });
});
