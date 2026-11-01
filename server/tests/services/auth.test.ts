import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAuthService } from '../../src/services/auth.js';
import { hashPassword, verifyPassword } from '../../src/db/seed.js';
import { blockUser, isBlocked } from '../../src/utils/token-blocklist.js';
import type { Db, DbUser } from '../../src/db/index.js';

function createMockDb(users: DbUser[] = []): Db {
  const store = new Map<string, DbUser>();
  for (const u of users) store.set(u.username, u);
  return {
    getUserByUsername(username: string) { return store.get(username) ?? null; },
    updateLastLogin(_id: number) {},
    // stubs for other methods — not used by auth service
  } as any as Db;
}

describe('AuthService', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const adminUser: DbUser = {
    id: 1, username: 'admin', email: null,
    passwordHash: hashPassword('secret123'), role: 'admin',
    enabled: true, createdAt: Date.now(), lastLogin: null, disclaimerAcceptedAt: null,
  };

  const disabledUser: DbUser = {
    id: 2, username: 'disabled', email: null,
    passwordHash: hashPassword('pass'), role: 'regular',
    enabled: false, createdAt: Date.now(), lastLogin: null, disclaimerAcceptedAt: null,
  };

  const service = (users: DbUser[] = [adminUser]) =>
    createAuthService(createMockDb(users), 'jwt-test-secret');

  it('returns token on valid credentials', () => {
    const auth = service();
    const result = auth.login('127.0.0.1', 'admin', 'secret123');
    expect(result.ok).toBe(true);
    expect(result.token).toBeDefined();
    expect(typeof result.token).toBe('string');
    expect(result.role).toBe('admin');
  });

  it('finds an invited user when the typed email uses different case', () => {
    // Invited users are stored with usernames that are lowercased emails.
    // The login form should match regardless of what case the user types.
    const invited: DbUser = {
      id: 3, username: 'alice@example.com', email: 'alice@example.com',
      passwordHash: hashPassword('Password123!'), role: 'regular',
      enabled: true, createdAt: Date.now(), lastLogin: null, disclaimerAcceptedAt: null,
    };
    const auth = service([invited]);

    const mixed = auth.login('127.0.0.1', 'Alice@Example.COM', 'Password123!');
    expect(mixed.ok).toBe(true);
    expect(mixed.username).toBe('alice@example.com');

    const padded = auth.login('127.0.0.1', '  ALICE@example.com  ', 'Password123!');
    expect(padded.ok).toBe(true);
  });

  it('does not lowercase non-email usernames (preserves admin case sensitivity)', () => {
    // Admin-chosen usernames without an '@' pass through unchanged, so two
    // users differing only in case remain distinct (existing contract).
    const mixed: DbUser = {
      id: 4, username: 'Admin', email: null,
      passwordHash: hashPassword('mixedpass'), role: 'admin',
      enabled: true, createdAt: Date.now(), lastLogin: null, disclaimerAcceptedAt: null,
    };
    const auth = service([mixed]);
    // Exact-match works
    expect(auth.login('127.0.0.1', 'Admin', 'mixedpass').ok).toBe(true);
    // Different case must NOT find it (the user is 'Admin', not 'admin')
    const wrongCase = auth.login('127.0.0.2', 'admin', 'mixedpass');
    expect(wrongCase.ok).toBe(false);
  });

  it('returns invalid_credentials on wrong password', () => {
    const auth = service();
    const result = auth.login('127.0.0.1', 'admin', 'wrong');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_credentials');
    expect(result.attemptsRemaining).toBeDefined();
  });

  it('returns invalid_credentials on wrong username', () => {
    const auth = service();
    const result = auth.login('127.0.0.1', 'wrong', 'secret123');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_credentials');
  });

  it('rejects disabled users', () => {
    const auth = service([adminUser, disabledUser]);
    const result = auth.login('127.0.0.1', 'disabled', 'pass');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('account_disabled');
  });

  it('disabled account and non-existent account both return ok=false with no token', () => {
    const auth = service([adminUser, disabledUser]);
    const disabled = auth.login('127.0.0.1', 'disabled', 'pass');
    const nonExistent = auth.login('127.0.0.2', 'doesnotexist', 'pass');
    expect(disabled.ok).toBe(false);
    expect(nonExistent.ok).toBe(false);
    expect(disabled.token).toBeUndefined();
    expect(nonExistent.token).toBeUndefined();
  });

  it('decrements attempts remaining on failures', () => {
    const auth = service();
    const r1 = auth.login('127.0.0.1', 'admin', 'wrong');
    const r2 = auth.login('127.0.0.1', 'admin', 'wrong');
    expect(r2.attemptsRemaining!).toBeLessThan(r1.attemptsRemaining!);
  });

  it('rate limits after too many failures', () => {
    const auth = service();
    // LOGIN rate limit: 5 attempts
    for (let i = 0; i < 5; i++) {
      auth.login('127.0.0.1', 'admin', 'wrong');
    }
    const result = auth.login('127.0.0.1', 'admin', 'wrong');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('rate_limited');
    expect(result.retryAfter).toBeDefined();
  });

  it('clears rate limit on successful login', () => {
    const auth = service();
    // Record some failures
    auth.login('127.0.0.1', 'admin', 'wrong');
    auth.login('127.0.0.1', 'admin', 'wrong');
    // Successful login clears limiter
    const success = auth.login('127.0.0.1', 'admin', 'secret123');
    expect(success.ok).toBe(true);
    // Next failure should have full attempts again
    const fail = auth.login('127.0.0.1', 'admin', 'wrong');
    expect(fail.attemptsRemaining).toBe(4);
  });

  it('isolates rate limits by IP', () => {
    const auth = service();
    for (let i = 0; i < 5; i++) {
      auth.login('1.1.1.1', 'admin', 'wrong');
    }
    // Different IP should still work
    const result = auth.login('2.2.2.2', 'admin', 'secret123');
    expect(result.ok).toBe(true);
  });

  it('unblocks user on successful login', () => {
    const auth = service();
    blockUser(adminUser.id);
    expect(isBlocked(adminUser.id)).toBe(true);

    const result = auth.login('127.0.0.1', 'admin', 'secret123');
    expect(result.ok).toBe(true);
    expect(isBlocked(adminUser.id)).toBe(false);
  });

  it('does not unblock user on failed login', () => {
    const auth = service();
    blockUser(adminUser.id);

    auth.login('127.0.0.1', 'admin', 'wrong');
    expect(isBlocked(adminUser.id)).toBe(true);
  });

  it('does not unblock disabled user on login attempt', () => {
    const auth = service([adminUser, disabledUser]);
    blockUser(disabledUser.id);

    auth.login('127.0.0.1', 'disabled', 'pass');
    expect(isBlocked(disabledUser.id)).toBe(true);
  });
});
