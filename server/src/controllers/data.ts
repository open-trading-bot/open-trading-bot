import type { Request, Response } from 'express';
import { HTTP_STATUS, ERROR_MSG, DEFAULTS, ROLES, WALLET_SIGN_MESSAGE, RATE_LIMITS, SUPPORTED_EXCHANGES, DEFAULT_EXCHANGE, EXCHANGE_VERIFY_TIMEOUT, EXPORT } from '../utils/constants.js';
import type { DataService } from '../services/data.js';
import type { BotService } from '../services/bot.js';
import type { Db } from '../db/index.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { verifyMessage } from 'ethers';
import { createBybitAdapter } from '../exchange/bybit.js';
import { createBinanceAdapter } from '../exchange/binance.js';
import { createRateLimiter, getClientIp } from '../utils/rate-limiter.js';
import { parseConfigUpdate } from '../utils/config-schema.js';
import { csvHeader, csvRow, csvAttachmentFilename } from '../utils/csv.js';
import { buildTextTable, textAttachmentFilename } from '../utils/text.js';

const verifyLimiter = createRateLimiter(RATE_LIMITS.VERIFY_EXCHANGE);
const checkKeyLimiter = createRateLimiter(RATE_LIMITS.CHECK_EXCHANGE_KEY);

function createExchangeAdapter(name: string, config: { apiKey: string; secret: string; testnet: boolean }) {
  switch (name) {
    case 'binance': return createBinanceAdapter(config);
    default: return createBybitAdapter(config);
  }
}

type ValidationError = { status: number; error: string };

function applyDemoModeRules(role: string, requestedMode: string | undefined, update: Record<string, any>): ValidationError | null {
  if (role !== ROLES.DEMO) return null;
  if (requestedMode === 'live') {
    return { status: HTTP_STATUS.FORBIDDEN, error: ERROR_MSG.DEMO_LIVE_RESTRICTED };
  }
  update.mode = DEFAULTS.BOT_MODE;
  return null;
}

function validateLiveRequiresKeys(
  requestedMode: string | undefined,
  user: { exchangeKey?: string | null; exchangeSecret?: string | null } | null,
): ValidationError | null {
  if (requestedMode !== 'live') return null;
  if (user?.exchangeKey && user?.exchangeSecret) return null;
  return { status: HTTP_STATUS.BAD_REQUEST, error: ERROR_MSG.LIVE_REQUIRES_KEYS };
}

function validatePaperBalanceLimits(
  currentMode: string,
  update: { tradeAmount?: number; dailyLossLimit?: number },
  user: { paperBalance?: number } | null,
): ValidationError | null {
  if (currentMode !== 'paper') return null;
  const balance = user?.paperBalance ?? DEFAULTS.PAPER_BALANCE;
  if (update.tradeAmount !== undefined && update.tradeAmount > balance) {
    return { status: HTTP_STATUS.BAD_REQUEST, error: ERROR_MSG.TRADE_AMOUNT_EXCEEDS_BALANCE };
  }
  if (update.dailyLossLimit !== undefined && update.dailyLossLimit > balance) {
    return { status: HTTP_STATUS.BAD_REQUEST, error: ERROR_MSG.DAILY_LOSS_EXCEEDS_BALANCE };
  }
  return null;
}

function validateAssetsCount(update: { assets?: { enabled: boolean }[] }): ValidationError | null {
  if (!update.assets) return null;
  if (update.assets.length > DEFAULTS.MAX_TOTAL_ASSETS) {
    return { status: HTTP_STATUS.BAD_REQUEST, error: ERROR_MSG.MAX_TOTAL_ASSETS_EXCEEDED };
  }
  if (update.assets.filter((a) => a.enabled).length > DEFAULTS.MAX_ENABLED_ASSETS) {
    return { status: HTTP_STATUS.BAD_REQUEST, error: ERROR_MSG.MAX_ASSETS_EXCEEDED };
  }
  return null;
}

function exchangeVerifyTimeout(): Promise<never> {
  return new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), EXCHANGE_VERIFY_TIMEOUT),
  );
}

async function verifyExchangeCredentials(
  exchangeName: string,
  apiKey: string,
  apiSecret: string,
  testnet: boolean,
): Promise<{ balance: number } | ValidationError> {
  try {
    const adapter = createExchangeAdapter(exchangeName, { apiKey, secret: apiSecret, testnet });
    const timeout = exchangeVerifyTimeout();
    const balance = await Promise.race([adapter.fetchBalance(), timeout]);
    if (adapter.fetchPermissions) {
      try {
        const perms = await Promise.race([adapter.fetchPermissions(), timeout]);
        if (perms.readOnly || !perms.canTrade) {
          return { status: HTTP_STATUS.BAD_REQUEST, error: ERROR_MSG.READ_ONLY_KEY };
        }
      } catch {
        // Permissions endpoint itself failed — don't hard-block. A restricted
        // key will surface at the first trade attempt.
      }
    }
    return { balance: balance.total };
  } catch {
    return { status: HTTP_STATUS.BAD_REQUEST, error: ERROR_MSG.VERIFY_FAILED };
  }
}

function isValidationError(result: { balance: number } | ValidationError): result is ValidationError {
  return 'status' in result;
}

export function createDataController(dataService: DataService, db: Db, jwtSecret: string, botService: BotService) {
  return {
    getDailyPnlReport(req: Request, res: Response) {
      const userId = (req as any).user.id;
      res.json(dataService.getDailyPnlReport(userId));
    },
    getPositions(req: Request, res: Response) {
      const userId = (req as any).user.id;
      const page = Number(req.query.page) || 0;
      const limit = Math.min(Number(req.query.limit) || 20, DEFAULTS.MAX_PAGE_SIZE);
      res.json(dataService.getPositionsPaginated(userId, page, limit));
    },
    getTrades(req: Request, res: Response) {
      const userId = (req as any).user.id;
      const page = Number(req.query.page) || 0;
      const limit = Math.min(Number(req.query.limit) || DEFAULTS.DEFAULT_TRADE_LIMIT, DEFAULTS.MAX_PAGE_SIZE);
      const filters: Record<string, any> = {};
      for (const key of ['symbol', 'side', 'strategy', 'mode', 'pnl', 'testnet', 'exchange']) {
        const val = req.query[key];
        if (typeof val === 'string' && val) filters[key] = val;
      }
      if (req.query.excludeZeroPnl === 'true') filters.excludeZeroPnl = true;
      const sortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy : undefined;
      const sortDir = req.query.sortDir === 'asc' ? 'asc' as const : 'desc' as const;
      const sort = sortBy ? { by: sortBy, dir: sortDir } : undefined;
      res.json(dataService.getTradesPaginated(userId, page, limit, Object.keys(filters).length > 0 ? filters : undefined, sort));
    },
    exportTrades(req: Request, res: Response) {
      const userId = (req as any).user.id;
      const filters: Record<string, any> = {};
      for (const key of ['symbol', 'side', 'strategy', 'mode', 'pnl', 'testnet', 'exchange']) {
        const val = req.query[key];
        if (typeof val === 'string' && val) filters[key] = val;
      }
      if (req.query.excludeZeroPnl === 'true') filters.excludeZeroPnl = true;
      res.json(dataService.exportTrades(userId, Object.keys(filters).length > 0 ? filters : undefined));
    },
    exportPositions(req: Request, res: Response) {
      const userId = (req as any).user.id;
      res.json(dataService.exportPositions(userId));
    },
    exportTradesCsv(req: Request, res: Response) {
      const userId = (req as any).user.id;
      const filters: Record<string, any> = {};
      for (const key of ['symbol', 'side', 'strategy', 'mode', 'pnl', 'testnet', 'exchange']) {
        const val = req.query[key];
        if (typeof val === 'string' && val) filters[key] = val;
      }
      if (req.query.excludeZeroPnl === 'true') filters.excludeZeroPnl = true;
      res.setHeader('Content-Type', EXPORT.CSV_CONTENT_TYPE);
      res.setHeader('Content-Disposition', `attachment; filename="${csvAttachmentFilename(EXPORT.TRADES_FILENAME_PREFIX)}"`);
      res.write(csvHeader(EXPORT.TRADE_COLUMNS) + '\n');
      for (const trade of dataService.iterateTrades(userId, Object.keys(filters).length > 0 ? filters : undefined)) {
        res.write(csvRow(trade, EXPORT.TRADE_COLUMNS) + '\n');
      }
      res.end();
    },
    exportPositionsCsv(req: Request, res: Response) {
      const userId = (req as any).user.id;
      res.setHeader('Content-Type', EXPORT.CSV_CONTENT_TYPE);
      res.setHeader('Content-Disposition', `attachment; filename="${csvAttachmentFilename(EXPORT.POSITIONS_FILENAME_PREFIX)}"`);
      res.write(csvHeader(EXPORT.POSITION_COLUMNS) + '\n');
      for (const pos of dataService.iteratePositions(userId)) {
        res.write(csvRow(pos, EXPORT.POSITION_COLUMNS) + '\n');
      }
      res.end();
    },
    exportTradesTxt(req: Request, res: Response) {
      const userId = (req as any).user.id;
      const filters: Record<string, any> = {};
      for (const key of ['symbol', 'side', 'strategy', 'mode', 'pnl', 'testnet', 'exchange']) {
        const val = req.query[key];
        if (typeof val === 'string' && val) filters[key] = val;
      }
      if (req.query.excludeZeroPnl === 'true') filters.excludeZeroPnl = true;
      const rows = dataService.exportTrades(userId, Object.keys(filters).length > 0 ? filters : undefined);
      res.setHeader('Content-Type', EXPORT.TEXT_CONTENT_TYPE);
      res.setHeader('Content-Disposition', `attachment; filename="${textAttachmentFilename(EXPORT.TRADES_FILENAME_PREFIX)}"`);
      res.send(buildTextTable(rows, EXPORT.TRADE_COLUMNS));
    },
    exportPositionsTxt(req: Request, res: Response) {
      const userId = (req as any).user.id;
      const rows = dataService.exportPositions(userId);
      res.setHeader('Content-Type', EXPORT.TEXT_CONTENT_TYPE);
      res.setHeader('Content-Disposition', `attachment; filename="${textAttachmentFilename(EXPORT.POSITIONS_FILENAME_PREFIX)}"`);
      res.send(buildTextTable(rows, EXPORT.POSITION_COLUMNS));
    },
    getPortfolio(req: Request, res: Response) {
      const userId = (req as any).user.id;
      res.json(dataService.getPortfolio(userId));
    },
    async getPortfolioBalance(req: Request, res: Response) {
      const userId = (req as any).user.id;
      res.json(await dataService.getPortfolioBalance(userId));
    },
    getStrategies(req: Request, res: Response) {
      const userId = (req as any).user.id;
      res.json(dataService.getStrategies(userId));
    },
    toggleStrategy(req: Request<{ id: string }>, res: Response) {
      const userId = (req as any).user.id;
      const result = dataService.toggleStrategy(userId, req.params.id);
      if (!result) { res.status(HTTP_STATUS.NOT_FOUND).json({ error: ERROR_MSG.STRATEGY_NOT_FOUND }); return; }
      res.json(result);
    },
    getAssets(req: Request, res: Response) {
      const userId = (req as any).user.id;
      res.json(dataService.getAssets(userId));
    },
    getTradeFilters(req: Request, res: Response) {
      const userId = (req as any).user.id;
      res.json(dataService.getTradeFilters(userId));
    },
    async getSymbols(req: Request, res: Response) {
      const userId = (req as any).user.id;
      try {
        res.json(await dataService.fetchSymbols(userId));
      } catch {
        res.status(HTTP_STATUS.INTERNAL_ERROR).json({ error: ERROR_MSG.FAILED_FETCH_SYMBOLS });
      }
    },
    async updateConfig(req: Request, res: Response) {
      const userId = (req as any).user.id;
      const role = (req as any).user.role;
      const parsed = parseConfigUpdate(req.body);
      if (!parsed.ok) { res.status(HTTP_STATUS.BAD_REQUEST).json({ error: parsed.error }); return; }
      const update = parsed.value;

      const demoError = applyDemoModeRules(role, req.body.mode, update);
      if (demoError) { res.status(demoError.status).json({ error: demoError.error }); return; }

      const user = db.getUserById(userId);
      const keysError = validateLiveRequiresKeys(req.body.mode, user);
      if (keysError) { res.status(keysError.status).json({ error: keysError.error }); return; }

      const currentMode = update.mode || (user ? db.getUserConfig(userId)?.mode : undefined) || DEFAULTS.BOT_MODE;
      const paperError = validatePaperBalanceLimits(currentMode, update, user);
      if (paperError) { res.status(paperError.status).json({ error: paperError.error }); return; }

      const assetsError = validateAssetsCount(update);
      if (assetsError) { res.status(assetsError.status).json({ error: assetsError.error }); return; }

      const result = await dataService.updateConfig(userId, update);
      if (!result.ok) {
        if ('error' in result && result.error === 'close_failed') {
          res.status(HTTP_STATUS.INTERNAL_ERROR).json({ error: `Failed to close ${result.symbol}: ${result.message}` });
          return;
        }
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: `${(result as { symbol: string }).symbol}: ${ERROR_MSG.SYMBOL_NOT_FOUND}` });
        return;
      }
      res.json({ ...result.config, closedPositions: result.closedPositions });
    },
    getExchangeKeys(req: Request, res: Response) {
      const userId = (req as any).user.id;
      const user = db.getUserById(userId);
      let keyHint = '';
      let secretHint = '';
      if (user?.exchangeKey) {
        try {
          const decrypted = decrypt(user.exchangeKey, jwtSecret);
          keyHint = decrypted.slice(-3);
        } catch { /* ignore */ }
      }
      if (user?.exchangeSecret) {
        try {
          const decrypted = decrypt(user.exchangeSecret, jwtSecret);
          secretHint = decrypted.slice(-3);
        } catch { /* ignore */ }
      }
      res.json({ hasKeys: !!(user?.exchangeKey), testnet: user?.exchangeTestnet ?? true, keyHint, secretHint, exchange: user?.exchangeName ?? DEFAULT_EXCHANGE });
    },
    async updateExchangeKeys(req: Request, res: Response) {
      const ip = getClientIp(req);
      const limit = verifyLimiter.check(ip);
      if (!limit.allowed) {
        res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({ error: ERROR_MSG.VERIFY_RATE_LIMITED, retryAfter: limit.retryAfter });
        return;
      }
      verifyLimiter.record(ip);
      const userId = (req as any).user.id;
      const { apiKey, apiSecret, testnet, exchange } = req.body;
      if (!apiKey || !apiSecret) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.API_KEY_SECRET_REQUIRED });
        return;
      }
      const exchangeName = (exchange && typeof exchange === 'string' ? exchange.toLowerCase().trim() : DEFAULT_EXCHANGE);
      if (!SUPPORTED_EXCHANGES.includes(exchangeName as any)) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.UNSUPPORTED_EXCHANGE });
        return;
      }

      const verifyResult = await verifyExchangeCredentials(exchangeName, apiKey, apiSecret, testnet ?? true);
      if (isValidationError(verifyResult)) { res.status(verifyResult.status).json({ error: verifyResult.error }); return; }

      const encKey = encrypt(apiKey, jwtSecret);
      const encSecret = encrypt(apiSecret, jwtSecret);
      db.updateUserExchangeKeys(userId, encKey, encSecret, testnet ?? true);
      db.updateUser(userId, { exchangeName });
      res.json({ hasKeys: true, testnet: testnet ?? true, keyHint: apiKey.slice(-3), secretHint: apiSecret.slice(-3), exchange: exchangeName });
    },
    clearExchangeKeys(req: Request, res: Response) {
      const userId = (req as any).user.id;
      db.updateUserExchangeKeys(userId, '', '', true);
      res.json({ hasKeys: false, testnet: true, keyHint: '', secretHint: '' });
    },
    async checkExchangeKeyPermissions(req: Request, res: Response) {
      // Surface the current stored key's read-only/can-trade status so the
      // Settings page can show a persistent warning for users who are
      // already in the broken state (live mode with a read-only key saved
      // before verify-time detection was added).
      const userId = (req as any).user.id;
      const user = db.getUserById(userId);
      if (!user?.exchangeKey || !user?.exchangeSecret) {
        res.json({ hasKeys: false });
        return;
      }
      const ip = getClientIp(req);
      const limit = checkKeyLimiter.check(ip);
      if (!limit.allowed) {
        res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({ error: ERROR_MSG.VERIFY_RATE_LIMITED, retryAfter: limit.retryAfter });
        return;
      }
      checkKeyLimiter.record(ip);
      try {
        const apiKey = decrypt(user.exchangeKey, jwtSecret);
        const apiSecret = decrypt(user.exchangeSecret, jwtSecret);
        const exchangeName = user.exchangeName || DEFAULT_EXCHANGE;
        const adapter = createExchangeAdapter(exchangeName, { apiKey, secret: apiSecret, testnet: user.exchangeTestnet });
        if (!adapter.fetchPermissions) {
          res.json({ hasKeys: true, checked: false });
          return;
        }
        const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), EXCHANGE_VERIFY_TIMEOUT));
        const perms = await Promise.race([adapter.fetchPermissions(), timeout]);
        res.json({ hasKeys: true, checked: true, readOnly: perms.readOnly, canTrade: perms.canTrade });
      } catch (err: any) {
        // Don't expose internal errors; just mark as unchecked.
        res.json({ hasKeys: true, checked: false, error: 'check-failed' });
      }
    },
    updateExchangeTestnet(req: Request, res: Response) {
      const userId = (req as any).user.id;
      const { testnet } = req.body;
      db.updateExchangeTestnet(userId, testnet === true);
      res.json({ ok: true, testnet: testnet === true });
    },
    async verifyExchangeKeys(req: Request, res: Response) {
      const ip = getClientIp(req);
      const limit = verifyLimiter.check(ip);
      if (!limit.allowed) {
        res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({ error: ERROR_MSG.VERIFY_RATE_LIMITED, retryAfter: limit.retryAfter });
        return;
      }
      verifyLimiter.record(ip);
      const { apiKey, apiSecret, testnet, exchange } = req.body;
      if (!apiKey || !apiSecret) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.API_KEY_SECRET_REQUIRED });
        return;
      }
      const exchangeName = (exchange && typeof exchange === 'string' ? exchange.toLowerCase().trim() : DEFAULT_EXCHANGE);
      if (!SUPPORTED_EXCHANGES.includes(exchangeName as any)) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.UNSUPPORTED_EXCHANGE });
        return;
      }
      const verifyResult = await verifyExchangeCredentials(exchangeName, apiKey, apiSecret, testnet ?? true);
      if (isValidationError(verifyResult)) { res.status(verifyResult.status).json({ error: verifyResult.error }); return; }
      res.json({ ok: true, exchange: exchangeName, balance: verifyResult.balance });
    },
    getWallet(req: Request, res: Response) {
      const userId = (req as any).user.id;
      const user = db.getUserById(userId);
      res.json({ address: user?.walletAddress ?? null });
    },
    connectWallet(req: Request, res: Response) {
      const userId = (req as any).user.id;
      const { address, signature } = req.body;
      if (!address || !signature) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.METAMASK_REQUIRED });
        return;
      }
      try {
        const recovered = verifyMessage(WALLET_SIGN_MESSAGE, signature);
        if (recovered.toLowerCase() !== address.toLowerCase()) {
          res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.INVALID_SIGNATURE });
          return;
        }
      } catch {
        res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.INVALID_SIGNATURE });
        return;
      }
      db.updateWalletAddress(userId, address.toLowerCase());
      res.json({ address: address.toLowerCase() });
    },
    disconnectWallet(req: Request, res: Response) {
      const userId = (req as any).user.id;
      db.updateWalletAddress(userId, null);
      res.json({ address: null });
    },
    updatePreferences(req: Request, res: Response) {
      const userId = (req as any).user.id;
      const { lang, theme } = req.body;
      if (lang && !DEFAULTS.VALID_LANGS.includes(lang)) { res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.INVALID_LANGUAGE }); return; }
      if (theme && !DEFAULTS.VALID_THEMES.includes(theme)) { res.status(HTTP_STATUS.BAD_REQUEST).json({ error: ERROR_MSG.INVALID_THEME }); return; }
      if (lang) db.updateUserPreferences(userId, lang, theme || 'dark');
      else if (theme) {
        const user = db.getUserById(userId);
        db.updateUserPreferences(userId, user?.lang || DEFAULTS.VALID_LANGS[0], theme);
      }
      res.json({ ok: true });
    },
    async closePosition(req: Request<{ id: string }>, res: Response) {
      const userId = (req as any).user.id;
      const positionId = req.params.id;
      try {
        const result = await botService.closePosition(userId, positionId);
        res.json(result);
      } catch (err: any) {
        const msg = err?.message ?? '';
        if (/not found/i.test(msg)) {
          res.status(HTTP_STATUS.NOT_FOUND).json({ error: msg });
          return;
        }
        res.status(HTTP_STATUS.INTERNAL_ERROR).json({ error: msg || 'Close failed' });
      }
    },
  };
}
