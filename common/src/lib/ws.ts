// client/src/lib/ws.ts
import { useEffect, useRef } from 'react';

type WsEventHandler = (event: { type: string; data: unknown }) => void;

let sharedWs: WebSocket | null = null;
let refCount = 0;
const handlers = new Set<WsEventHandler>();

function connect() {
  if (sharedWs && sharedWs.readyState <= WebSocket.OPEN) return;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // The token goes in the first message, not in the URL. Proxies log URLs.
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

  ws.onopen = () => {
    const token = localStorage.getItem('token');
    if (token) ws.send(JSON.stringify({ type: 'auth', token }));
    console.log('[ws] connected');
  };

  ws.onmessage = (msg) => {
    const event = JSON.parse(msg.data);
    console.log('[ws] event:', event.type);
    handlers.forEach((h) => h(event));
  };

  ws.onerror = () => {
    // Silently close — reconnect handled by onclose
  };

  ws.onclose = () => {
    sharedWs = null;
    if (refCount > 0) setTimeout(connect, 3000);
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
      if (refCount === 0 && sharedWs) {
        if (sharedWs.readyState === WebSocket.OPEN) sharedWs.close();
        sharedWs = null;
      }
    };
  }, []);
}
