import { Router } from 'express';

export function createBacktestRouter(backtestController: { run: any }): Router {
  const router = Router();

  router.get('/', backtestController.run);

  return router;
}
