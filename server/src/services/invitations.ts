import crypto from 'crypto';
import type { Db, DbInvitation } from '../db/index.js';
import type { EmailService } from './email.js';
import { buildInvitationEmail } from './email-templates/invitation.js';
import { ERROR_MSG, ROLES } from '../utils/constants.js';
import { hashPassword } from '../db/seed.js';
import { isPasswordValid } from '../utils/password.js';
import { DISCLAIMER_VERSION, isDisclaimerLang, isSignatureValid, normaliseSignature } from '../utils/disclaimer.js';

const TTL_MS = 72 * 60 * 60 * 1000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CreateResult =
  | { emailSent: true; id: string; rawToken: string }
  | { emailSent: false };

export type InvitationListItem = Omit<DbInvitation, 'tokenHash'> & {
  status: 'pending' | 'expired' | 'accepted' | 'revoked';
};

export interface InvitationsService {
  create(input: { email: string; createdBy: number }): Promise<CreateResult>;
  lookup(rawToken: string): { email: string } | null;
  accept(
    rawToken: string,
    password: string,
    disclaimer: { signature: string; lang: string; ip: string | null; userAgent: string | null },
  ): { user: { id: number; username: string; role: string }; token: string };
  revoke(id: string): void;
  resend(id: string): Promise<CreateResult>;
  list(opts: { includeAll: boolean }): InvitationListItem[];
}

function sha256(s: string) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function normaliseEmail(email: string) {
  return email.trim().toLowerCase();
}

function deriveStatus(inv: DbInvitation, now: number): 'pending' | 'expired' | 'accepted' | 'revoked' {
  if (inv.acceptedAt != null) return 'accepted';
  if (inv.revokedAt != null) return 'revoked';
  if (inv.expiresAt <= now) return 'expired';
  return 'pending';
}

export function createInvitationsService(
  db: Db,
  email: EmailService,
  publicAppUrl: string,
  authSigner: (user: { id: number; username: string; role: string }) => string,
): InvitationsService {
  async function doCreate(params: { email: string; createdBy: number }): Promise<CreateResult> {
    const normalised = normaliseEmail(params.email);
    if (!EMAIL_REGEX.test(normalised)) throw new Error(ERROR_MSG.INVALID_EMAIL);

    const existingUser = db.getUserByUsername(normalised);
    if (existingUser) throw new Error(ERROR_MSG.USER_EXISTS);

    if (!email.isConfigured()) return { emailSent: false };

    const now = Date.now();
    const id = crypto.randomUUID();
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = sha256(rawToken);

    db.db.transaction(() => {
      const pending = db.getActiveInvitationByEmail(normalised);
      if (pending) db.updateInvitationState(pending.id, { revokedAt: now });
      db.createInvitation({
        id,
        email: normalised,
        tokenHash,
        createdBy: params.createdBy,
        createdAt: now,
        expiresAt: now + TTL_MS,
      });
    })();

    const acceptUrl = `${publicAppUrl}/accept-invite?token=${rawToken}`;
    try {
      await email.send(buildInvitationEmail(normalised, acceptUrl));
    } catch (err) {
      db.updateInvitationState(id, { revokedAt: Date.now() });
      throw err;
    }
    return { emailSent: true, id, rawToken };
  }

  function doLookup(rawToken: string): { email: string } | null {
    const row = db.getInvitationByTokenHash(sha256(rawToken));
    if (!row) return null;
    const now = Date.now();
    if (deriveStatus(row, now) !== 'pending') return null;
    return { email: row.email };
  }

  function doAccept(
    rawToken: string,
    password: string,
    disclaimer: { signature: string; lang: string; ip: string | null; userAgent: string | null },
  ) {
    if (!isPasswordValid(password)) throw new Error(ERROR_MSG.INVALID_PASSWORD);
    if (!isDisclaimerLang(disclaimer.lang) || !isSignatureValid(disclaimer.lang, disclaimer.signature)) {
      throw new Error(ERROR_MSG.DISCLAIMER_INVALID);
    }
    const passwordHash = hashPassword(password);
    const tokenHash = sha256(rawToken);
    const now = Date.now();

    let user: { id: number; username: string; role: string };
    try {
      user = db.db.transaction(() => {
        const row = db.getInvitationByTokenHash(tokenHash);
        if (!row || deriveStatus(row, now) !== 'pending') throw new Error(ERROR_MSG.INVITATION_INVALID);
        const created = db.createUser(row.email, row.email, passwordHash, ROLES.REGULAR);
        db.acceptDisclaimerForUser(created.id, {
          version: DISCLAIMER_VERSION,
          lang: disclaimer.lang as 'en' | 'he',
          signature: normaliseSignature(disclaimer.signature),
          ip: disclaimer.ip,
          userAgent: disclaimer.userAgent,
          timestamp: now,
        });
        db.updateInvitationState(row.id, { acceptedAt: now });
        return created;
      })();
    } catch (err: any) {
      if (typeof err?.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
        const row = db.getInvitationByTokenHash(tokenHash);
        if (row) db.updateInvitationState(row.id, { revokedAt: Date.now() });
        throw new Error(ERROR_MSG.INVITATION_INVALID);
      }
      throw err;
    }

    const token = authSigner(user);
    return { user, token };
  }

  function doRevoke(id: string) {
    db.updateInvitationState(id, { revokedAt: Date.now() });
  }

  async function doResend(id: string) {
    const existing = db.getInvitationById(id);
    if (!existing) throw new Error(ERROR_MSG.INVITATION_INVALID);
    return doCreate({ email: existing.email, createdBy: existing.createdBy });
  }

  function doList({ includeAll }: { includeAll: boolean }) {
    const now = Date.now();
    return db.listInvitations({ includeAll }).map((inv) => {
      const { tokenHash: _tokenHash, ...rest } = inv;
      return { ...rest, status: deriveStatus(inv, now) };
    });
  }

  return { create: doCreate, lookup: doLookup, accept: doAccept, revoke: doRevoke, resend: doResend, list: doList };
}
