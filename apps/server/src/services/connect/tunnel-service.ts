// Server-hosted connect tunnel. When paired, the server dials the per-handle
// gate, holds an outbound NodeWebSocket, and proxies relayed HTTP/WS streams to its
// own loopback base URL (which serves the SPA + /api + /ws). The server owns
// the tunnel's lifetime and reconnects on restart; `bb connect` (and, later,
// the app) only pair via the /connect routes.
//
// Proxy loop ported from apps/connect/scripts/tunnel-client.mts.
import { WebSocket as NodeWebSocket } from "ws";
import {
  HEARTBEAT_REQUEST,
  HEARTBEAT_RESPONSE,
  chunkBody,
  decodeFrame,
  encodeFrame,
  type Frame,
  type HeaderPair,
  type OpenHttpFrame,
  type OpenWsFrame,
} from "@bb/tunnel-contract";
import type { ConnectStatusResponse } from "@bb/server-contract";
import type { ServerLogger } from "../../types.js";
import {
  clearConnectCredential,
  readConnectCredential,
  writeConnectCredential,
  type ConnectCredential,
} from "./credential-store.js";
import { deriveConnectBaseUrl, redeemConnectCode } from "./redeem.js";

const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_DEADLINE_MS = 60_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const SKIP_REQUEST_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "accept-encoding",
]);

function tunnelUrlForServer(serverUrl: string): string {
  return serverUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/__tunnel";
}

interface HttpStream {
  meta: OpenHttpFrame;
  chunks: Buffer[];
  abort: AbortController;
}
interface WsStream {
  socket: NodeWebSocket;
  buffered: Frame[];
  open: boolean;
}

/** Proxies one live tunnel socket's frames to the loopback origin. */
class TunnelSession {
  private readonly httpStreams = new Map<number, HttpStream>();
  private readonly wsStreams = new Map<number, WsStream>();
  private lastAck = Date.now();
  private heartbeat: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly tunnel: NodeWebSocket,
    private readonly origin: string,
    private readonly logger: ServerLogger,
  ) {}

  start(): void {
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastAck > HEARTBEAT_DEADLINE_MS) {
        this.logger.warn("connect tunnel heartbeat missed; reconnecting");
        this.tunnel.terminate();
        return;
      }
      this.tunnel.send(HEARTBEAT_REQUEST);
    }, HEARTBEAT_INTERVAL_MS);

    this.tunnel.on("message", (data: Buffer, isBinary: boolean) => {
      if (!isBinary) {
        if (data.toString() === HEARTBEAT_RESPONSE) this.lastAck = Date.now();
        return;
      }
      try {
        this.onFrame(decodeFrame(data));
      } catch (e) {
        this.logger.warn({ err: String(e) }, "connect tunnel bad frame");
      }
    });
    this.tunnel.on("close", () => this.dispose());
  }

  dispose(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const s of this.httpStreams.values()) s.abort.abort();
    for (const s of this.wsStreams.values()) s.socket.close(1001, "tunnel closed");
    this.httpStreams.clear();
    this.wsStreams.clear();
  }

  private send(frame: Frame): void {
    if (this.tunnel.readyState === NodeWebSocket.OPEN) {
      this.tunnel.send(encodeFrame(frame));
    }
  }

  private onFrame(frame: Frame): void {
    switch (frame.type) {
      case "open-http": {
        const stream: HttpStream = {
          meta: frame,
          chunks: [],
          abort: new AbortController(),
        };
        this.httpStreams.set(frame.streamId, stream);
        if (!frame.hasBody) void this.executeHttp(frame.streamId, stream);
        return;
      }
      case "body-chunk":
        this.httpStreams.get(frame.streamId)?.chunks.push(Buffer.from(frame.data));
        return;
      case "body-end": {
        const s = this.httpStreams.get(frame.streamId);
        if (s) void this.executeHttp(frame.streamId, s);
        return;
      }
      case "open-ws":
        this.openOriginWs(frame);
        return;
      case "ws-data": {
        const s = this.wsStreams.get(frame.streamId);
        if (!s) return;
        if (!s.open) {
          s.buffered.push(frame);
          return;
        }
        s.socket.send(frame.isBinary ? frame.data : Buffer.from(frame.data).toString());
        return;
      }
      case "close-stream": {
        const h = this.httpStreams.get(frame.streamId);
        if (h) {
          h.abort.abort();
          this.httpStreams.delete(frame.streamId);
          return;
        }
        const w = this.wsStreams.get(frame.streamId);
        if (w) {
          w.socket.close(frame.code, frame.reason);
          this.wsStreams.delete(frame.streamId);
        }
        return;
      }
      case "resp-head":
      case "ws-open-ack":
        return;
    }
  }

  private async executeHttp(
    streamId: number,
    stream: HttpStream,
  ): Promise<void> {
    const { meta } = stream;
    const headers: Record<string, string> = {};
    for (const [n, v] of meta.headers) {
      if (!SKIP_REQUEST_HEADERS.has(n.toLowerCase())) headers[n] = v;
    }
    try {
      const body = meta.hasBody ? Buffer.concat(stream.chunks) : undefined;
      const res = await fetch(`${this.origin}${meta.path}`, {
        method: meta.method,
        headers,
        body,
        redirect: "manual",
        signal: stream.abort.signal,
      });
      const respHeaders: HeaderPair[] = [];
      res.headers.forEach((v, n) => {
        if (n.toLowerCase() !== "content-encoding") respHeaders.push([n, v]);
      });
      this.send({
        type: "resp-head",
        streamId,
        status: res.status,
        headers: respHeaders,
      });
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const c of chunkBody(streamId, value)) this.send(c);
        }
      }
      this.send({ type: "body-end", streamId });
    } catch (e) {
      if (!stream.abort.signal.aborted) {
        this.send({ type: "close-stream", streamId, code: 1011, reason: String(e) });
      }
    } finally {
      this.httpStreams.delete(streamId);
    }
  }

  private openOriginWs(frame: OpenWsFrame): void {
    const wsOrigin = this.origin.replace(/^http/, "ws");
    const headers: Record<string, string> = {};
    for (const [n, v] of frame.headers) {
      if (!SKIP_REQUEST_HEADERS.has(n.toLowerCase())) headers[n] = v;
    }
    const socket = new NodeWebSocket(`${wsOrigin}${frame.path}`, frame.protocols, {
      headers,
    });
    const stream: WsStream = { socket, buffered: [], open: false };
    this.wsStreams.set(frame.streamId, stream);
    socket.on("open", () => {
      stream.open = true;
      this.send({
        type: "ws-open-ack",
        streamId: frame.streamId,
        protocol: socket.protocol || null,
      });
      for (const b of stream.buffered) this.onFrame(b);
      stream.buffered = [];
    });
    socket.on("message", (data: Buffer, isBinary: boolean) => {
      this.send({
        type: "ws-data",
        streamId: frame.streamId,
        isBinary,
        data: isBinary
          ? new Uint8Array(data)
          : new Uint8Array(Buffer.from(data.toString())),
      });
    });
    socket.on("close", (code: number, reason: Buffer) => {
      if (this.wsStreams.delete(frame.streamId)) {
        this.send({
          type: "close-stream",
          streamId: frame.streamId,
          code: code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000,
          reason: reason.toString(),
        });
      }
    });
    socket.on("error", (e: Error) =>
      this.logger.warn({ err: e.message, path: frame.path }, "connect origin ws error"),
    );
  }
}

export interface ConnectTunnelServiceOptions {
  dataDir: string;
  /** This server's own loopback base URL, e.g. http://127.0.0.1:38886. */
  loopbackBaseUrl: string;
  logger: ServerLogger;
}

/**
 * Holds the connect tunnel for the server. Pairing writes the durable
 * credential and (re)connects; the tunnel reconnects with capped backoff on
 * drops and is re-established from the stored credential on server boot.
 */
export class ConnectTunnelService {
  private credential: ConnectCredential | null = null;
  private tunnel: NodeWebSocket | undefined;
  private session: TunnelSession | undefined;
  private connected = false;
  private lastError: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private attempt = 0;
  private stopped = false;

  constructor(private readonly options: ConnectTunnelServiceOptions) {}

  /** Boot: reconnect from a previously-stored credential, if any. */
  start(): void {
    const stored = readConnectCredential(this.options.dataDir);
    if (stored) {
      this.credential = stored;
      this.stopped = false;
      this.openTunnel();
    }
  }

  async pair(args: {
    code: string;
    serverUrl: string;
    baseUrl?: string;
  }): Promise<ConnectStatusResponse> {
    const serverUrl = args.serverUrl.replace(/\/$/, "");
    const baseUrl = args.baseUrl ?? deriveConnectBaseUrl(serverUrl);
    const redeemed = await redeemConnectCode({ code: args.code, baseUrl });
    const credential: ConnectCredential = {
      serverUrl,
      handle: redeemed.handle,
      credential: redeemed.credential,
    };
    writeConnectCredential(this.options.dataDir, credential);
    this.credential = credential;
    this.lastError = null;
    this.reconnect();
    return this.status();
  }

  disconnect(): ConnectStatusResponse {
    clearConnectCredential(this.options.dataDir);
    this.credential = null;
    this.teardown();
    this.lastError = null;
    return this.status();
  }

  status(): ConnectStatusResponse {
    return {
      paired: this.credential !== null,
      handle: this.credential?.handle ?? null,
      url: this.credential?.serverUrl ?? null,
      connected: this.connected,
      lastError: this.lastError,
    };
  }

  /** Stop the tunnel without clearing the credential (server shutdown). */
  stop(): void {
    this.teardown();
  }

  private teardown(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.session?.dispose();
    this.session = undefined;
    // Keep the existing 'error'/'close' listeners (they no-op once `stopped` is
    // set and `this.tunnel` is cleared) rather than removeAllListeners, so a
    // late socket error after terminate() still has a handler and doesn't throw
    // as an unhandled 'error' event.
    this.tunnel?.terminate();
    this.tunnel = undefined;
    this.connected = false;
    this.attempt = 0;
  }

  private reconnect(): void {
    this.teardown();
    this.stopped = false;
    this.openTunnel();
  }

  private openTunnel(): void {
    const credential = this.credential;
    if (!credential || this.stopped) return;

    const tunnelUrl = tunnelUrlForServer(credential.serverUrl);
    this.options.logger.info(
      { url: tunnelUrl, origin: this.options.loopbackBaseUrl },
      "connect tunnel connecting",
    );
    const tunnel = new NodeWebSocket(tunnelUrl, {
      headers: { authorization: `Bearer ${credential.credential}` },
    });
    this.tunnel = tunnel;
    let connectedAt = 0;

    tunnel.on("open", () => {
      connectedAt = Date.now();
      this.connected = true;
      this.lastError = null;
      this.options.logger.info("connect tunnel connected");
      this.session = new TunnelSession(
        tunnel,
        this.options.loopbackBaseUrl,
        this.options.logger,
      );
      this.session.start();
    });
    tunnel.on("unexpected-response", (_req, res) => {
      this.lastError = `tunnel rejected: HTTP ${res.statusCode}`;
      this.options.logger.warn({ status: res.statusCode }, "connect tunnel rejected");
    });
    tunnel.on("error", (e: Error) => {
      this.lastError = e.message;
    });
    tunnel.on("close", (code: number, reason: Buffer) => {
      this.connected = false;
      this.session?.dispose();
      this.session = undefined;
      if (this.stopped || this.tunnel !== tunnel) return;
      const stable = connectedAt ? Date.now() - connectedAt : 0;
      this.attempt = stable > 10_000 ? 0 : this.attempt + 1;
      const delay = Math.min(1000 * 2 ** this.attempt, MAX_RECONNECT_DELAY_MS);
      this.options.logger.warn(
        { code, reason: reason.toString(), delay },
        "connect tunnel closed; reconnecting",
      );
      this.reconnectTimer = setTimeout(() => this.openTunnel(), delay);
    });
  }
}
