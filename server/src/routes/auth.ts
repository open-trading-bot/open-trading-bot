import { Router } from 'express';

export function createAuthRouter(
  authController: { login: any; getInvitation: any; acceptInvitation: any },
  interestController: { submit: any },
): Router {
  const router = Router();

  router.post('/login', authController.login);
  router.post('/interest', interestController.submit);
  router.get('/invitation/:token', authController.getInvitation);
  router.post('/invitation/:token/accept', authController.acceptInvitation);

  return router;
}
