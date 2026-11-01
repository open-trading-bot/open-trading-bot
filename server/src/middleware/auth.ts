import type { Request, Response, NextFunction } from 'express';
import { posix } from 'path';
import { timingSafeEqual } from 'crypto';
import { HTTP_STATUS, ERROR_MSG, PUBLIC_PATHS, PUBLIC_PREFIXES, ROLES } from '../utils/constants.js';
import { verifyUserToken } from '../utils/jwt.js';
import type { DbUser } from '../db/index.js';

export function safeEqual(a: unknown, b: string): boolean {
  if (typeof a !== 'string') return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function authMiddleware(apiKey: string, jwtSecret: string, getUser: (id: number) => DbUser | null) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Express routing ignores case, so compare a lower-case path. Otherwise
    // "/API/..." would skip this check and still reach an API route.
    const normPath = posix.normalize(req.path).toLowerCase();
    if (req.method === 'OPTIONS' || PUBLIC_PATHS.includes(normPath) || PUBLIC_PREFIXES.some((p) => normPath.startsWith(p)) || !normPath.startsWith('/api')) {
      next();
      return;
    }

    // Check API key — treated as admin role with id 0 (system)
    if (safeEqual(req.headers['x-api-key'], apiKey)) {
      (req as any).user = { id: 0, username: 'api-key', role: ROLES.ADMIN };
      next();
      return;
    }

    // Check JWT Bearer token against the current user record
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const user = verifyUserToken(authHeader.slice(7), jwtSecret, getUser);
      if (user) {
        (req as any).user = user;
        next();
        return;
      }
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MSG.SESSION_REVOKED });
      return;
    }

    res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MSG.UNAUTHORIZED });
  };
}
