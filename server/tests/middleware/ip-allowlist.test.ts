import { describe, it, expect, afterEach } from 'vitest';
import type http from 'http';
import { parseIpAllowList } from '../../src/middleware/ip-allowlist.js';
import { createApp } from '../../src/server.js';

describe('parseIpAllowList', () => {
  it('returns null when the value is empty', () => {
    expect(parseIpAllowList(undefined)).toBeNull();
    expect(parseIpAllowList('  ')).toBeNull();
  });

  it('matches single addresses and CIDR ranges, separated by commas or spaces', () => {
    const allow = parseIpAllowList('203.0.113.7, 10.0.0.0/8 2001:db8::/32')!;
    expect(allow('203.0.113.7')).toBe(true);
    expect(allow('10.20.30.40')).toBe(true);
    expect(allow('2001:db8::1')).toBe(true);
    expect(allow('203.0.113.8')).toBe(false);
    expect(allow('8.8.8.8')).toBe(false);
    expect(allow('2001:db9::1')).toBe(false);
  });

  it('matches an IPv4-mapped IPv6 address against an IPv4 entry', () => {
    const allow = parseIpAllowList('127.0.0.1')!;
    expect(allow('::ffff:127.0.0.1')).toBe(true);
  });

  it('rejects an address that is not valid', () => {
    const allow = parseIpAllowList('127.0.0.1')!;
    expect(allow(undefined)).toBe(false);
    expect(allow('not-an-ip')).toBe(false);
  });

  it('throws on an entry that is not an IP address or CIDR range', () => {
    expect(() => parseIpAllowList('10.0.0.0/8, office')).toThrow('BACKOFFICE_ALLOWED_IPS');
    expect(() => parseIpAllowList('10.0.0.0/40')).toThrow('BACKOFFICE_ALLOWED_IPS');
  });
});

describe('BACKOFFICE_ALLOWED_IPS on the API', () => {
  let server: http.Server | undefined;
  const saved = { allowed: process.env.BACKOFFICE_ALLOWED_IPS, trust: process.env.TRUST_PROXY };

  afterEach(() => {
    server?.close();
    server = undefined;
    for (const [k, v] of [['BACKOFFICE_ALLOWED_IPS', saved.allowed], ['TRUST_PROXY', saved.trust]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  async function start(allowed: string | undefined): Promise<number> {
    if (allowed === undefined) delete process.env.BACKOFFICE_ALLOWED_IPS;
    else process.env.BACKOFFICE_ALLOWED_IPS = allowed;
    delete process.env.TRUST_PROXY; // default: trust loopback, so the test can set X-Forwarded-For
    const { app } = createApp('api-key-for-tests-0123456789abcdef', 'jwt-secret', () => null);
    app.use((_req, res) => { res.status(204).end(); });
    return new Promise((resolve) => {
      const s = app.listen(0, () => resolve((s.address() as { port: number }).port));
      server = s;
    });
  }

  const get = (port: number, path: string, ip: string) =>
    fetch(`http://127.0.0.1:${port}${path}`, { headers: { 'X-Forwarded-For': ip, 'x-api-key': 'api-key-for-tests-0123456789abcdef' } });

  it('returns 403 for a backoffice request from an address that is not in the list', async () => {
    const port = await start('203.0.113.7');
    const res = await get(port, '/api/backoffice/users', '8.8.8.8');
    expect(res.status).toBe(403);
  });

  it('returns 403 also when the path has a different case', async () => {
    const port = await start('203.0.113.7');
    const res = await get(port, '/API/Backoffice/users', '8.8.8.8');
    expect(res.status).toBe(403);
  });

  it('allows a backoffice request from an address in the list', async () => {
    const port = await start('203.0.113.0/24');
    const res = await get(port, '/api/backoffice/users', '203.0.113.7');
    expect(res.status).toBe(204);
  });

  it('does not change other API routes', async () => {
    const port = await start('203.0.113.7');
    const res = await get(port, '/api/bot/status', '8.8.8.8');
    expect(res.status).toBe(204);
  });

  it('allows all addresses when the variable is not set', async () => {
    const port = await start(undefined);
    const res = await get(port, '/api/backoffice/users', '8.8.8.8');
    expect(res.status).toBe(204);
  });
});
