import { describe, it, expect, vi } from 'vitest';
import { createDataController } from '../../src/controllers/data.js';
import type { Db } from '../../src/db/index.js';

// Mock the bybit adapter module
vi.mock('../../src/exchange/bybit.js', () => ({
  createBybitAdapter: vi.fn(),
}));

import { createBybitAdapter } from '../../src/exchange/bybit.js';
import { TEST_CIPHER } from '../utils/crypto-fixtures.js';
const mockedCreateBybit = vi.mocked(createBybitAdapter);

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
  res.json = vi.fn();
  return res;
}

let ipCounter = 0;
function mockReq(body: any = {}, user: any = { id: 1 }, ip?: string): any {
  return { body, user, ip: ip ?? `192.168.1.${++ipCounter}`, headers: {} };
}

function mockDb(): Db {
  return { getUsers: vi.fn().mockReturnValue([]), getUserById: vi.fn().mockReturnValue(null), getUserConfig: vi.fn().mockReturnValue(null), updateUserExchangeKeys: vi.fn(), updateExchangeTestnet: vi.fn(), updateUser: vi.fn() } as any;
}

function mockDataService(): any {
  return {};
}

describe('verifyExchangeKeys', () => {
  it('returns 400 when apiKey is missing', async () => {
    const ctrl = createDataController(mockDataService(), mockDb(), TEST_CIPHER);
    const res = mockRes();
    await ctrl.verifyExchangeKeys(mockReq({ apiSecret: 'sec' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'API key and secret are required' });
  });

  it('returns 400 when apiSecret is missing', async () => {
    const ctrl = createDataController(mockDataService(), mockDb(), TEST_CIPHER);
    const res = mockRes();
    await ctrl.verifyExchangeKeys(mockReq({ apiKey: 'key' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns ok with balance on successful bybit connection', async () => {
    mockedCreateBybit.mockReturnValue({
      fetchBalance: vi.fn().mockResolvedValue({ total: 5000, free: 4500 }),
    } as any);

    const ctrl = createDataController(mockDataService(), mockDb(), TEST_CIPHER);
    const res = mockRes();
    await ctrl.verifyExchangeKeys(mockReq({ apiKey: 'key', apiSecret: 'sec', testnet: true, exchange: 'bybit' }), res);

    expect(mockedCreateBybit).toHaveBeenCalledWith({ apiKey: 'key', secret: 'sec', testnet: true });
    expect(res.json).toHaveBeenCalledWith({ ok: true, exchange: 'bybit', balance: 5000 });
  });

  it('defaults to bybit when no exchange specified', async () => {
    mockedCreateBybit.mockReturnValue({
      fetchBalance: vi.fn().mockResolvedValue({ total: 10000, free: 9000 }),
    } as any);

    const ctrl = createDataController(mockDataService(), mockDb(), TEST_CIPHER);
    const res = mockRes();
    await ctrl.verifyExchangeKeys(mockReq({ apiKey: 'key', apiSecret: 'sec', testnet: false }), res);

    expect(mockedCreateBybit).toHaveBeenCalledWith({ apiKey: 'key', secret: 'sec', testnet: false });
    expect(res.json).toHaveBeenCalledWith({ ok: true, exchange: 'bybit', balance: 10000 });
  });

  it('returns 400 on unsupported exchange', async () => {
    const ctrl = createDataController(mockDataService(), mockDb(), TEST_CIPHER);
    const res = mockRes();
    await ctrl.verifyExchangeKeys(mockReq({ apiKey: 'key', apiSecret: 'sec', exchange: 'kraken' }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unsupported exchange' });
  });

  it('returns 400 when exchange connection fails', async () => {
    mockedCreateBybit.mockReturnValue({
      fetchBalance: vi.fn().mockRejectedValue(new Error('Invalid API key')),
    } as any);

    const ctrl = createDataController(mockDataService(), mockDb(), TEST_CIPHER);
    const res = mockRes();
    await ctrl.verifyExchangeKeys(mockReq({ apiKey: 'bad', apiSecret: 'bad', testnet: true, exchange: 'bybit' }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to verify exchange credentials. Please check your API key and secret.' });
  });

  it('returns 429 when rate limited', async () => {
    const ctrl = createDataController(mockDataService(), mockDb(), TEST_CIPHER);
    // Use a unique IP to avoid interference from other tests
    const ip = '10.0.0.99';
    for (let i = 0; i < 5; i++) {
      await ctrl.verifyExchangeKeys({ body: { apiKey: 'k', apiSecret: 's' }, user: { id: 1 }, ip, headers: {} } as any, mockRes());
    }
    const res = mockRes();
    await ctrl.verifyExchangeKeys({ body: { apiKey: 'k', apiSecret: 's' }, user: { id: 1 }, ip, headers: {} } as any, res);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('returns 400 when the key is flagged read-only by fetchPermissions', async () => {
    mockedCreateBybit.mockReturnValue({
      fetchBalance: vi.fn().mockResolvedValue({ total: 5000, free: 4500 }),
      fetchPermissions: vi.fn().mockResolvedValue({ readOnly: true, canTrade: false }),
    } as any);

    const ctrl = createDataController(mockDataService(), mockDb(), TEST_CIPHER);
    const res = mockRes();
    await ctrl.verifyExchangeKeys(mockReq({ apiKey: 'readonly', apiSecret: 'readonly', testnet: false, exchange: 'bybit' }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    const err = (res.json as any).mock.calls[0][0].error as string;
    expect(err).toContain('read-only');
  });

  it('returns 400 when fetchPermissions reports canTrade=false even if readOnly=false', async () => {
    mockedCreateBybit.mockReturnValue({
      fetchBalance: vi.fn().mockResolvedValue({ total: 5000, free: 4500 }),
      fetchPermissions: vi.fn().mockResolvedValue({ readOnly: false, canTrade: false }),
    } as any);

    const ctrl = createDataController(mockDataService(), mockDb(), TEST_CIPHER);
    const res = mockRes();
    await ctrl.verifyExchangeKeys(mockReq({ apiKey: 'noperm', apiSecret: 'noperm', testnet: false, exchange: 'bybit' }), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns ok when fetchPermissions reports canTrade=true', async () => {
    mockedCreateBybit.mockReturnValue({
      fetchBalance: vi.fn().mockResolvedValue({ total: 5000, free: 4500 }),
      fetchPermissions: vi.fn().mockResolvedValue({ readOnly: false, canTrade: true }),
    } as any);

    const ctrl = createDataController(mockDataService(), mockDb(), TEST_CIPHER);
    const res = mockRes();
    await ctrl.verifyExchangeKeys(mockReq({ apiKey: 'good', apiSecret: 'good', testnet: false, exchange: 'bybit' }), res);

    expect(res.json).toHaveBeenCalledWith({ ok: true, exchange: 'bybit', balance: 5000 });
  });

  it('is non-fatal when fetchPermissions itself throws', async () => {
    mockedCreateBybit.mockReturnValue({
      fetchBalance: vi.fn().mockResolvedValue({ total: 5000, free: 4500 }),
      fetchPermissions: vi.fn().mockRejectedValue(new Error('permission endpoint unavailable')),
    } as any);

    const ctrl = createDataController(mockDataService(), mockDb(), TEST_CIPHER);
    const res = mockRes();
    await ctrl.verifyExchangeKeys(mockReq({ apiKey: 'k', apiSecret: 's', testnet: false, exchange: 'bybit' }), res);

    // Should still succeed — we don't hard-block on permission query failures.
    expect(res.json).toHaveBeenCalledWith({ ok: true, exchange: 'bybit', balance: 5000 });
  });
});

describe('updateExchangeKeys', () => {
  it('verifies keys before saving and returns ok', async () => {
    mockedCreateBybit.mockReturnValue({
      fetchBalance: vi.fn().mockResolvedValue({ total: 5000, free: 4500 }),
    } as any);

    const db = mockDb();
    const ctrl = createDataController(mockDataService(), db, TEST_CIPHER);
    const res = mockRes();
    await ctrl.updateExchangeKeys(mockReq({ apiKey: 'valid', apiSecret: 'valid', testnet: true }), res);

    expect(res.json).toHaveBeenCalledWith({ hasKeys: true, testnet: true, keyHint: 'lid', secretHint: 'lid', exchange: 'bybit' });
    expect(db.updateUserExchangeKeys).toHaveBeenCalled();
    expect(db.updateUser).toHaveBeenCalledWith(1, { exchangeName: 'bybit' });
  });

  it('rejects keys that fail verification', async () => {
    mockedCreateBybit.mockReturnValue({
      fetchBalance: vi.fn().mockRejectedValue(new Error('Invalid API key')),
    } as any);

    const db = mockDb();
    const ctrl = createDataController(mockDataService(), db, TEST_CIPHER);
    const res = mockRes();
    await ctrl.updateExchangeKeys(mockReq({ apiKey: 'bad', apiSecret: 'bad', testnet: true }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(db.updateUserExchangeKeys).not.toHaveBeenCalled();
  });

  it('returns 400 when apiKey is missing', async () => {
    const ctrl = createDataController(mockDataService(), mockDb(), TEST_CIPHER);
    const res = mockRes();
    await ctrl.updateExchangeKeys(mockReq({ apiSecret: 'sec' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects read-only keys before persisting them', async () => {
    mockedCreateBybit.mockReturnValue({
      fetchBalance: vi.fn().mockResolvedValue({ total: 5000, free: 4500 }),
      fetchPermissions: vi.fn().mockResolvedValue({ readOnly: true, canTrade: false }),
    } as any);

    const db = mockDb();
    const ctrl = createDataController(mockDataService(), db, TEST_CIPHER);
    const res = mockRes();
    await ctrl.updateExchangeKeys(mockReq({ apiKey: 'readonly', apiSecret: 'readonly', testnet: false }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    const err = (res.json as any).mock.calls[0][0].error as string;
    expect(err).toContain('read-only');
    expect(db.updateUserExchangeKeys).not.toHaveBeenCalled();
    expect(db.updateUser).not.toHaveBeenCalled();
  });

  it('persists keys when fetchPermissions reports canTrade=true', async () => {
    mockedCreateBybit.mockReturnValue({
      fetchBalance: vi.fn().mockResolvedValue({ total: 5000, free: 4500 }),
      fetchPermissions: vi.fn().mockResolvedValue({ readOnly: false, canTrade: true }),
    } as any);

    const db = mockDb();
    const ctrl = createDataController(mockDataService(), db, TEST_CIPHER);
    const res = mockRes();
    await ctrl.updateExchangeKeys(mockReq({ apiKey: 'goodkey', apiSecret: 'goodsecret', testnet: false }), res);

    expect(res.json).toHaveBeenCalledWith({ hasKeys: true, testnet: false, keyHint: 'key', secretHint: 'ret', exchange: 'bybit' });
    expect(db.updateUserExchangeKeys).toHaveBeenCalled();
    // S7: stored values use the v2 format from the exchange-key cipher.
    const [, encKey, encSecret] = (db.updateUserExchangeKeys as any).mock.calls[0];
    expect(encKey).toMatch(/^v2:/);
    expect(encSecret).toMatch(/^v2:/);
    expect(TEST_CIPHER.decrypt(encKey)).toBe('goodkey');
    expect(TEST_CIPHER.decrypt(encSecret)).toBe('goodsecret');
  });
});

describe('checkExchangeKeyPermissions', () => {
  // The controller decrypts the stored values with TEST_CIPHER.

  function mockDbWithUser(user: any): Db {
    return {
      getUsers: vi.fn().mockReturnValue([]),
      getUserById: vi.fn().mockReturnValue(user),
      getUserConfig: vi.fn().mockReturnValue(null),
      updateUserExchangeKeys: vi.fn(),
      updateExchangeTestnet: vi.fn(),
      updateUser: vi.fn(),
    } as any;
  }

  it('returns hasKeys=false when user has no saved keys', async () => {
    const ctrl = createDataController(mockDataService(), mockDbWithUser({ id: 1 }), TEST_CIPHER);
    const res = mockRes();
    await ctrl.checkExchangeKeyPermissions(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith({ hasKeys: false });
  });

  it('returns readOnly=true when the saved key is read-only', async () => {
    // We need a valid encrypted value that decrypt() can unwrap. Import
    // the real crypto helper and encrypt a known string first.
    const encKey = TEST_CIPHER.encrypt('real-api-key');
    const encSecret = TEST_CIPHER.encrypt('real-api-secret');

    mockedCreateBybit.mockReturnValue({
      fetchPermissions: vi.fn().mockResolvedValue({ readOnly: true, canTrade: false }),
    } as any);

    const db = mockDbWithUser({
      id: 1, exchangeKey: encKey, exchangeSecret: encSecret,
      exchangeTestnet: false, exchangeName: 'bybit',
    });
    const ctrl = createDataController(mockDataService(), db, TEST_CIPHER);
    const res = mockRes();
    await ctrl.checkExchangeKeyPermissions(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith({ hasKeys: true, checked: true, readOnly: true, canTrade: false });
  });

  it('returns canTrade=true when the saved key can trade', async () => {
    const encKey = TEST_CIPHER.encrypt('real-api-key');
    const encSecret = TEST_CIPHER.encrypt('real-api-secret');

    mockedCreateBybit.mockReturnValue({
      fetchPermissions: vi.fn().mockResolvedValue({ readOnly: false, canTrade: true }),
    } as any);

    const db = mockDbWithUser({
      id: 1, exchangeKey: encKey, exchangeSecret: encSecret,
      exchangeTestnet: false, exchangeName: 'bybit',
    });
    const ctrl = createDataController(mockDataService(), db, TEST_CIPHER);
    const res = mockRes();
    await ctrl.checkExchangeKeyPermissions(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith({ hasKeys: true, checked: true, readOnly: false, canTrade: true });
  });

  it('returns checked=false when fetchPermissions throws', async () => {
    const encKey = TEST_CIPHER.encrypt('real-api-key');
    const encSecret = TEST_CIPHER.encrypt('real-api-secret');

    mockedCreateBybit.mockReturnValue({
      fetchPermissions: vi.fn().mockRejectedValue(new Error('network down')),
    } as any);

    const db = mockDbWithUser({
      id: 1, exchangeKey: encKey, exchangeSecret: encSecret,
      exchangeTestnet: false, exchangeName: 'bybit',
    });
    const ctrl = createDataController(mockDataService(), db, TEST_CIPHER);
    const res = mockRes();
    await ctrl.checkExchangeKeyPermissions(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith({ hasKeys: true, checked: false, error: 'check-failed' });
  });

  it('returns checked=false when adapter has no fetchPermissions method', async () => {
    const encKey = TEST_CIPHER.encrypt('real-api-key');
    const encSecret = TEST_CIPHER.encrypt('real-api-secret');

    mockedCreateBybit.mockReturnValue({
      // No fetchPermissions method
    } as any);

    const db = mockDbWithUser({
      id: 1, exchangeKey: encKey, exchangeSecret: encSecret,
      exchangeTestnet: false, exchangeName: 'bybit',
    });
    const ctrl = createDataController(mockDataService(), db, TEST_CIPHER);
    const res = mockRes();
    await ctrl.checkExchangeKeyPermissions(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith({ hasKeys: true, checked: false });
  });
});

describe('clearExchangeKeys', () => {
  it('clears keys and returns hasKeys false', () => {
    const db = mockDb();
    const ctrl = createDataController(mockDataService(), db, TEST_CIPHER);
    const res = mockRes();
    ctrl.clearExchangeKeys(mockReq(), res);

    expect(db.updateUserExchangeKeys).toHaveBeenCalledWith(1, '', '', true);
    expect(res.json).toHaveBeenCalledWith({ hasKeys: false, testnet: true, keyHint: '', secretHint: '' });
  });
});

describe('updateExchangeTestnet', () => {
  it('updates testnet to false', () => {
    const db = mockDb();
    const ctrl = createDataController(mockDataService(), db, TEST_CIPHER);
    const res = mockRes();
    ctrl.updateExchangeTestnet(mockReq({ testnet: false }), res);

    expect(db.updateExchangeTestnet).toHaveBeenCalledWith(1, false);
    expect(res.json).toHaveBeenCalledWith({ ok: true, testnet: false });
  });

  it('updates testnet to true', () => {
    const db = mockDb();
    const ctrl = createDataController(mockDataService(), db, TEST_CIPHER);
    const res = mockRes();
    ctrl.updateExchangeTestnet(mockReq({ testnet: true }), res);

    expect(db.updateExchangeTestnet).toHaveBeenCalledWith(1, true);
    expect(res.json).toHaveBeenCalledWith({ ok: true, testnet: true });
  });

  it('coerces non-boolean testnet to false', () => {
    const db = mockDb();
    const ctrl = createDataController(mockDataService(), db, TEST_CIPHER);
    const res = mockRes();
    ctrl.updateExchangeTestnet(mockReq({ testnet: 'yes' }), res);

    expect(db.updateExchangeTestnet).toHaveBeenCalledWith(1, false);
    expect(res.json).toHaveBeenCalledWith({ ok: true, testnet: false });
  });
});
