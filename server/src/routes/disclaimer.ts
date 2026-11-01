import { Router, type Request, type Response } from 'express';
import { HTTP_STATUS, ERROR_MSG } from '../utils/constants.js';
import { getClientIp } from '../utils/rate-limiter.js';
import { DISCLAIMER_ERROR, type DisclaimerService } from '../services/disclaimer.js';

const USER_AGENT_MAX_LEN = 512;

export function createDisclaimerRouter(service: DisclaimerService): Router {
  const router = Router();

  router.get('/disclaimer', (_req, res) => {
    res.json(service.getPayload());
  });

  router.post('/me/accept-disclaimer', (req: Request, res: Response) => {
    const user = (req as any).user as { id: number } | undefined;
    if (!user) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MSG.UNAUTHORIZED });
      return;
    }
    const { signature, lang } = req.body ?? {};
    try {
      service.accept(
        user.id,
        {
          signature: typeof signature === 'string' ? signature : '',
          lang: typeof lang === 'string' ? lang : '',
        },
        {
          ip: getClientIp(req),
          userAgent: req.headers['user-agent']?.slice(0, USER_AGENT_MAX_LEN) ?? null,
        },
      );
      res.json({ ok: true, disclaimerAccepted: true });
    } catch (err: any) {
      if (
        err?.message === DISCLAIMER_ERROR.INVALID_SIGNATURE ||
        err?.message === DISCLAIMER_ERROR.INVALID_LANG
      ) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.DISCLAIMER_INVALID });
        return;
      }
      throw err;
    }
  });

  return router;
}
