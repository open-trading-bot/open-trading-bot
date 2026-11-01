// client/src/lib/api.ts
import axios from 'axios';
import { ROUTES } from './routes';

const instance = axios.create({
  baseURL: '/api',
});

instance.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

instance.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !err.config.url?.includes(ROUTES.AUTH_LOGIN)) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);

// Generic methods
export async function get<T = any>(url: string, params?: Record<string, unknown>): Promise<T> {
  const { data } = await instance.get(url, { params });
  return data;
}

export async function post<T = any>(url: string, body?: Record<string, unknown>): Promise<T> {
  const { data } = await instance.post(url, body);
  return data;
}

export async function put<T = any>(url: string, body?: Record<string, unknown>): Promise<T> {
  const { data } = await instance.put(url, body);
  return data;
}

export async function del<T = any>(url: string): Promise<T> {
  const { data } = await instance.delete(url);
  return data;
}

export async function patch<T = any>(url: string, body?: Record<string, unknown>): Promise<T> {
  const { data } = await instance.patch(url, body);
  return data;
}

// Keep the raw instance for Login page (needs full response)
export const api = instance;

// API functions
export const getVersion = (): Promise<{ version: string }> => get(ROUTES.VERSION);
export const getDailyPnlReport = (): Promise<{ date: string; pnl: number; tradeCount: number; volume: number; balance: number | null }[]> => get(ROUTES.REPORTS_DAILY_PNL);
export const lookupInvitation = (token: string): Promise<{ email: string }> => get(ROUTES.INVITATION_LOOKUP(token));
export const acceptInvitation = (
  token: string,
  password: string,
  signature: string,
  lang: string,
): Promise<{ token: string; role: string; username: string; disclaimerAccepted: boolean }> =>
  post(ROUTES.INVITATION_ACCEPT(token), { password, signature, lang });
export const getStatus = () => get(ROUTES.BOT_STATUS);
export const getPortfolio = () => get(ROUTES.PORTFOLIO);
export const getPortfolioBalance = (): Promise<{ totalBalance: number; availableBalance: number; totalEquity: number }> => get(ROUTES.PORTFOLIO_BALANCE);
export const getPositions = (page = 0, limit = 100): Promise<{ data: any[]; total: number; page: number; totalPages: number }> => get(ROUTES.POSITIONS, { page, limit });
export const getTrades = (page = 0, limit = 20, filters?: { symbol?: string; side?: string; strategy?: string; mode?: string }, sort?: { sortBy: string; sortDir: 'asc' | 'desc' }): Promise<{ data: any[]; total: number; totalPnl: number; page: number; totalPages: number }> => get(ROUTES.TRADES, { page, limit, ...filters, ...sort });
export const exportPositions = (): Promise<any[]> => get(ROUTES.POSITIONS_EXPORT);
export const exportTrades = (filters?: Record<string, any>): Promise<any[]> => get(ROUTES.TRADES_EXPORT, filters);
// Blob fetchers for CSV — axios returns the raw bytes without parsing, so the
// browser never allocates a JS copy of the dataset. Combined with the server-side
// streaming handler, memory stays flat end-to-end.
export const exportPositionsCsv = async (): Promise<Blob> => {
  const res = await instance.get(ROUTES.POSITIONS_EXPORT_CSV, { responseType: 'blob' });
  return res.data as Blob;
};
export const exportTradesCsv = async (filters?: Record<string, any>): Promise<Blob> => {
  const res = await instance.get(ROUTES.TRADES_EXPORT_CSV, { params: filters, responseType: 'blob' });
  return res.data as Blob;
};
export const exportPositionsTxt = async (): Promise<Blob> => {
  const res = await instance.get(ROUTES.POSITIONS_EXPORT_TXT, { responseType: 'blob' });
  return res.data as Blob;
};
export const exportTradesTxt = async (filters?: Record<string, any>): Promise<Blob> => {
  const res = await instance.get(ROUTES.TRADES_EXPORT_TXT, { params: filters, responseType: 'blob' });
  return res.data as Blob;
};
export const getStrategies = () => get(ROUTES.STRATEGIES);
export const getTradeFilters = (): Promise<{ symbols: string[]; strategies: string[] }> => get(ROUTES.TRADE_FILTERS);
export const startBot = () => post(ROUTES.BOT_START);
export const stopBot = () => post(ROUTES.BOT_STOP);
export const killBot = () => post(ROUTES.BOT_KILL);
export const closePosition = (id: string): Promise<{ ok: true }> => post(ROUTES.POSITION_CLOSE(id));
export const toggleStrategy = (id: string) => post(ROUTES.STRATEGY_TOGGLE(id));
export const updateConfig = (config: Record<string, unknown>) => put(ROUTES.CONFIG, config);
export const runBacktest = (params: { symbol: string; strategy: string; interval: string }) => get(ROUTES.BACKTEST, params as any);
export const getSymbols = (): Promise<string[]> => get(ROUTES.SYMBOLS);
export const getExchangeKeys = (): Promise<{ hasKeys: boolean; testnet: boolean; keyHint: string; secretHint: string }> => get(ROUTES.EXCHANGE_KEYS);
export const updateExchangeKeys = (keys: { apiKey: string; apiSecret: string; testnet: boolean; exchange?: string }) => put(ROUTES.EXCHANGE_KEYS, keys as any);
export const verifyExchangeKeys = (data: { apiKey: string; apiSecret: string; testnet: boolean; exchange: string }): Promise<{ ok: boolean; exchange: string; balance: number }> => post(ROUTES.EXCHANGE_KEYS_VERIFY, data as any);
// Module-scoped dedupe for checkExchangeKeyPermissions. The endpoint is
// called from multiple places (Settings mount, Dashboard mount) and can
// fire repeatedly under React strict-mode double-invocation and HMR.
// We coalesce concurrent calls into a single in-flight promise and cache
// the result for 30 seconds so normal page navigation doesn't hit the
// server on every mount.
type KeyCheckResult = { hasKeys: boolean; checked?: boolean; readOnly?: boolean; canTrade?: boolean; error?: string };
let keyCheckInFlight: Promise<KeyCheckResult> | null = null;
let keyCheckCache: { at: number; result: KeyCheckResult } | null = null;
const KEY_CHECK_TTL_MS = 30_000;

export const checkExchangeKeyPermissions = (): Promise<KeyCheckResult> => {
  const now = Date.now();
  if (keyCheckCache && now - keyCheckCache.at < KEY_CHECK_TTL_MS) {
    return Promise.resolve(keyCheckCache.result);
  }
  if (keyCheckInFlight) return keyCheckInFlight;
  keyCheckInFlight = (get(ROUTES.EXCHANGE_KEYS_CHECK) as Promise<KeyCheckResult>)
    .then((result) => {
      keyCheckCache = { at: Date.now(), result };
      return result;
    })
    .finally(() => { keyCheckInFlight = null; });
  return keyCheckInFlight;
};

// Call after saving/clearing keys to force the next check to hit the server.
export const invalidateExchangeKeyCheckCache = () => {
  keyCheckCache = null;
  keyCheckInFlight = null;
};
export const clearExchangeKeys = () => del(ROUTES.EXCHANGE_KEYS);
export const updateExchangeTestnet = (testnet: boolean) => patch(ROUTES.EXCHANGE_KEYS, { testnet } as any);
export const getWallet = (): Promise<{ address: string | null }> => get(ROUTES.WALLET);
export const connectWallet = (data: { address: string; signature: string }) => post(ROUTES.WALLET_CONNECT, data as any);
export const disconnectWallet = () => post(ROUTES.WALLET_DISCONNECT);
export const updatePreferences = (prefs: { lang?: string; theme?: string }) => put(ROUTES.PREFERENCES, prefs as any);
export const getFeatureFlags = (): Promise<{ flags: Record<string, boolean> }> => get(ROUTES.FEATURE_FLAGS);

export interface DisclaimerPayload {
  version: string;
  variants: {
    en: { requiredSignature: string; text: string };
    he: { requiredSignature: string; text: string };
  };
}

export const getDisclaimer = (): Promise<DisclaimerPayload> => get(ROUTES.DISCLAIMER);
export const acceptDisclaimer = (signature: string, lang: string): Promise<{ ok: true; disclaimerAccepted: boolean }> =>
  post(ROUTES.DISCLAIMER_ACCEPT, { signature, lang });
