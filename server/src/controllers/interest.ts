import type { Request, Response } from 'express';
import { HTTP_STATUS, ERROR_MSG } from '../utils/constants.js';
import { getClientIp } from '../utils/rate-limiter.js';
import type { InterestService } from '../services/interest.js';

export function createInterestController(interestService: InterestService) {
  return {
    async submit(req: Request, res: Response) {
      const ip = getClientIp(req);
      const ua = req.headers['user-agent'];
      const ref = req.headers.referer || req.headers.referrer;
      const result = await interestService.submit(ip, req.body.email, req.body.captchaToken, {
        userAgent: ua,
        referrer: typeof ref === 'string' ? ref : undefined,
      });

      if (result.error === 'rate_limited') {
        res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({ error: ERROR_MSG.TOO_MANY_REQUESTS });
        return;
      }
      if (result.error === 'invalid_email') {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.VALID_EMAIL_REQUIRED });
        return;
      }
      if (result.error === 'captcha_failed') {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.CAPTCHA_FAILED });
        return;
      }
      res.json({ ok: true });
    },
  };
}
