// client/src/lib/ws.ts
import { useEffect, useRef } from 'react';
import { useAuthStore } from '../stores/auth';

type WsEventHandler = (event: { type: string; data: unknown }) => void;

/** Close code the server sends when the token is missing, invalid or expired. */
export const WS_CLOSE_UNAUTHORIZED = 4001;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

let sharedWs: WebSocket | null = null;
let refCount = 0;
let attempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const handlers = new Set<WsEventHandler>();

/**
 * Delay before reconnect number `attempt` (0-based): exponential backoff with
 * a cap, and "equal jitter" so that many tabs do not reconnect at the same
 * time after a server restart.
 */
export function reconnectDelay(attemptNo: number, random: () => number = Math.random): number {
  const ceiling = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attemptNo);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

function scheduleReconnect() {
  if (reconnectTimer || refCount === 0) return;
  const delay = reconnectDelay(attempt);
  attempt++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (refCount > 0) connect();
  }, delay);
}

function connect() {
  if (sharedWs && sharedWs.readyState <= WebSocket.OPEN) return;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // The token goes in the first message, not in the URL. Proxies log URLs.
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

  ws.onopen = () => {
    attempt = 0;
    // Without a token the server closes the socket with 4001 after its auth
    // timeout. onclose then logs out.
    const token = useAuthStore.getState().token;
    if (token) ws.send(JSON.stringify({ type: 'auth', token }));
  };

  ws.onmessage = (msg) => {
    let event: { type: string; data: unknown };
    try {
      event = JSON.parse(msg.data);
    } catch {
      return;
    }
    handlers.forEach((h) => h(event));
  };

  ws.onerror = () => {
    // Silently close — reconnect handled by onclose
  };

  ws.onclose = (ev) => {
    if (sharedWs === ws) sharedWs = null;
    if (ev.code === WS_CLOSE_UNAUTHORIZED) {
      // The token is not valid. A reconnect can never succeed, so log out
      // and go to the login page, the same as an HTTP 401 does.
      useAuthStore.getState().logout();
      if (window.location.pathname !== '/login') window.location.href = '/login';
      return;
    }
    scheduleReconnect();
  };

  sharedWs = ws;
}

export function useWebSocket(onEvent: WsEventHandler) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    const handler: WsEventHandler = (event) => handlerRef.current(event);
    handlers.add(handler);
    refCount++;
    connect();

    return () => {
      handlers.delete(handler);
      refCount--;
      if (refCount === 0) {
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        attempt = 0;
        if (sharedWs) {
          const ws = sharedWs;
          sharedWs = null;
          if (ws.readyState === WebSocket.OPEN) ws.close();
        }
      }
    };
  }, []);
}
