import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadEnv } from '../../src/config/index.js';

const STRONG = 'k3P9vQ2xL7mN4rT8wY1zA6bC5dE0fG2h';
const saved = { ...process.env };

describe('loadEnv secret checks (S4)', () => {
  beforeEach(() => {
    process.env.API_KEY = STRONG;
    process.env.JWT_SECRET = STRONG + 'x';
    process.env.ADMIN_PASS = 'Str0ng!AdminPass';
  });
  afterEach(() => { process.env = { ...saved }; });

  it('accepts strong secrets', () => {
    expect(() => loadEnv()).not.toThrow();
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
