import { describe, it, expect, vi, afterEach } from 'vitest';
import type http from 'http';
import { createApp } from '../src/server.js';
import logger from '../src/utils/logger.js';

let server: http.Server | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = undefined;
});

async function start(): Promise<number> {
  const { app, server: s } = createApp('api-key', 'jwt-secret', () => null);
  app.get('/api/ok-test', (_req, res) => { res.json({ ok: true }); });
  app.get('/api/fail-test', (_req, res) => { res.status(500).json({ error: 'x' }); });
  server = s;
  await new Promise<void>((r) => s.listen(0, () => r()));
  return (s.address() as { port: number }).port;
}

const lines = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c) => String(c[0]));
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('API request log', () => {
  it('logs a successful request at debug, not info', async () => {
    const info = vi.spyOn(logger, 'info');
    const debug = vi.spyOn(logger, 'debug');
    const port = await start();
    await fetch(`http://localhost:${port}/api/ok-test`, { headers: { 'x-api-key': 'api-key' } });
    await settle();
    expect(lines(info).filter((m) => m.startsWith('[api]'))).toHaveLength(0);
    expect(lines(debug).some((m) => /^\[api\] GET \/api\/ok-test 200/.test(m))).toBe(true);
  });

  it('logs a 4xx response at warn and a 5xx response at error', async () => {
    const warn = vi.spyOn(logger, 'warn');
    const error = vi.spyOn(logger, 'error');
    const port = await start();
    await fetch(`http://localhost:${port}/api/ok-test`); // no credentials: 401
    await fetch(`http://localhost:${port}/api/fail-test`, { headers: { 'x-api-key': 'api-key' } });
    await settle();
    expect(lines(warn).some((m) => /^\[api\] GET \/api\/ok-test 401/.test(m))).toBe(true);
    expect(lines(error).some((m) => /^\[api\] GET \/api\/fail-test 500/.test(m))).toBe(true);
  });
});
