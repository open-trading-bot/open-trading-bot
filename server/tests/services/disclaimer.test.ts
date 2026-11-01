import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDisclaimerService } from '../../src/services/disclaimer.js';

function makeDb() {
  return {
    acceptDisclaimerForUser: vi.fn(),
    getUserById: vi.fn(() => ({ id: 1, disclaimerAcceptedAt: null } as any)),
  } as any;
}

describe('DisclaimerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-18T10:00:00Z'));
  });

  it('returns both language variants and version', () => {
    const svc = createDisclaimerService(makeDb());
    const payload = svc.getPayload();
    expect(payload.version).toBe('2026-04-18');
    expect(payload.variants.en.requiredSignature).toBe('I ACCEPT');
    expect(payload.variants.he.requiredSignature).toBe('אני מאשר');
    expect(payload.variants.en.text).toContain('Trading Risk');
    expect(payload.variants.he.text).toContain('כתב ויתור');
  });

  it('accepts a valid English signature and records audit fields', () => {
    const db = makeDb();
    const svc = createDisclaimerService(db);
    svc.accept(42, { signature: 'i accept ', lang: 'en' }, { ip: '1.2.3.4', userAgent: 'UA' });
    expect(db.acceptDisclaimerForUser).toHaveBeenCalledWith(42, {
      version: '2026-04-18',
      lang: 'en',
      signature: 'i accept',
      ip: '1.2.3.4',
      userAgent: 'UA',
      timestamp: new Date('2026-04-18T10:00:00Z').getTime(),
    });
  });

  it('accepts a valid Hebrew signature', () => {
    const db = makeDb();
    const svc = createDisclaimerService(db);
    svc.accept(7, { signature: ' אני מאשר ', lang: 'he' }, { ip: '1.1.1.1', userAgent: 'UA' });
    expect(db.acceptDisclaimerForUser).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({
      lang: 'he',
      signature: 'אני מאשר',
    }));
  });

  it('rejects a signature that does not match the declared language', () => {
    const db = makeDb();
    const svc = createDisclaimerService(db);
    expect(() => svc.accept(1, { signature: 'אני מאשר', lang: 'en' }, { ip: null, userAgent: null }))
      .toThrow('DISCLAIMER_INVALID_SIGNATURE');
    expect(db.acceptDisclaimerForUser).not.toHaveBeenCalled();
  });

  it('rejects a wrong English signature', () => {
    const db = makeDb();
    const svc = createDisclaimerService(db);
    expect(() => svc.accept(1, { signature: 'I AGREE', lang: 'en' }, { ip: null, userAgent: null }))
      .toThrow('DISCLAIMER_INVALID_SIGNATURE');
  });

  it('rejects a missing lang', () => {
    const db = makeDb();
    const svc = createDisclaimerService(db);
    expect(() => svc.accept(1, { signature: 'I ACCEPT', lang: 'fr' as any }, { ip: null, userAgent: null }))
      .toThrow('DISCLAIMER_INVALID_LANG');
  });

  it('is idempotent: already-accepted users do not throw', () => {
    const db = {
      ...makeDb(),
      getUserById: vi.fn(() => ({ id: 1, disclaimerAcceptedAt: 123 } as any)),
      acceptDisclaimerForUser: vi.fn(),
    };
    const svc = createDisclaimerService(db as any);
    svc.accept(1, { signature: 'I ACCEPT', lang: 'en' }, { ip: null, userAgent: null });
    expect(db.acceptDisclaimerForUser).not.toHaveBeenCalled();
  });

  it('buildRecord is exposed for reuse by the invitations flow', () => {
    const svc = createDisclaimerService(makeDb());
    const record = svc.buildRecord({ signature: 'I ACCEPT', lang: 'en' }, { ip: '9.9.9.9', userAgent: 'UA' });
    expect(record).toEqual({
      version: '2026-04-18',
      lang: 'en',
      signature: 'I ACCEPT'.toLowerCase(),
      ip: '9.9.9.9',
      userAgent: 'UA',
      timestamp: new Date('2026-04-18T10:00:00Z').getTime(),
    });
  });
});
