import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadEnv } from '../../src/config/index.js';

const STRONG = 'k3P9vQ2xL7mN4rT8wY1zA6bC5dE0fG2h';
const ENC_KEY = '3f9a1c7e5b2d8f4a6c0e9b1d3f5a7c2e4b6d8f0a1c3e5b7d9f2a4c6e8b0d1f3a';
const saved = { ...process.env };

describe('loadEnv secret checks (S4)', () => {
  beforeEach(() => {
    process.env.API_KEY = STRONG;
    process.env.JWT_SECRET = STRONG + 'x';
    process.env.ADMIN_PASS = 'Str0ng!AdminPass';
    process.env.EXCHANGE_KEYS_ENC_KEY = ENC_KEY;
    delete process.env.EXCHANGE_KEYS_ENC_KEY_PREVIOUS;
  });
  afterEach(() => { process.env = { ...saved }; });

  it('accepts strong secrets', () => {
    expect(() => loadEnv()).not.toThrow();
  });

  it('takes the reCAPTCHA hostname from PUBLIC_APP_URL', () => {
    process.env.PUBLIC_APP_URL = 'https://Bot.Example.com:8443/app/';
    expect(loadEnv().recaptchaHostname).toBe('bot.example.com');
  });

  it('has no reCAPTCHA hostname when PUBLIC_APP_URL is not set', () => {
    delete process.env.PUBLIC_APP_URL;
    expect(loadEnv().recaptchaHostname).toBeUndefined();
  });

  it.each([
    ['API_KEY', 'change-me-to-a-random-string'],
    ['JWT_SECRET', 'change-me-to-a-random-jwt-secret'],
    ['ADMIN_PASS', 'change-me-to-a-strong-password'],
    ['JWT_SECRET', 'CHANGE_ME_TO_RANDOM_SECRET'],
  ])('rejects the placeholder value of %s', (name, value) => {
    process.env[name] = value;
    expect(() => loadEnv()).toThrow(name);
  });

  it.each(['API_KEY', 'JWT_SECRET'])('rejects a %s shorter than 32 characters', (name) => {
    process.env[name] = 'short-but-not-a-placeholder';
    expect(() => loadEnv()).toThrow(name);
  });

  it('rejects an ADMIN_PASS shorter than 12 characters', () => {
    process.env.ADMIN_PASS = 'Ab1!short';
    expect(() => loadEnv()).toThrow('ADMIN_PASS');
  });
});

describe('loadEnv EXCHANGE_KEYS_ENC_KEY checks (S7)', () => {
  beforeEach(() => {
    process.env.API_KEY = STRONG;
    process.env.JWT_SECRET = STRONG + 'x';
    process.env.ADMIN_PASS = 'Str0ng!AdminPass';
    process.env.EXCHANGE_KEYS_ENC_KEY = ENC_KEY;
    delete process.env.EXCHANGE_KEYS_ENC_KEY_PREVIOUS;
  });
  afterEach(() => { process.env = { ...saved }; });

  it('returns the key', () => {
    expect(loadEnv().exchangeKeysEncKey).toBe(ENC_KEY);
  });

  it('rejects a missing EXCHANGE_KEYS_ENC_KEY', () => {
    delete process.env.EXCHANGE_KEYS_ENC_KEY;
    expect(() => loadEnv()).toThrow('EXCHANGE_KEYS_ENC_KEY');
  });

  it.each([
    ['short', 'abcdef0123456789'],
    ['63 hex chars', ENC_KEY.slice(1)],
    ['65 hex chars', ENC_KEY + 'a'],
    ['not hex', 'g'.repeat(64)],
    ['placeholder', 'change-me-run-openssl-rand-hex-32'],
    ['all zeros', '0'.repeat(64)],
  ])('rejects a bad EXCHANGE_KEYS_ENC_KEY (%s)', (_label, value) => {
    process.env.EXCHANGE_KEYS_ENC_KEY = value;
    expect(() => loadEnv()).toThrow('EXCHANGE_KEYS_ENC_KEY');
  });

  it('accepts a valid EXCHANGE_KEYS_ENC_KEY_PREVIOUS', () => {
    const prev = 'c'.repeat(64);
    process.env.EXCHANGE_KEYS_ENC_KEY_PREVIOUS = prev;
    expect(loadEnv().exchangeKeysEncKeyPrevious).toBe(prev);
  });

  it('rejects a bad EXCHANGE_KEYS_ENC_KEY_PREVIOUS', () => {
    process.env.EXCHANGE_KEYS_ENC_KEY_PREVIOUS = 'short';
    expect(() => loadEnv()).toThrow('EXCHANGE_KEYS_ENC_KEY_PREVIOUS');
  });

  it('rejects an EXCHANGE_KEYS_ENC_KEY_PREVIOUS equal to the current key', () => {
    process.env.EXCHANGE_KEYS_ENC_KEY_PREVIOUS = ENC_KEY;
    expect(() => loadEnv()).toThrow('EXCHANGE_KEYS_ENC_KEY_PREVIOUS');
  });
});
