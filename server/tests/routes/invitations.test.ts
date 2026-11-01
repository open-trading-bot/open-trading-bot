import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import { createDb } from '../../src/db/index.js';
import { createInvitationsService } from '../../src/services/invitations.js';
import { createAuthController } from '../../src/controllers/auth.js';
import { createBackofficeController } from '../../src/controllers/backoffice.js';
import { createAuthRouter } from '../../src/routes/auth.js';
import { createBackofficeRouter } from '../../src/routes/backoffice.js';
import { createAuthService } from '../../src/services/auth.js';
import { createBackofficeService } from '../../src/services/backoffice.js';
import { ROLES } from '../../src/utils/constants.js';

const emailMock = { isConfigured: vi.fn(() => true), send: vi.fn().mockResolvedValue(undefined) };

function buildApp() {
  const db = createDb(':memory:');
  const invitationsService = createInvitationsService(
    db,
    emailMock as any,
    'https://app.example.com',
    (u) => `jwt_for_${u.id}`,
  );
  const authService = createAuthService(db, 'test-secret');
  const backofficeService = createBackofficeService(db, null as any);
  const authController = createAuthController(authService, invitationsService);
  const backofficeController = createBackofficeController(backofficeService, {} as any, invitationsService);

  const app = express();
  app.use(express.json());
  // Inject admin user for backoffice routes
  app.use((req, _res, next) => {
    (req as any).user = { id: 1, username: 'admin', role: ROLES.ADMIN };
    next();
  });
  app.use('/api/backoffice', createBackofficeRouter(backofficeController));
  // Public auth routes — mount directly on the same app (user injection above won't break them)
  app.use('/api/auth', createAuthRouter(authController, { submit: (_r: any, res: any) => res.json({}) }));

  return { app, db };
}

let server: http.Server;
let port: number;
let dbRef: ReturnType<typeof createDb>;

async function startServer() {
  const { app, db } = buildApp();
  dbRef = db;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      port = (server.address() as any).port;
      resolve();
    });
  });
}

beforeEach(async () => {
  emailMock.send.mockClear();
  await startServer();
});

afterEach(() => server?.close());

async function call(method: string, path: string, body?: any) {
  const res = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

describe('POST /api/backoffice/invitations', () => {
  it('creates an invitation and calls the email service', async () => {
    const res = await call('POST', '/api/backoffice/invitations', { email: 'new@example.com' });
    expect(res.status).toBe(200);
    expect(emailMock.send).toHaveBeenCalledTimes(1);
    expect(emailMock.send.mock.calls[0][0].to).toBe('new@example.com');
  });

  it('returns 400 on invalid email', async () => {
    const res = await call('POST', '/api/backoffice/invitations', { email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when the email field is missing entirely', async () => {
    const res = await call('POST', '/api/backoffice/invitations', {});
    expect(res.status).toBe(400);
  });

  it('returns 409 when user already exists', async () => {
    dbRef.createUser('existing@example.com', 'existing@example.com', 'hash', 'regular');
    const res = await call('POST', '/api/backoffice/invitations', { email: 'existing@example.com' });
    expect(res.status).toBe(409);
  });

  it('invalidates existing pending invitation when sending new one', async () => {
    await call('POST', '/api/backoffice/invitations', { email: 'x@example.com' });
    await call('POST', '/api/backoffice/invitations', { email: 'x@example.com' });
    expect(emailMock.send).toHaveBeenCalledTimes(2);
    const list = await call('GET', '/api/backoffice/invitations?status=all');
    const rows = list.body as any[];
    const revokedCount = rows.filter((r) => r.status === 'revoked').length;
    expect(revokedCount).toBe(1);
  });
});

describe('GET /api/backoffice/invitations', () => {
  it('does not leak tokenHash in the response', async () => {
    await call('POST', '/api/backoffice/invitations', { email: 'leak@example.com' });
    const list = await call('GET', '/api/backoffice/invitations');
    const rows = list.body as any[];
    expect(rows.length).toBe(1);
    expect(rows[0]).not.toHaveProperty('tokenHash');
  });

  it('returns all invitations regardless of status (client handles filtering)', async () => {
    await call('POST', '/api/backoffice/invitations', { email: 'a@example.com' });
    await call('POST', '/api/backoffice/invitations', { email: 'b@example.com' });
    // Mark one as accepted.
    const seeded: any = dbRef.listInvitations({ includeAll: true })[0];
    dbRef.updateInvitationState(seeded.id, { acceptedAt: Date.now() });

    const list = await call('GET', '/api/backoffice/invitations');
    const rows = list.body as any[];
    expect(rows).toHaveLength(2);
    const statuses = rows.map((r) => r.status).sort();
    expect(statuses).toEqual(['accepted', 'pending']);
  });
});

describe('DELETE /api/backoffice/invitations/:id', () => {
  it('sets revoked_at', async () => {
    await call('POST', '/api/backoffice/invitations', { email: 'y@example.com' });
    const seeded: any = dbRef.listInvitations({ includeAll: false })[0];
    const res = await call('DELETE', `/api/backoffice/invitations/${seeded.id}`);
    expect(res.status).toBe(200);
    const after = dbRef.getInvitationById(seeded.id);
    expect(after!.revokedAt).not.toBeNull();
  });
});

describe('POST /api/backoffice/invitations/:id/resend', () => {
  it('issues a new token, revokes the original, and calls the email service again', async () => {
    await call('POST', '/api/backoffice/invitations', { email: 'z@example.com' });
    const original: any = dbRef.listInvitations({ includeAll: false })[0];
    expect(emailMock.send).toHaveBeenCalledTimes(1);

    const res = await call('POST', `/api/backoffice/invitations/${original.id}/resend`);
    expect(res.status).toBe(200);
    expect(emailMock.send).toHaveBeenCalledTimes(2);

    const originalAfter = dbRef.getInvitationById(original.id);
    expect(originalAfter!.revokedAt).not.toBeNull();

    const active = dbRef.listInvitations({ includeAll: false });
    expect(active).toHaveLength(1);
    expect(active[0].id).not.toBe(original.id);
    expect(active[0].email).toBe('z@example.com');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await call('POST', '/api/backoffice/invitations/does-not-exist/resend');
    expect(res.status).toBe(404);
  });
});

describe('public invitation endpoints', () => {
  it('GET /api/auth/invitation/:token returns 404 for unknown token', async () => {
    const res = await call('GET', '/api/auth/invitation/nonsense');
    expect(res.status).toBe(404);
  });

  it('POST accept creates user and returns JWT token + username', async () => {
    await call('POST', '/api/backoffice/invitations', { email: 'invited@example.com' });
    const msg = emailMock.send.mock.calls[0][0] as { text: string };
    const match = msg.text.match(/accept-invite\?token=([A-Za-z0-9_-]+)/);
    const rawToken = match![1];

    const lookup = await call('GET', `/api/auth/invitation/${rawToken}`);
    expect(lookup.status).toBe(200);
    expect((lookup.body as any).email).toBe('invited@example.com');

    const accept = await call('POST', `/api/auth/invitation/${rawToken}/accept`, { password: 'Password123!', signature: 'I ACCEPT', lang: 'en' });
    expect(accept.status).toBe(200);
    expect((accept.body as any).token).toBe('jwt_for_1');
    expect((accept.body as any).username).toBe('invited@example.com');

    // Single-use
    const again = await call('POST', `/api/auth/invitation/${rawToken}/accept`, { password: 'Password123!', signature: 'I ACCEPT', lang: 'en' });
    expect(again.status).toBe(404);
  });

  it('POST accept rejects a non-string password (numeric)', async () => {
    await call('POST', '/api/backoffice/invitations', { email: 'numpw@example.com' });
    const msg = emailMock.send.mock.calls[0][0] as { text: string };
    const match = msg.text.match(/accept-invite\?token=([A-Za-z0-9_-]+)/);
    const rawToken = match![1];

    const res = await call('POST', `/api/auth/invitation/${rawToken}/accept`, { password: 12345678 });
    expect(res.status).toBe(400);
  });

  it('POST accept rejects short password', async () => {
    await call('POST', '/api/backoffice/invitations', { email: 'short@example.com' });
    const msg = emailMock.send.mock.calls[0][0] as { text: string };
    const match = msg.text.match(/accept-invite\?token=([A-Za-z0-9_-]+)/);
    const rawToken = match![1];

    const res = await call('POST', `/api/auth/invitation/${rawToken}/accept`, { password: 'short' });
    expect(res.status).toBe(400);
  });
});
