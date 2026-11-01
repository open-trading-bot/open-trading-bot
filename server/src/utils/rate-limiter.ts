import type { Request } from 'express';

interface RateLimitRecord {
  count: number;
  firstAttempt: number;
  lockedUntil: number | null;
}

interface RateLimiterConfig {
  maxAttempts: number;
  windowMs: number;
  lockoutMs?: number;
}

export interface RateLimiter {
  check(ip: string): { allowed: boolean; retryAfter?: number };
  record(ip: string): void;
  clear(ip: string): void;
  remaining(ip: string): number;
}

export function getClientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
}

export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  const records = new Map<string, RateLimitRecord>();

  return {
    check(ip: string) {
      const now = Date.now();
      const record = records.get(ip);
      if (!record) return { allowed: true };

      if (record.lockedUntil && now < record.lockedUntil) {
        return { allowed: false, retryAfter: Math.ceil((record.lockedUntil - now) / 1000) };
      }
      if (record.lockedUntil && now >= record.lockedUntil) {
        records.delete(ip);
        return { allowed: true };
      }
      if (now - record.firstAttempt > config.windowMs) {
        records.delete(ip);
        return { allowed: true };
      }
      if (record.count >= config.maxAttempts) {
        if (config.lockoutMs) record.lockedUntil = now + config.lockoutMs;
        return { allowed: false, retryAfter: config.lockoutMs ? Math.ceil(config.lockoutMs / 1000) : 0 };
      }
      return { allowed: true };
    },

    record(ip: string) {
      const now = Date.now();
      const record = records.get(ip);
      if (!record || now - record.firstAttempt > config.windowMs) {
        records.set(ip, { count: 1, firstAttempt: now, lockedUntil: null });
      } else {
        record.count++;
      }
    },

    clear(ip: string) {
      records.delete(ip);
    },

    remaining(ip: string) {
      const record = records.get(ip);
      return config.maxAttempts - (record?.count ?? 0);
    },
  };
}
