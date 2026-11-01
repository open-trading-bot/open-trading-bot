import crypto from 'crypto';

// Encryption of the users' exchange API keys and secrets at rest.
//
// v2 format (current):
//   v2:<keyId>:<salt>:<iv>:<tag>:<ciphertext>
// - keyId: 8 hex chars, a fingerprint of the master key (HMAC-SHA256). It
//   selects the master key on decrypt, so a rotation can keep the previous key.
// - salt: 16 random bytes per record. HKDF-SHA256(masterKey, salt) gives the
//   AES-256-GCM key of the record.
// - iv: 12 random bytes. tag: 16 bytes.
// - salt, iv, tag and ciphertext are base64url. The "v2:<keyId>" header is
//   GCM additional data, so a change to the header fails decryption.
//
// v1 format (legacy, read only for the startup migration):
//   base64(iv[16] | tag[16] | ciphertext), key = scrypt(JWT_SECRET, fixed salt)

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v2';
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HKDF_INFO = Buffer.from('open-trading-bot/exchange-keys/v2');
const MASTER_KEY_PATTERN = /^[0-9a-f]{64}$/i;

export interface ExchangeKeyCipher {
  /** Encrypts with the current master key. */
  encrypt(plaintext: string): string;
  /** Decrypts v2 values of the current or the previous master key. Throws on v1 or on tampered data. */
  decrypt(encoded: string): string;
  /** True when the value is v2 and uses the current master key. */
  isCurrent(encoded: string): boolean;
}

interface MasterKey {
  id: string;
  key: Buffer;
}

export function isValidMasterKey(hex: string): boolean {
  return MASTER_KEY_PATTERN.test(hex) && !/^0+$/.test(hex);
}

function toMasterKey(hex: string): MasterKey {
  if (!isValidMasterKey(hex)) {
    throw new Error('The exchange-key master key must be 64 hex characters (32 random bytes).');
  }
  const key = Buffer.from(hex, 'hex');
  const id = crypto.createHmac('sha256', key).update('key-id').digest('hex').slice(0, 8);
  return { id, key };
}

function recordKey(master: Buffer, salt: Buffer): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', master, salt, HKDF_INFO, 32));
}

export function createExchangeKeyCipher(currentHex: string, previousHex?: string): ExchangeKeyCipher {
  const current = toMasterKey(currentHex);
  const keys = new Map<string, MasterKey>([[current.id, current]]);
  if (previousHex) {
    const previous = toMasterKey(previousHex);
    if (!keys.has(previous.id)) keys.set(previous.id, previous);
  }

  return {
    encrypt(plaintext) {
      const salt = crypto.randomBytes(SALT_LENGTH);
      const iv = crypto.randomBytes(IV_LENGTH);
      const header = `${VERSION}:${current.id}`;
      const cipher = crypto.createCipheriv(ALGORITHM, recordKey(current.key, salt), iv, { authTagLength: TAG_LENGTH });
      cipher.setAAD(Buffer.from(header));
      const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [header, salt, iv, tag, ct].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join(':');
    },

    decrypt(encoded) {
      const parts = encoded.split(':');
      if (parts.length !== 6 || parts[0] !== VERSION) {
        throw new Error('Unsupported exchange-key ciphertext format');
      }
      const [version, keyId, saltB64, ivB64, tagB64, ctB64] = parts;
      const master = keys.get(keyId);
      if (!master) throw new Error('Unknown exchange-key master key id');
      const salt = Buffer.from(saltB64, 'base64url');
      const iv = Buffer.from(ivB64, 'base64url');
      const tag = Buffer.from(tagB64, 'base64url');
      if (salt.length !== SALT_LENGTH || iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
        throw new Error('Malformed exchange-key ciphertext');
      }
      const decipher = crypto.createDecipheriv(ALGORITHM, recordKey(master.key, salt), iv, { authTagLength: TAG_LENGTH });
      decipher.setAAD(Buffer.from(`${version}:${keyId}`));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8');
    },

    isCurrent(encoded) {
      return encoded.startsWith(`${VERSION}:${current.id}:`);
    },
  };
}

/** True when the value is not in the v2 format (so it is legacy v1). */
export function isLegacyV1(encoded: string): boolean {
  return !encoded.startsWith(`${VERSION}:`);
}

/**
 * Decrypts the legacy v1 format. Only the startup migration may call this.
 * The key comes from JWT_SECRET with a fixed salt.
 */
export function decryptLegacyV1(encoded: string, jwtSecret: string): string {
  const key = crypto.scryptSync(jwtSecret, 'trading-bot-salt', 32);
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, 16);
  const tag = buf.subarray(16, 32);
  const encrypted = buf.subarray(32);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
