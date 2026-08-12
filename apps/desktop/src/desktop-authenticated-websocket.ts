import type { BbRealtimeSocket, BbRealtimeSocketFactory } from "@bb/sdk";

interface CreateDesktopAuthenticatedWebsocketFactoryArgs {
  headers(url: string): Promise<Record<string, string> | undefined>;
}

interface ElectronNodeWebSocketConstructor {
  new (url: string, options?: WebSocketInit): WebSocket;
}

function openElectronNodeWebSocket(
  url: string,
  headers: Record<string, string> | undefined,
): WebSocket {
  // Electron's Node runtime supports Undici's WebSocketInit extension, while
  // Electron's ambient DOM declaration exposes only the browser overload.
  const WebSocketWithHeaders = WebSocket as ElectronNodeWebSocketConstructor;
  return new WebSocketWithHeaders(url, headers ? { headers } : undefined);
}

export function createDesktopAuthenticatedWebsocketFactory(
  args: CreateDesktopAuthenticatedWebsocketFactoryArgs,
): BbRealtimeSocketFactory {
  return (url) => {
    let socket: WebSocket | null = null;
    let closed = false;
    let closeEmitted = false;

    const emitClose = (): void => {
      if (closeEmitted) {
        return;
      }
      closeEmitted = true;
      adapter.onclose?.();
    };
    const adapter: BbRealtimeSocket = {
      close() {
        if (closed) {
          return;
        }
        closed = true;
        if (socket === null) {
          emitClose();
          return;
        }
        socket.close();
      },
      onclose: null,
      onerror: null,
      onmessage: null,
      onopen: null,
      get readyState() {
        return (
          socket?.readyState ??
          (closed ? WebSocket.CLOSED : WebSocket.CONNECTING)
        );
      },
      send(data) {
        if (socket === null) {
          throw new Error("WebSocket opened before authentication completed");
        }
        socket.send(data);
      },
    };

    void args.headers(url).then(
      (headers) => {
        if (closed) {
          return;
        }
        socket = openElectronNodeWebSocket(url, headers);
        socket.onopen = () => adapter.onopen?.();
        socket.onmessage = (event) => adapter.onmessage?.({ data: event.data });
        socket.onclose = emitClose;
        socket.onerror = () => adapter.onerror?.();
      },
      () => {
        if (closed) {
          return;
        }
        adapter.onerror?.();
        if (!closed) {
          adapter.close();
        }
      },
    );

    return adapter;
  };
}
