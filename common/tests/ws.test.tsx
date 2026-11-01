import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useWebSocket, reconnectDelay, WS_CLOSE_UNAUTHORIZED } from '../src/lib/ws';
import { useAuthStore } from '../src/stores/auth';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** Minimal stand-in for the browser WebSocket. Tests drive its events. */
class FakeWebSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(public url: string) { FakeWebSocket.instances.push(this); }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = FakeWebSocket.CLOSED; }
  serverOpen() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  serverClose(code: number) { this.readyState = FakeWebSocket.CLOSED; this.onclose?.({ code }); }
}

let root: Root;
let container: HTMLElement;

function mount(onEvent = vi.fn()) {
  function Probe() { useWebSocket(onEvent); return null; }
  act(() => { root.render(createElement(Probe)); });
  return onEvent;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  // jsdom cannot navigate. A plain object records the redirect instead.
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:5173', pathname: '/', href: 'http://localhost:5173/' });
  container = document.createElement('div');
  root = createRoot(container);
  useAuthStore.setState({ token: 'tok-123' });
});

afterEach(() => {
  act(() => { root.unmount(); });
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('reconnectDelay', () => {
  it('doubles the ceiling for each attempt', () => {
    const max = () => 1; // upper end of the jitter range
    expect([0, 1, 2, 3].map((a) => reconnectDelay(a, max))).toEqual([1000, 2000, 4000, 8000]);
  });

  it('never waits more than 30 seconds', () => {
    expect(reconnectDelay(20, () => 1)).toBe(30_000);
  });

  it('keeps at least half of the ceiling (equal jitter)', () => {
    expect(reconnectDelay(3, () => 0)).toBe(4000);
  });
});

describe('useWebSocket', () => {
  it('does not put the token in the URL', () => {
    mount();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toBe('ws://localhost:5173/ws');
    expect(FakeWebSocket.instances[0].url).not.toContain('tok-123');
  });

  it('sends the token in the first message after the socket opens', () => {
    mount();
    const ws = FakeWebSocket.instances[0];
    expect(ws.sent).toEqual([]);
    ws.serverOpen();
    expect(ws.sent.map((s) => JSON.parse(s))).toEqual([{ type: 'auth', token: 'tok-123' }]);
  });

  it('passes server events to the handler', () => {
    const onEvent = mount();
    const ws = FakeWebSocket.instances[0];
    ws.serverOpen();
    ws.onmessage?.({ data: JSON.stringify({ type: 'tick:complete', data: 1 }) });
    ws.onmessage?.({ data: 'not json' });
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ type: 'tick:complete', data: 1 });
  });

  it('reconnects with backoff after an unexpected close', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    mount();
    FakeWebSocket.instances[0].serverClose(1006);
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    // The second failure waits longer.
    FakeWebSocket.instances[1].serverClose(1006);
    vi.advanceTimersByTime(1999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('resets the backoff after a successful open', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    mount();
    FakeWebSocket.instances[0].serverClose(1006);
    vi.advanceTimersByTime(1000);
    FakeWebSocket.instances[1].serverOpen();
    FakeWebSocket.instances[1].serverClose(1006);
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('logs out and does not reconnect when the server rejects the token (4001)', () => {
    const logout = vi.spyOn(useAuthStore.getState(), 'logout');
    useAuthStore.setState({ logout });
    mount();
    FakeWebSocket.instances[0].serverClose(WS_CLOSE_UNAUTHORIZED);
    vi.advanceTimersByTime(60_000);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe('/login');
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('closes the socket and cancels a pending reconnect on unmount', () => {
    mount();
    FakeWebSocket.instances[0].serverClose(1006);
    act(() => { root.unmount(); });
    // No reconnect timer may stay behind after the last component unmounts.
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    root = createRoot(container); // afterEach unmounts again
  });

  it('shares one socket between components', () => {
    function Two() { useWebSocket(() => {}); useWebSocket(() => {}); return null; }
    act(() => { root.render(createElement(Two)); });
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
