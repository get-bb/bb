/**
 * Runtime-agnostic socket shape the realtime manager drives. The default
 * factory adapts the global WebSocket (React Native's, or Node's in tests);
 * tests inject a fake.
 */
export interface RealtimeSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  /**
   * React Native's WebSocket reports the failure reason here (e.g. "Received
   * bad response code from server 401"); the DOM event has no message.
   */
  onerror: ((event: RealtimeSocketErrorEvent) => void) | null;
}

export interface RealtimeSocketErrorEvent {
  message: string | null;
}

/** `WebSocket.OPEN` without touching the global. */
export const SOCKET_OPEN = 1;

export interface RealtimeSocketOptions {
  /** Extra request headers for the upgrade (React Native supports these). */
  headers: Record<string, string>;
}

export type RealtimeSocketFactory = (
  url: string,
  options: RealtimeSocketOptions,
) => RealtimeSocketLike;

// React Native's WebSocket accepts a third `options` argument (headers); the
// lib.dom declaration does not, so widen the constructor at this one boundary.
type WebSocketWithOptionsConstructor = new (
  url: string,
  protocols?: string | string[] | null,
  options?: { headers?: Record<string, string> },
) => WebSocket;

/** React Native attaches `message` to its WebSocket error events. */
function socketErrorMessage(event: unknown): string | null {
  if (typeof event !== "object" || event === null) return null;
  const message = (event as { message?: unknown }).message;
  return typeof message === "string" && message.length > 0 ? message : null;
}

export const defaultRealtimeSocketFactory: RealtimeSocketFactory = (
  url,
  options,
) => {
  const hasHeaders = Object.keys(options.headers).length > 0;
  const socket = hasHeaders
    ? new (WebSocket as unknown as WebSocketWithOptionsConstructor)(url, null, {
        headers: options.headers,
      })
    : new WebSocket(url);
  const adapter: RealtimeSocketLike = {
    onclose: null,
    onerror: null,
    onmessage: null,
    onopen: null,
    get readyState() {
      return socket.readyState;
    },
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
  };
  socket.onopen = () => adapter.onopen?.();
  socket.onmessage = (event) => adapter.onmessage?.({ data: event.data });
  socket.onclose = (event) =>
    adapter.onclose?.({ code: event.code, reason: event.reason });
  socket.onerror = (event) =>
    adapter.onerror?.({ message: socketErrorMessage(event) });
  return adapter;
};
