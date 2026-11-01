import jwt from 'jsonwebtoken';
import logger from '../utils/logger.js';
import { createRateLimiter } from '../utils/rate-limiter.js';
import { RATE_LIMITS, DEFAULTS } from '../utils/constants.js';
import { verifyPassword } from '../db/seed.js';
import { unblockUser } from '../utils/token-blocklist.js';
import type { Db } from '../db/index.js';

export interface AuthService {
  login(ip: string, username: string, password: string): LoginResult;
}

export interface LoginResult {
  ok: boolean;
  token?: string;
  role?: string;
  username?: string;
  disclaimerAccepted?: boolean;
  attemptsRemaining?: number;
  retryAfter?: number;
  error?: 'invalid_credentials' | 'rate_limited' | 'account_disabled';
}

export function createAuthService(db: Db, jwtSecret: string): AuthService {
  const limiter = createRateLimiter(RATE_LIMITS.LOGIN);

  return {
    login(ip, username, password) {
      const { allowed, retryAfter } = limiter.check(ip);
      if (!allowed) {
        logger.warn(`[auth] Login blocked for ${ip} — retry after ${retryAfter}s`);
        return { ok: false, error: 'rate_limited', retryAfter };
      }

      const lookup = typeof username === 'string' && username.includes('@')
        ? username.trim().toLowerCase()
        : username;
      const user = db.getUserByUsername(lookup);
      if (user && user.enabled && verifyPassword(password, user.passwordHash)) {
        limiter.clear(ip);
        unblockUser(user.id);
        db.updateLastLogin(user.id);
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, jwtSecret, { expiresIn: DEFAULTS.JWT_EXPIRY });
        logger.info(`[auth] Login success for ${ip} (${user.username}, role=${user.role})`);
        return { ok: true, token, role: user.role, username: user.username, email: user.email, disclaimerAccepted: user.disclaimerAcceptedAt != null };
      }

      if (user && !user.enabled) {
        logger.warn(`[auth] Login rejected for disabled user ${username} from ${ip}`);
        limiter.record(ip);
        const remaining = limiter.remaining(ip);
        return { ok: false, error: 'account_disabled', attemptsRemaining: remaining };
      }

      limiter.record(ip);
      const remaining = limiter.remaining(ip);
      logger.warn(`[auth] Login failed for ${ip} — ${remaining} attempts remaining`);
      return { ok: false, error: 'invalid_credentials', attemptsRemaining: remaining };
    },
  };
}
