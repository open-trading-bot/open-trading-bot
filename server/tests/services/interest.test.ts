import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInterestService } from '../../src/services/interest.js';

function mockDb() {
  return { insertLead: vi.fn() } as any;
}

describe('InterestService', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('submits valid email successfully', async () => {
    const db = mockDb();
    const svc = createInterestService(db);
    const result = await svc.submit('127.0.0.1', 'user@example.com', null);
    expect(result).toEqual({ ok: true });
    expect(db.insertLead).toHaveBeenCalledWith('user@example.com', { ip: '127.0.0.1' });
  });

  it('trims and lowercases email', async () => {
    const db = mockDb();
    const svc = createInterestService(db);
    await svc.submit('127.0.0.1', '  User@Example.COM  ', null);
    expect(db.insertLead).toHaveBeenCalledWith('user@example.com', { ip: '127.0.0.1' });
  });

  it('returns invalid_email for missing email', async () => {
    const svc = createInterestService(mockDb());
    const result = await svc.submit('127.0.0.1', '', null);
    expect(result).toEqual({ ok: false, error: 'invalid_email' });
  });

  it('returns invalid_email for non-string email', async () => {
    const svc = createInterestService(mockDb());
    const result = await svc.submit('127.0.0.1', 123, null);
    expect(result).toEqual({ ok: false, error: 'invalid_email' });
  });

  it('returns invalid_email for email without @', async () => {
    const svc = createInterestService(mockDb());
    const result = await svc.submit('127.0.0.1', 'notanemail', null);
    expect(result).toEqual({ ok: false, error: 'invalid_email' });
  });

  it('silently succeeds on duplicate email', async () => {
    const db = mockDb();
    db.insertLead.mockImplementation(() => { throw new Error('UNIQUE constraint'); });
    const svc = createInterestService(db);
    const result = await svc.submit('127.0.0.1', 'user@example.com', null);
    expect(result).toEqual({ ok: true });
  });

  it('rate limits after max attempts', async () => {
    const svc = createInterestService(mockDb());
    // INTEREST rate limit: 3 attempts per hour
    await svc.submit('127.0.0.1', 'a@b.com', null);
    await svc.submit('127.0.0.1', 'a@b.com', null);
    await svc.submit('127.0.0.1', 'a@b.com', null);
    const result = await svc.submit('127.0.0.1', 'a@b.com', null);
    expect(result).toEqual({ ok: false, error: 'rate_limited' });
  });

  describe('without a reCAPTCHA secret', () => {
    it('refuses submissions in production', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const db = mockDb();
      const svc = createInterestService(db, undefined, { production: true });
      const result = await svc.submit('127.0.0.1', 'user@example.com', null);
      expect(result).toEqual({ ok: false, error: 'captcha_unavailable' });
      expect(db.insertLead).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('skips the check outside production', async () => {
      const db = mockDb();
      const svc = createInterestService(db, undefined, { production: false });
      const result = await svc.submit('127.0.0.1', 'user@example.com', null);
      expect(result).toEqual({ ok: true });
    });
  });

  describe('with recaptcha', () => {
    it('returns captcha_failed when no token provided', async () => {
      const svc = createInterestService(mockDb(), 'recaptcha-secret');
      const result = await svc.submit('127.0.0.1', 'user@example.com', null);
      expect(result).toEqual({ ok: false, error: 'captcha_failed' });
    });

    it('returns captcha_failed when token is not a string', async () => {
      const svc = createInterestService(mockDb(), 'recaptcha-secret');
      const result = await svc.submit('127.0.0.1', 'user@example.com', 123);
      expect(result).toEqual({ ok: false, error: 'captcha_failed' });
    });

    it('verifies captcha with Google and succeeds', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ success: true }),
      }));
      const db = mockDb();
      const svc = createInterestService(db, 'recaptcha-secret');
      const result = await svc.submit('127.0.0.1', 'user@example.com', 'valid-token');
      expect(result).toEqual({ ok: true });
      expect(db.insertLead).toHaveBeenCalled();
    });

    it('returns captcha_failed when Google says not success', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ success: false }),
      }));
      const svc = createInterestService(mockDb(), 'recaptcha-secret');
      const result = await svc.submit('127.0.0.1', 'user@example.com', 'bad-token');
      expect(result).toEqual({ ok: false, error: 'captcha_failed' });
    });

    it('returns captcha_failed when the hostname in the Google response is different', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ success: true, hostname: 'attacker.example' }),
      }));
      const db = mockDb();
      const svc = createInterestService(db, 'recaptcha-secret', { expectedHostname: 'bot.example.com' });
      const result = await svc.submit('127.0.0.1', 'user@example.com', 'token-from-other-site');
      expect(result).toEqual({ ok: false, error: 'captcha_failed' });
      expect(db.insertLead).not.toHaveBeenCalled();
    });

    it('accepts the token when the hostname in the Google response is correct', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ success: true, hostname: 'bot.example.com' }),
      }));
      const svc = createInterestService(mockDb(), 'recaptcha-secret', { expectedHostname: 'bot.example.com' });
      const result = await svc.submit('127.0.0.1', 'user@example.com', 'token');
      expect(result).toEqual({ ok: true });
    });

    it('returns captcha_failed when fetch throws', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
      const svc = createInterestService(mockDb(), 'recaptcha-secret');
      const result = await svc.submit('127.0.0.1', 'user@example.com', 'token');
      expect(result).toEqual({ ok: false, error: 'captcha_failed' });
    });
  });
});
