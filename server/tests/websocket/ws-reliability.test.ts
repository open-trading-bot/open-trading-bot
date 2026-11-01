import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'http';
import WebSocket from 'ws';
import { createWsServer, type WsBroadcaster } from '../../src/websocket/index.js';
import logger from '../../src/utils/logger.js';
import { signUserToken } from '../../src/utils/jwt.js';
import type { DbUser } from '../../src/db/index.js';

const USER = { id: 1, username: 'u', role: 'regular', enabled: true, tokenVersion: 0 } as DbUser;
const TOKEN = signUserToken(USER, 'jwt');

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
  broadcaster = createWsServer(server, 'jwt', (id) => (id === USER.id ? USER : null), opts);
  await new Promise<void>((resolve) => server.listen(0, () => {
    port = (server.address() as { port: number }).port;
    resolve();
  }));
}

function connect(clientOpts: WebSocket.ClientOptions = {}): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`, clientOpts);
    clients.push(ws);
    ws.once('open', () => ws.send(JSON.stringify({ type: 'auth', token: TOKEN })));
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
      broadcaster.broadcastToUser(USER.id, { type: 'alert', data: { message: big, severity: 'info' } });
    }
    await wait(500);

    expect(received).toBe(1);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('[ws] slow client'))).toHaveLength(1);
    ws.close();
  });
});
