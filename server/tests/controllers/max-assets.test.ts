import { describe, it, expect, vi } from 'vitest';
import { createDataController } from '../../src/controllers/data.js';
import type { Db } from '../../src/db/index.js';
import { TEST_CIPHER } from '../utils/crypto-fixtures.js';

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
  res.json = vi.fn();
  return res;
}

function mockReq(body: any = {}, user: any = { id: 1, role: 'regular' }): any {
  return { body, user, ip: '127.0.0.1', headers: {} };
}

function mockDb(): Db {
  return { getUsers: vi.fn().mockReturnValue([]), getUserById: vi.fn().mockReturnValue(null), getUserConfig: vi.fn().mockReturnValue(null), updateUserExchangeKeys: vi.fn(), updateExchangeTestnet: vi.fn() } as any;
}

function mockDataService(): any {
  return {
    updateConfig: vi.fn().mockResolvedValue({ ok: true, config: {} }),
  };
}

function makeAssets(count: number, enabled = true) {
  return Array.from({ length: count }, (_, i) => ({
    symbol: `ASSET${i}/USDT`,
    enabled,
    marketType: 'spot',
  }));
}

describe('updateConfig — max assets limit', () => {
  it('allows up to 10 enabled assets', async () => {
    const service = mockDataService();
    const ctrl = createDataController(service, mockDb(), TEST_CIPHER);
    const res = mockRes();

    await ctrl.updateConfig(mockReq({ assets: makeAssets(10) }), res);

    expect(service.updateConfig).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects more than 10 enabled assets', async () => {
    const service = mockDataService();
    const ctrl = createDataController(service, mockDb(), TEST_CIPHER);
    const res = mockRes();

    await ctrl.updateConfig(mockReq({ assets: makeAssets(11) }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(service.updateConfig).not.toHaveBeenCalled();
  });

  it('allows more than 10 assets if some are disabled', async () => {
    const service = mockDataService();
    const ctrl = createDataController(service, mockDb(), TEST_CIPHER);
    const res = mockRes();

    const assets = [...makeAssets(10), ...makeAssets(5, false)];
    await ctrl.updateConfig(mockReq({ assets }), res);

    expect(service.updateConfig).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows config updates without assets field', async () => {
    const service = mockDataService();
    const ctrl = createDataController(service, mockDb(), TEST_CIPHER);
    const res = mockRes();

    await ctrl.updateConfig(mockReq({ tradeAmount: 200 }), res);

    expect(service.updateConfig).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows up to 20 total assets', async () => {
    const service = mockDataService();
    const ctrl = createDataController(service, mockDb(), TEST_CIPHER);
    const res = mockRes();

    const assets = [...makeAssets(10), ...makeAssets(10, false)];
    await ctrl.updateConfig(mockReq({ assets }), res);

    expect(service.updateConfig).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects more than 20 total assets', async () => {
    const service = mockDataService();
    const ctrl = createDataController(service, mockDb(), TEST_CIPHER);
    const res = mockRes();

    const assets = [...makeAssets(10), ...makeAssets(11, false)];
    await ctrl.updateConfig(mockReq({ assets }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(service.updateConfig).not.toHaveBeenCalled();
  });
});
