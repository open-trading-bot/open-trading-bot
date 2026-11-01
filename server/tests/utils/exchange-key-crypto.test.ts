import { describe, it, expect } from 'vitest';
import { createExchangeKeyCipher, decryptLegacyV1 } from '../../src/utils/crypto.js';
import { encryptLegacyV1, TEST_ENC_KEY, TEST_ENC_KEY_2 } from './crypto-fixtures.js';

describe('exchange-key cipher (S7)', () => {
  it('round-trips a value in the v2 format with a key id', () => {
    const cipher = createExchangeKeyCipher(TEST_ENC_KEY);
    const ct = cipher.encrypt('my-api-secret');
    expect(ct).toMatch(/^v2:[0-9a-f]{8}:[^:]+:[^:]+:[^:]+:[^:]+$/);
    expect(ct).not.toContain('my-api-secret');
    expect(cipher.decrypt(ct)).toBe('my-api-secret');
    expect(cipher.isCurrent(ct)).toBe(true);
  });

  it('gives a different ciphertext each time for the same value', () => {
    const cipher = createExchangeKeyCipher(TEST_ENC_KEY);
    const a = cipher.encrypt('same');
    const b = cipher.encrypt('same');
    expect(a).not.toBe(b);
    expect(a.split(':')[2]).not.toBe(b.split(':')[2]); // salt
    expect(a.split(':')[3]).not.toBe(b.split(':')[3]); // iv
  });

  it.each([2, 3, 4, 5])('throws when part %i of the ciphertext changes', (part) => {
    const cipher = createExchangeKeyCipher(TEST_ENC_KEY);
    const parts = cipher.encrypt('value-to-protect').split(':');
    const buf = Buffer.from(parts[part], 'base64url');
    buf[0] ^= 0x01;
    parts[part] = buf.toString('base64url');
    expect(() => cipher.decrypt(parts.join(':'))).toThrow();
  });

  it('throws when the key id changes', () => {
    const cipher = createExchangeKeyCipher(TEST_ENC_KEY);
    const parts = cipher.encrypt('v').split(':');
    parts[1] = '00000000';
    expect(() => cipher.decrypt(parts.join(':'))).toThrow();
  });

  it('does not decrypt with a different master key', () => {
    const ct = createExchangeKeyCipher(TEST_ENC_KEY).encrypt('v');
    expect(() => createExchangeKeyCipher(TEST_ENC_KEY_2).decrypt(ct)).toThrow();
  });

  it('decrypts a value from the previous key and marks it as not current', () => {
    const old = createExchangeKeyCipher(TEST_ENC_KEY).encrypt('rotated');
    const cipher = createExchangeKeyCipher(TEST_ENC_KEY_2, TEST_ENC_KEY);
    expect(cipher.decrypt(old)).toBe('rotated');
    expect(cipher.isCurrent(old)).toBe(false);
    expect(cipher.isCurrent(cipher.encrypt('new'))).toBe(true);
  });

  it('does not decrypt v1 ciphertext (JWT_SECRET is not an exchange-key key)', () => {
    const cipher = createExchangeKeyCipher(TEST_ENC_KEY);
    const v1 = encryptLegacyV1('legacy', 'some-jwt-secret-that-is-long-enough');
    expect(cipher.isCurrent(v1)).toBe(false);
    expect(() => cipher.decrypt(v1)).toThrow();
  });

  it('decrypts v1 ciphertext only through the legacy migration helper', () => {
    const v1 = encryptLegacyV1('legacy', 'some-jwt-secret-that-is-long-enough');
    expect(decryptLegacyV1(v1, 'some-jwt-secret-that-is-long-enough')).toBe('legacy');
    expect(() => decryptLegacyV1(v1, 'a-different-jwt-secret-value-0000')).toThrow();
  });

  it.each(['', 'abc', 'z'.repeat(64), 'a'.repeat(63)])('rejects the bad master key %j', (bad) => {
    expect(() => createExchangeKeyCipher(bad)).toThrow();
  });
});
