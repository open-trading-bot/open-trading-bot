import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import { authMiddleware } from '../../src/middleware/auth.js';
import { createDb, type Db } from '../../src/db/index.js';
import { signUserToken } from '../../src/utils/jwt.js';
import { hashPassword } from '../../src/db/seed.js';
import { createAuthService } from '../../src/services/auth.js';

const API_KEY = 'test-api-key-0123456789abcdef0123456789';
const JWT_SECRET = 'test-jwt-secret-0123456789abcdef012345';

describe('Auth middleware: session revocation (S2)', () => {
  let db: Db;
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    db = createDb(':memory:');
    const app = express();
    app.use(authMiddleware(API_KEY, JWT_SECRET, (id) => db.getUserById(id)));
    app.get('/api/me', (req, res) => res.json((req as any).user));
    await new Promise<void>((r) => { server = app.listen(0, () => { port = (server.address() as any).port; r(); }); });
  });
  afterEach(() => { server.close(); db.close(); });

  const call = (token: string) =>
    fetch(`http://localhost:${port}/api/me`, { headers: { Authorization: `Bearer ${token}` } });

  it('accepts a token for an enabled user and takes the role from the database', async () => {
    const u = db.createUser('alice', null, hashPassword('x'), 'regular');
    const token = signUserToken(db.getUserById(u.id)!, JWT_SECRET);
    db.updateUser(u.id, { role: 'demo' });
    const res = await call(token);
    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe('demo');
  });

  it('rejects an old token after sessions are revoked, even after a new login', async () => {
    const u = db.createUser('bob', null, hashPassword('Secret1!'), 'admin');
    const oldToken = signUserToken(db.getUserById(u.id)!, JWT_SECRET);
    db.bumpTokenVersion(u.id);
    // A new login must not make the old token valid again.
    const login = createAuthService(db, JWT_SECRET).login('1.1.1.1', 'bob', 'Secret1!');
    expect(login.ok).toBe(true);
    expect((await call(oldToken)).status).toBe(401);
    expect((await call(login.token!)).status).toBe(200);
  });

  it('rejects a token of a disabled user', async () => {
    const u = db.createUser('carol', null, hashPassword('x'), 'regular');
    const token = signUserToken(db.getUserById(u.id)!, JWT_SECRET);
    db.updateUser(u.id, { enabled: false });
    expect((await call(token)).status).toBe(401);
  });

  it('rejects a token of a deleted user', async () => {
    const u = db.createUser('dave', null, hashPassword('x'), 'regular');
    const token = signUserToken(db.getUserById(u.id)!, JWT_SECRET);
    db.deleteUser(u.id);
    expect((await call(token)).status).toBe(401);
  });

  it('rejects upper-case API paths without credentials (S8)', async () => {
    const res = await fetch(`http://localhost:${port}/API/me`);
    expect(res.status).toBe(401);
  });
});

describe('Auth service: rate limit (S1)', () => {
  it('locks an account after repeated failures, whatever the client IP is', () => {
    const db = createDb(':memory:');
    db.createUser('eve', null, hashPassword('Right1!'), 'admin');
    const auth = createAuthService(db, JWT_SECRET);
    for (let i = 0; i < 10; i++) auth.login(`10.0.0.${i}`, 'eve', 'wrong');
    const res = auth.login('10.0.0.99', 'eve', 'Right1!');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('rate_limited');
    db.close();
  });
});
