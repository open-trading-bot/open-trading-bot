import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import { createAuthRouter } from '../../src/routes/auth.js';
import { createAuthService } from '../../src/services/auth.js';
import { createAuthController } from '../../src/controllers/auth.js';
import { hashPassword } from '../../src/db/seed.js';
import type { Db, DbUser } from '../../src/db/index.js';

describe('Auth Routes', () => {
  let server: http.Server;
  let port: number;
  let authController: { login: any; getInvitation: any; acceptInvitation: any };
  let interestController: { submit: any };

  beforeEach(async () => {
    authController = {
      login: vi.fn((req: any, res: any) => res.json({ token: 'test' })),
      getInvitation: vi.fn((req: any, res: any) => res.json({ email: 'test@test.com' })),
      acceptInvitation: vi.fn((req: any, res: any) => res.json({ token: 'test', role: 'regular', username: 'user' })),
    };
    interestController = {
      submit: vi.fn((req: any, res: any) => res.json({ ok: true })),
    };
    const app = express();
    app.use(express.json());
    app.use('/', createAuthRouter(authController, interestController));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => { port = (server.address() as { port: number }).port; resolve(); });
    });
  });
  afterEach(() => server?.close());

  it('POST /login calls authController.login', async () => {
    const res = await fetch(`http://localhost:${port}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'pass' }),
    });
    expect(res.status).toBe(200);
    expect(authController.login).toHaveBeenCalled();
  });

  it('POST /interest calls interestController.submit', async () => {
    const res = await fetch(`http://localhost:${port}/interest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com' }),
    });
    expect(res.status).toBe(200);
    expect(interestController.submit).toHaveBeenCalled();
  });

  it('GET /login returns 404 (method not allowed)', async () => {
    const res = await fetch(`http://localhost:${port}/login`);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('Auth Controller — disabled account returns 401 (not 200)', () => {
  let server: http.Server;
  let port: number;

  const disabledUser: DbUser = {
    id: 2, username: 'blocked', email: null,
    passwordHash: hashPassword('pass'), role: 'regular',
    enabled: false, createdAt: Date.now(), lastLogin: null,
  } as DbUser;
  const activeUser: DbUser = {
    id: 1, username: 'admin', email: null,
    passwordHash: hashPassword('secret123'), role: 'admin',
    enabled: true, createdAt: Date.now(), lastLogin: null,
  } as DbUser;

  function mockDb(users: DbUser[]): Db {
    const store = new Map<string, DbUser>();
    for (const u of users) store.set(u.username, u);
    return {
      getUserByUsername(username: string) { return store.get(username) ?? null; },
      updateLastLogin() {},
    } as any as Db;
  }

  beforeEach(async () => {
    const db = mockDb([activeUser, disabledUser]);
    const authService = createAuthService(db, 'jwt-test-secret');
    const authController = createAuthController(authService, {} as any);
    const app = express();
    app.use(express.json());
    app.use('/', createAuthRouter(authController, { submit: (_r: any, res: any) => res.json({}) }));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => { port = (server.address() as { port: number }).port; resolve(); });
    });
  });
  afterEach(() => server?.close());

  it('returns 401 for a disabled account', async () => {
    const res = await fetch(`http://localhost:${port}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'blocked', password: 'pass' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Invalid credentials');
  });

  it('returns the same 401 for a non-existent account', async () => {
    const res = await fetch(`http://localhost:${port}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'doesnotexist', password: 'anything' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Invalid credentials');
  });

  it('disabled and non-existent accounts are indistinguishable in the response', async () => {
    const disabled = await fetch(`http://localhost:${port}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'blocked', password: 'pass' }),
    });
    const nonExistent = await fetch(`http://localhost:${port}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ghost', password: 'anything' }),
    });
    expect(disabled.status).toBe(nonExistent.status);
    const dBody = await disabled.json();
    const nBody = await nonExistent.json();
    expect(dBody.error).toBe(nBody.error);
  });
});
