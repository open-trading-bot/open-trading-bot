import type { Request, Response } from 'express';
import type { BackofficeService } from '../services/backoffice.js';
import type { FeatureFlagService } from '../services/featureFlags.js';
import type { InvitationsService } from '../services/invitations.js';
import { HTTP_STATUS, ERROR_MSG, DEFAULTS, ROLES } from '../utils/constants.js';
import { isPasswordValid } from '../utils/password.js';

export function createBackofficeController(
  backofficeService: BackofficeService,
  featureFlagService: FeatureFlagService,
  invitationsService: InvitationsService,
) {
  return {
    getLeads(_req: Request, res: Response) {
      res.json(backofficeService.getLeads());
    },
    deleteLead(req: Request, res: Response) {
      const id = Number(req.params.id);
      backofficeService.deleteLead(id);
      res.json({ ok: true });
    },
    async getStats(_req: Request, res: Response) {
      res.json(await backofficeService.getStats());
    },
    getUsers(_req: Request, res: Response) {
      const users = backofficeService.getUsers().map(({ passwordHash: _, exchangeKey: _k, exchangeSecret: _s, walletAddress: _w, ...u }) => u);
      res.json(users);
    },
    createUser(req: Request, res: Response) {
      const { username, password, email, role } = req.body;
      if (!username || !password) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.USERNAME_PASSWORD_REQUIRED });
        return;
      }
      try {
        const user = backofficeService.createUser(username, password, email || null, role || ROLES.DEMO);
        res.json(user);
      } catch (err: any) {
        if (err.message === ERROR_MSG.USERNAME_TAKEN) {
          res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.USERNAME_TAKEN });
        } else {
          res.status(HTTP_STATUS.INTERNAL_ERROR).json({ error: err.message });
        }
      }
    },
    async updateUser(req: Request, res: Response) {
      const id = Number(req.params.id);
      const adminId = (req as any).user.id;
      const { email, role, enabled, paperBalance } = req.body;
      await backofficeService.updateUser(id, { email, role, enabled, paperBalance }, adminId);
      res.json({ ok: true });
    },
    updateUserPassword(req: Request, res: Response) {
      const id = Number(req.params.id);
      const { password } = req.body;
      if (!password || !isPasswordValid(password)) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.INVALID_PASSWORD });
        return;
      }
      backofficeService.updateUserPassword(id, password);
      res.json({ ok: true });
    },
    deleteUser(req: Request, res: Response) {
      const id = Number(req.params.id);
      const adminId = (req as any).user.id;
      backofficeService.deleteUser(id, adminId);
      res.json({ ok: true });
    },
    getAllTrades(req: Request, res: Response) {
      const page = Number(req.query.page) || 0;
      const limit = Math.min(Number(req.query.limit) || 20, DEFAULTS.MAX_PAGE_SIZE);
      const filters: Record<string, any> = {};
      for (const key of ['symbol', 'side', 'strategy', 'mode', 'pnl', 'testnet', 'exchange']) {
        const val = req.query[key];
        if (typeof val === 'string' && val) filters[key] = val;
      }
      if (req.query.userId && typeof req.query.userId === 'string') filters.userId = Number(req.query.userId);
      if (req.query.excludeZeroPnl === 'true') filters.excludeZeroPnl = true;
      if (typeof req.query.sortBy === 'string') filters.sortBy = req.query.sortBy;
      if (req.query.sortDir === 'asc') filters.sortDir = 'asc';
      res.json(backofficeService.getAllTradesPaginated(page, limit, Object.keys(filters).length > 0 ? filters : undefined));
    },
    getAllTradeFilters(_req: Request, res: Response) {
      res.json(backofficeService.getAllTradeFilters());
    },
    getAllPositions(req: Request, res: Response) {
      const page = Number(req.query.page) || 0;
      const limit = Math.min(Number(req.query.limit) || 20, DEFAULTS.MAX_PAGE_SIZE);
      res.json(backofficeService.getAllPositionsPaginated(page, limit));
    },
    getUserBotStatuses(_req: Request, res: Response) {
      res.json(backofficeService.getUserBotStatuses());
    },
    getUsersDailyPnl(_req: Request, res: Response) {
      res.json(backofficeService.getUsersDailyPnl());
    },
    getUserTrades(req: Request, res: Response) {
      const userId = Number(req.params.id);
      const page = Number(req.query.page) || 0;
      const limit = Math.min(Number(req.query.limit) || 20, DEFAULTS.MAX_PAGE_SIZE);
      const filters: Record<string, any> = {};
      for (const key of ['symbol', 'side', 'strategy', 'mode', 'pnl', 'testnet', 'exchange']) {
        const val = req.query[key];
        if (typeof val === 'string' && val) filters[key] = val;
      }
      if (req.query.excludeZeroPnl === 'true') filters.excludeZeroPnl = true;
      res.json(backofficeService.getUserTradesPaginated(userId, page, limit, Object.keys(filters).length > 0 ? filters : undefined));
    },
    getUserTradeFilters(req: Request, res: Response) {
      const userId = Number(req.params.id);
      res.json(backofficeService.getUserTradeFilters(userId));
    },
    getUserPositions(req: Request, res: Response) {
      const userId = Number(req.params.id);
      const page = Number(req.query.page) || 0;
      const limit = Math.min(Number(req.query.limit) || 20, DEFAULTS.MAX_PAGE_SIZE);
      res.json(backofficeService.getUserPositionsPaginated(userId, page, limit));
    },
    getUserBotStatus(req: Request, res: Response) {
      const userId = Number(req.params.id);
      const status = backofficeService.getUserBotStatus(userId);
      res.json(status ?? { status: 'stopped', mode: DEFAULTS.BOT_MODE });
    },
    getUserActionLogs(req: Request, res: Response) {
      const userId = Number(req.params.id);
      const page = Number(req.query.page) || 0;
      const limit = Math.min(Number(req.query.limit) || 20, DEFAULTS.MAX_PAGE_SIZE);
      const filters: { action?: string; source?: string } = {};
      if (typeof req.query.action === 'string' && req.query.action) filters.action = req.query.action;
      if (typeof req.query.source === 'string' && req.query.source) filters.source = req.query.source;
      res.json(backofficeService.getUserActionLogs(userId, page, limit, Object.keys(filters).length > 0 ? filters : undefined));
    },
    getFeatureFlags(_req: Request, res: Response) {
      res.json(featureFlagService.getAllFlags());
    },
    createFeatureFlag(req: Request, res: Response) {
      const { id, description, enabled } = req.body;
      if (!id || !description) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.FLAG_ID_DESC_REQUIRED });
        return;
      }
      if (!/^[a-zA-Z0-9_]{1,64}$/.test(id)) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.FLAG_ID_INVALID });
        return;
      }
      if (String(description).length > 500) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.FLAG_DESC_TOO_LONG });
        return;
      }
      try {
        const userId = (req as any).user.id;
        featureFlagService.createFlag(id, String(description), enabled === true, userId);
        res.json({ ok: true });
      } catch (err: any) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: err.message });
      }
    },
    updateFeatureFlag(req: Request, res: Response) {
      const id = req.params.id as string;
      const { description, enabled } = req.body;
      const updates: Partial<{ description: string; enabled: boolean }> = {};
      if (description !== undefined) {
        if (String(description).length > 500) {
          res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.FLAG_DESC_TOO_LONG });
          return;
        }
        updates.description = String(description);
      }
      if (enabled !== undefined) updates.enabled = enabled === true;
      featureFlagService.updateFlag(id, updates);
      res.json({ ok: true });
    },
    deleteFeatureFlag(req: Request, res: Response) {
      const id = req.params.id as string;
      featureFlagService.deleteFlag(id);
      res.json({ ok: true });
    },
    setFeatureFlagOverrides(req: Request, res: Response) {
      const id = req.params.id as string;
      const { overrides } = req.body;
      if (!Array.isArray(overrides)) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.OVERRIDES_MUST_BE_ARRAY });
        return;
      }
      if (overrides.length > 200) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.OVERRIDES_TOO_MANY });
        return;
      }
      const validRoles = Object.values(ROLES);
      for (const o of overrides) {
        if (o.targetType !== 'user' && o.targetType !== 'role') {
          res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.INVALID_TARGET_TYPE });
          return;
        }
        if (o.targetType === 'role' && !validRoles.includes(o.targetValue)) {
          res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.INVALID_ROLE });
          return;
        }
        if (o.targetType === 'user' && !/^\d+$/.test(String(o.targetValue))) {
          res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.INVALID_USER_TARGET });
          return;
        }
      }
      featureFlagService.setOverrides(id, overrides.map((o: any) => ({
        targetType: o.targetType,
        targetValue: String(o.targetValue),
        enabled: o.enabled === true,
      })));
      res.json({ ok: true });
    },

    listInvitations(_req: Request, res: Response) {
      const list = invitationsService.list({ includeAll: true });
      res.json(list);
    },

    async createInvitation(req: Request, res: Response) {
      const { email } = req.body ?? {};
      if (typeof email !== 'string' || email.length === 0) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.INVALID_EMAIL });
        return;
      }
      const createdBy = (req as any).user.id;
      try {
        const result = await invitationsService.create({ email, createdBy });
        if (result.emailSent) res.json({ id: result.id, emailSent: true });
        else res.json({ emailSent: false });
      } catch (err: any) {
        if (err.message === ERROR_MSG.INVALID_EMAIL) {
          res.status(HTTP_STATUS.BAD_REQUEST).json({ error: err.message });
        } else if (err.message === ERROR_MSG.USER_EXISTS) {
          res.status(HTTP_STATUS.CONFLICT).json({ error: err.message });
        } else if (err.message === ERROR_MSG.EMAIL_SEND_FAILED) {
          res.status(HTTP_STATUS.BAD_GATEWAY).json({ error: err.message });
        } else {
          res.status(HTTP_STATUS.INTERNAL_ERROR).json({ error: err.message });
        }
      }
    },

    async resendInvitation(req: Request<{ id: string }>, res: Response) {
      try {
        const result = await invitationsService.resend(req.params.id);
        if (result.emailSent) res.json({ id: result.id, emailSent: true });
        else res.json({ emailSent: false });
      } catch (err: any) {
        if (err.message === ERROR_MSG.INVITATION_INVALID) {
          res.status(HTTP_STATUS.NOT_FOUND).json({ error: err.message });
        } else if (err.message === ERROR_MSG.USER_EXISTS) {
          res.status(HTTP_STATUS.CONFLICT).json({ error: err.message });
        } else if (err.message === ERROR_MSG.EMAIL_SEND_FAILED) {
          res.status(HTTP_STATUS.BAD_GATEWAY).json({ error: err.message });
        } else {
          res.status(HTTP_STATUS.INTERNAL_ERROR).json({ error: err.message });
        }
      }
    },

    revokeInvitation(req: Request<{ id: string }>, res: Response) {
      invitationsService.revoke(req.params.id);
      res.json({ ok: true });
    },
  };
}
