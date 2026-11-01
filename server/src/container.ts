import type { Db } from './db/index.js';
import type { BotManager } from './engine/bot-manager.js';

// Services
import { createAuthService } from './services/auth.js';
import { createInterestService } from './services/interest.js';
import { createBotService } from './services/bot.js';
import { createDataService } from './services/data.js';
import { createBacktestService } from './services/backtest.js';
import { createBackofficeService } from './services/backoffice.js';
import { createFeatureFlagService } from './services/featureFlags.js';
import { createEmailService } from './services/email.js';
import { createInvitationsService } from './services/invitations.js';
import { createDisclaimerService } from './services/disclaimer.js';

// Controllers
import { createAuthController } from './controllers/auth.js';
import { createInterestController } from './controllers/interest.js';
import { createBotController } from './controllers/bot.js';
import { createDataController } from './controllers/data.js';
import type { ExchangeKeyCipher } from './utils/crypto.js';
import { createBacktestController } from './controllers/backtest.js';
import { createBackofficeController } from './controllers/backoffice.js';

import { signUserToken } from './utils/jwt.js';

// Routes
import { createAuthRouter } from './routes/auth.js';
import { createBotRouter } from './routes/bot.js';
import { createDataRouter } from './routes/data.js';
import { createBacktestRouter } from './routes/backtest.js';
import { createBackofficeRouter } from './routes/backoffice.js';
import { createDisclaimerRouter } from './routes/disclaimer.js';

interface ContainerConfig {
  db: Db;
  botManager: BotManager;
  jwtSecret: string;
  exchangeKeyCipher: ExchangeKeyCipher;
  adminUser: string;
  adminPass: string;
  recaptchaSecret?: string;
  recaptchaHostname?: string;
  resendApiKey?: string;
  emailFrom?: string;
  publicAppUrl: string;
}

export function createContainer(config: ContainerConfig) {
  // Services — own their dependencies
  const authService = createAuthService(config.db, config.jwtSecret);
  const interestService = createInterestService(config.db, config.recaptchaSecret, { expectedHostname: config.recaptchaHostname });
  const botService = createBotService(config.botManager, config.db);
  const dataService = createDataService(config.db, config.botManager);
  const backtestService = createBacktestService(config.db, config.botManager);
  const backofficeService = createBackofficeService(config.db, config.botManager);
  const featureFlagService = createFeatureFlagService(config.db);
  const emailService = createEmailService({
    resendApiKey: config.resendApiKey,
    emailFrom: config.emailFrom,
  });
  const invitationsService = createInvitationsService(
    config.db,
    emailService,
    config.publicAppUrl,
    (user) => signUserToken(user, config.jwtSecret),
  );
  const disclaimerService = createDisclaimerService(config.db);

  // Controllers — only know services
  const authController = createAuthController(authService, invitationsService);
  const interestController = createInterestController(interestService);
  const botController = createBotController(botService);
  const dataController = createDataController(dataService, config.db, config.exchangeKeyCipher, botService);
  const backtestController = createBacktestController(backtestService);
  const backofficeController = createBackofficeController(backofficeService, featureFlagService, invitationsService);

  // Routes — only know controllers
  const authRouter = createAuthRouter(authController, interestController);
  const botRouter = createBotRouter(botController);
  const dataRouter = createDataRouter(dataController, featureFlagService);
  const backtestRouter = createBacktestRouter(backtestController);
  const backofficeRouter = createBackofficeRouter(backofficeController);
  const disclaimerRouter = createDisclaimerRouter(disclaimerService);

  return { authRouter, botRouter, dataRouter, backtestRouter, backofficeRouter, disclaimerRouter };
}
