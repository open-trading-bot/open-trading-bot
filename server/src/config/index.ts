import { getAllStrategies } from '../engine/strategies/index.js';
import { DEFAULTS, DEFAULT_ASSETS, ERROR_MSG } from '../utils/constants.js';
import type { BotConfig, BotMode } from '../types/index.js';
import { isValidMasterKey } from '../utils/crypto.js';

export interface EnvConfig {
  port: number;
  apiKey: string;
  jwtSecret: string;
  exchangeKeysEncKey: string;
  exchangeKeysEncKeyPrevious?: string;
  adminUser: string;
  adminPass: string;
  botMode: BotMode;
  recaptchaSecret?: string;
  bybitApiKey: string;
  bybitApiSecret: string;
  bybitTestnet: boolean;
  resendApiKey?: string;
  emailFrom?: string;
  publicAppUrl: string;
}

// The example env files are public. A server that runs with their values
// gives anyone admin access, token forgery, and the exchange-key encryption key.
function assertStrongSecret(name: string, value: string, minLength: number): void {
  if (/change[-_]?me/i.test(value)) {
    throw new Error(`${name} still has the placeholder value from the example env file. Set a random value.`);
  }
  if (value.length < minLength) {
    throw new Error(`${name} must have at least ${minLength} characters.`);
  }
}

// The master key that encrypts the users' exchange API keys. It is separate
// from JWT_SECRET, so a leaked or rotated JWT_SECRET does not affect it.
function assertEncryptionKey(name: string, value: string): void {
  if (/change[-_]?me/i.test(value)) {
    throw new Error(`${name} still has the placeholder value from the example env file. Run "openssl rand -hex 32" and set the output.`);
  }
  if (!isValidMasterKey(value)) {
    throw new Error(`${name} must be 64 hex characters (32 random bytes). Run "openssl rand -hex 32" and set the output.`);
  }
}

export function loadEnv(): EnvConfig {
  const apiKey = process.env.API_KEY;
  const jwtSecret = process.env.JWT_SECRET;
  const adminPass = process.env.ADMIN_PASS;

  if (!apiKey || !jwtSecret || !adminPass) {
    throw new Error(ERROR_MSG.MISSING_ENV_VARS);
  }
  assertStrongSecret('API_KEY', apiKey, 32);
  assertStrongSecret('JWT_SECRET', jwtSecret, 32);
  assertStrongSecret('ADMIN_PASS', adminPass, 12);

  const exchangeKeysEncKey = process.env.EXCHANGE_KEYS_ENC_KEY;
  if (!exchangeKeysEncKey) {
    throw new Error('EXCHANGE_KEYS_ENC_KEY is not set. Run "openssl rand -hex 32" and set the output.');
  }
  assertEncryptionKey('EXCHANGE_KEYS_ENC_KEY', exchangeKeysEncKey);
  const exchangeKeysEncKeyPrevious = process.env.EXCHANGE_KEYS_ENC_KEY_PREVIOUS || undefined;
  if (exchangeKeysEncKeyPrevious) {
    assertEncryptionKey('EXCHANGE_KEYS_ENC_KEY_PREVIOUS', exchangeKeysEncKeyPrevious);
    if (exchangeKeysEncKeyPrevious.toLowerCase() === exchangeKeysEncKey.toLowerCase()) {
      throw new Error('EXCHANGE_KEYS_ENC_KEY_PREVIOUS must be different from EXCHANGE_KEYS_ENC_KEY.');
    }
  }

  return {
    port: Number(process.env.PORT) || DEFAULTS.PORT,
    apiKey,
    jwtSecret,
    exchangeKeysEncKey,
    exchangeKeysEncKeyPrevious,
    adminUser: process.env.ADMIN_USER || DEFAULTS.ADMIN_USER,
    adminPass,
    botMode: (process.env.BOT_MODE || DEFAULTS.BOT_MODE) as BotMode,
    recaptchaSecret: process.env.RECAPTCHA_SECRET_KEY,
    bybitApiKey: process.env.BYBIT_API_KEY || '',
    bybitApiSecret: process.env.BYBIT_API_SECRET || '',
    bybitTestnet: process.env.BYBIT_TESTNET === 'true',
    resendApiKey: process.env.RESEND_API_KEY,
    emailFrom: process.env.EMAIL_FROM,
    publicAppUrl: (process.env.PUBLIC_APP_URL || 'http://localhost:5173').replace(/\/+$/, ''),
  };
}

// Stored configs hold a frozen snapshot of the strategy list from when they
// were first saved. Reconcile against the live registry on load: append
// newly-registered strategies (disabled, so a running bot never auto-trades a
// strategy the user never opted into) and drop any that no longer exist.
export function reconcileStrategies(config: BotConfig): BotConfig {
  const registry = getAllStrategies();
  const storedIds = new Set(config.strategies.map((s) => s.id));
  const registryIds = new Set(registry.map((r) => r.id));

  const kept = config.strategies.filter((s) => registryIds.has(s.id));
  const added = registry
    .filter((r) => !storedIds.has(r.id))
    .map((r) => ({
      id: r.id, name: r.name, enabled: false, params: r.defaultParams,
      interval: r.defaultInterval, marketType: DEFAULTS.MARKET_TYPE as 'spot',
    }));

  if (added.length === 0 && kept.length === config.strategies.length) return config;
  return { ...config, strategies: [...kept, ...added] };
}

export function createBotConfig(mode: BotMode): BotConfig {
  const strategies = getAllStrategies().map((s) => ({
    id: s.id, name: s.name, enabled: true, params: s.defaultParams,
    interval: s.defaultInterval, marketType: DEFAULTS.MARKET_TYPE as 'spot',
  }));

  return {
    mode,
    riskLevel: DEFAULTS.RISK_LEVEL as 'moderate',
    tradeAmount: Number(process.env.TRADE_AMOUNT) || DEFAULTS.TRADE_AMOUNT,
    stopLossPct: Number(process.env.STOP_LOSS_PCT) || DEFAULTS.STOP_LOSS_PCT,
    dailyLossLimit: Number(process.env.DAILY_LOSS_LIMIT) || DEFAULTS.DAILY_LOSS_LIMIT,
    maxOpenPositions: Number(process.env.MAX_OPEN_POSITIONS) || DEFAULTS.MAX_OPEN_POSITIONS,
    minConfidence: Number(process.env.MIN_CONFIDENCE) || DEFAULTS.MIN_CONFIDENCE,
    tickInterval: Number(process.env.TICK_INTERVAL) || DEFAULTS.TICK_INTERVAL,
    orderType: DEFAULTS.ORDER_TYPE as 'market',
    assets: [...DEFAULT_ASSETS] as BotConfig['assets'],
    strategies,
  };
}
