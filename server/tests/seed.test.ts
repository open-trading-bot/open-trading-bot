import { describe, it, expect, vi } from 'vitest';
import { hashPassword, verifyPassword, seedUsers } from '../src/db/seed.js';
import type { Db } from '../src/db/index.js';
import { ROLES } from '../src/utils/constants.js';

function createMockDb(existingUsernames: string[] = []): Db {
  return {
    getUserByUsername: vi.fn().mockImplementation((username: string) =>
      existingUsernames.includes(username)
        ? { id: 1, username, passwordHash: hashPassword('pass') }
        : null
    ),
    updateUserPassword: vi.fn(),
    createUser: vi.fn().mockImplementation((username, _email, _hash, role) => ({
      id: 1, username, role,
    })),
    getUserConfig: vi.fn().mockReturnValue(null),
    setUserConfig: vi.fn(),
  } as any;
}

describe('hashPassword', () => {
  it('returns salted scrypt hash with salt:hash format', () => {
    const hash = hashPassword('test123');
    expect(hash).toContain(':');
    const [salt, derived] = hash.split(':');
    expect(salt).toMatch(/^[a-f0-9]{32}$/);
    expect(derived).toMatch(/^[a-f0-9]{128}$/);
  });

  it('returns different hashes for same input (random salt)', () => {
    const hash1 = hashPassword('test123');
    const hash2 = hashPassword('test123');
    expect(hash1).not.toBe(hash2);
  });

  it('returns different hashes for different inputs', () => {
    expect(hashPassword('a')).not.toBe(hashPassword('b'));
  });
});

describe('verifyPassword', () => {
  it('verifies correct password', () => {
    const hash = hashPassword('mypassword');
    expect(verifyPassword('mypassword', hash)).toBe(true);
  });

  it('rejects wrong password', () => {
    const hash = hashPassword('mypassword');
    expect(verifyPassword('wrongpassword', hash)).toBe(false);
  });

  it('returns false for malformed hash', () => {
    expect(verifyPassword('password', 'notavalidhash')).toBe(false);
    expect(verifyPassword('password', '')).toBe(false);
  });
});

describe('seedUsers', () => {
  it('creates only the admin user by default', () => {
    const db = createMockDb([]);
    seedUsers(db, 'myadmin', 'mypass');

    expect(db.createUser).toHaveBeenCalledTimes(1);
    expect(db.createUser).toHaveBeenCalledWith('myadmin', null, expect.stringContaining(':'), ROLES.ADMIN);
  });

  it('creates all default users when demo seeding is on', () => {
    const db = createMockDb([]);
    seedUsers(db, 'myadmin', 'mypass', true);

    expect(db.createUser).toHaveBeenCalledTimes(3);
    expect(db.createUser).toHaveBeenCalledWith('myadmin', null, expect.stringContaining(':'), ROLES.ADMIN);
    expect(db.createUser).toHaveBeenCalledWith('demo', null, expect.stringContaining(':'), ROLES.DEMO);
    expect(db.createUser).toHaveBeenCalledWith('user', null, expect.stringContaining(':'), ROLES.REGULAR);
  });

  it('skips existing users and creates missing ones', () => {
    const db = createMockDb(['admin', 'demo']);
    seedUsers(db, 'admin', 'pass', true);

    expect(db.createUser).toHaveBeenCalledTimes(1);
    expect(db.createUser).toHaveBeenCalledWith('user', null, expect.stringContaining(':'), ROLES.REGULAR);
  });

  it('skips all if all users exist', () => {
    const db = createMockDb(['admin', 'demo', 'user']);
    seedUsers(db, 'admin', 'pass', true);

    expect(db.createUser).not.toHaveBeenCalled();
  });

  it('updates the admin password when it changed', () => {
    const db = createMockDb(['admin']);
    seedUsers(db, 'admin', 'new-pass');

    expect(db.updateUserPassword).toHaveBeenCalledTimes(1);
  });
});
