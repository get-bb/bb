import {
  defaultRealtimeSocketFactory,
  type RealtimeSocketFactory,
  type RealtimeSocketLike,
} from "../realtime/socket";

const SOCKET_CONNECTING = 0;
const SOCKET_CLOSED = 3;

export function createTicketSocketFactory(args: {
  resolveUrl: (url: string) => Promise<string> | null;
  socketFactory?: RealtimeSocketFactory;
}): RealtimeSocketFactory {
  const socketFactory = args.socketFactory ?? defaultRealtimeSocketFactory;
  return (url) => {
    const resolving = args.resolveUrl(url);
    if (resolving === null) return socketFactory(url);
    let inner: RealtimeSocketLike | null = null;
    let closed = false;
    const adapter: RealtimeSocketLike = {
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      get readyState() {
        if (inner !== null) return inner.readyState;
        return closed ? SOCKET_CLOSED : SOCKET_CONNECTING;
      },
      send(data) {
        inner?.send(data);
      },
      close(code, reason) {
        closed = true;
        inner?.close(code, reason);
      },
    };
    resolving.then(
      (resolvedUrl) => {
        if (closed) return;
        const socket = socketFactory(resolvedUrl);
        inner = socket;
        socket.onopen = () => adapter.onopen?.();
        socket.onmessage = (event) => adapter.onmessage?.(event);
        socket.onclose = (event) => adapter.onclose?.(event);
        socket.onerror = (event) => adapter.onerror?.(event);
      },
      (error: unknown) => {
        if (closed) return;
        closed = true;
        adapter.onerror?.({
          message: error instanceof Error ? error.message : String(error),
        });
        adapter.onclose?.({ code: 4401, reason: "realtime ticket refused" });
      },
    );
    return adapter;
  };
}
