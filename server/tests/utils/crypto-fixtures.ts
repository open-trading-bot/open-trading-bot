import crypto from 'crypto';
import { createExchangeKeyCipher } from '../../src/utils/crypto.js';

// The exact algorithm of the old (v1) exchange-key encryption: an
// AES-256-GCM key from scrypt(JWT_SECRET, fixed salt), output
// base64(iv[16] | tag[16] | ciphertext). Tests use it to make real v1 rows.
export function encryptLegacyV1(text: string, jwtSecret: string): string {
  const key = crypto.scryptSync(jwtSecret, 'trading-bot-salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

export const TEST_ENC_KEY = 'a'.repeat(16) + '0123456789abcdef'.repeat(3);
export const TEST_ENC_KEY_2 = 'b'.repeat(16) + 'fedcba9876543210'.repeat(3);

// A ready cipher for tests that build controllers or bot managers.
export const TEST_CIPHER = createExchangeKeyCipher(TEST_ENC_KEY);
