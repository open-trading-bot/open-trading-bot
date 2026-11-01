// HTTP Status Codes
export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
} as const;

// Roles
export const ROLES = {
  ADMIN: 'admin',
  REGULAR: 'regular',
  DEMO: 'demo',
} as const;

// Error Messages
export const ERROR_MSG = {
  UNAUTHORIZED: 'Unauthorized',
  INVALID_CREDENTIALS: 'Invalid credentials',
  TOO_MANY_ATTEMPTS: 'Too many login attempts',
  FORBIDDEN: 'Forbidden',
  ADMIN_ACCESS_REQUIRED: 'Admin access required',
  USER_NOT_FOUND: 'User not found',
  USERNAME_TAKEN: 'Username already exists',
  ACCOUNT_DISABLED: 'Account is disabled',
  SESSION_REVOKED: 'Session has been revoked',
  DEMO_LIVE_RESTRICTED: 'Live trading is not available in demo mode',
  LIVE_REQUIRES_KEYS: 'Live trading requires saved exchange API keys',
  STRATEGY_NOT_FOUND: 'Strategy not found',
  MISSING_BACKTEST_PARAMS: 'Missing required params: symbol, strategy, interval',
  ZERO_BALANCE: 'Cannot start bot with zero balance',
  ALL_POSITIONS_CLOSED: 'All positions closed',
  KILL_SWITCH_ACTIVATED: 'Kill switch activated — all positions closed',
  VALID_EMAIL_REQUIRED: 'Valid email is required',
  TOO_MANY_REQUESTS: 'Too many requests, try again later',
  NOT_AVAILABLE: 'Not available',
  SYMBOL_NOT_FOUND: 'Symbol not found on exchange',
  CAPTCHA_FAILED: 'Captcha verification failed',
  FAILED_FETCH_SYMBOLS: 'Failed to fetch symbols',
  INVALID_SIGNATURE: 'Invalid wallet signature',
  METAMASK_REQUIRED: 'Wallet address and signature are required',
  MISSING_ENV_VARS: 'Missing required environment variables: API_KEY, JWT_SECRET, ADMIN_PASS',
  SHUTTING_DOWN: 'Shutting down...',
  API_KEY_SECRET_REQUIRED: 'API key and secret are required',
  UNSUPPORTED_EXCHANGE: 'Unsupported exchange',
  VERIFY_FAILED: 'Failed to verify exchange credentials. Please check your API key and secret.',
  READ_ONLY_KEY: 'This API key is read-only. The bot cannot place trades with a read-only key. On Bybit, generate a new key under "Read and Write" with Unified Trading → Trade enabled (see the help page for details).',
  VERIFY_RATE_LIMITED: 'Too many verification attempts. Try again later.',
  USERNAME_PASSWORD_REQUIRED: 'Username and password are required',
  FLAG_ID_DESC_REQUIRED: 'id and description are required',
  FLAG_ID_INVALID: 'id must be 1-64 alphanumeric/underscore characters',
  FLAG_DESC_TOO_LONG: 'description must be 500 characters or less',
  OVERRIDES_MUST_BE_ARRAY: 'overrides must be an array',
  OVERRIDES_TOO_MANY: 'too many overrides (max 200)',
  INVALID_TARGET_TYPE: 'targetType must be "user" or "role"',
  INVALID_ROLE: 'invalid role',
  INVALID_USER_TARGET: 'user targetValue must be a numeric id',
  MAX_ASSETS_EXCEEDED: 'Maximum 10 enabled assets allowed',
  MAX_TOTAL_ASSETS_EXCEEDED: 'Maximum 20 assets allowed',
  TRADE_AMOUNT_EXCEEDS_BALANCE: 'Trade amount exceeds total balance',
  DAILY_LOSS_EXCEEDS_BALANCE: 'Daily loss limit exceeds total balance',
  INVALID_LANGUAGE: 'Invalid language',
  INVALID_THEME: 'Invalid theme',
  INVALID_EMAIL: 'Invalid email address',
  USER_EXISTS: 'A user with this email already exists',
  DISCLAIMER_INVALID: 'Disclaimer acceptance is required and must match.',
  INVITATION_INVALID: 'Invitation is invalid or has expired',
  INVALID_PASSWORD: 'Password must be at least 8 characters and include an uppercase letter, a digit, and a special character',
  EMAIL_SEND_FAILED: 'Failed to send invitation email',
  INSUFFICIENT_PAPER_CASH: 'Insufficient paper cash for buy',
  INTERNAL_ERROR: 'Internal server error',
  INVALID_REQUEST: 'Invalid request',
  FLAG_EXISTS: 'Flag already exists',
  POSITION_NOT_FOUND: 'Position not found',
  CLOSE_FAILED: 'Close failed',
  IP_NOT_ALLOWED: 'Access from this IP address is not allowed',
} as const;

// WebSocket Event Types
export const WS_EVENTS = {
  BOT_STATUS: 'bot:status',
  SIGNAL_GENERATED: 'signal:generated',
  // All signals of one tick in one message. Replaces SIGNAL_GENERATED.
  SIGNALS_BATCH: 'signals:batch',
  TRADE_EXECUTED: 'trade:executed',
  POSITION_UPDATE: 'position:update',
  TICK_COMPLETE: 'tick:complete',
  ALERT: 'alert',
  CONNECTED: 'connected',
} as const;

// Defaults
export const DEFAULTS = {
  BOT_MODE: 'paper',
  ADMIN_USER: 'admin',
  PORT: 3001,
  TRADE_AMOUNT: 100,
  STOP_LOSS_PCT: 2,
  DAILY_LOSS_LIMIT: 500,
  MAX_OPEN_POSITIONS: 10,
  MIN_CONFIDENCE: 0.5,
  TICK_INTERVAL: 60,
  ORDER_TYPE: 'market',
  RISK_LEVEL: 'moderate',
  STRATEGY_INTERVAL: '5m',
  MARKET_TYPE: 'spot',
  PAPER_BALANCE: 10000,
  MIN_START_BALANCE: 1,
  MAX_ENABLED_ASSETS: 10,
  MAX_TOTAL_ASSETS: 20,
  JWT_EXPIRY: '7d',
  BACKTEST_DAYS: 30,
  BACKTEST_TRADE_AMOUNT: 100,
  CANDLE_LIMIT: 1000,
  DEFAULT_TRADE_LIMIT: 100,
  MIN_PASSWORD_LENGTH: 8,
  MAX_PAGE_SIZE: 200,
  SYMBOLS_CACHE_TTL_MS: 10 * 60 * 1000,
  VALID_LANGS: ['en', 'he'],
  VALID_THEMES: ['dark', 'light'],
} as const;

// Default Assets
export const DEFAULT_ASSETS = [
  { symbol: 'BTC/USDT', enabled: true, marketType: DEFAULTS.MARKET_TYPE },
  { symbol: 'ETH/USDT', enabled: true, marketType: DEFAULTS.MARKET_TYPE },
  { symbol: 'SOL/USDT', enabled: true, marketType: DEFAULTS.MARKET_TYPE },
] as const;

// Wallet
export const WALLET_SIGN_MESSAGE = 'Sign this message to connect your wallet to Trading Bot.\n\nThis does not cost any gas fees.';

// Captcha
export const CAPTCHA_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

// API Paths
export const API_PATHS = {
  HEALTH: '/api/health',
  VERSION: '/api/version',
  AUTH: '/api/auth',
  BOT: '/api/bot',
  DATA: '/api',
  BACKTEST: '/api/backtest',
  BACKOFFICE: '/api/backoffice',
} as const;

// Public paths (no auth required)
export const PUBLIC_PATHS = [API_PATHS.HEALTH, API_PATHS.VERSION, '/api/auth/login', '/api/auth/interest', '/api/disclaimer'];

export const PUBLIC_PREFIXES = ['/api/auth/invitation/'];

// Rate Limiting
export const RATE_LIMITS = {
  // Backtests are CPU work on the main thread. Limit them per user.
  BACKTEST: { maxAttempts: 10, windowMs: 60 * 1000 },
  LOGIN: { maxAttempts: 5, windowMs: 15 * 60 * 1000, lockoutMs: 30 * 60 * 1000 },
  // Per-account limit. It stops a password guess that rotates IP addresses.
  LOGIN_ACCOUNT: { maxAttempts: 10, windowMs: 15 * 60 * 1000, lockoutMs: 15 * 60 * 1000 },
  INTEREST: { maxAttempts: 3, windowMs: 60 * 60 * 1000 },
  VERIFY_EXCHANGE: { maxAttempts: 5, windowMs: 15 * 60 * 1000, lockoutMs: 15 * 60 * 1000 },
  // Key-permissions check is a passive read on the stored key. Fires on
  // Settings and Dashboard mount — it needs enough budget to cover HMR
  // reloads, React strict-mode double-mounts, and normal page navigation.
  CHECK_EXCHANGE_KEY: { maxAttempts: 30, windowMs: 60 * 1000 },
  INVITATION_LOOKUP: { maxAttempts: 20, windowMs: 15 * 60 * 1000 },
  INVITATION_ACCEPT: { maxAttempts: 10, windowMs: 15 * 60 * 1000, lockoutMs: 15 * 60 * 1000 },
} as const;

// Action Log constants
export const BOT_ACTIONS = {
  START: 'start',
  STOP: 'stop',
  KILL: 'kill',
  CLOSE_POSITION: 'close_position',
} as const;

export const ACTION_SOURCES = {
  SELF: 'self',
  BACKOFFICE: 'backoffice',
} as const;

export const SUPPORTED_EXCHANGES = ['bybit', 'binance'] as const;
export const DEFAULT_EXCHANGE = 'bybit';

export const EXCHANGE_VERIFY_TIMEOUT = 8000;

export const QUOTE_CURRENCY = 'USDT';
export const QUOTE_SUFFIX = `/${QUOTE_CURRENCY}`;

export const BYBIT_CATEGORY = {
  SPOT: 'spot',
  LINEAR: 'linear',
} as const;

export const BINANCE_MARKET_TYPE = {
  FUTURE: 'future',
} as const;

export const CCXT_ORDER_STATUS = {
  CLOSED: 'closed',
  OPEN: 'open',
  PARTIALLY_FILLED: 'partially_filled',
} as const;

// Export (JSON / CSV / TXT)
export const EXPORT = {
  JSON_CONTENT_TYPE: 'application/json; charset=utf-8',
  CSV_CONTENT_TYPE: 'text/csv; charset=utf-8',
  TEXT_CONTENT_TYPE: 'text/plain; charset=utf-8',
  TRADES_FILENAME_PREFIX: 'trades',
  POSITIONS_FILENAME_PREFIX: 'open-positions',
  TRADE_COLUMNS: ['id', 'symbol', 'side', 'price', 'quantity', 'amount', 'strategy', 'mode', 'marketType', 'orderId', 'pnl', 'timestamp', 'testnet', 'exchange', 'closeReason'],
  POSITION_COLUMNS: ['id', 'symbol', 'side', 'entryPrice', 'quantity', 'amount', 'currentPrice', 'pnl', 'pnlPct', 'strategy', 'mode', 'marketType', 'stopLoss', 'openedAt', 'testnet', 'exchange'],
} as const;
