import logger from '../utils/logger.js';
import { createRateLimiter } from '../utils/rate-limiter.js';
import { RATE_LIMITS, CAPTCHA_VERIFY_URL } from '../utils/constants.js';
import type { Db } from '../db/index.js';

export interface InterestService {
  submit(ip: string, email: unknown, captchaToken: unknown, meta?: { userAgent?: string; referrer?: string }): Promise<InterestResult>;
}

export interface InterestResult {
  ok: boolean;
  error?: 'rate_limited' | 'invalid_email' | 'captcha_failed';
}

export function createInterestService(db: Db, recaptchaSecret?: string): InterestService {
  const limiter = createRateLimiter(RATE_LIMITS.INTEREST);

  return {
    async submit(ip, email, captchaToken, meta) {
      const { allowed } = limiter.check(ip);
      if (!allowed) return { ok: false, error: 'rate_limited' };
      limiter.record(ip);

      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return { ok: false, error: 'invalid_email' };
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
          const data = await response.json() as { success: boolean };
          if (!data.success) {
            logger.warn(`[lead] Captcha failed for ${ip}`);
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
