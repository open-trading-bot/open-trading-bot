import logger from '../utils/logger.js';
import { createRateLimiter } from '../utils/rate-limiter.js';
import { RATE_LIMITS } from '../utils/constants.js';
import { signUserToken } from '../utils/jwt.js';
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
  const accountLimiter = createRateLimiter(RATE_LIMITS.LOGIN_ACCOUNT);

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
      const accountKey = `account:${String(lookup).toLowerCase()}`;
      const account = accountLimiter.check(accountKey);
      if (!account.allowed) {
        logger.warn(`[auth] Login blocked for account ${lookup} — retry after ${account.retryAfter}s`);
        return { ok: false, error: 'rate_limited', retryAfter: account.retryAfter };
      }
      const user = db.getUserByUsername(lookup);
      if (user && user.enabled && verifyPassword(password, user.passwordHash)) {
        limiter.clear(ip);
        accountLimiter.clear(accountKey);
        // Only clears the "sessions revoked" badge in the backoffice. Old
        // tokens stay invalid because their token version is out of date.
        unblockUser(user.id);
        db.updateLastLogin(user.id);
        const token = signUserToken(user, jwtSecret);
        logger.info(`[auth] Login success for ${ip} (${user.username}, role=${user.role})`);
        return { ok: true, token, role: user.role, username: user.username, email: user.email, disclaimerAccepted: user.disclaimerAcceptedAt != null };
      }

      if (user && !user.enabled) {
        logger.warn(`[auth] Login rejected for disabled user ${username} from ${ip}`);
        limiter.record(ip);
      accountLimiter.record(accountKey);
        accountLimiter.record(accountKey);
        const remaining = limiter.remaining(ip);
        return { ok: false, error: 'account_disabled', attemptsRemaining: remaining };
      }

      limiter.record(ip);
      accountLimiter.record(accountKey);
      const remaining = limiter.remaining(ip);
      logger.warn(`[auth] Login failed for ${ip} — ${remaining} attempts remaining`);
      return { ok: false, error: 'invalid_credentials', attemptsRemaining: remaining };
    },
  };
}
