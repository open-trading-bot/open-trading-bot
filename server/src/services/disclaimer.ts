import type { Db } from '../db/index.js';
import {
  DISCLAIMER,
  DISCLAIMER_LANGS,
  DISCLAIMER_VERSION,
  isDisclaimerLang,
  isSignatureValid,
  normaliseSignature,
  type DisclaimerLang,
} from '../utils/disclaimer.js';

export interface DisclaimerPayload {
  version: string;
  variants: Record<DisclaimerLang, { requiredSignature: string; text: string }>;
}

export interface AcceptInput {
  signature: string;
  lang: string;
}

export interface AcceptContext {
  ip: string | null;
  userAgent: string | null;
}

export interface DisclaimerRecord {
  version: string;
  lang: DisclaimerLang;
  signature: string;
  ip: string | null;
  userAgent: string | null;
  timestamp: number;
}

export const DISCLAIMER_ERROR = {
  INVALID_LANG: 'DISCLAIMER_INVALID_LANG',
  INVALID_SIGNATURE: 'DISCLAIMER_INVALID_SIGNATURE',
} as const;

export type DisclaimerErrorCode = typeof DISCLAIMER_ERROR[keyof typeof DISCLAIMER_ERROR];

export interface DisclaimerService {
  getPayload(): DisclaimerPayload;
  /**
   * Validate the payload and, if the user has not already accepted,
   * persist the audit record. Idempotent for already-accepted users.
   */
  accept(userId: number, input: AcceptInput, ctx: AcceptContext): void;
  /**
   * Validate the payload and return the audit record *without* persisting.
   * Used by the invitations flow, which writes to the user row as part of
   * user creation.
   */
  buildRecord(input: AcceptInput, ctx: AcceptContext): DisclaimerRecord;
}

export function createDisclaimerService(db: Db): DisclaimerService {
  function validate(input: AcceptInput): { lang: DisclaimerLang; signature: string } {
    if (!isDisclaimerLang(input.lang)) throw new Error(DISCLAIMER_ERROR.INVALID_LANG);
    if (!isSignatureValid(input.lang, input.signature)) throw new Error(DISCLAIMER_ERROR.INVALID_SIGNATURE);
    return { lang: input.lang, signature: normaliseSignature(input.signature) };
  }

  function buildRecord(input: AcceptInput, ctx: AcceptContext): DisclaimerRecord {
    const { lang, signature } = validate(input);
    return {
      version: DISCLAIMER_VERSION,
      lang,
      signature,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      timestamp: Date.now(),
    };
  }

  return {
    getPayload() {
      const variants = {} as DisclaimerPayload['variants'];
      for (const lang of DISCLAIMER_LANGS) {
        variants[lang] = {
          requiredSignature: DISCLAIMER[lang].requiredSignature,
          text: DISCLAIMER[lang].text,
        };
      }
      return { version: DISCLAIMER_VERSION, variants };
    },
    accept(userId, input, ctx) {
      const record = buildRecord(input, ctx);
      // Auth middleware has already verified the caller exists, so we only
      // need to check whether they've already accepted. The UPDATE has its
      // own `WHERE disclaimer_accepted_at IS NULL` guard for safety.
      const user = db.getUserById(userId);
      if (user?.disclaimerAcceptedAt != null) return; // idempotent
      db.acceptDisclaimerForUser(userId, record);
    },
    buildRecord,
  };
}
