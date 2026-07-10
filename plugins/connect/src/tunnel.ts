// The connect tunnel, hosted by the plugin's "tunnel" background service.
// When paired, it dials the per-handle gate over an outbound WebSocket and
// proxies relayed HTTP/WS streams to the server's own loopback base URL
// (which serves the SPA + /api + /ws), or to a registered share port when
// the relay stamps `target` on the open frame.
import { WebSocket as NodeWebSocket } from "ws";
import {
  HEARTBEAT_REQUEST,
  HEARTBEAT_RESPONSE,
  PROTOCOL_VERSION,
  TUNNEL_PROTOCOL_QUERY_PARAM,
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
  ConnectListError,
  fetchAccountServers,
  withAccountServerUrls,
  type ListAccountServersResult,
} from "./list-servers.js";
import {
  asConnectPairError,
  DEFAULT_CONNECT_BASE_URL,
  deriveConnectBaseUrl,
  redeemConnectCode,
  serverUrlForHandle,
} from "./redeem.js";
import {
  ShareRegistry,
  shareLoopbackHost,
  shareLoopbackOrigin,
  sharePublicUrl,
} from "./shares.js";
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

const UNREGISTERED_PORT_BODY = "this port is not shared";
const textEncoder = new TextEncoder();

export interface LoopbackHeaderRewrite {
  publicOrigin: string;
  loopbackOrigin: string;
  /**
   * When set, inject a Host header (share streams). When omitted, Host is
   * dropped — bare-handle behavior, byte-identical to pre-share.
   */
  host?: string;
}

export function headersForLoopbackRequest(
  headers: HeaderPair[],
  rewrite: LoopbackHeaderRewrite,
): Record<string, string> {
  const forwarded: Record<string, string> = {};
  for (const [name, value] of headers) {
    const lowerName = name.toLowerCase();
    if (SKIP_REQUEST_HEADERS.has(lowerName)) continue;
    forwarded[name] =
      lowerName === "origin" && value === rewrite.publicOrigin
        ? rewrite.loopbackOrigin
        : value;
  }
  if (rewrite.host !== undefined) {
    forwarded.Host = rewrite.host;
  }
  return forwarded;
}

/** Host shown in transport errors — the connect apex, e.g. "getbb.app". */
function connectApexHost(serverUrl: string): string {
  try {
    return new URL(deriveConnectBaseUrl(serverUrl)).host;
  } catch {
    return "getbb.app";
  }
}

/**
 * Turn a raw socket error into a human line for the reconnecting card:
 * "can't reach getbb.app — connection refused". Falls back to the raw
 * message for unrecognized failures rather than inventing a cause.
 */
export function humanizeTransportError(error: Error, host: string): string {
  const code = (error as NodeJS.ErrnoException).code;
  let reason: string;
  if (code === "ECONNREFUSED") reason = "connection refused";
  else if (code === "ENOTFOUND" || code === "EAI_AGAIN") reason = "host not found";
  else if (code === "ETIMEDOUT" || /timed out|timeout|ETIMEDOUT/i.test(error.message))
    reason = "timed out";
  else if (code === "ECONNRESET") reason = "connection reset";
  else reason = error.message;
  return `can't reach ${host} — ${reason}`;
}

function tunnelUrlForServer(serverUrl: string): string {
  const base =
    serverUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/__tunnel";
  const url = new URL(base);
  url.searchParams.set(TUNNEL_PROTOCOL_QUERY_PARAM, String(PROTOCOL_VERSION));
  return url.toString();
}

/** True when this open-ws is the bb app's realtime socket via the bare handle. */
export function isBareBbRealtimeWs(
  path: string,
  target: string | undefined,
): boolean {
  if (target !== undefined) return false;
  // Spec: path starts with `/ws` and has no target.
  return path === "/ws" || path.startsWith("/ws?") || path.startsWith("/ws/");
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
  /** Counted toward remoteClients (bare-handle /ws). */
  countsAsRemoteClient: boolean;
}

export interface ResolvedStreamOrigin {
  /** Fetch/WS base, e.g. `http://127.0.0.1:38886` or a share port. */
  origin: string;
  publicOrigin: string;
  /** Injected Host for share streams; omitted for bare-handle. */
  host?: string;
}

export type StreamOriginResult =
  | { kind: "ok"; resolved: ResolvedStreamOrigin }
  | { kind: "unregistered" };

export interface TunnelSessionOptions {
  tunnel: NodeWebSocket;
  log: PluginLogger;
  /**
   * Resolve a frame's optional `target` (decimal port string) to a local
   * origin. Called for every open-http / open-ws.
   */
  resolveOrigin: (target: string | undefined) => StreamOriginResult;
  /** Fired when remoteClients transitions 0↔nonzero. */
  onRemoteClientsChange?: (remoteClients: number) => void;
  /** Fired on every relayed frame (any type). */
  onActivity?: (at: number) => void;
}

/** Proxies one live tunnel socket's frames to per-stream loopback origins. */
export class TunnelSession {
  private readonly httpStreams = new Map<number, HttpStream>();
  private readonly wsStreams = new Map<number, WsStream>();
  private lastAck = Date.now();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private remoteClientCount = 0;
  lastRemoteActivityAt: number | null = null;

  constructor(private readonly options: TunnelSessionOptions) {}

  get remoteClients(): number {
    return this.remoteClientCount;
  }

  start(): void {
    const { tunnel } = this.options;
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastAck > HEARTBEAT_DEADLINE_MS) {
        this.options.log.warn("tunnel heartbeat missed; reconnecting");
        tunnel.terminate();
        return;
      }
      tunnel.send(HEARTBEAT_REQUEST);
    }, HEARTBEAT_INTERVAL_MS);

    tunnel.on("message", (data: Buffer, isBinary: boolean) => {
      if (!isBinary) {
        if (data.toString() === HEARTBEAT_RESPONSE) this.lastAck = Date.now();
        return;
      }
      try {
        this.onFrame(decodeFrame(data));
      } catch (e) {
        this.options.log.warn(`tunnel bad frame: ${String(e)}`);
      }
    });
    tunnel.on("close", () => this.dispose());
  }

  dispose(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const s of this.httpStreams.values()) s.abort.abort();
    for (const s of this.wsStreams.values()) s.socket.close(1001, "tunnel closed");
    this.httpStreams.clear();
    this.wsStreams.clear();
    this.setRemoteClients(0);
  }

  private noteActivity(): void {
    const at = Date.now();
    this.lastRemoteActivityAt = at;
    this.options.onActivity?.(at);
  }

  private setRemoteClients(next: number): void {
    const prev = this.remoteClientCount;
    this.remoteClientCount = next;
    if ((prev === 0) !== (next === 0)) {
      this.options.onRemoteClientsChange?.(next);
    }
  }

  private adjustRemoteClients(delta: number): void {
    this.setRemoteClients(Math.max(0, this.remoteClientCount + delta));
  }

  private send(frame: Frame): void {
    if (this.options.tunnel.readyState === NodeWebSocket.OPEN) {
      this.options.tunnel.send(encodeFrame(frame));
    }
  }

  private onFrame(frame: Frame): void {
    this.noteActivity();
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
          this.forgetWsStream(frame.streamId, w);
        }
        return;
      }
      case "resp-head":
      case "ws-open-ack":
        return;
    }
  }

  private forgetWsStream(streamId: number, stream: WsStream): void {
    if (!this.wsStreams.delete(streamId)) return;
    if (stream.countsAsRemoteClient) this.adjustRemoteClients(-1);
  }

  private rejectUnregisteredHttp(streamId: number): void {
    const body = textEncoder.encode(UNREGISTERED_PORT_BODY);
    this.send({
      type: "resp-head",
      streamId,
      status: 404,
      headers: [["content-type", "text/plain; charset=utf-8"]],
    });
    for (const c of chunkBody(streamId, body)) this.send(c);
    this.send({ type: "body-end", streamId });
  }

  private async executeHttp(
    streamId: number,
    stream: HttpStream,
  ): Promise<void> {
    const { meta } = stream;
    const originResult = this.options.resolveOrigin(meta.target);
    if (originResult.kind === "unregistered") {
      this.rejectUnregisteredHttp(streamId);
      this.httpStreams.delete(streamId);
      return;
    }
    const { resolved } = originResult;
    const headers = headersForLoopbackRequest(meta.headers, {
      publicOrigin: resolved.publicOrigin,
      loopbackOrigin: new URL(resolved.origin).origin,
      ...(resolved.host !== undefined ? { host: resolved.host } : {}),
    });
    try {
      const body = meta.hasBody ? Buffer.concat(stream.chunks) : undefined;
      const res = await fetch(`${resolved.origin}${meta.path}`, {
        method: meta.method,
        headers,
        body,
        redirect: "manual",
        signal: stream.abort.signal,
      });
      const respHeaders: HeaderPair[] = [];
      // fetch transparently decompresses a compressed origin body, so when
      // content-encoding is present the origin's content-length describes
      // compressed bytes we are not forwarding — relaying it would corrupt
      // the response framing at the relay. Drop both.
      const decompressed = res.headers.get("content-encoding") !== null;
      res.headers.forEach((v, n) => {
        const lower = n.toLowerCase();
        if (lower === "content-encoding") return;
        if (decompressed && lower === "content-length") return;
        respHeaders.push([n, v]);
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
      // Unreachable share ports and other fetch failures: clean close-stream,
      // not a crash. Aborted streams are silent.
      if (!stream.abort.signal.aborted) {
        this.send({
          type: "close-stream",
          streamId,
          code: 1011,
          reason: String(e),
        });
      }
    } finally {
      this.httpStreams.delete(streamId);
    }
  }

  private openOriginWs(frame: OpenWsFrame): void {
    const originResult = this.options.resolveOrigin(frame.target);
    if (originResult.kind === "unregistered") {
      this.send({
        type: "close-stream",
        streamId: frame.streamId,
        code: 1008,
        reason: UNREGISTERED_PORT_BODY,
      });
      return;
    }
    const { resolved } = originResult;
    const wsOrigin = resolved.origin.replace(/^http/, "ws");
    const headers = headersForLoopbackRequest(frame.headers, {
      publicOrigin: resolved.publicOrigin,
      loopbackOrigin: new URL(resolved.origin).origin,
      ...(resolved.host !== undefined ? { host: resolved.host } : {}),
    });
    const countsAsRemoteClient = isBareBbRealtimeWs(frame.path, frame.target);
    let socket: NodeWebSocket;
    try {
      socket = new NodeWebSocket(`${wsOrigin}${frame.path}`, frame.protocols, {
        headers,
      });
    } catch (e) {
      this.send({
        type: "close-stream",
        streamId: frame.streamId,
        code: 1011,
        reason: String(e),
      });
      return;
    }
    const stream: WsStream = {
      socket,
      buffered: [],
      open: false,
      countsAsRemoteClient,
    };
    this.wsStreams.set(frame.streamId, stream);
    if (countsAsRemoteClient) this.adjustRemoteClients(1);

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
      if (this.wsStreams.has(frame.streamId)) {
        this.forgetWsStream(frame.streamId, stream);
        this.send({
          type: "close-stream",
          streamId: frame.streamId,
          code: code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000,
          reason: reason.toString(),
        });
      }
    });
    socket.on("error", (e: Error) => {
      // Dead share ports surface as socket errors; the subsequent 'close'
      // sends close-stream. Log only — do not throw.
      this.options.log.warn(`origin ws error on ${frame.path}: ${e.message}`);
    });
  }
}

export interface ConnectTunnelOptions {
  store: CredentialStore;
  shares: ShareRegistry;
  /**
   * The server's own loopback base URL, read lazily (bb.server is
   * bind-gated; the tunnel only needs it once a socket opens).
   */
  getLoopbackBaseUrl: () => string;
  log: PluginLogger;
  /** Fired on every state/handle/error/shares/presence transition. */
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
  private lastRemoteActivityAt: number | null = null;
  private remoteClients = 0;
  private nextRetryAt: number | null = null;

  constructor(private readonly options: ConnectTunnelOptions) {}

  get shares(): ShareRegistry {
    return this.options.shares;
  }

  /** Current pairing credential, or null when unpaired. */
  getCredential(): ConnectCredential | null {
    return this.credential;
  }

  /** Service start: reconnect from a previously-stored credential, if any. */
  async start(): Promise<void> {
    await this.options.shares.load();
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
      let redeemed;
      try {
        redeemed = await redeemConnectCode({ code: args.code, baseUrl });
      } catch (error) {
        // Raw wire/transport detail goes to the log only; the caller gets a
        // typed ConnectPairError whose code the panel maps to human copy.
        const pairError = asConnectPairError(error);
        this.options.log.warn(`pair failed (${pairError.code}): ${pairError.message}`);
        throw pairError;
      }
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

  async expose(port: number): Promise<{ port: number; url: string }> {
    const listing = await this.options.shares.add(port);
    // shares.onChange already publishes; ensure status is fresh if it didn't.
    this.publish();
    return { port: listing.port, url: listing.url };
  }

  async unexpose(port: number): Promise<{ removed: boolean; port: number }> {
    const removed = await this.options.shares.remove(port);
    this.publish();
    return { removed, port };
  }

  listShares(): Array<{ port: number; url: string }> {
    return this.options.shares.list().map(({ port, url }) => ({ port, url }));
  }

  /**
   * List every bb server on the paired account (via the connect gate).
   * Returns this server's handle so callers can dedupe self. Each row includes
   * the public connect URL (`https://<handle>.…`) derived from the credential.
   */
  async listAccountServers(): Promise<ListAccountServersResult> {
    const credential = this.credential;
    if (credential === null) {
      throw new ConnectListError(
        "not_paired",
        "this bb is not connected to getbb.app — run `bb connect` for how to pair",
      );
    }
    const servers = withAccountServerUrls(
      await fetchAccountServers(credential),
      credential,
    );
    return { servers, selfHandle: credential.handle };
  }

  status(): ConnectStatus {
    const state = this.computeState();
    return {
      state,
      paired: this.credential !== null,
      handle: this.credential?.handle ?? null,
      url: this.credential?.serverUrl ?? null,
      dashboardUrl: this.dashboardUrl(),
      lastError: this.lastError,
      nextRetryAt: state === "reconnecting" ? this.nextRetryAt : null,
      since: this.stateSince,
      remoteClients: this.remoteClients,
      lastRemoteActivityAt: this.lastRemoteActivityAt,
      shares: this.listShares(),
    };
  }

  /** getbb.app dashboard URL, derived from the paired base (or the apex). */
  private dashboardUrl(): string {
    const base =
      this.credential !== null
        ? deriveConnectBaseUrl(this.credential.serverUrl)
        : DEFAULT_CONNECT_BASE_URL;
    return `${base.replace(/\/$/, "")}/dashboard`;
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
    this.remoteClients = 0;
    // Keep the existing 'error'/'close' listeners (they no-op once `stopped` is
    // set and `this.tunnel` is cleared) rather than removeAllListeners, so a
    // late socket error after terminate() still has a handler and doesn't throw
    // as an unhandled 'error' event.
    this.tunnel?.terminate();
    this.tunnel = undefined;
    this.connected = false;
    this.attempt = 0;
    this.nextRetryAt = null;
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

  private resolveStreamOrigin(target: string | undefined): StreamOriginResult {
    if (target === undefined) {
      return {
        kind: "ok",
        resolved: {
          origin: this.options.getLoopbackBaseUrl().replace(/\/$/, ""),
          publicOrigin: this.credential
            ? new URL(this.credential.serverUrl).origin
            : this.options.getLoopbackBaseUrl(),
        },
      };
    }
    const port = Number(target);
    if (!Number.isInteger(port) || !this.options.shares.has(port)) {
      return { kind: "unregistered" };
    }
    const credential = this.credential;
    if (credential === null) {
      return { kind: "unregistered" };
    }
    return {
      kind: "ok",
      resolved: {
        origin: shareLoopbackOrigin(port),
        publicOrigin: new URL(sharePublicUrl(credential, port)).origin,
        host: shareLoopbackHost(port),
      },
    };
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
      this.nextRetryAt = null;
      this.options.log.info("tunnel connected");
      this.session = new TunnelSession({
        tunnel,
        log: this.options.log,
        resolveOrigin: (target) => this.resolveStreamOrigin(target),
        onRemoteClientsChange: (count) => {
          this.remoteClients = count;
          this.publish();
        },
        onActivity: (at) => {
          this.lastRemoteActivityAt = at;
        },
      });
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
      // Humanize transport failures for the reconnecting card; the raw
      // message still rides the log via the close handler below.
      this.lastError = humanizeTransportError(e, connectApexHost(credential.serverUrl));
    });
    tunnel.on("close", (code: number, reason: Buffer) => {
      this.connected = false;
      this.session?.dispose();
      this.session = undefined;
      this.remoteClients = 0;
      if (this.stopped || this.tunnel !== tunnel) return;
      const stable = connectedAt ? Date.now() - connectedAt : 0;
      this.attempt = stable > 10_000 ? 0 : this.attempt + 1;
      const delay = Math.min(1000 * 2 ** this.attempt, MAX_RECONNECT_DELAY_MS);
      // A clean close with no prior socket error still leaves the card empty;
      // give it an honest line so the reconnecting state is never blank.
      if (this.lastError === null) {
        this.lastError = `can't reach ${connectApexHost(credential.serverUrl)} — connection closed`;
      }
      this.nextRetryAt = Date.now() + delay;
      this.options.log.warn(
        `tunnel closed (code ${code}${reason.length > 0 ? `, ${reason.toString()}` : ""}); reconnecting in ${delay}ms`,
      );
      this.reconnectTimer = setTimeout(() => this.openTunnel(), delay);
      this.publish();
    });
  }
}
