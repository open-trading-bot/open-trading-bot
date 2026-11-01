import { WebSocketServer, WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'http';
import type { WsEvent } from '../types/index.js';
import { WS_EVENTS } from '../utils/constants.js';
import { isBlocked } from '../utils/token-blocklist.js';
import jwt from 'jsonwebtoken';

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

function authenticateWs(req: IncomingMessage, jwtSecret: string, apiKey: string): AuthResult {
  const url = new URL(req.url || '', 'http://localhost');
  const token = url.searchParams.get('token');

  if (token) {
    // Try JWT
    try {
      const payload = jwt.verify(token, jwtSecret) as { id: number; username: string; role: string };
      if (isBlocked(payload.id)) return { authenticated: false };
      return { authenticated: true, userId: payload.id };
    } catch { /* not a valid JWT, try as API key */ }

    // Try API key — admin with id 0
    if (token === apiKey) return { authenticated: true, userId: 0 };
  }

  return { authenticated: false };
}

export function createWsServer(server: Server, jwtSecret: string, apiKey: string): WsBroadcaster {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const userConnections = new Map<number, Set<WebSocket>>();

  wss.on('connection', (ws, req) => {
    const auth = authenticateWs(req, jwtSecret, apiKey);
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
