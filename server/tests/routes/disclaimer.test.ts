import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import { createDisclaimerRouter } from '../../src/routes/disclaimer.js';
import type { DisclaimerService } from '../../src/services/disclaimer.js';

function build(service: DisclaimerService, authUser?: { id: number }) {
  const app = express();
  app.use(express.json());
  if (authUser) {
    app.use((req, _res, next) => { (req as any).user = authUser; next(); });
  }
  app.use('/api', createDisclaimerRouter(service));
  return app;
}

async function startServer(app: express.Express): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      resolve({ server, port });
    });
  });
}

describe('Disclaimer routes', () => {
  let service: DisclaimerService;
  let server: http.Server;
  let port: number;

  beforeEach(() => {
    service = {
      getPayload: vi.fn(() => ({
        version: '2026-04-18',
        variants: {
          en: { requiredSignature: 'I ACCEPT', text: 'EN' },
          he: { requiredSignature: 'אני מאשר', text: 'HE' },
        },
      })),
      accept: vi.fn(),
      buildRecord: vi.fn(),
    };
  });

  afterEach(() => {
    server?.close();
  });

  it('GET /api/disclaimer returns version and both variants', async () => {
    ({ server, port } = await startServer(build(service)));
    const res = await fetch(`http://localhost:${port}/api/disclaimer`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.version).toBe('2026-04-18');
    expect(body.variants.en.requiredSignature).toBe('I ACCEPT');
    expect(body.variants.he.requiredSignature).toBe('אני מאשר');
  });

  it('POST /api/me/accept-disclaimer 401 when unauthenticated', async () => {
    ({ server, port } = await startServer(build(service)));
    const res = await fetch(`http://localhost:${port}/api/me/accept-disclaimer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature: 'I ACCEPT', lang: 'en' }),
    });
    expect(res.status).toBe(401);
    expect(service.accept).not.toHaveBeenCalled();
  });

  it('POST /api/me/accept-disclaimer 200 on valid payload', async () => {
    ({ server, port } = await startServer(build(service, { id: 42 })));
    const res = await fetch(`http://localhost:${port}/api/me/accept-disclaimer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'jest' },
      body: JSON.stringify({ signature: 'I ACCEPT', lang: 'en' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toEqual({ ok: true, disclaimerAccepted: true });
    expect(service.accept).toHaveBeenCalledWith(
      42,
      { signature: 'I ACCEPT', lang: 'en' },
      expect.objectContaining({ userAgent: 'jest' }),
    );
  });

  it('POST /api/me/accept-disclaimer 400 on invalid signature', async () => {
    (service.accept as any).mockImplementation(() => { throw new Error('DISCLAIMER_INVALID_SIGNATURE'); });
    ({ server, port } = await startServer(build(service, { id: 42 })));
    const res = await fetch(`http://localhost:${port}/api/me/accept-disclaimer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature: 'WRONG', lang: 'en' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/me/accept-disclaimer 400 on invalid lang', async () => {
    (service.accept as any).mockImplementation(() => { throw new Error('DISCLAIMER_INVALID_LANG'); });
    ({ server, port } = await startServer(build(service, { id: 42 })));
    const res = await fetch(`http://localhost:${port}/api/me/accept-disclaimer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature: 'I ACCEPT', lang: 'fr' }),
    });
    expect(res.status).toBe(400);
  });
});
