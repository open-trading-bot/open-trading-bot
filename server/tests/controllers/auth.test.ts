import { describe, it, expect, vi } from 'vitest';
import { createAuthController } from '../../src/controllers/auth.js';

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
  res.json = vi.fn();
  return res;
}

function mockReq(body: any = {}) {
  return { body, headers: {}, ip: '127.0.0.1' } as any;
}

describe('AuthController', () => {
  it('returns 200 with token on success', () => {
    const authService = { login: vi.fn().mockReturnValue({ ok: true, token: 'jwt-token', role: 'admin', username: 'admin', disclaimerAccepted: false }) };
    const ctrl = createAuthController(authService);
    const res = mockRes();
    ctrl.login(mockReq({ username: 'admin', password: 'pass' }), res);
    expect(res.json).toHaveBeenCalledWith({ token: 'jwt-token', role: 'admin', username: 'admin', disclaimerAccepted: false });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 on invalid credentials', () => {
    const authService = { login: vi.fn().mockReturnValue({ ok: false, error: 'invalid_credentials', attemptsRemaining: 4 }) };
    const ctrl = createAuthController(authService);
    const res = mockRes();
    ctrl.login(mockReq({ username: 'admin', password: 'wrong' }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ attemptsRemaining: 4 }));
  });

  it('returns 429 on rate limited', () => {
    const authService = { login: vi.fn().mockReturnValue({ ok: false, error: 'rate_limited', retryAfter: 1800 }) };
    const ctrl = createAuthController(authService);
    const res = mockRes();
    ctrl.login(mockReq({ username: 'admin', password: 'pass' }), res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ retryAfter: 1800 }));
  });
});
