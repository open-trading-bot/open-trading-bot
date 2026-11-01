import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import WebSocket from 'ws';
import { createWsServer, type WsBroadcaster } from '../../src/websocket/index.js';

const TEST_JWT_SECRET = 'test-secret';
const TEST_API_KEY = 'test-api-key';

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
    broadcaster = createWsServer(server, TEST_JWT_SECRET, TEST_API_KEY, () => null);
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  }

  function connectClient(token = TEST_API_KEY): Promise<{ ws: WebSocket; welcomeMsg: string }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${port}/ws?token=${token}`);
      ws.once('message', (data) => {
        resolve({ ws, welcomeMsg: data.toString() });
      });
      ws.once('close', (code) => {
        if (code === 4001) reject(new Error('Unauthorized'));
      });
    });
  }

  it('accepts authenticated connections', async () => {
    await setup();
    const { ws: client, welcomeMsg } = await connectClient();
    expect(client.readyState).toBe(WebSocket.OPEN);
    const msg = JSON.parse(welcomeMsg);
    expect(msg.type).toBe('connected');
    client.close();
  });

  it('rejects unauthenticated connections', async () => {
    await setup();
    await expect(connectClient('invalid-token')).rejects.toThrow('Unauthorized');
  });

  it('broadcasts events to connected clients', async () => {
    await setup();
    const { ws: client } = await connectClient();

    const received = new Promise<string>((resolve) => {
      client.once('message', (data) => resolve(data.toString()));
    });

    broadcaster.broadcastToUser(0, {
      type: 'bot:status',
      data: { status: 'running', mode: 'paper' },
    });

    const msg = JSON.parse(await received);
    expect(msg.type).toBe('bot:status');
    expect(msg.data.status).toBe('running');
    client.close();
  });

  it('broadcasts trade:executed events to clients', async () => {
    await setup();
    const { ws: client } = await connectClient();

    const received = new Promise<string>((resolve) => {
      client.once('message', (data) => resolve(data.toString()));
    });

    broadcaster.broadcastToUser(0, {
      type: 'trade:executed',
      data: { id: 't1', symbol: 'BTC/USDT', side: 'buy', price: 50000, amount: 100, pnl: 5 },
    } as any);

    const msg = JSON.parse(await received);
    expect(msg.type).toBe('trade:executed');
    expect(msg.data.symbol).toBe('BTC/USDT');
    expect(msg.data.pnl).toBe(5);
    client.close();
  });

  it('broadcasts position:update events to clients', async () => {
    await setup();
    const { ws: client } = await connectClient();

    const received = new Promise<string>((resolve) => {
      client.once('message', (data) => resolve(data.toString()));
    });

    broadcaster.broadcastToUser(0, {
      type: 'position:update',
      data: { id: 'p1', symbol: 'ETH/USDT', pnl: 12.5, pnlPct: 2.5 },
    } as any);

    const msg = JSON.parse(await received);
    expect(msg.type).toBe('position:update');
    expect(msg.data.symbol).toBe('ETH/USDT');
    expect(msg.data.pnl).toBe(12.5);
    client.close();
  });

  it('reports connected client count', async () => {
    await setup();
    expect(broadcaster.clientCount()).toBe(0);
    const { ws: client } = await connectClient();
    expect(broadcaster.clientCount()).toBe(1);
    client.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(broadcaster.clientCount()).toBe(0);
  });
});
