import jwt from 'jsonwebtoken';
import { DEFAULTS } from './constants.js';
import type { DbUser } from '../db/index.js';

export interface AuthUser {
  id: number;
  username: string;
  role: string;
}

interface TokenPayload {
  id: number;
  username: string;
  role: string;
  tv?: number;
}

/** Signs a login token. `tv` is the user's token version at sign time. */
export function signUserToken(user: Pick<DbUser, 'id' | 'username' | 'role' | 'tokenVersion'>, jwtSecret: string): string {
  const payload: TokenPayload = { id: user.id, username: user.username, role: user.role, tv: user.tokenVersion ?? 0 };
  return jwt.sign(payload, jwtSecret, { expiresIn: DEFAULTS.JWT_EXPIRY });
}

/**
 * Verifies a login token against the current database state.
 * Returns null when the signature is bad, the token expired, the user is
 * deleted or disabled, or the user's sessions were revoked after sign time.
 * The role comes from the database, never from the token.
 */
export function verifyUserToken(
  token: string,
  jwtSecret: string,
  getUser: (id: number) => DbUser | null,
): AuthUser | null {
  let payload: TokenPayload;
  try {
    payload = jwt.verify(token, jwtSecret) as TokenPayload;
  } catch {
    return null;
  }
  if (typeof payload.id !== 'number') return null;
  const user = getUser(payload.id);
  if (!user || !user.enabled) return null;
  if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) return null;
  return { id: user.id, username: user.username, role: user.role };
}
