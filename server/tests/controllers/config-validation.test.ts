import { describe, it, expect, vi } from 'vitest';
import { createDataController } from '../../src/controllers/data.js';
import type { Db } from '../../src/db/index.js';

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
  res.json = vi.fn();
  return res;
}

const req = (body: unknown, role = 'regular'): any => ({ body, user: { id: 1, role }, ip: '127.0.0.1', headers: {} });
const db = (): Db => ({ getUserById: vi.fn().mockReturnValue(null), getUserConfig: vi.fn().mockReturnValue(null) } as any);

describe('PUT /api/config validation (S3)', () => {
  it.each([
    [{ tickInterval: 0.001 }],
    [{ dailyLossLimit: 'x' }],
    [{ maxOpenPositions: 'x' }],
  ])('returns 400 and does not change the bot for %j', async (body) => {
    const service = { updateConfig: vi.fn() };
    const res = mockRes();
    await createDataController(service as any, db(), 'secret').updateConfig(req(body, 'demo'), res);
    expect(res.statusCode).toBe(400);
    expect(service.updateConfig).not.toHaveBeenCalled();
  });

  it('passes only validated fields to the service', async () => {
    const service = { updateConfig: vi.fn().mockResolvedValue({ ok: true, config: {} }) };
    const res = mockRes();
    await createDataController(service as any, db(), 'secret').updateConfig(req({ tickInterval: 30, evil: 1 }), res);
    expect(service.updateConfig).toHaveBeenCalledWith(1, { tickInterval: 30 });
  });
});
