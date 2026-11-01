import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../../src/middleware/auth.js';
import http from 'http';

const API_KEY = 'test-secret';
const JWT_SECRET = 'jwt-test-secret';

describe('Auth Middleware', () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    const app = express();
    app.use(authMiddleware(API_KEY, JWT_SECRET));
    app.get('/api/test', (req, res) => res.json({ ok: true, user: (req as any).user }));
    app.get('/api/health', (_req, res) => res.json({ ok: true }));
    app.get('/api/auth/invitation/:token', (_req, res) => res.json({ ok: true }));
    app.get('/api/admin/secret', (_req, res) => res.json({ ok: true }));

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterEach(() => server?.close());

  it('rejects requests without API key', async () => {
    const res = await fetch(`http://localhost:${port}/api/test`);
    expect(res.status).toBe(401);
  });

  it('accepts requests with valid API key and sets admin role', async () => {
    const res = await fetch(`http://localhost:${port}/api/test`, {
      headers: { 'x-api-key': API_KEY },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user.role).toBe('admin');
  });

  it('accepts requests with valid JWT and attaches user', async () => {
    const token = jwt.sign({ id: 42, username: 'testuser', role: 'regular' }, JWT_SECRET);
    const res = await fetch(`http://localhost:${port}/api/test`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user.id).toBe(42);
    expect(data.user.username).toBe('testuser');
    expect(data.user.role).toBe('regular');
  });

  it('allows /api/health without auth', async () => {
    const res = await fetch(`http://localhost:${port}/api/health`);
    expect(res.status).toBe(200);
  });

  it('allows /api/auth/invitation/:token without auth (public prefix)', async () => {
    const res = await fetch(`http://localhost:${port}/api/auth/invitation/sometoken`);
    expect(res.status).toBe(200);
  });

  it('rejects path-traversal attempt that hides under the invitation prefix', async () => {
    const res = await fetch(`http://localhost:${port}/api/auth/invitation/../admin/secret`);
    expect(res.status).toBe(401);
  });

  it('rejects raw-path /../api/... that would otherwise bypass the non-api short-circuit', async () => {
    // HTTP clients normalize URLs before sending, so this scenario can't be
    // reproduced via fetch. Invoke the middleware directly with a mock req
    // whose `path` still contains the literal `..`. The middleware must
    // check the NORMALIZED path when deciding whether to short-circuit for
    // non-api routes — otherwise `/../api/backoffice/invitations` skips
    // the auth check entirely.
    const mw = authMiddleware(API_KEY, JWT_SECRET);
    const req = { method: 'GET', path: '/../api/backoffice/invitations', headers: {} } as any;
    let statusCode = 200;
    let nextCalled = false;
    const res = {
      status(code: number) { statusCode = code; return this; },
      json(_body: unknown) { return this; },
    } as any;
    const next = () => { nextCalled = true; };
    mw(req, res, next);
    expect(nextCalled).toBe(false);
    expect(statusCode).toBe(401);
  });
});
