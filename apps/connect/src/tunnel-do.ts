import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { machine, server } from "@bb/connect-db";
import {
  HEARTBEAT_REQUEST,
  HEARTBEAT_RESPONSE,
  TUNNEL_PROTOCOL_QUERY_PARAM,
  decodeFrame,
  encodeFrame,
  type Frame,
  type HeaderPair,
} from "@bb/tunnel-contract";
import { relayedResponse } from "./response-encoding.js";
import { TUNNEL_TARGET_HEADER } from "./protocol-headers.js";

export interface Env {
  TUNNEL_DO: DurableObjectNamespace;
  DB: D1Database;
  BASE_DOMAIN: string;
  BETTER_AUTH_SECRET: string;
  ACCOUNT_APP_URL?: string;
  CLOUD_DEV?: string;
  /**
   * Android signing-cert SHA-256 fingerprints for `/.well-known/assetlinks.json`
   * (comma-separated). Unset → the file serves an empty list (iOS universal
   * links are unaffected).
   */
  ASSETLINKS_SHA256_FINGERPRINTS?: string;
}

const TUNNEL_TAG = "tunnel";
const RESP_HEAD_TIMEOUT_MS = 30_000;
// Refresh the server's last_seen_at while a tunnel is connected so the
// dashboard shows accurate presence. Alarm-driven (auto-response pings don't
// run JS), kept under the 90s offline window.
const PRESENCE_INTERVAL_MS = 50_000;

// Standard WebSocket readyState numbering (workerd's READY_STATE_OPEN; the
// constant itself is Cloudflare-only, so tests in Node use the number).
const WS_READY_STATE_OPEN = 1;

/**
 * DO → gate marker on the offline 503. Lets the gate distinguish "no tunnel
 * connected" (infra offline — render the styled page for browser navigations)
 * from an origin app that happens to answer 503 through a live tunnel. The 503
 * body stays plain text; this is a routing hint only.
 */
export const TUNNEL_OFFLINE_HEADER = "x-bb-tunnel-offline";

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
  TUNNEL_TARGET_HEADER,
]);

function forwardableHeaders(headers: Headers): HeaderPair[] {
  const pairs: HeaderPair[] = [];
  headers.forEach((value, name) => {
    if (!HOP_HEADERS.has(name.toLowerCase())) pairs.push([name, value]);
  });
  return pairs;
}

function readTunnelTarget(headers: Headers): string | undefined {
  const value = headers.get(TUNNEL_TARGET_HEADER);
  return value !== null && value !== "" ? value : undefined;
}

/** Parse client protocol version from dial query; missing/unparsable → 0. */
export function parseClientProtocolVersion(raw: string | null): number {
  if (raw === null || raw === "") return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

const PORT_SHARE_TOO_OLD =
  "this bb's connect plugin is too old for port sharing — update bb and reconnect";

interface PendingHttp {
  resolve: (response: Response) => void;
  /** Set once resp-head arrives and the body stream exists. */
  writer: WritableStreamDefaultWriter<Uint8Array> | null;
  /** Serializes body writes so chunk order is preserved without blocking the socket handler. */
  writeChain: Promise<void>;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * One TunnelDO instance per routing label. The tunnel client
 * holds one WebSocket tagged `tunnel`; each visitor WebSocket is tagged
 * `visitor:<streamId>` with the id also in its attachment so the mapping
 * survives hibernation. In-flight HTTP requests live in instance memory only —
 * an in-flight request keeps the DO active, so that state cannot be lost to
 * hibernation while it matters.
 */
export class TunnelDO {
  private readonly pendingHttp = new Map<number, PendingHttp>();
  private nextStreamId: number;
  /** Client protocol version from the dial (`?v=`); 0 = pre-port-sharing. */
  private clientProtocolVersion = 0;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {
    // Resume stream-id allocation above any visitor sockets that survived
    // hibernation so ids are never reused while a socket still holds one.
    let maxSeen = 0;
    for (const ws of this.state.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as {
        streamId?: number;
      } | null;
      if (attachment?.streamId && attachment.streamId > maxSeen)
        maxSeen = attachment.streamId;
    }
    this.nextStreamId = maxSeen + 1;
    this.state.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(HEARTBEAT_REQUEST, HEARTBEAT_RESPONSE),
    );
    // Restore protocol version after hibernation (in-memory is wiped).
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<number>("protocolVersion");
      if (
        typeof stored === "number" &&
        Number.isFinite(stored) &&
        stored >= 0
      ) {
        this.clientProtocolVersion = stored;
      }
    });
  }

  fetch(request: Request): Response | Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/__tunnel") {
      const serverId = url.searchParams.get("serverId");
      const machineId = url.searchParams.get("machineId");
      if (serverId !== null && machineId !== null) {
        return new Response("conflicting tunnel identity", { status: 400 });
      }
      return this.acceptTunnel(
        request,
        serverId,
        machineId,
        parseClientProtocolVersion(
          url.searchParams.get(TUNNEL_PROTOCOL_QUERY_PARAM),
        ),
      );
    }
    // Internal control channel — only reachable via the cross-script DO binding
    // (the gate rejects external /__ paths). Used to sever a live tunnel the
    // instant the owner revokes, without waiting for a reconnect.
    if (url.pathname === "/__control/close") {
      for (const ws of this.state.getWebSockets(TUNNEL_TAG))
        ws.close(1000, "revoked by owner");
      void this.state.storage.delete("serverId");
      void this.state.storage.delete("machineId");
      void this.state.storage.delete("protocolVersion");
      this.clientProtocolVersion = 0;
      return new Response(null, { status: 204 });
    }

    const tunnel = this.tunnelSocket();
    if (!tunnel) {
      return this.offlineResponse();
    }

    const target = readTunnelTarget(request.headers);
    if (target !== undefined && this.clientProtocolVersion < 1) {
      return new Response(`bb connect: ${PORT_SHARE_TOO_OLD}\n`, {
        status: 502,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      return this.openVisitorWebSocket(request, url, tunnel, target);
    }
    return this.proxyHttp(request, url, tunnel, target);
  }

  private tunnelSocket(): WebSocket | null {
    // A tunnel socket can die without webSocketClose ever being delivered
    // (abrupt network drop), leaving it tagged but unusable — send() on it
    // throws. And after a reconnect the runtime can briefly list both the
    // stale socket and the replacement. Pick the most recently accepted OPEN
    // socket; a dead-but-lingering socket must read as "offline", never be
    // proxied to (that turns every visitor request into an uncaught 1101).
    const sockets = this.state.getWebSockets(TUNNEL_TAG);
    for (let i = sockets.length - 1; i >= 0; i--) {
      if (sockets[i].readyState === WS_READY_STATE_OPEN) return sockets[i];
    }
    return null;
  }

  /**
   * send() throws once the socket is closing/closed, and that can race any
   * liveness check. Returns false instead of throwing so callers degrade to
   * their offline path rather than crashing the request.
   */
  private trySend(
    tunnel: WebSocket,
    data: ArrayBuffer | ArrayBufferView | string,
  ): boolean {
    try {
      tunnel.send(data);
      return true;
    } catch {
      return false;
    }
  }

  private offlineResponse(): Response {
    return new Response(
      "bb connect: this server is offline (no tunnel connected)\n",
      {
        status: 503,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          [TUNNEL_OFFLINE_HEADER]: "1",
        },
      },
    );
  }

  /** Bump the connected server or machine's last_seen_at. */
  private async markPresence(): Promise<void> {
    const serverId = await this.state.storage.get<string>("serverId");
    const machineId = await this.state.storage.get<string>("machineId");
    if (!serverId && !machineId) return;
    try {
      const db = drizzle(this.env.DB);
      if (machineId) {
        await db
          .update(machine)
          .set({ lastSeenAt: new Date() })
          .where(and(eq(machine.id, machineId), isNull(machine.revokedAt)))
          .run();
      } else if (serverId) {
        await db
          .update(server)
          .set({ lastSeenAt: new Date() })
          .where(eq(server.id, serverId))
          .run();
      }
    } catch {
      // presence is best-effort; never break the tunnel over it
    }
  }

  /** Alarm loop: refresh presence while the tunnel is connected. */
  async alarm(): Promise<void> {
    if (!this.tunnelSocket()) {
      await this.state.storage.delete("serverId");
      await this.state.storage.delete("machineId");
      await this.state.storage.delete("protocolVersion");
      this.clientProtocolVersion = 0;
      return;
    }
    await this.markPresence();
    await this.state.storage.setAlarm(Date.now() + PRESENCE_INTERVAL_MS);
  }

  private acceptTunnel(
    request: Request,
    serverId: string | null,
    machineId: string | null,
    protocolVersion: number,
  ): Response {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    // Single tunnel per label: a reconnect replaces the previous socket.
    for (const existing of this.state.getWebSockets(TUNNEL_TAG)) {
      try {
        existing.close(1000, "replaced by a new tunnel connection");
      } catch {
        // Already dead — must not block the replacement from connecting.
      }
    }
    // Streams opened over a replaced (or hibernated-away) tunnel belong to
    // the old client session — the connecting client has no state for them,
    // so their frames will never arrive. Fail them now: a mid-body response
    // has no timeout and would otherwise hang its visitor forever.
    this.abandonStreams("tunnel reconnected mid-request", "tunnel reconnected");
    this.clientProtocolVersion = protocolVersion;
    void this.state.storage.put("protocolVersion", protocolVersion);
    if (serverId) {
      void this.state.storage.put("serverId", serverId);
      void this.state.storage.delete("machineId");
      void this.markPresence();
      void this.state.storage.setAlarm(Date.now() + PRESENCE_INTERVAL_MS);
    } else if (machineId) {
      void this.state.storage.put("machineId", machineId);
      void this.state.storage.delete("serverId");
      void this.markPresence();
      void this.state.storage.setAlarm(Date.now() + PRESENCE_INTERVAL_MS);
    }
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1], [TUNNEL_TAG]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private openVisitorWebSocket(
    request: Request,
    url: URL,
    tunnel: WebSocket,
    target: string | undefined,
  ): Response {
    const streamId = this.nextStreamId++;
    const protocols =
      request.headers
        .get("sec-websocket-protocol")
        ?.split(",")
        .map((p) => p.trim())
        .filter(Boolean) ?? [];

    // Send the open frame before accepting the visitor socket: if the tunnel
    // died since the liveness check, answer 503 offline instead of leaving an
    // accepted visitor socket with no stream behind it.
    const opened = this.trySend(
      tunnel,
      encodeFrame({
        type: "open-ws",
        streamId,
        path: url.pathname + url.search,
        headers: forwardableHeaders(request.headers),
        protocols,
        ...(target !== undefined ? { target } : {}),
      }),
    );
    if (!opened) return this.offlineResponse();

    const pair = new WebSocketPair();
    pair[1].serializeAttachment({ streamId });
    this.state.acceptWebSocket(pair[1], [`visitor:${streamId}`]);

    const responseHeaders = new Headers();
    if (protocols.length > 0) {
      // TODO(M2): carry the origin's negotiated subprotocol back through
      // ws-open-ack before answering the upgrade. The spike echoes the first
      // offer, which is correct for every current bb client (they offer one).
      responseHeaders.set("sec-websocket-protocol", protocols[0]);
    }
    return new Response(null, {
      status: 101,
      webSocket: pair[0],
      headers: responseHeaders,
    });
  }

  private async proxyHttp(
    request: Request,
    url: URL,
    tunnel: WebSocket,
    target: string | undefined,
  ): Promise<Response> {
    const streamId = this.nextStreamId++;
    const hasBody = request.body !== null;

    const responsePromise = new Promise<Response>((resolve) => {
      const timeout = setTimeout(() => {
        this.failHttpStream(
          streamId,
          504,
          "timed out waiting for the tunnel client",
        );
      }, RESP_HEAD_TIMEOUT_MS);
      this.pendingHttp.set(streamId, {
        resolve,
        writer: null,
        writeChain: Promise.resolve(),
        timeout,
      });
    });

    const opened = this.trySend(
      tunnel,
      encodeFrame({
        type: "open-http",
        streamId,
        method: request.method,
        path: url.pathname + url.search,
        headers: forwardableHeaders(request.headers),
        hasBody,
        ...(target !== undefined ? { target } : {}),
      }),
    );
    if (!opened) {
      const entry = this.pendingHttp.get(streamId);
      if (entry) {
        this.pendingHttp.delete(streamId);
        clearTimeout(entry.timeout);
      }
      return this.offlineResponse();
    }

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
          const sent = this.trySend(
            tunnel,
            encodeFrame({
              type: "body-chunk",
              streamId,
              data: value.subarray(offset, offset + 1024 * 1024),
            }),
          );
          // Tunnel died mid-body: nothing left to notify — the client session
          // behind this socket is gone and the stream dies with it.
          if (!sent) return;
        }
      }
      this.trySend(tunnel, encodeFrame({ type: "body-end", streamId }));
    } catch {
      this.trySend(
        tunnel,
        encodeFrame({
          type: "close-stream",
          streamId,
          code: 1011,
          reason: "request body error",
        }),
      );
    }
  }

  /** Fail every in-flight stream: pending HTTP answers `status` 502, visitor sockets close. */
  private abandonStreams(httpReason: string, wsReason: string): void {
    for (const streamId of [...this.pendingHttp.keys()]) {
      this.failHttpStream(streamId, 502, httpReason);
    }
    for (const visitor of this.state.getWebSockets()) {
      if (!this.state.getTags(visitor).includes(TUNNEL_TAG)) {
        try {
          visitor.close(1001, wsReason);
        } catch {
          // already closed
        }
      }
    }
  }

  private failHttpStream(
    streamId: number,
    status: number,
    message: string,
  ): void {
    const entry = this.pendingHttp.get(streamId);
    if (!entry) return;
    this.pendingHttp.delete(streamId);
    clearTimeout(entry.timeout);
    if (entry.writer) {
      void entry.writeChain
        .then(() => entry.writer?.abort(message))
        .catch(() => {});
    } else {
      entry.resolve(
        new Response(`bb connect: ${message}\n`, {
          status,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
      );
    }
  }

  private cancelHttpStream(streamId: number, message: string): void {
    const entry = this.pendingHttp.get(streamId);
    if (!entry) return;
    this.pendingHttp.delete(streamId);
    clearTimeout(entry.timeout);
    const tunnel = this.tunnelSocket();
    if (!tunnel) return;
    this.trySend(
      tunnel,
      encodeFrame({
        type: "close-stream",
        streamId,
        code: 1000,
        reason: message,
      }),
    );
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
    const sent = this.trySend(
      tunnel,
      encodeFrame({
        type: "ws-data",
        streamId: attachment.streamId,
        isBinary,
        data: isBinary
          ? new Uint8Array(message)
          : new TextEncoder().encode(message),
      }),
    );
    if (!sent) ws.close(1011, "tunnel disconnected");
  }

  private onTunnelFrame(frame: Frame): void {
    switch (frame.type) {
      case "resp-head": {
        const entry = this.pendingHttp.get(frame.streamId);
        if (!entry) return;
        clearTimeout(entry.timeout);
        const headers = frame.headers.filter(
          ([name]) => !HOP_HEADERS.has(name.toLowerCase()),
        );
        // Null-body statuses must resolve bodiless: Response throws on a
        // stream body for 204/205/304, and a throw here would strand the
        // visitor's request unresolved forever (its timeout is already
        // cleared). Dev servers answer 304 to every ETag revalidation, so
        // this is the common path on a reload, not an edge case. The entry
        // stays until the client's trailing body-end frame clears it.
        if (
          frame.status === 204 ||
          frame.status === 205 ||
          frame.status === 304
        ) {
          entry.resolve(new Response(null, { status: frame.status, headers }));
          return;
        }
        const { readable, writable } = new TransformStream<
          Uint8Array,
          Uint8Array
        >();
        let response: Response;
        try {
          response = relayedResponse(readable, frame.status, headers);
        } catch {
          // Any other unconstructable response (e.g. an out-of-range status):
          // answer 502 rather than leaving the request pending.
          this.pendingHttp.delete(frame.streamId);
          entry.resolve(
            new Response(
              `bb connect: unrelayable origin response (status ${frame.status})\n`,
              {
                status: 502,
                headers: { "content-type": "text/plain; charset=utf-8" },
              },
            ),
          );
          return;
        }
        entry.writer = writable.getWriter();
        void entry.writer.closed.catch(() => {
          this.cancelHttpStream(
            frame.streamId,
            "visitor canceled response body",
          );
        });
        entry.resolve(response);
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
        entry.writeChain = entry.writeChain
          .then(() => entry.writer?.close())
          .catch(() => {});
        return;
      }
      case "close-stream": {
        if (this.pendingHttp.has(frame.streamId)) {
          this.failHttpStream(
            frame.streamId,
            502,
            `tunnel client aborted: ${frame.reason}`,
          );
        } else {
          try {
            this.visitorSocket(frame.streamId)?.close(
              safeCloseCode(frame.code),
              frame.reason,
            );
          } catch {
            // already closed
          }
        }
        return;
      }
      case "ws-data": {
        const visitor = this.visitorSocket(frame.streamId);
        if (!visitor) return;
        try {
          visitor.send(
            frame.isBinary ? frame.data : new TextDecoder().decode(frame.data),
          );
        } catch {
          // Visitor socket died; its close handler tells the client.
        }
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
      // socket closing must not tear down the new tunnel's visitors —
      // acceptTunnel already abandoned the old socket's streams).
      if (this.tunnelSocket() !== null) return;
      this.abandonStreams(
        "tunnel disconnected mid-request",
        "tunnel disconnected",
      );
      return;
    }
    const attachment = ws.deserializeAttachment() as { streamId: number };
    const tunnel = this.tunnelSocket();
    if (tunnel) {
      this.trySend(
        tunnel,
        encodeFrame({
          type: "close-stream",
          streamId: attachment.streamId,
          code: safeCloseCode(code),
          reason,
        }),
      );
    }
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
