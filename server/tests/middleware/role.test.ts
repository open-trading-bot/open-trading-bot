import { describe, it, expect, vi } from 'vitest';
import { requireRole } from '../../src/middleware/role.js';
import { HTTP_STATUS, ERROR_MSG } from '../../src/utils/constants.js';

function mockReq(user?: { role: string }): any {
  return { user };
}

function mockRes() {
  const res: any = { statusCode: 200 };
  res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
  res.json = vi.fn();
  return res;
}

describe('requireRole middleware', () => {
  it('allows access when user has matching role', () => {
    const middleware = requireRole('admin');
    const req = mockReq({ role: 'admin' });
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows access when user has one of multiple allowed roles', () => {
    const middleware = requireRole('admin', 'regular');
    const req = mockReq({ role: 'regular' });
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when user has wrong role', () => {
    const middleware = requireRole('admin');
    const req = mockReq({ role: 'demo' });
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.FORBIDDEN);
    expect(res.json).toHaveBeenCalledWith({ error: ERROR_MSG.FORBIDDEN });
  });

  it('returns 403 when no user on request', () => {
    const middleware = requireRole('admin');
    const req = mockReq(undefined);
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.FORBIDDEN);
    expect(res.json).toHaveBeenCalledWith({ error: ERROR_MSG.FORBIDDEN });
  });
});
