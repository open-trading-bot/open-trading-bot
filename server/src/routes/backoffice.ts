import { Router } from 'express';
import { requireRole } from '../middleware/role.js';
import { ROLES } from '../utils/constants.js';

export function createBackofficeRouter(backofficeController: {
  getLeads: any; deleteLead: any; getStats: any;
  getUsers: any; createUser: any; updateUser: any; updateUserPassword: any; deleteUser: any;
  getAllTrades: any; getAllTradeFilters: any; getAllPositions: any; getUserBotStatuses: any; getUsersDailyPnl: any;
  getUserTrades: any; getUserTradeFilters: any; getUserPositions: any; getUserBotStatus: any; getUserActionLogs: any;
  getFeatureFlags: any; createFeatureFlag: any; updateFeatureFlag: any; deleteFeatureFlag: any; setFeatureFlagOverrides: any;
  listInvitations: any; createInvitation: any; resendInvitation: any; revokeInvitation: any;
}): Router {
  const router = Router();

  router.use(requireRole(ROLES.ADMIN));

  router.get('/leads', backofficeController.getLeads);
  router.delete('/leads/:id', backofficeController.deleteLead);
  router.get('/stats', backofficeController.getStats);
  router.get('/users', backofficeController.getUsers);
  router.post('/users', backofficeController.createUser);
  router.put('/users/:id', backofficeController.updateUser);
  router.put('/users/:id/password', backofficeController.updateUserPassword);
  router.delete('/users/:id', backofficeController.deleteUser);
  router.get('/users/:id/trades/filters', backofficeController.getUserTradeFilters);
  router.get('/users/:id/trades', backofficeController.getUserTrades);
  router.get('/users/:id/positions', backofficeController.getUserPositions);
  router.get('/users/:id/bot', backofficeController.getUserBotStatus);
  router.get('/users/:id/logs', backofficeController.getUserActionLogs);
  router.get('/trades/filters', backofficeController.getAllTradeFilters);
  router.get('/trades', backofficeController.getAllTrades);
  router.get('/positions', backofficeController.getAllPositions);
  router.get('/bots', backofficeController.getUserBotStatuses);
  router.get('/daily-pnl', backofficeController.getUsersDailyPnl);

  router.get('/feature-flags', backofficeController.getFeatureFlags);
  router.post('/feature-flags', backofficeController.createFeatureFlag);
  router.put('/feature-flags/:id', backofficeController.updateFeatureFlag);
  router.delete('/feature-flags/:id', backofficeController.deleteFeatureFlag);
  router.put('/feature-flags/:id/overrides', backofficeController.setFeatureFlagOverrides);

  router.get('/invitations', backofficeController.listInvitations);
  router.post('/invitations', backofficeController.createInvitation);
  router.post('/invitations/:id/resend', backofficeController.resendInvitation);
  router.delete('/invitations/:id', backofficeController.revokeInvitation);

  return router;
}
