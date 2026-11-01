import type { Request, Response, NextFunction } from 'express';
import { posix } from 'path';
import jwt from 'jsonwebtoken';
import { HTTP_STATUS, ERROR_MSG, PUBLIC_PATHS, PUBLIC_PREFIXES, ROLES } from '../utils/constants.js';
import { isBlocked } from '../utils/token-blocklist.js';

export function authMiddleware(apiKey: string, jwtSecret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip auth for preflight CORS, public paths, and non-API routes (static files)
    const normPath = posix.normalize(req.path);
    if (req.method === 'OPTIONS' || PUBLIC_PATHS.includes(normPath) || PUBLIC_PREFIXES.some((p) => normPath.startsWith(p)) || !normPath.startsWith('/api')) {
      next();
      return;
    }

    // Check API key — treated as admin role with id 0 (system)
    const providedKey = req.headers['x-api-key'];
    if (providedKey === apiKey) {
      (req as any).user = { id: 0, username: 'api-key', role: ROLES.ADMIN };
      next();
      return;
    }

    // Check JWT Bearer token
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        const payload = jwt.verify(token, jwtSecret) as { id: number; username: string; role: string };
        if (typeof payload.id !== 'number') {
          res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MSG.UNAUTHORIZED });
          return;
        }
        if (isBlocked(payload.id)) {
          res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MSG.SESSION_REVOKED });
          return;
        }
        (req as any).user = { id: payload.id, username: payload.username, role: payload.role };
        next();
        return;
      } catch {
        // fall through to 401
      }
    }

    res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MSG.UNAUTHORIZED });
  };
}
