import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Db, DbUser } from '../../src/db/index.js';

// Wrap verifyPassword in a spy. The real function still runs.
vi.mock('../../src/db/seed.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/db/seed.js')>();
  return { ...mod, verifyPassword: vi.fn(mod.verifyPassword) };
});

const { createAuthService } = await import('../../src/services/auth.js');
const seed = await import('../../src/db/seed.js');

function mockDb(users: DbUser[]): Db {
  const store = new Map(users.map((u) => [u.username, u]));
  return {
    // Like better-sqlite3, which throws when it binds an array or object.
    getUserByUsername: (name: string) => {
      if (typeof name !== 'string') throw new TypeError('SQLite3 can only bind numbers, strings, bigints, buffers, and null');
      return store.get(name) ?? null;
    },
    updateLastLogin: () => {},
  } as unknown as Db;
}

const admin: DbUser = {
  id: 1, username: 'admin', email: null, passwordHash: seed.hashPassword('secret123'), role: 'admin',
  enabled: true, createdAt: 0, lastLogin: null, disclaimerAcceptedAt: null,
};
const disabled: DbUser = { ...admin, id: 2, username: 'disabled', enabled: false };

describe('login does not reveal which usernames exist', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.mocked(seed.verifyPassword).mockClear(); });
  afterEach(() => { vi.useRealTimers(); });

  it('hashes a password for a username that does not exist', () => {
    const auth = createAuthService(mockDb([admin]), 'jwt');
    const result = auth.login('10.0.0.1', 'nobody', 'secret123');
    expect(result.error).toBe('invalid_credentials');
    expect(seed.verifyPassword).toHaveBeenCalledTimes(1);
  });

  it('hashes a password for a disabled user', () => {
    const auth = createAuthService(mockDb([admin, disabled]), 'jwt');
    auth.login('10.0.0.1', 'disabled', 'secret123');
    expect(seed.verifyPassword).toHaveBeenCalledTimes(1);
  });

  it('treats a non-string password for an existing user as invalid credentials', () => {
    const auth = createAuthService(mockDb([admin]), 'jwt');
    const first = auth.login('10.0.0.1', 'admin', { $ne: '' } as unknown as string);
    expect(first.ok).toBe(false);
    expect(first.error).toBe('invalid_credentials');
    expect(first.attemptsRemaining).toBe(4);
  });

  it('gives the same answer for a non-string password with an unknown user', () => {
    const auth = createAuthService(mockDb([admin]), 'jwt');
    const known = auth.login('10.0.0.1', 'admin', 123 as unknown as string);
    const unknown = auth.login('10.0.0.2', 'nobody', 123 as unknown as string);
    expect(known).toEqual(unknown);
  });

  it('treats a non-string username as invalid credentials and records the attempt', () => {
    const auth = createAuthService(mockDb([admin]), 'jwt');
    const r = auth.login('10.0.0.1', ['admin'] as unknown as string, 'secret123');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_credentials');
    expect(r.attemptsRemaining).toBe(4);
  });
});
