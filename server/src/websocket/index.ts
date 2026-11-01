import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { Server } from 'http';
import type { WsEvent } from '../types/index.js';
import { WS_EVENTS } from '../utils/constants.js';
import { verifyUserToken } from '../utils/jwt.js';
import type { DbUser } from '../db/index.js';

export interface WsBroadcaster {
  broadcast(event: WsEvent): void; // Used by per-user wrappers in bot-manager
  broadcastToUser(userId: number, event: WsEvent): void;
  clientCount(): number;
  close(): void;
}

export interface WsOptions {
  /** Time for the client to send its auth message. Default: 5000 ms. */
  authTimeoutMs?: number;
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
  options: WsOptions = {},
): WsBroadcaster {
  const authTimeoutMs = options.authTimeoutMs ?? 5000;
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
  const userConnections = new Map<number, Set<WebSocket>>();

  function remove(userId: number, ws: WebSocket) {
    const conns = userConnections.get(userId);
    if (conns) {
      conns.delete(ws);
      if (conns.size === 0) userConnections.delete(userId);
    }
  }

  wss.on('connection', (ws) => {
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
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      }
    },

    clientCount() {
      return wss.clients.size;
    },

    close() {
      userConnections.clear();
      wss.close();
    },
  };
}
