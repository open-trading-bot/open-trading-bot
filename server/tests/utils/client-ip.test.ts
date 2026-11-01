import { describe, it, expect } from 'vitest';
import express from 'express';
import http from 'http';
import { getClientIp } from '../../src/utils/rate-limiter.js';

async function ipSeenBy(trustProxy: string | false, headers: Record<string, string>): Promise<string> {
  const app = express();
  if (trustProxy !== false) app.set('trust proxy', trustProxy);
  app.get('/ip', (req, res) => res.json({ ip: getClientIp(req) }));
  const server: http.Server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try {
    const port = (server.address() as any).port;
    const res = await fetch(`http://127.0.0.1:${port}/ip`, { headers });
    return (await res.json()).ip;
  } finally { server.close(); }
}

describe('getClientIp (S1)', () => {
  it('ignores a client-supplied X-Forwarded-For when no proxy is trusted', async () => {
    const ip = await ipSeenBy(false, { 'X-Forwarded-For': '6.6.6.6' });
    expect(ip).not.toBe('6.6.6.6');
  });

  it('uses the address that a trusted proxy appended', async () => {
    // The request comes from 127.0.0.1, which acts as the trusted proxy.
    const ip = await ipSeenBy('loopback', { 'X-Forwarded-For': '6.6.6.6, 8.8.8.8' });
    expect(ip).toBe('8.8.8.8');
  });
});
