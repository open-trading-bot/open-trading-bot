import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createInvitationsService } from '../../src/services/invitations.js';
import type { Db, DbInvitation, DbUser } from '../../src/db/index.js';
import { ERROR_MSG } from '../../src/utils/constants.js';
import crypto from 'crypto';

function sha256(s: string) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function createMockDb(): Db {
  const invitations = new Map<string, DbInvitation>();
  const users = new Map<string, DbUser>();
  const db = {
    createInvitation(inv: any) {
      invitations.set(inv.id, { ...inv, acceptedAt: null, revokedAt: null });
    },
    getInvitationByTokenHash(h: string) {
      for (const inv of invitations.values()) if (inv.tokenHash === h) return inv;
      return null;
    },
    getInvitationById(id: string) {
      return invitations.get(id) ?? null;
    },
    getActiveInvitationByEmail(email: string) {
      for (const inv of invitations.values()) {
        if (inv.email === email && inv.acceptedAt == null && inv.revokedAt == null) return inv;
      }
      return null;
    },
    listInvitations({ includeAll }: { includeAll: boolean }) {
      return Array.from(invitations.values()).filter((i) =>
        includeAll || (i.acceptedAt == null && i.revokedAt == null),
      );
    },
    updateInvitationState(id: string, patch: any) {
      const existing = invitations.get(id);
      if (!existing) return;
      invitations.set(id, { ...existing, ...patch });
    },
    getUserByUsername(username: string) {
      return users.get(username) ?? null;
    },
    createUser(username: string, email: string | null, passwordHash: string, role: string) {
      if (users.has(username)) {
        const e: any = new Error('UNIQUE constraint failed: users.username');
        e.code = 'SQLITE_CONSTRAINT_UNIQUE';
        throw e;
      }
      const id = users.size + 1;
      const user: DbUser = {
        id,
        username,
        email,
        passwordHash,
        role,
        enabled: true,
        createdAt: Date.now(),
        lastLogin: null,
        exchangeKey: null,
        exchangeSecret: null,
        exchangeTestnet: true,
        walletAddress: null,
        paperBalance: 10000,
        lang: 'en',
        theme: 'dark',
        exchangeName: 'bybit',
        disclaimerAcceptedAt: null,
        disclaimerVersion: null,
        disclaimerLang: null,
        disclaimerSignature: null,
        disclaimerIp: null,
        disclaimerUserAgent: null,
      };
      users.set(username, user);
      return { id, username, role };
    },
    setUserConfig: vi.fn(),
    acceptDisclaimerForUser: vi.fn(),
    updateLastLogin: vi.fn(),
    // No-op transaction wrapper so doAccept's db.db.transaction(fn)() call works
    // identically to executing fn() directly in the mock world.
    db: {
      transaction: (fn: () => any) => () => fn(),
    },
  } as unknown as Db;
  return db;
}

const EMAIL_SERVICE = { isConfigured: vi.fn(() => true), send: vi.fn() };
const NOW = 1000000;

// Narrowing helper: most tests only care about the happy path where the
// email service is configured and the service returns the sent=true variant.
async function createOk(svc: ReturnType<typeof createInvitationsService>, args: { email: string; createdBy: number }) {
  const r = await svc.create(args);
  if (!r.emailSent) throw new Error('test expected emailSent=true but got false');
  return r;
}

describe('InvitationsService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    EMAIL_SERVICE.send.mockReset();
    EMAIL_SERVICE.send.mockResolvedValue(undefined);
    EMAIL_SERVICE.isConfigured.mockReturnValue(true);
  });

  describe('create', () => {
    it('stores only the token hash and returns the raw token once', async () => {
      const db = createMockDb();
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      const result = await createOk(svc, { email: 'new@example.com', createdBy: 1 });

      expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]+$/);
      const stored = db.getInvitationByTokenHash(sha256(result.rawToken));
      expect(stored).not.toBeNull();
      expect(stored!.email).toBe('new@example.com');
      expect(stored!.expiresAt).toBe(NOW + 72 * 60 * 60 * 1000);
    });

    it('sends the invitation email with the correct accept URL', async () => {
      const db = createMockDb();
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      const result = await createOk(svc, { email: 'new@example.com', createdBy: 1 });
      expect(EMAIL_SERVICE.send).toHaveBeenCalledTimes(1);
      const msg = EMAIL_SERVICE.send.mock.calls[0][0];
      expect(msg.to).toBe('new@example.com');
      expect(msg.html).toContain(`https://app.example.com/accept-invite?token=${result.rawToken}`);
      expect(msg.text).toContain(`https://app.example.com/accept-invite?token=${result.rawToken}`);
    });

    it('rejects emails that fail basic regex validation', async () => {
      const db = createMockDb();
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      await expect(svc.create({ email: 'not-an-email', createdBy: 1 })).rejects.toThrow(ERROR_MSG.INVALID_EMAIL);
    });

    it('rejects when a user with that email already exists', async () => {
      const db = createMockDb();
      db.createUser('existing@example.com', 'existing@example.com', 'hash', 'regular');
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      await expect(svc.create({ email: 'existing@example.com', createdBy: 1 })).rejects.toThrow(ERROR_MSG.USER_EXISTS);
    });

    it('invalidates the old pending invitation when sending a new one', async () => {
      const db = createMockDb();
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      const first = await createOk(svc, { email: 'new@example.com', createdBy: 1 });
      const second = await createOk(svc, { email: 'new@example.com', createdBy: 1 });
      expect(first.rawToken).not.toBe(second.rawToken);

      const firstRow = db.getInvitationByTokenHash(sha256(first.rawToken));
      expect(firstRow!.revokedAt).toBe(NOW);
      const secondRow = db.getInvitationByTokenHash(sha256(second.rawToken));
      expect(secondRow!.revokedAt).toBeNull();
    });

    it('revokes the row when the email send fails so it does not appear in the default list', async () => {
      const db = createMockDb();
      const failingEmail = {
        isConfigured: vi.fn(() => true),
        send: vi.fn().mockRejectedValue(new Error('boom')),
      };
      const svc = createInvitationsService(db, failingEmail as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      await expect(svc.create({ email: 'x@example.com', createdBy: 1 })).rejects.toThrow('boom');

      // Row is marked revoked (audit trail kept) and filtered out of the
      // default list view.
      const all = db.listInvitations({ includeAll: true });
      expect(all).toHaveLength(1);
      expect(all[0].revokedAt).toBe(NOW);
      const active = db.listInvitations({ includeAll: false });
      expect(active).toHaveLength(0);
    });

    it('returns emailSent=false and does NOT persist a row when the email service is not configured', async () => {
      const db = createMockDb();
      const unconfiguredEmail = {
        isConfigured: vi.fn(() => false),
        send: vi.fn(),
      };
      const svc = createInvitationsService(db, unconfiguredEmail as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      const result = await svc.create({ email: 'x@example.com', createdBy: 1 });
      expect(result).toEqual({ emailSent: false });
      expect(unconfiguredEmail.send).not.toHaveBeenCalled();
      expect(db.listInvitations({ includeAll: true })).toHaveLength(0);
    });

    it('returns emailSent=true on the happy path', async () => {
      const db = createMockDb();
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      const result = await svc.create({ email: 'x@example.com', createdBy: 1 });
      expect(result.emailSent).toBe(true);
    });
  });

  describe('lookup', () => {
    it('returns the invitation email for a valid raw token', async () => {
      const db = createMockDb();
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      const { rawToken } = await createOk(svc, { email: 'ok@example.com', createdBy: 1 });
      const looked = svc.lookup(rawToken);
      expect(looked).not.toBeNull();
      expect(looked!.email).toBe('ok@example.com');
    });

    it('returns null for an unknown token', () => {
      const db = createMockDb();
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      expect(svc.lookup('nonsense')).toBeNull();
    });

    it('returns null for a revoked token', async () => {
      const db = createMockDb();
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      const { rawToken } = await createOk(svc, { email: 'ok@example.com', createdBy: 1 });
      const inv = db.getInvitationByTokenHash(sha256(rawToken))!;
      db.updateInvitationState(inv.id, { revokedAt: NOW });
      expect(svc.lookup(rawToken)).toBeNull();
    });

    it('returns null for an accepted token', async () => {
      const db = createMockDb();
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      const { rawToken } = await createOk(svc, { email: 'ok@example.com', createdBy: 1 });
      const inv = db.getInvitationByTokenHash(sha256(rawToken))!;
      db.updateInvitationState(inv.id, { acceptedAt: NOW });
      expect(svc.lookup(rawToken)).toBeNull();
    });

    it('returns null for an expired token', async () => {
      const db = createMockDb();
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      const { rawToken } = await createOk(svc, { email: 'ok@example.com', createdBy: 1 });
      vi.setSystemTime(NOW + 73 * 60 * 60 * 1000);
      expect(svc.lookup(rawToken)).toBeNull();
    });
  });

  describe('accept', () => {
    it('creates a regular user with username = email and marks accepted_at', async () => {
      const db = createMockDb();
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      const { rawToken } = await createOk(svc, { email: 'new@example.com', createdBy: 1 });
      const result = svc.accept(rawToken, 'Password123!', { signature: 'I ACCEPT', lang: 'en', ip: null, userAgent: null });
      expect(result.user.username).toBe('new@example.com');
      expect(result.user.role).toBe('regular');
      const stored = db.getUserByUsername('new@example.com');
      expect(stored).not.toBeNull();
      expect(stored!.email).toBe('new@example.com');
    });

    it('is single-use — second accept returns INVITATION_INVALID', async () => {
      const db = createMockDb();
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      const { rawToken } = await createOk(svc, { email: 'new@example.com', createdBy: 1 });
      svc.accept(rawToken, 'Password123!', { signature: 'I ACCEPT', lang: 'en', ip: null, userAgent: null });
      expect(() => svc.accept(rawToken, 'Password123!', { signature: 'I ACCEPT', lang: 'en', ip: null, userAgent: null })).toThrow(ERROR_MSG.INVITATION_INVALID);
    });

    it('rejects non-string passwords (e.g. a number that would bypass length check)', async () => {
      const db = createMockDb();
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      const { rawToken } = await createOk(svc, { email: 'new@example.com', createdBy: 1 });
      // A number like 12345678 is truthy and has no `.length`, so a naive
      // `password.length < 8` check would pass. Must be rejected by typeof.
      expect(() => svc.accept(rawToken, 12345678 as unknown as string, { signature: 'I ACCEPT', lang: 'en', ip: null, userAgent: null })).toThrow(ERROR_MSG.INVALID_PASSWORD);
      expect(db.getUserByUsername('new@example.com')).toBeNull();
    });

    it('rejects passwords shorter than 8 characters', async () => {
      const db = createMockDb();
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      const { rawToken } = await createOk(svc, { email: 'new@example.com', createdBy: 1 });
      expect(() => svc.accept(rawToken, 'short', { signature: 'I ACCEPT', lang: 'en', ip: null, userAgent: null })).toThrow(ERROR_MSG.INVALID_PASSWORD);
    });

    it('rejects unknown tokens', () => {
      const db = createMockDb();
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      expect(() => svc.accept('unknown', 'Password123!', { signature: 'I ACCEPT', lang: 'en', ip: null, userAgent: null })).toThrow(ERROR_MSG.INVITATION_INVALID);
    });

    it('rejects expired tokens and does not create a user', async () => {
      const db = createMockDb();
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      const { rawToken } = await createOk(svc, { email: 'expired@example.com', createdBy: 1 });
      vi.setSystemTime(NOW + 73 * 60 * 60 * 1000);
      expect(() => svc.accept(rawToken, 'Password123!', { signature: 'I ACCEPT', lang: 'en', ip: null, userAgent: null })).toThrow(ERROR_MSG.INVITATION_INVALID);
      expect(db.getUserByUsername('expired@example.com')).toBeNull();
    });

    it('rejects revoked tokens', async () => {
      const db = createMockDb();
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      const { rawToken } = await createOk(svc, { email: 'new@example.com', createdBy: 1 });
      const inv = db.getInvitationByTokenHash(sha256(rawToken))!;
      svc.revoke(inv.id);
      expect(() => svc.accept(rawToken, 'Password123!', { signature: 'I ACCEPT', lang: 'en', ip: null, userAgent: null })).toThrow(ERROR_MSG.INVITATION_INVALID);
      // Atomicity: the failed accept must not have created the user
      expect(db.getUserByUsername('new@example.com')).toBeNull();
    });

    it('maps SQLITE_CONSTRAINT races to INVITATION_INVALID (not 500)', async () => {
      const db = createMockDb();
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      const { rawToken } = await createOk(svc, { email: 'race@example.com', createdBy: 1 });
      // Simulate another path having created the user between the request
      // landing and doAccept running. The mock createUser throws a
      // SQLITE_CONSTRAINT_UNIQUE error; the service must map it to
      // INVITATION_INVALID rather than letting the raw error propagate.
      db.createUser('race@example.com', 'race@example.com', 'hash', 'regular');
      expect(() => svc.accept(rawToken, 'Password123!', { signature: 'I ACCEPT', lang: 'en', ip: null, userAgent: null })).toThrow(ERROR_MSG.INVITATION_INVALID);
    });

    it('revokes the invitation on SQLITE_CONSTRAINT so it does not become a ghost pending', async () => {
      const db = createMockDb();
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      const { rawToken } = await createOk(svc, { email: 'ghost@example.com', createdBy: 1 });
      // Simulate an admin manually creating the user via a different flow
      // between invitation creation and accept.
      db.createUser('ghost@example.com', 'ghost@example.com', 'other-hash', 'regular');

      expect(() => svc.accept(rawToken, 'Password123!', { signature: 'I ACCEPT', lang: 'en', ip: null, userAgent: null })).toThrow(ERROR_MSG.INVITATION_INVALID);

      // The row must not linger as a ghost pending: it should be revoked
      // so it drops out of the default list view.
      const active = db.listInvitations({ includeAll: false });
      expect(active).toHaveLength(0);
      const all = db.listInvitations({ includeAll: true });
      expect(all).toHaveLength(1);
      expect(all[0].revokedAt).not.toBeNull();
    });
  });

  describe('revoke', () => {
    it('sets revoked_at and subsequent lookup returns null', async () => {
      const db = createMockDb();
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      const { rawToken } = await createOk(svc, { email: 'x@example.com', createdBy: 1 });
      const inv = db.getInvitationByTokenHash(sha256(rawToken))!;
      svc.revoke(inv.id);
      expect(svc.lookup(rawToken)).toBeNull();
    });
  });

  describe('resend', () => {
    it('throws INVITATION_INVALID for an unknown id', async () => {
      const db = createMockDb();
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      await expect(svc.resend('does-not-exist')).rejects.toThrow(ERROR_MSG.INVITATION_INVALID);
    });

    it('issues a fresh token and revokes the previous pending invitation', async () => {
      const db = createMockDb();
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      const first = await createOk(svc, { email: 'r@example.com', createdBy: 1 });
      const firstRow = db.listInvitations({ includeAll: false })[0];

      const second = await svc.resend(firstRow.id);
      expect(second.rawToken).not.toBe(first.rawToken);

      // The original row should now be revoked
      const oldRow = db.getInvitationByTokenHash(sha256(first.rawToken));
      expect(oldRow!.revokedAt).toBe(NOW);
      // The new row should be active
      const newRow = db.getInvitationByTokenHash(sha256(second.rawToken));
      expect(newRow!.revokedAt).toBeNull();
      expect(newRow!.acceptedAt).toBeNull();
    });

    it('fails with USER_EXISTS when resending after the invitation was already accepted', async () => {
      const db = createMockDb();
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      const { rawToken } = await createOk(svc, { email: 'r2@example.com', createdBy: 1 });
      const inv = db.getInvitationByTokenHash(sha256(rawToken))!;
      svc.accept(rawToken, 'Password123!', { signature: 'I ACCEPT', lang: 'en', ip: null, userAgent: null });
      // The invitation row still exists in the DB; resend should hit USER_EXISTS via doCreate
      await expect(svc.resend(inv.id)).rejects.toThrow(ERROR_MSG.USER_EXISTS);
    });
  });

  describe('list', () => {
    it('default view excludes both accepted and revoked', async () => {
      const db = createMockDb();
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://app.example.com', (u) => `jwt_for_${u.id}`);
      const { rawToken: tokenA } = await createOk(svc, { email: 'a@example.com', createdBy: 1 });
      const { rawToken: tokenB } = await createOk(svc, { email: 'b@example.com', createdBy: 1 });
      await createOk(svc, { email: 'c@example.com', createdBy: 1 });
      // a: accepted, b: revoked, c: still pending
      svc.accept(tokenA, 'Password123!', { signature: 'I ACCEPT', lang: 'en', ip: null, userAgent: null });
      const invB = db.getInvitationByTokenHash(sha256(tokenB))!;
      svc.revoke(invB.id);

      const pending = svc.list({ includeAll: false });
      expect(pending.map((i) => i.email)).toEqual(['c@example.com']);
      const all = svc.list({ includeAll: true });
      expect(all.length).toBe(3);
    });
  });

  describe('accept with disclaimer', () => {
    async function setupPendingInvite() {
      const db = createMockDb();
      const authSigner = () => 'jwt';
      const svc = createInvitationsService(db, EMAIL_SERVICE as any, 'https://example.test', authSigner);
      const created = await createOk(svc, { email: 'user@example.com', createdBy: 1 });
      return { db, svc, token: created.rawToken };
    }

    it('accepts with a valid English signature and stores audit fields', async () => {
      const { db, svc, token } = await setupPendingInvite();
      const result = svc.accept(token, 'Password1!', {
        signature: 'I ACCEPT',
        lang: 'en',
        ip: '10.0.0.1',
        userAgent: 'jest',
      });
      expect(result.user.username).toBe('user@example.com');
      expect(db.acceptDisclaimerForUser).toHaveBeenCalledWith(result.user.id, expect.objectContaining({
        version: '2026-04-18',
        lang: 'en',
        ip: '10.0.0.1',
        userAgent: 'jest',
      }));
    });

    it('accepts with a valid Hebrew signature', async () => {
      const { db, svc, token } = await setupPendingInvite();
      svc.accept(token, 'Password1!', {
        signature: 'אני מאשר',
        lang: 'he',
        ip: null,
        userAgent: null,
      });
      expect(db.acceptDisclaimerForUser).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({
        lang: 'he',
        signature: 'אני מאשר',
      }));
    });

    it('rejects when signature is missing', async () => {
      const { svc, token } = await setupPendingInvite();
      expect(() => svc.accept(token, 'Password1!', { signature: '', lang: 'en', ip: null, userAgent: null }))
        .toThrow(ERROR_MSG.DISCLAIMER_INVALID);
    });

    it('rejects when signature does not match the declared language', async () => {
      const { svc, token } = await setupPendingInvite();
      expect(() => svc.accept(token, 'Password1!', {
        signature: 'אני מאשר',
        lang: 'en',
        ip: null,
        userAgent: null,
      })).toThrow(ERROR_MSG.DISCLAIMER_INVALID);
    });

    it('rejects an invalid lang', async () => {
      const { svc, token } = await setupPendingInvite();
      expect(() => svc.accept(token, 'Password1!', {
        signature: 'I ACCEPT',
        lang: 'fr',
        ip: null,
        userAgent: null,
      } as any)).toThrow(ERROR_MSG.DISCLAIMER_INVALID);
    });

    it('does not create the user if the signature is invalid', async () => {
      const { db, svc, token } = await setupPendingInvite();
      try { svc.accept(token, 'Password1!', { signature: 'WRONG', lang: 'en', ip: null, userAgent: null }); } catch {}
      expect(db.acceptDisclaimerForUser).not.toHaveBeenCalled();
      // Invitation should still be pending, so a second accept with a valid signature succeeds.
      expect(() => svc.accept(token, 'Password1!', { signature: 'I ACCEPT', lang: 'en', ip: null, userAgent: null })).not.toThrow();
    });
  });
});
