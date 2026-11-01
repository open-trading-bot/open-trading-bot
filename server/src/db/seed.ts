import crypto from 'crypto';
import type { Db } from './index.js';
import { createBotConfig } from '../config/index.js';
import { ROLES } from '../utils/constants.js';
import logger from '../utils/logger.js';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
}

/**
 * Creates the admin user. The demo users (demo/demo, user/user) have well-known
 * passwords, so they are created only when seedDemoUsers is true.
 */
export function seedUsers(db: Db, adminUser: string, adminPass: string, seedDemoUsers = false): void {
  const defaults = [
    { username: adminUser, password: adminPass, role: ROLES.ADMIN },
    ...(seedDemoUsers
      ? [
          { username: 'demo', password: 'demo', role: ROLES.DEMO },
          { username: 'user', password: 'user', role: ROLES.REGULAR },
        ]
      : []),
  ];

  for (const { username, password, role } of defaults) {
    const existing = db.getUserByUsername(username);
    if (!existing) {
      const user = db.createUser(username, null, hashPassword(password), role);
      db.setUserConfig(user.id, createBotConfig('paper'));
      logger.info(`[seed] Created ${role} user: ${username} (with default config)`);
    } else {
      if (role === ROLES.ADMIN && !verifyPassword(password, existing.passwordHash)) {
        db.updateUserPassword(existing.id, hashPassword(password));
        logger.info(`[seed] Updated admin password for: ${username}`);
      }
      if (!db.getUserConfig(existing.id)) {
        db.setUserConfig(existing.id, createBotConfig('paper'));
        logger.info(`[seed] Created default config for existing user: ${username}`);
      }
    }
  }
}
