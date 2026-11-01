import 'dotenv/config';
import { loadEnv } from './config/index.js';
import { createDb } from './db/index.js';
import { createWsServer } from './websocket/index.js';
import { createBotManager } from './engine/bot-manager.js';
import { createContainer } from './container.js';
import { createApp, mountRoutes } from './server.js';
import { ERROR_MSG } from './utils/constants.js';
import { seedUsers } from './db/seed.js';
import logger from './utils/logger.js';

const env = loadEnv();

const db = createDb('./data/trading.db');
seedUsers(db, env.adminUser, env.adminPass, process.env.SEED_DEMO_USERS === 'true');

const getUser = (id: number) => db.getUserById(id);
const { app, server } = createApp(env.apiKey, env.jwtSecret, getUser);
const broadcaster = createWsServer(server, env.jwtSecret, env.apiKey, getUser);

const botManager = createBotManager(db, broadcaster, env.jwtSecret);

const routers = createContainer({
  db, botManager,
  jwtSecret: env.jwtSecret, adminUser: env.adminUser, adminPass: env.adminPass,
  recaptchaSecret: env.recaptchaSecret,
  resendApiKey: env.resendApiKey,
  emailFrom: env.emailFrom,
  publicAppUrl: env.publicAppUrl,
});
mountRoutes(app, routers);

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`[shutdown] received ${signal}; ${ERROR_MSG.SHUTTING_DOWN}`);
  botManager.stopAll();
  db.close();
  broadcaster.close();
  server.close();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// unhandledRejection: log and continue. Node 15+'s default is to crash; we
// override because in a multi-tenant bot a stray rejection from one user's
// tick path shouldn't take down everyone else's bot. Genuine bugs surface
// in the log line.
process.on('unhandledRejection', (reason) => {
  logger.error(`[process] unhandledRejection: ${(reason as Error)?.stack ?? reason}`);
});
// uncaughtException: log and exit. After an uncaught sync exception the
// process is in an undefined state per Node docs — for a trading bot,
// continuing risks corrupt position/balance state. Container restart_policy
// brings the process back up and resumeAll re-bootstraps bots from DB.
process.on('uncaughtException', (err) => {
  logger.error(`[process] uncaughtException (exiting): ${err?.stack ?? err}`);
  process.exit(1);
});

botManager.resumeAll();

setInterval(() => {
  logger.info(`[heartbeat] ${new Date().toISOString()} runningBots=${botManager.runningCount()}`);
}, 60_000).unref();

server.listen(env.port, () => {
  logger.info(`Trading bot server running on port ${env.port}`);
  logger.info(`Multi-tenant mode enabled`);
  logger.info(`WebSocket ready`);
});
