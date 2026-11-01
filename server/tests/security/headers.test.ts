import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type http from 'http';
import { createApp } from '../../src/server.js';

describe('security headers', () => {
  let server: http.Server;
  let headers: Headers;

  beforeAll(async () => {
    const { app } = createApp('api-key-for-tests-0123456789abcdef', 'jwt-secret', () => null);
    app.get('/page', (_req, res) => { res.send('<!doctype html><title>x</title>'); });
    const port: number = await new Promise((resolve) => {
      server = app.listen(0, () => resolve((server.address() as { port: number }).port));
    });
    headers = (await fetch(`http://127.0.0.1:${port}/page`)).headers;
  });
  afterAll(() => server?.close());

  it('sets X-Content-Type-Options', () => {
    expect(headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('forbids framing', () => {
    expect(headers.get('x-frame-options')).toBe('DENY');
    expect(headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('sets a strict Referrer-Policy', () => {
    expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  it('leaves HSTS to the TLS proxy', () => {
    // The server does not know the public host name. HSTS from here would
    // also pin "localhost" in local Docker runs.
    expect(headers.get('strict-transport-security')).toBeNull();
  });

  it('removes X-Powered-By', () => {
    expect(headers.get('x-powered-by')).toBeNull();
  });

  it('sets a CSP that allows the app and reCAPTCHA and blocks other scripts', () => {
    const csp = headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toMatch(/script-src 'self' https:\/\/www\.google\.com\/recaptcha\/ https:\/\/www\.gstatic\.com\/recaptcha\/(;|$)/);
    expect(csp).toContain('frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/');
    expect(csp).toContain("img-src 'self' data: https://cdn.jsdelivr.net");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('upgrade-insecure-requests');
  });
});
