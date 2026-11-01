import { WebSocketServer, WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'http';
import type { WsEvent } from '../types/index.js';
import { WS_EVENTS } from '../utils/constants.js';
import { verifyUserToken } from '../utils/jwt.js';
import { safeEqual } from '../middleware/auth.js';
import type { DbUser } from '../db/index.js';
import logger from '../utils/logger.js';

export interface WsServerOptions {
  /** Ping interval. A client that does not answer one ping before the next is terminated. */
  heartbeatMs?: number;
  /** A client with more unsent bytes than this does not get new messages. */
  maxBufferedBytes?: number;
}

export const WS_DEFAULTS = {
  HEARTBEAT_MS: 30_000,
  MAX_BUFFERED_BYTES: 1024 * 1024,
} as const;

export interface WsBroadcaster {
  broadcast(event: WsEvent): void; // Used by per-user wrappers in bot-manager
  broadcastToUser(userId: number, event: WsEvent): void;
  clientCount(): number;
  close(): void;
}

interface AuthResult {
  authenticated: boolean;
  userId?: number;
}

function authenticateWs(req: IncomingMessage, jwtSecret: string, apiKey: string, getUser: (id: number) => DbUser | null): AuthResult {
  const url = new URL(req.url || '', 'http://localhost');
  const token = url.searchParams.get('token');

  if (token) {
    const user = verifyUserToken(token, jwtSecret, getUser);
    if (user) return { authenticated: true, userId: user.id };
    // Try API key — admin with id 0
    if (safeEqual(token, apiKey)) return { authenticated: true, userId: 0 };
  }

  return { authenticated: false };
}

export function createWsServer(
  server: Server, jwtSecret: string, apiKey: string, getUser: (id: number) => DbUser | null,
  options: WsServerOptions = {},
): WsBroadcaster {
  const heartbeatMs = options.heartbeatMs ?? WS_DEFAULTS.HEARTBEAT_MS;
  const maxBufferedBytes = options.maxBufferedBytes ?? WS_DEFAULTS.MAX_BUFFERED_BYTES;
  const wss = new WebSocketServer({ server, path: '/ws' });
  const userConnections = new Map<number, Set<WebSocket>>();
  // Sockets that answered the last ping. A half-open socket (the peer is gone
  // without a close frame) never answers, so the next heartbeat removes it.
  const alive = new WeakSet<WebSocket>();
  // Sockets that are skipped because of a full send buffer. Used to log one
  // warning per slow period, not one per message.
  const slow = new WeakSet<WebSocket>();

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) { ws.terminate(); continue; }
      alive.delete(ws);
      ws.ping();
    }
  }, heartbeatMs);
  heartbeat.unref();

  wss.on('connection', (ws, req) => {
    const auth = authenticateWs(req, jwtSecret, apiKey, getUser);
    if (!auth.authenticated || auth.userId === undefined) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const userId = auth.userId;
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));
    if (!userConnections.has(userId)) {
      userConnections.set(userId, new Set());
    }
    userConnections.get(userId)!.add(ws);

    ws.on('error', () => {
      const conns = userConnections.get(userId);
      if (conns) {
        conns.delete(ws);
        if (conns.size === 0) userConnections.delete(userId);
      }
    });

    ws.on('close', () => {
      const conns = userConnections.get(userId);
      if (conns) {
        conns.delete(ws);
        if (conns.size === 0) userConnections.delete(userId);
      }
    });

    ws.send(JSON.stringify({ type: WS_EVENTS.CONNECTED, data: { timestamp: Date.now() } }));
  });

  return {
    broadcast(_event: WsEvent) {
      // No-op: global broadcast disabled for security. Use broadcastToUser() instead.
    },

    broadcastToUser(userId: number, event: WsEvent) {
      const conns = userConnections.get(userId);
      if (!conns) return;
      const data = JSON.stringify(event);
      for (const ws of conns) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        if (ws.bufferedAmount > maxBufferedBytes) {
          if (!slow.has(ws)) {
            slow.add(ws);
            logger.warn(`[ws] slow client for user ${userId}: ${ws.bufferedAmount} bytes unsent, skipping messages until it drains`);
          }
          continue;
        }
        slow.delete(ws);
        ws.send(data);
      }
    },

    clientCount() {
      return wss.clients.size;
    },

    close() {
      clearInterval(heartbeat);
      userConnections.clear();
      wss.close();
    },
  };
}
