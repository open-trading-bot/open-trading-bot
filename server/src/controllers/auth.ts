import type { Request, Response } from 'express';
import { HTTP_STATUS, ERROR_MSG, RATE_LIMITS } from '../utils/constants.js';
import { getClientIp, createRateLimiter } from '../utils/rate-limiter.js';
import type { AuthService } from '../services/auth.js';
import type { InvitationsService } from '../services/invitations.js';

const USER_AGENT_MAX_LEN = 512;

export function createAuthController(authService: AuthService, invitationsService: InvitationsService) {
  const lookupLimiter = createRateLimiter(RATE_LIMITS.INVITATION_LOOKUP);
  const acceptLimiter = createRateLimiter(RATE_LIMITS.INVITATION_ACCEPT);

  return {
    login(req: Request, res: Response) {
      const ip = getClientIp(req);
      const { username, password } = req.body;
      const result = authService.login(ip, username, password);

      if (result.error === 'rate_limited') {
        res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({ error: ERROR_MSG.TOO_MANY_ATTEMPTS, retryAfter: result.retryAfter });
        return;
      }
      if (result.error === 'invalid_credentials' || result.error === 'account_disabled') {
        res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: ERROR_MSG.INVALID_CREDENTIALS, attemptsRemaining: result.attemptsRemaining });
        return;
      }
      res.json({
        token: result.token,
        role: result.role,
        username: result.username,
        disclaimerAccepted: result.disclaimerAccepted,
      });
    },

    getInvitation(req: Request<{ token: string }>, res: Response) {
      const ip = getClientIp(req);
      const { allowed, retryAfter } = lookupLimiter.check(ip);
      if (!allowed) {
        res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({ error: ERROR_MSG.TOO_MANY_ATTEMPTS, retryAfter });
        return;
      }
      lookupLimiter.record(ip);
      const found = invitationsService.lookup(req.params.token);
      if (!found) {
        res.status(HTTP_STATUS.NOT_FOUND).json({ error: ERROR_MSG.INVITATION_INVALID });
        return;
      }
      res.json({ email: found.email });
    },

    acceptInvitation(req: Request<{ token: string }>, res: Response) {
      const ip = getClientIp(req);
      const { allowed, retryAfter } = acceptLimiter.check(ip);
      if (!allowed) {
        res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({ error: ERROR_MSG.TOO_MANY_ATTEMPTS, retryAfter });
        return;
      }
      acceptLimiter.record(ip);
      const { password, signature, lang } = req.body ?? {};
      try {
        const { user, token } = invitationsService.accept(req.params.token, password, {
          signature: typeof signature === 'string' ? signature : '',
          lang: typeof lang === 'string' ? lang : '',
          ip,
          userAgent: req.headers['user-agent']?.slice(0, USER_AGENT_MAX_LEN) ?? null,
        });
        res.json({ token, role: user.role, username: user.username, disclaimerAccepted: true });
      } catch (err: any) {
        if (err.message === ERROR_MSG.INVALID_PASSWORD || err.message === ERROR_MSG.DISCLAIMER_INVALID) {
          res.status(HTTP_STATUS.BAD_REQUEST).json({ error: err.message });
        } else {
          res.status(HTTP_STATUS.NOT_FOUND).json({ error: ERROR_MSG.INVITATION_INVALID });
        }
      }
    },
  };
}
