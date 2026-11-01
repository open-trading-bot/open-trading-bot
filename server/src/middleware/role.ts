import type { Request, Response, NextFunction } from 'express';
import { HTTP_STATUS, ERROR_MSG } from '../utils/constants.js';

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userRole = (req as any).user?.role;
    if (!userRole || !roles.includes(userRole)) {
      res.status(HTTP_STATUS.FORBIDDEN).json({ error: ERROR_MSG.FORBIDDEN });
      return;
    }
    next();
  };
}
