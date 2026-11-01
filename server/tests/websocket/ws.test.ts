import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import WebSocket from 'ws';
import { createWsServer, type WsBroadcaster } from '../../src/websocket/index.js';
import { signUserToken } from '../../src/utils/jwt.js';
import type { DbUser } from '../../src/db/index.js';

const TEST_JWT_SECRET = 'test-secret';
const TEST_API_KEY = 'test-api-key-that-must-not-work-on-ws';
const AUTH_TIMEOUT_MS = 150;

const alice = { id: 7, username: 'alice', role: 'regular', enabled: true, tokenVersion: 0 } as DbUser;
const bob = { id: 8, username: 'bob', role: 'regular', enabled: true, tokenVersion: 0 } as DbUser;
const users = new Map<number, DbUser>([[alice.id, alice], [bob.id, bob]]);
const getUser = (id: number) => users.get(id) ?? null;

const aliceToken = signUserToken(alice, TEST_JWT_SECRET);
const bobToken = signUserToken(bob, TEST_JWT_SECRET);

describe('WebSocket Server', () => {
  let server: http.Server;
  let broadcaster: WsBroadcaster;
  let port: number;

  afterEach(async () => {
    broadcaster?.close();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  async function setup(): Promise<void> {
    server = http.createServer();
    broadcaster = createWsServer(server, TEST_JWT_SECRET, getUser, { authTimeoutMs: AUTH_TIMEOUT_MS });
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  }

  /** Opens a socket. Sends `firstMessage` after open, if given. Resolves with the first server message, rejects on close. */
  function connect(firstMessage?: string, query = ''): Promise<{ ws: WebSocket; welcomeMsg: string }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws${query}`);
      ws.once('open', () => { if (firstMessage !== undefined) ws.send(firstMessage); });
      ws.once('message', (data) => resolve({ ws, welcomeMsg: data.toString() }));
      ws.once('close', (code) => reject(new Error(`closed ${code}`)));
    });
  }

  const auth = (token: string) => JSON.stringify({ type: 'auth', token });

  it('accepts a valid JWT sent in the first message', async () => {
    await setup();
    const { ws, welcomeMsg } = await connect(auth(aliceToken));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(JSON.parse(welcomeMsg).type).toBe('connected');
    ws.close();
  });

  it('rejects an invalid token', async () => {
    await setup();
    await expect(connect(auth('invalid-token'))).rejects.toThrow('closed 4001');
  });

  it('rejects the master API key', async () => {
    await setup();
    await expect(connect(auth(TEST_API_KEY))).rejects.toThrow('closed 4001');
  });

  it('rejects a first message that is not JSON', async () => {
    await setup();
    await expect(connect('hello')).rejects.toThrow('closed 4001');
  });

  it('rejects a first message of a different type', async () => {
    await setup();
    await expect(connect(JSON.stringify({ type: 'subscribe', token: aliceToken }))).rejects.toThrow('closed 4001');
  });

  it('rejects a token of a disabled user', async () => {
    await setup();
    users.set(alice.id, { ...alice, enabled: false });
    try {
      await expect(connect(auth(aliceToken))).rejects.toThrow('closed 4001');
    } finally {
      users.set(alice.id, alice);
    }
  });

  it('closes a socket that does not authenticate in time', async () => {
    await setup();
    const started = Date.now();
    await expect(connect()).rejects.toThrow('closed 4001');
    expect(Date.now() - started).toBeGreaterThanOrEqual(AUTH_TIMEOUT_MS - 20);
  });

  it('ignores a token in the URL query', async () => {
    await setup();
    await expect(connect(undefined, `?token=${aliceToken}`)).rejects.toThrow('closed 4001');
  });

  it('sends events only to the sockets of the target user', async () => {
    await setup();
    const { ws: a } = await connect(auth(aliceToken));
    const { ws: b } = await connect(auth(bobToken));
    const bobGot: string[] = [];
    b.on('message', (d) => bobGot.push(d.toString()));

    const received = new Promise<string>((resolve) => a.once('message', (d) => resolve(d.toString())));
    broadcaster.broadcastToUser(alice.id, { type: 'bot:status', data: { status: 'running', mode: 'paper' } });

    const msg = JSON.parse(await received);
    expect(msg.type).toBe('bot:status');
    expect(msg.data.status).toBe('running');
    await new Promise((r) => setTimeout(r, 30));
    expect(bobGot).toEqual([]);
    a.close();
    b.close();
  });

  it('does not send events to a socket before it authenticates', async () => {
    await setup();
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    const got: string[] = [];
    ws.on('message', (d) => got.push(d.toString()));
    await new Promise((r) => ws.once('open', r));
    broadcaster.broadcastToUser(alice.id, { type: 'bot:status', data: { status: 'running', mode: 'paper' } });
    await new Promise((r) => setTimeout(r, 30));
    expect(got).toEqual([]);
    ws.close();
  });

  it('broadcasts trade:executed events to clients', async () => {
    await setup();
    const { ws } = await connect(auth(aliceToken));
    const received = new Promise<string>((resolve) => ws.once('message', (d) => resolve(d.toString())));
    broadcaster.broadcastToUser(alice.id, {
      type: 'trade:executed',
      data: { id: 't1', symbol: 'BTC/USDT', side: 'buy', price: 50000, amount: 100, pnl: 5 },
    } as any);
    const msg = JSON.parse(await received);
    expect(msg.type).toBe('trade:executed');
    expect(msg.data.symbol).toBe('BTC/USDT');
    expect(msg.data.pnl).toBe(5);
    ws.close();
  });

  it('reports connected client count', async () => {
    await setup();
    expect(broadcaster.clientCount()).toBe(0);
    const { ws } = await connect(auth(aliceToken));
    expect(broadcaster.clientCount()).toBe(1);
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(broadcaster.clientCount()).toBe(0);
  });
});
