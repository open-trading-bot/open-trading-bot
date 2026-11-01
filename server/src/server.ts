import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import http from 'http';
import type { Router } from 'express';
import { authMiddleware } from './middleware/auth.js';
import { ipAllowListMiddleware } from './middleware/ip-allowlist.js';
import { API_PATHS, HTTP_STATUS, ERROR_MSG } from './utils/constants.js';
import { PublicError } from './utils/errors.js';
import logger from './utils/logger.js';

import type { DbUser } from './db/index.js';

/**
 * Which proxies may set X-Forwarded-For. The default trusts only private
 * networks (for example the nginx container). Set TRUST_PROXY to a hop count
 * or address list when another proxy sits in front of the server.
 */
export function trustProxySetting(value = process.env.TRUST_PROXY): string | number {
  if (value === undefined || value.trim() === '') return 'loopback, linklocal, uniquelocal';
  return /^\d+$/.test(value.trim()) ? Number(value) : value;
}

export function createApp(apiKey: string, jwtSecret: string, getUser: (id: number) => DbUser | null) {
  const app = express();
  const server = http.createServer(app);
  app.set('trust proxy', trustProxySetting());

  app.use(cors());
  app.use(express.json());
  app.use((req, _res, next) => {
    logger.info(`[api] ${req.method} ${req.path}`);
    next();
  });
  // Runs before auth, so a blocked address gets 403 also with a valid token.
  // Express matches this path without case sensitivity.
  app.use(API_PATHS.BACKOFFICE, ipAllowListMiddleware(process.env.BACKOFFICE_ALLOWED_IPS));
  app.use(authMiddleware(apiKey, jwtSecret, getUser));

  return { app, server };
}

export function mountRoutes(app: express.Express, routers: {
  authRouter: Router; botRouter: Router; dataRouter: Router; backtestRouter: Router; backofficeRouter: Router; disclaimerRouter: Router;
}) {
  app.get(API_PATHS.HEALTH, (_req, res) => { res.json({ status: HTTP_STATUS.OK, timestamp: Date.now() }); });
  app.get(API_PATHS.VERSION, (_req, res) => {
    const sha = process.env.GIT_COMMIT_SHA || '';
    res.json({ version: sha ? sha.slice(0, 7) : 'unknown' });
  });
  app.use('/api', routers.disclaimerRouter);
  app.use(API_PATHS.AUTH, routers.authRouter);
  app.use(API_PATHS.BOT, routers.botRouter);
  app.use(API_PATHS.DATA, routers.dataRouter);
  app.use(API_PATHS.BACKTEST, routers.backtestRouter);
  app.use(API_PATHS.BACKOFFICE, routers.backofficeRouter);

  // Error handling middleware
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const errorHandler: express.ErrorRequestHandler = (err, req, res, _next) => {
    if (err instanceof PublicError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    // Do not send the error text: it can contain SQL, exchange responses or
    // parser details. Body parser errors carry a 4xx status.
    const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : HTTP_STATUS.INTERNAL_ERROR;
    logger.error(`[api-error] ${req.method} ${req.path} — ${err?.stack ?? err}`);
    res.status(status).json({ error: status === HTTP_STATUS.INTERNAL_ERROR ? ERROR_MSG.INTERNAL_ERROR : ERROR_MSG.INVALID_REQUEST });
  };
  app.use(errorHandler);

  // Serve client static files in production
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));
  app.get('{*path}', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}
