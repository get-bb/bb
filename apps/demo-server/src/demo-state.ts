import { DemoWorld } from "./demo-world.js";

function parseWebSocketText(data: MessageEvent["data"]): string | null {
  if (Object.prototype.toString.call(data) !== "[object String]") return null;
  return String(data);
}

export class DemoStateDO {
  private readonly world = new DemoWorld();
  private readonly sockets = new Set<WebSocket>();

  constructor() {
    this.world.onChanged((message) => {
      const raw = JSON.stringify(message);
      for (const socket of this.sockets) {
        try {
          socket.send(raw);
        } catch {
          this.sockets.delete(socket);
        }
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.replace(/\/+$/u, "") === "/ws") {
      return this.handleWebSocket(request);
    }
    return this.world.handle(request);
  }

  private handleWebSocket(request: Request): Response {
    if (request.headers.get("upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sockets.add(server);
    server.addEventListener("close", () => this.sockets.delete(server));
    server.addEventListener("error", () => this.sockets.delete(server));
    server.addEventListener("message", (event) => {
      const message = parseWebSocketText(event.data);
      if (message === null) return;
      const reply = this.world.socketReply(message);
      if (reply !== null) server.send(reply);
    });
    return new Response(null, { status: 101, webSocket: client });
  }
}
