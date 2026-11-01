import { WebSocketServer, WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'http';
import type { WsEvent } from '../types/index.js';
import { WS_EVENTS } from '../utils/constants.js';
import { verifyUserToken } from '../utils/jwt.js';
import { safeEqual } from '../middleware/auth.js';
import type { DbUser } from '../db/index.js';

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

export function createWsServer(server: Server, jwtSecret: string, apiKey: string, getUser: (id: number) => DbUser | null): WsBroadcaster {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const userConnections = new Map<number, Set<WebSocket>>();

  wss.on('connection', (ws, req) => {
    const auth = authenticateWs(req, jwtSecret, apiKey, getUser);
    if (!auth.authenticated || auth.userId === undefined) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const userId = auth.userId;
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
