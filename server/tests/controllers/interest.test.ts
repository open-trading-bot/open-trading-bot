import { describe, it, expect, vi } from 'vitest';
import { createInterestController } from '../../src/controllers/interest.js';

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
  res.json = vi.fn();
  return res;
}

function mockReq(body: any = {}) {
  return { body, headers: {}, ip: '127.0.0.1' } as any;
}

describe('InterestController', () => {
  it('returns 200 on success', async () => {
    const svc = { submit: vi.fn().mockResolvedValue({ ok: true }) };
    const ctrl = createInterestController(svc);
    const res = mockRes();
    await ctrl.submit(mockReq({ email: 'a@b.com' }), res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('returns 429 on rate limited', async () => {
    const svc = { submit: vi.fn().mockResolvedValue({ ok: false, error: 'rate_limited' }) };
    const ctrl = createInterestController(svc);
    const res = mockRes();
    await ctrl.submit(mockReq({ email: 'a@b.com' }), res);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('returns 400 on invalid email', async () => {
    const svc = { submit: vi.fn().mockResolvedValue({ ok: false, error: 'invalid_email' }) };
    const ctrl = createInterestController(svc);
    const res = mockRes();
    await ctrl.submit(mockReq({ email: 'bad' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 on captcha failed', async () => {
    const svc = { submit: vi.fn().mockResolvedValue({ ok: false, error: 'captcha_failed' }) };
    const ctrl = createInterestController(svc);
    const res = mockRes();
    await ctrl.submit(mockReq({ email: 'a@b.com', captchaToken: 'bad' }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
