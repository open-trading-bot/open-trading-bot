import { createApiClient, get, post, put, del } from 'common';
import { ROUTES } from './routes';

const apiBase = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api';
const instance = createApiClient(apiBase);

// Re-export raw instance for Login page
export const api = instance;

// Generic helpers bound to our instance
function _get<T = any>(url: string, params?: Record<string, unknown>): Promise<T> {
  return get(instance, url, params);
}

function _post<T = any>(url: string, body?: Record<string, unknown>): Promise<T> {
  return post(instance, url, body);
}

function _put<T = any>(url: string, body?: Record<string, unknown>): Promise<T> {
  return put(instance, url, body);
}

function _del<T = any>(url: string): Promise<T> {
  return del(instance, url);
}

// Shared API functions
export const getStatus = () => _get(ROUTES.BOT_STATUS);
export const getPortfolio = () => _get(ROUTES.PORTFOLIO);
export const getPositions = () => _get(ROUTES.POSITIONS);
export const getTrades = (limit = 100) => _get(ROUTES.TRADES, { limit });
export const startBot = () => _post(ROUTES.BOT_START);
export const stopBot = () => _post(ROUTES.BOT_STOP);
export const killBot = () => _post(ROUTES.BOT_KILL);
export const toggleStrategy = (id: string) => _post(ROUTES.STRATEGY_TOGGLE(id));
export const updateConfig = (config: Record<string, unknown>) => _put(ROUTES.CONFIG, config);

// Backoffice-specific
export const getLeads = () => _get(ROUTES.BACKOFFICE_LEADS);
export const deleteLead = (id: number) => _del(ROUTES.BACKOFFICE_LEAD(id));
export const getStats = () => _get(ROUTES.BACKOFFICE_STATS);
export const getSystemConfig = () => _get(ROUTES.BACKOFFICE_CONFIG);

// User management
export const getUsers = () => _get(ROUTES.BACKOFFICE_USERS);
export const createUser = (user: { username: string; password: string; email?: string; role: string }) => _post(ROUTES.BACKOFFICE_USERS, user as any);
export const updateUser = (id: number, updates: { email?: string; role?: string; enabled?: boolean; paperBalance?: number }) => _put(ROUTES.BACKOFFICE_USER(id), updates as any);
export const updateUserPassword = (id: number, password: string) => _put(`/backoffice/users/${id}/password`, { password } as any);
export const deleteUser = (id: number) => _del(ROUTES.BACKOFFICE_USER(id));
export const getUserTradesPaginated = (id: number, page: number, limit = 20, filters?: Record<string, any>) => _get(`/backoffice/users/${id}/trades`, { page, limit, ...filters });
export const getUserTradeFilters = (id: number): Promise<{ symbols: string[]; strategies: string[] }> => _get(`/backoffice/users/${id}/trades/filters`);
export const getUserPositions = (id: number) => _get(`/backoffice/users/${id}/positions`);
export const getUserPositionsPaginated = (id: number, page: number, limit = 20) => _get(`/backoffice/users/${id}/positions`, { page, limit });
export const getUserBotStatus = (id: number) => _get(`/backoffice/users/${id}/bot`);
export const getUserActionLogs = (id: number, page = 0, limit = 20, filters?: Record<string, any>) =>
  _get(`/backoffice/users/${id}/logs`, { page, limit, ...(filters || {}) });

// Cross-user backoffice data
export const getAllTrades = (page = 0, limit = 20, filters?: Record<string, any>) => _get(ROUTES.BACKOFFICE_TRADES, { page, limit, ...filters });
export const getAllTradeFilters = (): Promise<{ symbols: string[]; strategies: string[] }> => _get(ROUTES.BACKOFFICE_TRADE_FILTERS);
export const getAllPositions = () => _get(ROUTES.BACKOFFICE_POSITIONS);
export const getBotStatuses = () => _get(ROUTES.BACKOFFICE_BOTS);
export const getDailyPnl = (): Promise<{ userId: number; dailyPnl: number }[]> => _get(ROUTES.BACKOFFICE_DAILY_PNL);

// Invitations
export interface Invitation {
  id: string;
  email: string;
  createdBy: number;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
  revokedAt: number | null;
  status: 'pending' | 'expired' | 'accepted' | 'revoked';
}

export type CreateInvitationResult = { emailSent: true; id: string } | { emailSent: false };

export const listInvitations = (status?: 'pending' | 'all'): Promise<Invitation[]> =>
  _get(ROUTES.BACKOFFICE_INVITATIONS, status ? { status } : undefined);
export const createInvitation = (email: string): Promise<CreateInvitationResult> => _post(ROUTES.BACKOFFICE_INVITATIONS, { email });
export const resendInvitation = (id: string): Promise<CreateInvitationResult> => _post(ROUTES.BACKOFFICE_INVITATION_RESEND(id));
export const revokeInvitation = (id: string) => _del(ROUTES.BACKOFFICE_INVITATION(id));

// Feature flags
export const getFeatureFlags = () => _get(ROUTES.BACKOFFICE_FEATURE_FLAGS);
export const createFeatureFlag = (flag: { id: string; description: string; enabled: boolean }) => _post(ROUTES.BACKOFFICE_FEATURE_FLAGS, flag as any);
export const updateFeatureFlag = (id: string, updates: { description?: string; enabled?: boolean }) => _put(ROUTES.BACKOFFICE_FEATURE_FLAG(id), updates as any);
export const deleteFeatureFlag = (id: string) => _del(ROUTES.BACKOFFICE_FEATURE_FLAG(id));
export const setFeatureFlagOverrides = (id: string, overrides: { targetType: string; targetValue: string; enabled: boolean }[]) => _put(ROUTES.BACKOFFICE_FEATURE_FLAG_OVERRIDES(id), { overrides } as any);
