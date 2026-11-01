import { Router } from 'express';
import { requireRole } from '../middleware/role.js';
import { ROLES } from '../utils/constants.js';
import type { FeatureFlagService } from '../services/featureFlags.js';

export function createDataRouter(dataController: {
  getDailyPnlReport: any;
  getPositions: any; getTrades: any; exportPositions: any; exportTrades: any; exportPositionsCsv: any; exportTradesCsv: any; exportPositionsTxt: any; exportTradesTxt: any; getPortfolio: any; getPortfolioBalance: any; getStrategies: any;
  toggleStrategy: any; getAssets: any; getSymbols: any; getTradeFilters: any; updateConfig: any;
  getExchangeKeys: any; updateExchangeKeys: any; verifyExchangeKeys: any; clearExchangeKeys: any; updateExchangeTestnet: any; checkExchangeKeyPermissions: any;
  getWallet: any; connectWallet: any; disconnectWallet: any; updatePreferences: any; closePosition: any;
}, featureFlagService: FeatureFlagService): Router {
  const router = Router();

  router.get('/reports/daily-pnl', dataController.getDailyPnlReport);
  router.get('/positions', dataController.getPositions);
  router.get('/positions/export', dataController.exportPositions);
  router.get('/positions/export.csv', dataController.exportPositionsCsv);
  router.get('/positions/export.txt', dataController.exportPositionsTxt);
  router.post('/positions/:id/close', requireRole(ROLES.DEMO, ROLES.REGULAR, ROLES.ADMIN), dataController.closePosition);
  router.get('/trades', dataController.getTrades);
  router.get('/trades/export', dataController.exportTrades);
  router.get('/trades/export.csv', dataController.exportTradesCsv);
  router.get('/trades/export.txt', dataController.exportTradesTxt);
  router.get('/portfolio', dataController.getPortfolio);
  router.get('/portfolio/balance', dataController.getPortfolioBalance);
  router.get('/strategies', dataController.getStrategies);
  router.post('/strategies/:id/toggle', dataController.toggleStrategy);
  router.get('/assets', dataController.getAssets);
  router.get('/symbols', dataController.getSymbols);
  router.get('/trades/filters', dataController.getTradeFilters);
  router.put('/config', dataController.updateConfig);
  router.get('/exchange-keys', requireRole(ROLES.REGULAR, ROLES.ADMIN), dataController.getExchangeKeys);
  router.get('/exchange-keys/check', requireRole(ROLES.REGULAR, ROLES.ADMIN), dataController.checkExchangeKeyPermissions);
  router.put('/exchange-keys', requireRole(ROLES.REGULAR, ROLES.ADMIN), dataController.updateExchangeKeys);
  router.post('/exchange-keys/verify', requireRole(ROLES.REGULAR, ROLES.ADMIN), dataController.verifyExchangeKeys);
  router.delete('/exchange-keys', requireRole(ROLES.REGULAR, ROLES.ADMIN), dataController.clearExchangeKeys);
  router.patch('/exchange-keys', requireRole(ROLES.REGULAR, ROLES.ADMIN), dataController.updateExchangeTestnet);
  router.get('/wallet', requireRole(ROLES.REGULAR, ROLES.ADMIN), dataController.getWallet);
  router.post('/wallet/connect', requireRole(ROLES.REGULAR, ROLES.ADMIN), dataController.connectWallet);
  router.post('/wallet/disconnect', requireRole(ROLES.REGULAR, ROLES.ADMIN), dataController.disconnectWallet);
  router.put('/preferences', dataController.updatePreferences);

  router.get('/feature-flags', (req, res) => {
    const user = (req as any).user;
    res.json({ flags: featureFlagService.getResolvedFlags(user.id, user.role) });
  });

  return router;
}
