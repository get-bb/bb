// The connect tunnel, hosted by the plugin's "tunnel" background service.
// When paired, it dials the per-handle gate over an outbound WebSocket and
// proxies relayed HTTP/WS streams to the server's own loopback base URL
// (which serves the SPA + /api + /ws). Ported from the kernel's
// services/connect/tunnel-service.ts with three changes: the credential
// lives in plugin kv (injected CredentialStore), status is a small state
// machine pushed over bb.realtime, and an auth-rejected credential is
// cleared (landing in "not paired") instead of reconnecting forever.
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
import type { PluginLogger } from "@bb/plugin-sdk";
import type { ConnectCredential, CredentialStore } from "./credential.js";
import {
  DEFAULT_CONNECT_BASE_URL,
  deriveConnectBaseUrl,
  redeemConnectCode,
  serverUrlForHandle,
} from "./redeem.js";
import type { ConnectStateName, ConnectStatus } from "./types.js";

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
    private readonly log: PluginLogger,
  ) {}

  start(): void {
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastAck > HEARTBEAT_DEADLINE_MS) {
        this.log.warn("tunnel heartbeat missed; reconnecting");
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
        this.log.warn(`tunnel bad frame: ${String(e)}`);
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
      this.log.warn(`origin ws error on ${frame.path}: ${e.message}`),
    );
  }
}

export interface ConnectTunnelOptions {
  store: CredentialStore;
  /**
   * The server's own loopback base URL, read lazily (bb.server is
   * bind-gated; the tunnel only needs it once a socket opens).
   */
  getLoopbackBaseUrl: () => string;
  log: PluginLogger;
  /** Fired on every state/handle/error transition (bb.realtime push). */
  onStatusChange?: (status: ConnectStatus) => void;
}

/**
 * Holds the connect tunnel for this bb. Pairing writes the durable credential
 * to plugin kv and (re)connects; the tunnel reconnects with capped backoff on
 * drops and is re-established from the stored credential when the background
 * service starts. Disabling the plugin aborts the service, which stops the
 * tunnel — the plugin is the single owner of remote access.
 */
export class ConnectTunnel {
  private credential: ConnectCredential | null = null;
  private tunnel: NodeWebSocket | undefined;
  private session: TunnelSession | undefined;
  private connected = false;
  private pairing = false;
  private lastError: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private attempt = 0;
  private stopped = false;
  private lastState: ConnectStateName = "disconnected";
  private stateSince = Date.now();

  constructor(private readonly options: ConnectTunnelOptions) {}

  /** Service start: reconnect from a previously-stored credential, if any. */
  async start(): Promise<void> {
    const stored = await this.options.store.read();
    if (stored) {
      this.credential = stored;
      this.stopped = false;
      this.openTunnel();
    }
    this.publish();
  }

  async pair(args: {
    code: string;
    serverUrl?: string;
    baseUrl?: string;
  }): Promise<ConnectStatus> {
    const baseUrl =
      args.baseUrl ??
      (args.serverUrl !== undefined
        ? deriveConnectBaseUrl(args.serverUrl)
        : DEFAULT_CONNECT_BASE_URL);
    this.pairing = true;
    this.publish();
    try {
      const redeemed = await redeemConnectCode({ code: args.code, baseUrl });
      const serverUrl = (
        args.serverUrl ?? serverUrlForHandle(baseUrl, redeemed.handle)
      ).replace(/\/$/, "");
      const credential: ConnectCredential = {
        serverUrl,
        handle: redeemed.handle,
        credential: redeemed.credential,
      };
      await this.options.store.write(credential);
      this.credential = credential;
      this.lastError = null;
      this.reconnect();
    } finally {
      this.pairing = false;
      this.publish();
    }
    return this.status();
  }

  async disconnect(): Promise<ConnectStatus> {
    await this.options.store.clear();
    this.credential = null;
    this.teardown();
    this.lastError = null;
    this.publish();
    return this.status();
  }

  status(): ConnectStatus {
    return {
      state: this.computeState(),
      paired: this.credential !== null,
      handle: this.credential?.handle ?? null,
      url: this.credential?.serverUrl ?? null,
      lastError: this.lastError,
      since: this.stateSince,
    };
  }

  /** Stop the tunnel without clearing the credential (service abort). */
  stop(): void {
    this.teardown();
    this.publish();
  }

  private computeState(): ConnectStateName {
    if (this.pairing) return "pairing";
    if (this.credential === null) return "disconnected";
    return this.connected ? "connected" : "reconnecting";
  }

  /** Recompute the state and push a status snapshot when anything changed. */
  private publish(): void {
    const state = this.computeState();
    if (state !== this.lastState) {
      this.lastState = state;
      this.stateSince = Date.now();
    }
    this.options.onStatusChange?.(this.status());
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

  /**
   * The gate refused our bearer credential: reconnecting cannot help, so
   * forget it and land in "not paired" with an explanation — unlike network
   * failures, which keep the credential and stay in "reconnecting".
   */
  private credentialRejected(statusCode: number): void {
    this.lastError =
      `the gate rejected this bb's credential (HTTP ${statusCode}) — ` +
      "pairing was revoked; get a new code from the getbb.app dashboard and re-pair";
    this.options.log.warn(this.lastError);
    this.credential = null;
    this.teardown();
    this.publish();
    void this.options.store.clear().catch((error: unknown) => {
      this.options.log.warn(
        `failed to clear the rejected credential: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  private openTunnel(): void {
    const credential = this.credential;
    if (!credential || this.stopped) return;

    const tunnelUrl = tunnelUrlForServer(credential.serverUrl);
    this.options.log.info(
      `tunnel connecting to ${tunnelUrl} (origin ${this.options.getLoopbackBaseUrl()})`,
    );
    let tunnel: NodeWebSocket;
    try {
      tunnel = new NodeWebSocket(tunnelUrl, {
        headers: { authorization: `Bearer ${credential.credential}` },
      });
    } catch (error) {
      // A malformed stored serverUrl throws synchronously. Retrying cannot
      // help; surface it and wait for a re-pair (or disconnect).
      this.lastError = `cannot dial ${tunnelUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.options.log.warn(this.lastError);
      this.publish();
      return;
    }
    this.tunnel = tunnel;
    let connectedAt = 0;

    tunnel.on("open", () => {
      connectedAt = Date.now();
      this.connected = true;
      this.lastError = null;
      this.options.log.info("tunnel connected");
      this.session = new TunnelSession(
        tunnel,
        this.options.getLoopbackBaseUrl(),
        this.options.log,
      );
      this.session.start();
      this.publish();
    });
    tunnel.on("unexpected-response", (_req, res) => {
      const statusCode = res.statusCode ?? 0;
      if (statusCode === 401 || statusCode === 403) {
        this.credentialRejected(statusCode);
        return;
      }
      this.lastError = `tunnel rejected: HTTP ${statusCode}`;
      this.options.log.warn(this.lastError);
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
      this.options.log.warn(
        `tunnel closed (code ${code}${reason.length > 0 ? `, ${reason.toString()}` : ""}); reconnecting in ${delay}ms`,
      );
      this.reconnectTimer = setTimeout(() => this.openTunnel(), delay);
      this.publish();
    });
  }
}
