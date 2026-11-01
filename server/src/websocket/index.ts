import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { Server } from 'http';
import type { WsEvent } from '../types/index.js';
import { WS_EVENTS } from '../utils/constants.js';
import { verifyUserToken } from '../utils/jwt.js';
import type { DbUser } from '../db/index.js';
import logger from '../utils/logger.js';

export interface WsServerOptions {
  /** Ping interval. A client that does not answer one ping before the next is terminated. */
  heartbeatMs?: number;
  /** A client with more unsent bytes than this does not get new messages. */
  maxBufferedBytes?: number;
  /** Time for the client to send its auth message. Default: 5000 ms. */
  authTimeoutMs?: number;
}

export const WS_DEFAULTS = {
  HEARTBEAT_MS: 30_000,
  AUTH_TIMEOUT_MS: 5_000,
  MAX_BUFFERED_BYTES: 1024 * 1024,
} as const;

export interface WsBroadcaster {
  broadcast(event: WsEvent): void; // Used by per-user wrappers in bot-manager
  broadcastToUser(userId: number, event: WsEvent): void;
  clientCount(): number;
  close(): void;
}

const WS_UNAUTHORIZED = 4001;
const MAX_AUTH_MESSAGE_BYTES = 4096;

/**
 * Reads the first client message: {"type":"auth","token":"<JWT>"}.
 * The token is not in the URL, so proxy access logs do not record it.
 * Only user JWTs are accepted. The master API_KEY does not work here.
 */
function authenticate(data: RawData, jwtSecret: string, getUser: (id: number) => DbUser | null): number | null {
  const text = data.toString();
  if (text.length > MAX_AUTH_MESSAGE_BYTES) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(text);
  } catch {
    return null;
  }
  const { type, token } = (msg ?? {}) as { type?: unknown; token?: unknown };
  if (type !== 'auth' || typeof token !== 'string') return null;
  return verifyUserToken(token, jwtSecret, getUser)?.id ?? null;
}

export function createWsServer(
  server: Server,
  jwtSecret: string,
  getUser: (id: number) => DbUser | null,
  options: WsServerOptions = {},
): WsBroadcaster {
  const heartbeatMs = options.heartbeatMs ?? WS_DEFAULTS.HEARTBEAT_MS;
  const maxBufferedBytes = options.maxBufferedBytes ?? WS_DEFAULTS.MAX_BUFFERED_BYTES;
  const authTimeoutMs = options.authTimeoutMs ?? WS_DEFAULTS.AUTH_TIMEOUT_MS;
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
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

  function remove(userId: number, ws: WebSocket) {
    const conns = userConnections.get(userId);
    if (conns) {
      conns.delete(ws);
      if (conns.size === 0) userConnections.delete(userId);
    }
  }

  wss.on('connection', (ws) => {
    // An unauthenticated socket also gets pings, so a dead peer is removed.
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));
    // The client must authenticate in time. Code 4001 tells the client to log out.
    const timer = setTimeout(() => ws.close(WS_UNAUTHORIZED, 'Unauthorized'), authTimeoutMs);
    ws.on('error', () => { /* the close handler cleans up */ });

    ws.once('message', (data) => {
      clearTimeout(timer);
      const userId = authenticate(data, jwtSecret, getUser);
      if (userId === null) {
        ws.close(WS_UNAUTHORIZED, 'Unauthorized');
        return;
      }
      if (ws.readyState !== WebSocket.OPEN) return;

      if (!userConnections.has(userId)) userConnections.set(userId, new Set());
      userConnections.get(userId)!.add(ws);
      ws.on('close', () => remove(userId, ws));
      ws.send(JSON.stringify({ type: WS_EVENTS.CONNECTED, data: { timestamp: Date.now() } }));
    });

    ws.on('close', () => clearTimeout(timer));
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
