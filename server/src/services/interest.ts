import logger from '../utils/logger.js';
import { createRateLimiter } from '../utils/rate-limiter.js';
import { RATE_LIMITS, CAPTCHA_VERIFY_URL } from '../utils/constants.js';
import type { Db } from '../db/index.js';

export interface InterestService {
  submit(ip: string, email: unknown, captchaToken: unknown, meta?: { userAgent?: string; referrer?: string }): Promise<InterestResult>;
}

export interface InterestResult {
  ok: boolean;
  error?: 'rate_limited' | 'invalid_email' | 'captcha_failed' | 'captcha_unavailable';
}

export interface InterestOptions {
  /** In production the form needs reCAPTCHA. Default: NODE_ENV is "production". */
  production?: boolean;
  /** When set, the hostname in the Google response must be equal to this value. */
  expectedHostname?: string;
}

export function createInterestService(db: Db, recaptchaSecret?: string, options: InterestOptions = {}): InterestService {
  const limiter = createRateLimiter(RATE_LIMITS.INTEREST);
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const expectedHostname = options.expectedHostname?.toLowerCase();

  if (!recaptchaSecret) {
    if (production) logger.error('[lead] RECAPTCHA_SECRET_KEY is not set. The interest form refuses all submissions.');
    else logger.warn('[lead] RECAPTCHA_SECRET_KEY is not set. The captcha check is skipped (not production).');
  }

  return {
    async submit(ip, email, captchaToken, meta) {
      const { allowed } = limiter.check(ip);
      if (!allowed) return { ok: false, error: 'rate_limited' };
      limiter.record(ip);

      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return { ok: false, error: 'invalid_email' };
      }

      if (!recaptchaSecret && production) {
        return { ok: false, error: 'captcha_unavailable' };
      }

      if (recaptchaSecret) {
        if (!captchaToken || typeof captchaToken !== 'string') {
          return { ok: false, error: 'captcha_failed' };
        }
        try {
          const response = await fetch(CAPTCHA_VERIFY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=${encodeURIComponent(recaptchaSecret)}&response=${encodeURIComponent(captchaToken)}&remoteip=${encodeURIComponent(ip)}`,
          });
          const data = await response.json() as { success: boolean; hostname?: string };
          if (!data.success) {
            logger.warn(`[lead] Captcha failed for ${ip}`);
            return { ok: false, error: 'captcha_failed' };
          }
          // A token solved on a different site is valid for the same site key.
          if (expectedHostname && data.hostname?.toLowerCase() !== expectedHostname) {
            logger.warn(`[lead] Captcha hostname mismatch for ${ip}: ${data.hostname}`);
            return { ok: false, error: 'captcha_failed' };
          }
        } catch (err) {
          logger.error(`[lead] Captcha verification error: ${err}`);
          return { ok: false, error: 'captcha_failed' };
        }
      }

      try {
        db.insertLead(email.trim().toLowerCase(), { ip, ...meta });
        logger.info(`[lead] New interest: ${email}`);
      } catch {
        // duplicate — silently succeed
      }
      return { ok: true };
    },
  };
}
