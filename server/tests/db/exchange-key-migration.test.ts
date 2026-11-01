import { describe, it, expect, vi, afterEach } from 'vitest';
import { createDb } from '../../src/db/index.js';
import { createExchangeKeyCipher } from '../../src/utils/crypto.js';
import { migrateExchangeKeys } from '../../src/db/exchange-key-migration.js';
import logger from '../../src/utils/logger.js';
import { encryptLegacyV1, TEST_ENC_KEY, TEST_ENC_KEY_2 } from '../utils/crypto-fixtures.js';

const JWT = 'old-jwt-secret-with-at-least-32-chars';

function setup() {
  const db = createDb(':memory:');
  const alice = db.createUser('alice', null, 'h', 'user');
  const bob = db.createUser('bob', null, 'h', 'user');
  const carol = db.createUser('carol', null, 'h', 'user');
  db.updateUserExchangeKeys(alice.id, encryptLegacyV1('alice-key-123', JWT), encryptLegacyV1('alice-secret-456', JWT), true);
  db.updateUserExchangeKeys(bob.id, encryptLegacyV1('bob-key-789', JWT), encryptLegacyV1('bob-secret-000', JWT), false);
  return { db, alice, bob, carol };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('exchange-key migration v1 -> v2 (S7)', () => {
  it('re-encrypts v1 rows as v2 and keeps the same plaintext', () => {
    const { db, alice, bob } = setup();
    const cipher = createExchangeKeyCipher(TEST_ENC_KEY);

    const result = migrateExchangeKeys(db, cipher, JWT);

    expect(result).toEqual({ migrated: 2, failed: 0 });
    const a = db.getUserById(alice.id)!;
    const b = db.getUserById(bob.id)!;
    for (const v of [a.exchangeKey!, a.exchangeSecret!, b.exchangeKey!, b.exchangeSecret!]) {
      expect(v.startsWith('v2:')).toBe(true);
    }
    expect(cipher.decrypt(a.exchangeKey!)).toBe('alice-key-123');
    expect(cipher.decrypt(a.exchangeSecret!)).toBe('alice-secret-456');
    expect(cipher.decrypt(b.exchangeKey!)).toBe('bob-key-789');
    expect(cipher.decrypt(b.exchangeSecret!)).toBe('bob-secret-000');
    expect(b.exchangeTestnet).toBe(false);
    db.close();
  });

  it('keeps exchange keys usable after JWT_SECRET rotates', () => {
    const { db, alice } = setup();
    const cipher = createExchangeKeyCipher(TEST_ENC_KEY);
    migrateExchangeKeys(db, cipher, JWT);

    // Next start: the operator rotated JWT_SECRET.
    const second = migrateExchangeKeys(db, cipher, 'new-jwt-secret-also-32-chars-long!!');

    expect(second).toEqual({ migrated: 0, failed: 0 });
    expect(cipher.decrypt(db.getUserById(alice.id)!.exchangeKey!)).toBe('alice-key-123');
    db.close();
  });

  it('leaves a row it cannot decrypt, logs the user id, and continues', () => {
    const { db, alice, bob } = setup();
    const broken = encryptLegacyV1('x', 'a-different-jwt-secret-of-32-chars!');
    db.updateUserExchangeKeys(alice.id, broken, broken, true);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const cipher = createExchangeKeyCipher(TEST_ENC_KEY);

    const result = migrateExchangeKeys(db, cipher, JWT);

    expect(result).toEqual({ migrated: 1, failed: 1 });
    expect(db.getUserById(alice.id)!.exchangeKey).toBe(broken);
    expect(cipher.decrypt(db.getUserById(bob.id)!.exchangeKey!)).toBe('bob-key-789');
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes(`user ${alice.id}`))).toBe(true);
    db.close();
  });

  it('never logs key material', () => {
    const { db } = setup();
    const lines: string[] = [];
    for (const level of ['info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(logger, level).mockImplementation(((m: unknown) => { lines.push(String(m)); return logger; }) as any);
    }
    migrateExchangeKeys(db, createExchangeKeyCipher(TEST_ENC_KEY), JWT);
    const all = lines.join('\n');
    expect(all).toContain('2');
    for (const s of ['alice-key-123', 'alice-secret-456', 'bob-key-789', JWT, TEST_ENC_KEY]) {
      expect(all).not.toContain(s);
    }
    db.close();
  });

  it('skips users without keys and users with cleared keys', () => {
    const { db, carol, alice } = setup();
    db.updateUserExchangeKeys(alice.id, '', '', true);
    const result = migrateExchangeKeys(db, createExchangeKeyCipher(TEST_ENC_KEY), JWT);
    expect(result).toEqual({ migrated: 1, failed: 0 });
    expect(db.getUserById(carol.id)!.exchangeKey).toBeNull();
    expect(db.getUserById(alice.id)!.exchangeKey).toBe('');
    db.close();
  });

  it('re-encrypts rows from the previous master key with the current key', () => {
    const { db, alice } = setup();
    migrateExchangeKeys(db, createExchangeKeyCipher(TEST_ENC_KEY), JWT);

    const rotated = createExchangeKeyCipher(TEST_ENC_KEY_2, TEST_ENC_KEY);
    expect(migrateExchangeKeys(db, rotated, JWT)).toEqual({ migrated: 2, failed: 0 });

    const onlyNew = createExchangeKeyCipher(TEST_ENC_KEY_2);
    expect(onlyNew.decrypt(db.getUserById(alice.id)!.exchangeKey!)).toBe('alice-key-123');
    db.close();
  });
});
