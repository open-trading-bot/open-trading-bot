import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRateLimiter, getClientIp } from '../../src/utils/rate-limiter.js';

describe('createRateLimiter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('allows first request from unknown IP', () => {
    const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 60_000 });
    expect(limiter.check('1.2.3.4')).toEqual({ allowed: true });
  });

  it('tracks remaining attempts', () => {
    const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 60_000 });
    expect(limiter.remaining('1.2.3.4')).toBe(3);
    limiter.record('1.2.3.4');
    expect(limiter.remaining('1.2.3.4')).toBe(2);
    limiter.record('1.2.3.4');
    expect(limiter.remaining('1.2.3.4')).toBe(1);
  });

  it('blocks after max attempts reached', () => {
    const limiter = createRateLimiter({ maxAttempts: 2, windowMs: 60_000 });
    limiter.record('1.2.3.4');
    limiter.record('1.2.3.4');
    const result = limiter.check('1.2.3.4');
    expect(result.allowed).toBe(false);
  });

  it('applies lockout when lockoutMs is configured', () => {
    const limiter = createRateLimiter({ maxAttempts: 2, windowMs: 60_000, lockoutMs: 30_000 });
    limiter.record('1.2.3.4');
    limiter.record('1.2.3.4');
    const result = limiter.check('1.2.3.4');
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBe(30);
  });

  it('returns retryAfter=0 when blocked without lockoutMs', () => {
    const limiter = createRateLimiter({ maxAttempts: 2, windowMs: 60_000 });
    limiter.record('1.2.3.4');
    limiter.record('1.2.3.4');
    const result = limiter.check('1.2.3.4');
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBe(0);
  });

  it('allows again after lockout expires', () => {
    const limiter = createRateLimiter({ maxAttempts: 2, windowMs: 60_000, lockoutMs: 30_000 });
    limiter.record('1.2.3.4');
    limiter.record('1.2.3.4');
    // Trigger lockout
    limiter.check('1.2.3.4');
    vi.advanceTimersByTime(31_000);
    const result = limiter.check('1.2.3.4');
    expect(result.allowed).toBe(true);
  });

  it('resets window after windowMs expires', () => {
    const limiter = createRateLimiter({ maxAttempts: 2, windowMs: 60_000 });
    limiter.record('1.2.3.4');
    limiter.record('1.2.3.4');
    vi.advanceTimersByTime(61_000);
    expect(limiter.check('1.2.3.4')).toEqual({ allowed: true });
  });

  it('clear removes record for IP', () => {
    const limiter = createRateLimiter({ maxAttempts: 2, windowMs: 60_000 });
    limiter.record('1.2.3.4');
    limiter.record('1.2.3.4');
    limiter.clear('1.2.3.4');
    expect(limiter.check('1.2.3.4')).toEqual({ allowed: true });
    expect(limiter.remaining('1.2.3.4')).toBe(2);
  });

  it('record resets count after window expires', () => {
    const limiter = createRateLimiter({ maxAttempts: 2, windowMs: 60_000 });
    limiter.record('1.2.3.4');
    vi.advanceTimersByTime(61_000);
    limiter.record('1.2.3.4');
    expect(limiter.remaining('1.2.3.4')).toBe(1);
  });

  it('returns retryAfter seconds while locked', () => {
    const limiter = createRateLimiter({ maxAttempts: 1, windowMs: 60_000, lockoutMs: 10_000 });
    limiter.record('1.2.3.4');
    // Trigger lockout
    limiter.check('1.2.3.4');
    vi.advanceTimersByTime(5_000);
    const result = limiter.check('1.2.3.4');
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBe(5);
  });
});

describe('getClientIp', () => {
  it('does not read x-forwarded-for directly (Express resolves req.ip)', () => {
    const req = { headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' }, ip: '127.0.0.1' } as any;
    expect(getClientIp(req)).toBe('127.0.0.1');
  });

  it('falls back to req.ip', () => {
    const req = { headers: {}, ip: '192.168.1.1' } as any;
    expect(getClientIp(req)).toBe('192.168.1.1');
  });

  it('returns unknown when no IP available', () => {
    const req = { headers: {} } as any;
    expect(getClientIp(req)).toBe('unknown');
  });
});
