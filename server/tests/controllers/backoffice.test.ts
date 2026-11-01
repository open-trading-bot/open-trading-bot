import { describe, it, expect, vi } from 'vitest';
import { createBackofficeController } from '../../src/controllers/backoffice.js';
import { ERROR_MSG } from '../../src/utils/constants.js';
import type { BackofficeService } from '../../src/services/backoffice.js';

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
  res.json = vi.fn();
  return res;
}

function mockReq(body: any = {}, params: any = {}, user: any = { id: 1 }): any {
  return { body, params, user };
}

function createMockService(overrides: Partial<BackofficeService> = {}): BackofficeService {
  return {
    getLeads: vi.fn().mockReturnValue([]),
    getStats: vi.fn().mockResolvedValue({}),
    getSystemConfig: vi.fn().mockReturnValue({}),
    getUsers: vi.fn().mockReturnValue([]),
    createUser: vi.fn().mockReturnValue({ id: 1, username: 'new', role: 'demo' }),
    updateUser: vi.fn().mockResolvedValue(undefined),
    deleteUser: vi.fn(),
    getUserActionLogs: vi.fn().mockReturnValue({ data: [], total: 0, page: 0, totalPages: 0 }),
    updateUserPassword: vi.fn(),
    ...overrides,
  };
}

describe('BackofficeController — user management', () => {
  it('getUsers returns users without passwordHash', () => {
    const service = createMockService({
      getUsers: vi.fn().mockReturnValue([
        { id: 1, username: 'admin', email: null, passwordHash: 'secret', role: 'admin', enabled: true, createdAt: 0, lastLogin: null },
        { id: 2, username: 'demo', email: null, passwordHash: 'hash2', role: 'demo', enabled: true, createdAt: 0, lastLogin: null },
      ]),
    });
    const ctrl = createBackofficeController(service);
    const res = mockRes();

    ctrl.getUsers(mockReq(), res);

    const users = res.json.mock.calls[0][0];
    expect(users).toHaveLength(2);
    expect(users[0]).not.toHaveProperty('passwordHash');
    expect(users[1]).not.toHaveProperty('passwordHash');
    expect(users[0].username).toBe('admin');
  });

  it('createUser returns 400 when username/password missing', () => {
    const ctrl = createBackofficeController(createMockService());
    const res = mockRes();

    ctrl.createUser(mockReq({ username: '', password: '' }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Username and password are required' });
  });

  it('createUser returns 400 when username taken', () => {
    const service = createMockService({
      createUser: vi.fn().mockImplementation(() => { throw new Error(ERROR_MSG.USERNAME_TAKEN); }),
    });
    const ctrl = createBackofficeController(service);
    const res = mockRes();

    ctrl.createUser(mockReq({ username: 'taken', password: 'pass' }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: ERROR_MSG.USERNAME_TAKEN });
  });

  it('createUser returns user on success', () => {
    const ctrl = createBackofficeController(createMockService());
    const res = mockRes();

    ctrl.createUser(mockReq({ username: 'new', password: 'pass123' }), res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ id: 1, username: 'new', role: 'demo' });
  });

  it('updateUser returns ok', async () => {
    const service = createMockService();
    const ctrl = createBackofficeController(service);
    const res = mockRes();

    await ctrl.updateUser(mockReq({ role: 'admin' }, { id: '5' }), res);

    expect(service.updateUser).toHaveBeenCalledWith(5, expect.objectContaining({ role: 'admin' }), 1);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('deleteUser returns ok', () => {
    const service = createMockService();
    const ctrl = createBackofficeController(service);
    const res = mockRes();

    ctrl.deleteUser(mockReq({}, { id: '7' }), res);

    expect(service.deleteUser).toHaveBeenCalledWith(7, 1);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('updateUserPassword returns ok', () => {
    const service = createMockService();
    const ctrl = createBackofficeController(service);
    const res = mockRes();

    ctrl.updateUserPassword(mockReq({ password: 'newPass123!' }, { id: '5' }), res);

    expect(service.updateUserPassword).toHaveBeenCalledWith(5, 'newPass123!');
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('updateUserPassword returns 400 when password is empty', () => {
    const service = createMockService();
    const ctrl = createBackofficeController(service);
    const res = mockRes();

    ctrl.updateUserPassword(mockReq({ password: '' }, { id: '5' }), res);

    expect(service.updateUserPassword).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('updateUserPassword returns 400 when password is too short', () => {
    const service = createMockService();
    const ctrl = createBackofficeController(service);
    const res = mockRes();

    ctrl.updateUserPassword(mockReq({ password: 'short' }, { id: '5' }), res);

    expect(service.updateUserPassword).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('updateUserPassword returns 400 when password is missing', () => {
    const service = createMockService();
    const ctrl = createBackofficeController(service);
    const res = mockRes();

    ctrl.updateUserPassword(mockReq({}, { id: '5' }), res);

    expect(service.updateUserPassword).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('getUserActionLogs returns paginated logs', () => {
    const logs = { data: [{ id: 1, action: 'start' }], total: 1, page: 0, totalPages: 1 };
    const service = createMockService({ getUserActionLogs: vi.fn().mockReturnValue(logs) });
    const ctrl = createBackofficeController(service);
    const res = mockRes();

    ctrl.getUserActionLogs({ params: { id: '5' }, query: { page: '0', limit: '20' }, user: { id: 1 } } as any, res);

    expect(service.getUserActionLogs).toHaveBeenCalledWith(5, 0, 20, undefined);
    expect(res.json).toHaveBeenCalledWith(logs);
  });

  it('getUserActionLogs pipes action query param to service filters', () => {
    const service = createMockService({ getUserActionLogs: vi.fn().mockReturnValue({ data: [], total: 0, page: 0, totalPages: 0 }) });
    const ctrl = createBackofficeController(service);
    const res = mockRes();

    ctrl.getUserActionLogs({ params: { id: '5' }, query: { page: '0', limit: '20', action: 'kill' }, user: { id: 1 } } as any, res);

    expect(service.getUserActionLogs).toHaveBeenCalledWith(5, 0, 20, { action: 'kill' });
  });

  it('getUserActionLogs pipes source query param to service filters', () => {
    const service = createMockService({ getUserActionLogs: vi.fn().mockReturnValue({ data: [], total: 0, page: 0, totalPages: 0 }) });
    const ctrl = createBackofficeController(service);
    const res = mockRes();

    ctrl.getUserActionLogs({ params: { id: '5' }, query: { page: '0', limit: '20', source: 'backoffice' }, user: { id: 1 } } as any, res);

    expect(service.getUserActionLogs).toHaveBeenCalledWith(5, 0, 20, { source: 'backoffice' });
  });

  it('getUserActionLogs pipes combined action + source filters', () => {
    const service = createMockService({ getUserActionLogs: vi.fn().mockReturnValue({ data: [], total: 0, page: 0, totalPages: 0 }) });
    const ctrl = createBackofficeController(service);
    const res = mockRes();

    ctrl.getUserActionLogs({ params: { id: '5' }, query: { page: '0', limit: '20', action: 'start', source: 'self' }, user: { id: 1 } } as any, res);

    expect(service.getUserActionLogs).toHaveBeenCalledWith(5, 0, 20, { action: 'start', source: 'self' });
  });
});
