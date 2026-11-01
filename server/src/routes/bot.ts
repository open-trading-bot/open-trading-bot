import { Router } from 'express';

export function createBotRouter(botController: { getStatus: any; start: any; stop: any; kill: any }): Router {
  const router = Router();

  router.get('/status', botController.getStatus);
  router.post('/start', botController.start);
  router.post('/stop', botController.stop);
  router.post('/kill', botController.kill);

  return router;
}
