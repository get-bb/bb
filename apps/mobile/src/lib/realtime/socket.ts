export type RealtimeMessageData = string | ArrayBuffer;

export interface RealtimeSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: RealtimeMessageData }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: RealtimeSocketErrorEvent) => void) | null;
}

export interface RealtimeSocketErrorEvent {
  message: string | null;
}

export const SOCKET_OPEN = 1;

export interface RealtimeSocketOptions {
  headers: Record<string, string>;
}

export type RealtimeSocketFactory = (
  url: string,
  options: RealtimeSocketOptions,
) => RealtimeSocketLike;

const socketErrorEventSchema = z.object({ message: z.string() });

function socketErrorMessage(cause: unknown): string | null {
  const parsed = socketErrorEventSchema.safeParse(cause);
  return parsed.success && parsed.data.message.length > 0
    ? parsed.data.message
    : null;
}

export const defaultRealtimeSocketFactory: RealtimeSocketFactory = (
  url,
  options,
) => {
  const hasHeaders = Object.keys(options.headers).length > 0;
  const socket: WebSocket = hasHeaders
    ? Reflect.construct(WebSocket, [url, null, { headers: options.headers }])
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
import { z } from "zod";
