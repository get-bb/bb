import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { server } from "@bb/connect-db";
import {
  HEARTBEAT_REQUEST,
  HEARTBEAT_RESPONSE,
  decodeFrame,
  encodeFrame,
  type Frame,
  type HeaderPair,
} from "@bb/tunnel-contract";

export interface Env {
  TUNNEL_DO: DurableObjectNamespace;
  DB: D1Database;
  BASE_DOMAIN: string;
  BETTER_AUTH_SECRET: string;
}

const TUNNEL_TAG = "tunnel";
const RESP_HEAD_TIMEOUT_MS = 30_000;
// Refresh the server's last_seen_at while a tunnel is connected so the
// dashboard shows accurate presence. Alarm-driven (auto-response pings don't
// run JS), kept under the 90s offline window.
const PRESENCE_INTERVAL_MS = 50_000;

/** Headers that must not be forwarded in either direction. */
const HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "expect",
  "host",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-extensions",
]);

function forwardableHeaders(headers: Headers): HeaderPair[] {
  const pairs: HeaderPair[] = [];
  headers.forEach((value, name) => {
    if (!HOP_HEADERS.has(name.toLowerCase())) pairs.push([name, value]);
  });
  return pairs;
}

interface PendingHttp {
  resolve: (response: Response) => void;
  /** Set once resp-head arrives and the body stream exists. */
  writer: WritableStreamDefaultWriter<Uint8Array> | null;
  /** Serializes body writes so chunk order is preserved without blocking the socket handler. */
  writeChain: Promise<void>;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * One TunnelDO instance per handle. The tunnel client (the user's machine)
 * holds one WebSocket tagged `tunnel`; each visitor WebSocket is tagged
 * `visitor:<streamId>` with the id also in its attachment so the mapping
 * survives hibernation. In-flight HTTP requests live in instance memory only —
 * an in-flight request keeps the DO active, so that state cannot be lost to
 * hibernation while it matters.
 */
export class TunnelDO {
  private readonly pendingHttp = new Map<number, PendingHttp>();
  private nextStreamId: number;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {
    // Resume stream-id allocation above any visitor sockets that survived
    // hibernation so ids are never reused while a socket still holds one.
    let maxSeen = 0;
    for (const ws of this.state.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as { streamId?: number } | null;
      if (attachment?.streamId && attachment.streamId > maxSeen) maxSeen = attachment.streamId;
    }
    this.nextStreamId = maxSeen + 1;
    this.state.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(HEARTBEAT_REQUEST, HEARTBEAT_RESPONSE),
    );
  }

  fetch(request: Request): Response | Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/__tunnel") {
      return this.acceptTunnel(request, url.searchParams.get("serverId"));
    }
    // Internal control channel — only reachable via the cross-script DO binding
    // (the gate rejects external /__ paths). Used to sever a live tunnel the
    // instant the owner revokes, without waiting for a reconnect.
    if (url.pathname === "/__control/close") {
      for (const ws of this.state.getWebSockets(TUNNEL_TAG)) ws.close(1000, "revoked by owner");
      void this.state.storage.delete("serverId");
      return new Response(null, { status: 204 });
    }

    const tunnel = this.tunnelSocket();
    if (!tunnel) {
      return new Response("bb connect: this server is offline (no tunnel connected)\n", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      return this.openVisitorWebSocket(request, url, tunnel);
    }
    return this.proxyHttp(request, url, tunnel);
  }

  private tunnelSocket(): WebSocket | null {
    return this.state.getWebSockets(TUNNEL_TAG)[0] ?? null;
  }

  /** Bump the server's last_seen_at in D1 (presence for the dashboard). */
  private async markPresence(): Promise<void> {
    const serverId = await this.state.storage.get<string>("serverId");
    if (!serverId) return;
    try {
      await drizzle(this.env.DB)
        .update(server)
        .set({ lastSeenAt: new Date() })
        .where(eq(server.id, serverId))
        .run();
    } catch {
      // presence is best-effort; never break the tunnel over it
    }
  }

  /** Alarm loop: refresh presence while the tunnel is connected. */
  async alarm(): Promise<void> {
    if (!this.tunnelSocket()) {
      await this.state.storage.delete("serverId");
      return;
    }
    await this.markPresence();
    await this.state.storage.setAlarm(Date.now() + PRESENCE_INTERVAL_MS);
  }

  private acceptTunnel(request: Request, serverId: string | null): Response {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    // Single tunnel per handle: a reconnect replaces the previous socket.
    for (const existing of this.state.getWebSockets(TUNNEL_TAG)) {
      existing.close(1000, "replaced by a new tunnel connection");
    }
    if (serverId) {
      void this.state.storage.put("serverId", serverId);
      void this.markPresence();
      void this.state.storage.setAlarm(Date.now() + PRESENCE_INTERVAL_MS);
    }
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1], [TUNNEL_TAG]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private openVisitorWebSocket(request: Request, url: URL, tunnel: WebSocket): Response {
    const streamId = this.nextStreamId++;
    const protocols =
      request.headers
        .get("sec-websocket-protocol")
        ?.split(",")
        .map((p) => p.trim())
        .filter(Boolean) ?? [];

    const pair = new WebSocketPair();
    pair[1].serializeAttachment({ streamId });
    this.state.acceptWebSocket(pair[1], [`visitor:${streamId}`]);

    tunnel.send(
      encodeFrame({
        type: "open-ws",
        streamId,
        path: url.pathname + url.search,
        headers: forwardableHeaders(request.headers),
        protocols,
      }),
    );

    const responseHeaders = new Headers();
    if (protocols.length > 0) {
      // TODO(M2): carry the origin's negotiated subprotocol back through
      // ws-open-ack before answering the upgrade. The spike echoes the first
      // offer, which is correct for every current bb client (they offer one).
      responseHeaders.set("sec-websocket-protocol", protocols[0]);
    }
    return new Response(null, { status: 101, webSocket: pair[0], headers: responseHeaders });
  }

  private async proxyHttp(request: Request, url: URL, tunnel: WebSocket): Promise<Response> {
    const streamId = this.nextStreamId++;
    const hasBody = request.body !== null;

    const responsePromise = new Promise<Response>((resolve) => {
      const timeout = setTimeout(() => {
        this.failHttpStream(streamId, 504, "timed out waiting for the tunnel client");
      }, RESP_HEAD_TIMEOUT_MS);
      this.pendingHttp.set(streamId, {
        resolve,
        writer: null,
        writeChain: Promise.resolve(),
        timeout,
      });
    });

    tunnel.send(
      encodeFrame({
        type: "open-http",
        streamId,
        method: request.method,
        path: url.pathname + url.search,
        headers: forwardableHeaders(request.headers),
        hasBody,
      }),
    );

    if (hasBody) {
      void this.pumpRequestBody(streamId, request.body!, tunnel);
    }
    return responsePromise;
  }

  private async pumpRequestBody(
    streamId: number,
    body: ReadableStream<Uint8Array>,
    tunnel: WebSocket,
  ): Promise<void> {
    try {
      const reader = body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        // Frames cap at MAX_CHUNK_BYTES; reader chunks are far smaller in
        // practice, but split defensively.
        for (let offset = 0; offset < value.length; offset += 1024 * 1024) {
          tunnel.send(
            encodeFrame({
              type: "body-chunk",
              streamId,
              data: value.subarray(offset, offset + 1024 * 1024),
            }),
          );
        }
      }
      tunnel.send(encodeFrame({ type: "body-end", streamId }));
    } catch {
      tunnel.send(
        encodeFrame({ type: "close-stream", streamId, code: 1011, reason: "request body error" }),
      );
    }
  }

  private failHttpStream(streamId: number, status: number, message: string): void {
    const entry = this.pendingHttp.get(streamId);
    if (!entry) return;
    this.pendingHttp.delete(streamId);
    clearTimeout(entry.timeout);
    if (entry.writer) {
      void entry.writeChain.then(() => entry.writer?.abort(message)).catch(() => {});
    } else {
      entry.resolve(
        new Response(`bb connect: ${message}\n`, {
          status,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
      );
    }
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    const tags = this.state.getTags(ws);
    if (tags.includes(TUNNEL_TAG)) {
      if (typeof message === "string") return; // heartbeats are auto-responded; ignore other text
      this.onTunnelFrame(decodeFrame(message));
      return;
    }
    // Visitor socket → wrap into a ws-data frame toward the tunnel client.
    const attachment = ws.deserializeAttachment() as { streamId: number };
    const tunnel = this.tunnelSocket();
    if (!tunnel) {
      ws.close(1011, "tunnel disconnected");
      return;
    }
    const isBinary = typeof message !== "string";
    tunnel.send(
      encodeFrame({
        type: "ws-data",
        streamId: attachment.streamId,
        isBinary,
        data: isBinary ? new Uint8Array(message) : new TextEncoder().encode(message),
      }),
    );
  }

  private onTunnelFrame(frame: Frame): void {
    switch (frame.type) {
      case "resp-head": {
        const entry = this.pendingHttp.get(frame.streamId);
        if (!entry) return;
        clearTimeout(entry.timeout);
        const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
        entry.writer = writable.getWriter();
        entry.resolve(
          new Response(readable, {
            status: frame.status,
            headers: frame.headers.filter(([name]) => !HOP_HEADERS.has(name.toLowerCase())),
          }),
        );
        return;
      }
      case "body-chunk": {
        const entry = this.pendingHttp.get(frame.streamId);
        if (!entry?.writer) return;
        // Copy out of the transient message buffer before queueing the write.
        const copy = frame.data.slice();
        entry.writeChain = entry.writeChain
          .then(() => entry.writer!.write(copy))
          .catch(() => {});
        return;
      }
      case "body-end": {
        const entry = this.pendingHttp.get(frame.streamId);
        if (!entry) return;
        this.pendingHttp.delete(frame.streamId);
        entry.writeChain = entry.writeChain.then(() => entry.writer?.close()).catch(() => {});
        return;
      }
      case "close-stream": {
        if (this.pendingHttp.has(frame.streamId)) {
          this.failHttpStream(frame.streamId, 502, `tunnel client aborted: ${frame.reason}`);
        } else {
          this.visitorSocket(frame.streamId)?.close(safeCloseCode(frame.code), frame.reason);
        }
        return;
      }
      case "ws-data": {
        const visitor = this.visitorSocket(frame.streamId);
        if (!visitor) return;
        visitor.send(frame.isBinary ? frame.data : new TextDecoder().decode(frame.data));
        return;
      }
      case "ws-open-ack":
        // The upgrade was already answered (see openVisitorWebSocket TODO).
        return;
      case "open-http":
      case "open-ws":
        // Streams are only opened by the relay side; ignore.
        return;
    }
  }

  private visitorSocket(streamId: number): WebSocket | null {
    return this.state.getWebSockets(`visitor:${streamId}`)[0] ?? null;
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    const tags = this.state.getTags(ws);
    if (tags.includes(TUNNEL_TAG)) {
      // Only react if this socket is still the active tunnel (a replaced
      // socket closing must not tear down the new tunnel's visitors).
      if (this.tunnelSocket() !== null) return;
      for (const streamId of [...this.pendingHttp.keys()]) {
        this.failHttpStream(streamId, 502, "tunnel disconnected mid-request");
      }
      for (const visitor of this.state.getWebSockets()) {
        if (!this.state.getTags(visitor).includes(TUNNEL_TAG)) {
          visitor.close(1001, "tunnel disconnected");
        }
      }
      return;
    }
    const attachment = ws.deserializeAttachment() as { streamId: number };
    this.tunnelSocket()?.send(
      encodeFrame({
        type: "close-stream",
        streamId: attachment.streamId,
        code: safeCloseCode(code),
        reason,
      }),
    );
    // Complete the close handshake on the visitor socket (a client-initiated
    // close is delivered to this handler without the runtime echoing it).
    try {
      ws.close(safeCloseCode(code), reason);
    } catch {
      // already closed
    }
  }

  webSocketError(ws: WebSocket): void {
    this.webSocketClose(ws, 1011, "socket error");
  }
}

/** Clamp arbitrary close codes to ones close() is allowed to send. */
function safeCloseCode(code: number): number {
  return code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000;
}
