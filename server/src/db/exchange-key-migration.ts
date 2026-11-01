import type { Db } from './index.js';
import { type ExchangeKeyCipher, isLegacyV1, decryptLegacyV1 } from '../utils/crypto.js';
import logger from '../utils/logger.js';

export interface ExchangeKeyMigrationResult {
  migrated: number;
  failed: number;
}

interface Row {
  id: number;
  exchange_key: string | null;
  exchange_secret: string | null;
}

/**
 * Re-encrypts stored exchange keys with the current master key.
 * - v1 values (key from JWT_SECRET) are decrypted with legacyJwtSecret.
 * - v2 values from the previous master key are decrypted with that key.
 * All updates run in one transaction. A row that does not decrypt stays
 * unchanged and gets a warning with its user id. Logs never contain key material.
 */
export function migrateExchangeKeys(db: Db, cipher: ExchangeKeyCipher, legacyJwtSecret: string): ExchangeKeyMigrationResult {
  const rows = db.db
    .prepare("SELECT id, exchange_key, exchange_secret FROM users WHERE COALESCE(exchange_key, '') <> '' OR COALESCE(exchange_secret, '') <> ''")
    .all() as Row[];

  const reencrypt = (value: string | null): string | null => {
    if (!value) return value;
    if (cipher.isCurrent(value)) return value;
    const plaintext = isLegacyV1(value) ? decryptLegacyV1(value, legacyJwtSecret) : cipher.decrypt(value);
    return cipher.encrypt(plaintext);
  };

  const updates: { id: number; key: string | null; secret: string | null }[] = [];
  let failed = 0;
  for (const row of rows) {
    if ((!row.exchange_key || cipher.isCurrent(row.exchange_key)) && (!row.exchange_secret || cipher.isCurrent(row.exchange_secret))) {
      continue;
    }
    try {
      updates.push({ id: row.id, key: reencrypt(row.exchange_key), secret: reencrypt(row.exchange_secret) });
    } catch {
      failed++;
      logger.warn(`[exchange-keys] Cannot decrypt the stored exchange keys of user ${row.id}. The row stays unchanged. The user must save the keys again.`);
    }
  }

  if (updates.length > 0) {
    const stmt = db.db.prepare('UPDATE users SET exchange_key = ?, exchange_secret = ? WHERE id = ?');
    db.db.transaction(() => {
      for (const u of updates) stmt.run(u.key, u.secret, u.id);
    })();
  }

  if (updates.length > 0 || failed > 0) {
    logger.info(`[exchange-keys] Re-encrypted the exchange keys of ${updates.length} user(s) with EXCHANGE_KEYS_ENC_KEY. Failed: ${failed}.`);
  }
  return { migrated: updates.length, failed };
}
