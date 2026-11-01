import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'http';
import WebSocket from 'ws';
import { createWsServer, type WsBroadcaster } from '../../src/websocket/index.js';
import logger from '../../src/utils/logger.js';

const API_KEY = 'test-api-key';

let server: http.Server;
let broadcaster: WsBroadcaster;
let port: number;
const clients: WebSocket[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const c of clients.splice(0)) c.terminate();
  broadcaster?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

async function setup(opts: { heartbeatMs?: number; maxBufferedBytes?: number }): Promise<void> {
  server = http.createServer();
  broadcaster = createWsServer(server, 'jwt', API_KEY, () => null, opts);
  await new Promise<void>((resolve) => server.listen(0, () => {
    port = (server.address() as { port: number }).port;
    resolve();
  }));
}

function connect(clientOpts: WebSocket.ClientOptions = {}): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws?token=${API_KEY}`, clientOpts);
    clients.push(ws);
    ws.once('message', () => resolve(ws));
    ws.once('error', reject);
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('WebSocket heartbeat', () => {
  it('terminates a client that does not answer pings', async () => {
    await setup({ heartbeatMs: 40 });
    const ws = await connect({ autoPong: false });
    const closed = new Promise<void>((resolve) => ws.once('close', () => resolve()));
    await Promise.race([closed, wait(500).then(() => { throw new Error('socket not reaped'); })]);
    await wait(20);
    expect(broadcaster.clientCount()).toBe(0);
  });

  it('keeps a client that answers pings', async () => {
    await setup({ heartbeatMs: 40 });
    const ws = await connect();
    await wait(250);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(broadcaster.clientCount()).toBe(1);
    ws.close();
  });
});

describe('WebSocket slow consumer', () => {
  it('skips a client whose send buffer is over the limit and logs one warning', async () => {
    const warn = vi.spyOn(logger, 'warn');
    await setup({ maxBufferedBytes: 1024 });
    const ws = await connect();
    let received = 0;
    ws.on('message', () => { received++; });

    const big = 'x'.repeat(4 * 1024 * 1024);
    for (let i = 0; i < 3; i++) {
      broadcaster.broadcastToUser(0, { type: 'alert', data: { message: big, severity: 'info' } });
    }
    await wait(500);

    expect(received).toBe(1);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('[ws] slow client'))).toHaveLength(1);
    ws.close();
  });
});
