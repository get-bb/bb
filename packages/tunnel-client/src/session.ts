import {
  request as httpRequest,
  type IncomingMessage,
  type RequestOptions,
} from "node:http";
import { request as httpsRequest } from "node:https";
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
import { headersForLoopbackRequest } from "./headers.js";
import type { TunnelClientLogger } from "./logger.js";

const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_DEADLINE_MS = 60_000;
const HEARTBEAT_LATE_TICK_MS = HEARTBEAT_INTERVAL_MS + 5_000;
const SEND_BUFFER_HIGH_WATER_BYTES = 1024 * 1024;
const SEND_BUFFER_POLL_MS = 10;

const UNREGISTERED_PORT_BODY = "this port is not shared";
const WS_TRANSPORT_OPEN = 1;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const INITIAL_THREAD_LOAD_PATH =
  /^\/api\/v1\/threads\/[^/]+\/(?:timeline|conversation-outline)(?:\?|$)/u;

interface OriginHttpRequestArgs {
  body: Buffer | undefined;
  headers: Record<string, string>;
  method: string;
  signal: AbortSignal;
  url: URL;
}

function frameBodyHeaders(
  headers: Record<string, string>,
  body: Buffer | undefined,
): Record<string, string> {
  if (body === undefined) return headers;
  return { ...headers, "Content-Length": String(body.byteLength) };
}

export function requestOriginHttp(
  args: OriginHttpRequestArgs,
): Promise<IncomingMessage> {
  const request = args.url.protocol === "https:" ? httpsRequest : httpRequest;
  const options: RequestOptions = {
    headers: frameBodyHeaders(args.headers, args.body),
    method: args.method,
    signal: args.signal,
  };
  return new Promise<IncomingMessage>((resolve, reject) => {
    const originRequest = request(args.url, options, resolve);
    originRequest.once("error", reject);
    originRequest.end(args.body);
  });
}

function responseHeaderPairs(response: IncomingMessage): HeaderPair[] {
  const headers: HeaderPair[] = [];
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    const name = response.rawHeaders[index];
    const value = response.rawHeaders[index + 1];
    if (name !== undefined && value !== undefined) {
      headers.push([name, value]);
    }
  }
  return headers;
}

const DOT_SEGMENT_PATTERN = /(?:^|\/)(?:\.|\.\.)(?:\/|$)/u;

export interface CanonicalStreamPath {
  forward: string;
  guard: string;
}

function hasForbiddenShape(pathname: string): boolean {
  return (
    pathname.includes("//") ||
    pathname.includes("\\") ||
    DOT_SEGMENT_PATTERN.test(pathname)
  );
}

export function canonicalStreamPath(
  rawPath: string,
): CanonicalStreamPath | null {
  if (!rawPath.startsWith("/") || rawPath.startsWith("//")) return null;
  const withoutQuery = rawPath.split("?", 1)[0] ?? rawPath;
  if (hasForbiddenShape(withoutQuery)) return null;
  let url: URL;
  try {
    url = new URL(rawPath, "http://bb.local");
  } catch {
    return null;
  }
  if (url.host !== "bb.local") return null;
  let decoded: string;
  let decodedNormalized: string;
  try {
    decoded = decodeURIComponent(withoutQuery);
    decodedNormalized = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (decoded !== decodedNormalized) return null;
  if (decoded !== withoutQuery && hasForbiddenShape(decoded)) return null;
  if (decoded.split("/").length !== withoutQuery.split("/").length) {
    return null;
  }
  return {
    forward: `${url.pathname}${url.search}`,
    guard: `${decoded}${url.search}`,
  };
}

function isInitialThreadLoad(path: string): boolean {
  if (!INITIAL_THREAD_LOAD_PATH.test(path)) {
    return false;
  }
  return !new URL(path, "http://bb.local").searchParams.has("afterSequence");
}

function roundDurationMs(durationMs: number): number {
  return Math.round(durationMs * 10) / 10;
}

export function isBareBbRealtimeWs(
  path: string,
  target: string | undefined,
): boolean {
  if (target !== undefined) return false;
  return path === "/ws" || path.startsWith("/ws?") || path.startsWith("/ws/");
}

interface HttpStream {
  meta: OpenHttpFrame;
  chunks: Buffer[];
  abort: AbortController;
  guarded: StreamGuardInput | null;
}
interface WsStream {
  socket: NodeWebSocket;
  buffered: Frame[];
  open: boolean;
  countsAsRemoteClient: boolean;
  guarded: StreamGuardInput | null;
}

interface ResolvedStreamOrigin {
  origin: string;
  publicOrigin: string;
  host?: string;
}

export interface TunnelSessionSnapshot {
  openHttpStreams: number;
  openWsStreams: number;
  bytesReceived: number;
  bytesSent: number;
  lastReceivedAgeMs: number | null;
  lastSentAgeMs: number | null;
  bufferedBytes: number;
}

export type StreamOriginResult =
  | { kind: "ok"; resolved: ResolvedStreamOrigin }
  | { kind: "unregistered" };

export interface StreamGuardInput {
  kind: "http" | "ws";
  method: string;
  path: string;
  headers: HeaderPair[];
  target: string | undefined;
}

export type StreamGuardResult =
  | { allow: true }
  | { allow: false; status: number; code: string; message: string };

export interface TunnelTransport {
  readonly readyState: number;
  readonly bufferedAmount?: number;
  send(data: Uint8Array | string): void;
  on(
    event: "message",
    listener: (data: Uint8Array, isBinary: boolean) => void,
  ): void;
  on(event: "close", listener: () => void): void;
  terminate(): void;
}

interface TunnelSessionOptions {
  tunnel: TunnelTransport;
  log: TunnelClientLogger;
  resolveOrigin: (target: string | undefined) => StreamOriginResult;
  guardStream?: (stream: StreamGuardInput) => StreamGuardResult;
  stripRequestHeaders?: readonly string[];
  injectRequestHeaders?: () => Record<string, string>;
  onRemoteClientsChange?: (remoteClients: number) => void;
  onActivity?: (at: number) => void;
  monotonicNow?: () => number;
}

export class TunnelSession {
  private readonly httpStreams = new Map<number, HttpStream>();
  private readonly wsStreams = new Map<number, WsStream>();
  private lastAck = Date.now();
  private lastReceivedAckAt: number | null = null;
  private lastHeartbeatTickAt = 0;
  private stallGraceSinceAck = false;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private remoteClientCount = 0;
  private bytesReceived = 0;
  private bytesSent = 0;
  private lastReceivedAt: number | null = null;
  private lastSentAt: number | null = null;
  lastRemoteActivityAt: number | null = null;

  constructor(private readonly options: TunnelSessionOptions) {}

  get remoteClients(): number {
    return this.remoteClientCount;
  }

  get lastHeartbeatAckAt(): number | null {
    return this.lastReceivedAckAt;
  }

  snapshot(now: number): TunnelSessionSnapshot {
    return {
      openHttpStreams: this.httpStreams.size,
      openWsStreams: this.wsStreams.size,
      bytesReceived: this.bytesReceived,
      bytesSent: this.bytesSent,
      lastReceivedAgeMs:
        this.lastReceivedAt === null ? null : now - this.lastReceivedAt,
      lastSentAgeMs: this.lastSentAt === null ? null : now - this.lastSentAt,
      bufferedBytes: this.options.tunnel.bufferedAmount ?? 0,
    };
  }

  start(): void {
    const { tunnel } = this.options;
    const monotonicNow = this.options.monotonicNow ?? (() => performance.now());
    this.lastAck = Date.now();
    this.lastReceivedAckAt = null;
    this.lastHeartbeatTickAt = monotonicNow();
    this.heartbeat = setInterval(() => {
      const tickAt = monotonicNow();
      const tickGapMs = tickAt - this.lastHeartbeatTickAt;
      this.lastHeartbeatTickAt = tickAt;
      const now = Date.now();
      if (tickGapMs > HEARTBEAT_LATE_TICK_MS && !this.stallGraceSinceAck) {
        this.options.log.warn(
          `event loop stalled for ${Math.round(tickGapMs / 1000)}s; restarting the tunnel heartbeat deadline`,
        );
        this.lastAck = now;
        this.stallGraceSinceAck = true;
      } else if (now - this.lastAck > HEARTBEAT_DEADLINE_MS) {
        this.options.log.warn("tunnel heartbeat missed; reconnecting");
        tunnel.terminate();
        return;
      }
      this.sendRaw(HEARTBEAT_REQUEST, Buffer.byteLength(HEARTBEAT_REQUEST));
    }, HEARTBEAT_INTERVAL_MS);

    tunnel.on("message", (data: Uint8Array, isBinary: boolean) => {
      this.bytesReceived += data.byteLength;
      this.lastReceivedAt = Date.now();
      if (!isBinary) {
        if (textDecoder.decode(data) === HEARTBEAT_RESPONSE) {
          this.lastAck = Date.now();
          this.lastReceivedAckAt = this.lastAck;
          this.stallGraceSinceAck = false;
        }
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

  reguard(): number {
    let closed = 0;
    for (const [streamId, stream] of [...this.wsStreams]) {
      if (stream.guarded === null) continue;
      const verdict = this.guard(stream.guarded);
      if (verdict.allow) continue;
      closed += 1;
      this.forgetWsStream(streamId, stream);
      stream.socket.close(1008, verdict.code);
      this.send({
        type: "close-stream",
        streamId,
        code: 1008,
        reason: verdict.code,
      });
    }
    for (const [streamId, stream] of [...this.httpStreams]) {
      if (stream.guarded === null) continue;
      const verdict = this.guard(stream.guarded);
      if (verdict.allow) continue;
      closed += 1;
      this.httpStreams.delete(streamId);
      stream.abort.abort();
      this.send({
        type: "close-stream",
        streamId,
        code: 1008,
        reason: verdict.code,
      });
    }
    return closed;
  }

  dispose(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const s of this.httpStreams.values()) s.abort.abort();
    for (const s of this.wsStreams.values())
      s.socket.close(1001, "tunnel closed");
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
    if (this.options.tunnel.readyState === WS_TRANSPORT_OPEN) {
      const encoded = encodeFrame(frame);
      this.sendRaw(encoded, encoded.byteLength);
    }
  }

  private async waitForSendBuffer(signal: AbortSignal): Promise<void> {
    const { tunnel } = this.options;
    while (
      !signal.aborted &&
      tunnel.readyState === WS_TRANSPORT_OPEN &&
      (tunnel.bufferedAmount ?? 0) > SEND_BUFFER_HIGH_WATER_BYTES
    ) {
      await new Promise((resolve) => setTimeout(resolve, SEND_BUFFER_POLL_MS));
    }
  }

  private sendRaw(data: string | Uint8Array, byteLength: number): void {
    this.options.tunnel.send(data);
    this.bytesSent += byteLength;
    this.lastSentAt = Date.now();
  }

  private applyHeaderPolicy(
    headers: Record<string, string>,
  ): Record<string, string> {
    const strip = new Set(
      (this.options.stripRequestHeaders ?? []).map((name) =>
        name.toLowerCase(),
      ),
    );
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
      if (!strip.has(name.toLowerCase())) out[name] = value;
    }
    return { ...out, ...(this.options.injectRequestHeaders?.() ?? {}) };
  }

  private guardApplies(target: string | undefined): boolean {
    return this.options.guardStream !== undefined && target === undefined;
  }

  private guard(stream: StreamGuardInput): StreamGuardResult {
    return this.options.guardStream?.(stream) ?? { allow: true };
  }

  private rejectGuardedHttp(
    streamId: number,
    verdict: Extract<StreamGuardResult, { allow: false }>,
  ): void {
    const body = textEncoder.encode(
      JSON.stringify({ error: verdict.message, code: verdict.code }),
    );
    this.send({
      type: "resp-head",
      streamId,
      status: verdict.status,
      headers: [
        ["content-type", "application/json; charset=utf-8"],
        ["cache-control", "no-store"],
      ],
    });
    for (const c of chunkBody(streamId, body)) this.send(c);
    this.send({ type: "body-end", streamId });
  }

  private onFrame(frame: Frame): void {
    this.noteActivity();
    switch (frame.type) {
      case "open-http": {
        const stream: HttpStream = {
          meta: frame,
          chunks: [],
          abort: new AbortController(),
          guarded: null,
        };
        this.httpStreams.set(frame.streamId, stream);
        if (!frame.hasBody) void this.executeHttp(frame.streamId, stream);
        return;
      }
      case "body-chunk":
        this.httpStreams
          .get(frame.streamId)
          ?.chunks.push(Buffer.from(frame.data));
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
        s.socket.send(
          frame.isBinary ? frame.data : Buffer.from(frame.data).toString(),
        );
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
    let path = meta.path;
    if (this.guardApplies(meta.target)) {
      const canonical = canonicalStreamPath(meta.path);
      if (canonical === null) {
        this.rejectGuardedHttp(streamId, {
          allow: false,
          status: 400,
          code: "malformed_path",
          message: "request path is not canonical",
        });
        this.httpStreams.delete(streamId);
        return;
      }
      path = canonical.forward;
      const guarded: StreamGuardInput = {
        kind: "http",
        method: meta.method,
        path: canonical.guard,
        headers: meta.headers,
        target: meta.target,
      };
      const verdict = this.guard(guarded);
      if (!verdict.allow) {
        this.rejectGuardedHttp(streamId, verdict);
        this.httpStreams.delete(streamId);
        return;
      }
      stream.guarded = guarded;
    }
    const originResult = this.options.resolveOrigin(meta.target);
    if (originResult.kind === "unregistered") {
      this.rejectUnregisteredHttp(streamId);
      this.httpStreams.delete(streamId);
      return;
    }
    const { resolved } = originResult;
    const headers = this.applyHeaderPolicy(
      headersForLoopbackRequest(meta.headers, {
        publicOrigin: resolved.publicOrigin,
        loopbackOrigin: new URL(resolved.origin).origin,
        ...(resolved.host !== undefined ? { host: resolved.host } : {}),
      }),
    );
    try {
      const startedAt = performance.now();
      const body = meta.hasBody ? Buffer.concat(stream.chunks) : undefined;
      const res = await requestOriginHttp({
        url: new URL(`${resolved.origin.replace(/\/$/u, "")}${path}`),
        method: meta.method,
        headers,
        body,
        signal: stream.abort.signal,
      });
      const originTtfbMs = performance.now() - startedAt;
      const respHeaders = responseHeaderPairs(res);
      const initialThreadLoad = isInitialThreadLoad(meta.path);
      if (initialThreadLoad) {
        respHeaders.push([
          "server-timing",
          `bb_connect_origin;dur=${roundDurationMs(originTtfbMs)}`,
        ]);
      }
      this.send({
        type: "resp-head",
        streamId,
        status: res.statusCode ?? 502,
        headers: respHeaders,
      });
      let responseBytes = 0;
      for await (const chunk of res) {
        const value =
          chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk));
        responseBytes += value.byteLength;
        for (const frame of chunkBody(streamId, value)) this.send(frame);
        await this.waitForSendBuffer(stream.abort.signal);
      }
      this.send({ type: "body-end", streamId });
      if (initialThreadLoad) {
        const totalMs = performance.now() - startedAt;
        this.options.log.info?.(
          [
            "bb connect thread load",
            `path=${meta.path}`,
            `status=${res.statusCode ?? 502}`,
            `originTtfbMs=${roundDurationMs(originTtfbMs)}`,
            `originBodyMs=${roundDurationMs(totalMs - originTtfbMs)}`,
            `totalMs=${roundDurationMs(totalMs)}`,
            `responseBytes=${responseBytes}`,
            `contentEncoding=${res.headers["content-encoding"] ?? "identity"}`,
          ].join(" "),
        );
      }
    } catch (e) {
      if (!stream.abort.signal.aborted) {
        this.options.log.warn(
          `origin http error on ${meta.method} ${new URL(meta.path, "http://bb.local").pathname}: ${String(e)}`,
        );
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
    let path = frame.path;
    let guarded: StreamGuardInput | null = null;
    if (this.guardApplies(frame.target)) {
      const canonical = canonicalStreamPath(frame.path);
      if (canonical === null) {
        this.send({
          type: "close-stream",
          streamId: frame.streamId,
          code: 1008,
          reason: "malformed_path",
        });
        return;
      }
      path = canonical.forward;
      guarded = {
        kind: "ws",
        method: "GET",
        path: canonical.guard,
        headers: frame.headers,
        target: frame.target,
      };
      const verdict = this.guard(guarded);
      if (!verdict.allow) {
        this.send({
          type: "close-stream",
          streamId: frame.streamId,
          code: 1008,
          reason: verdict.code,
        });
        return;
      }
    }
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
    const headers = this.applyHeaderPolicy(
      headersForLoopbackRequest(frame.headers, {
        publicOrigin: resolved.publicOrigin,
        loopbackOrigin: new URL(resolved.origin).origin,
        ...(resolved.host !== undefined ? { host: resolved.host } : {}),
      }),
    );
    const countsAsRemoteClient = isBareBbRealtimeWs(frame.path, frame.target);
    let socket: NodeWebSocket;
    try {
      socket = new NodeWebSocket(`${wsOrigin}${path}`, frame.protocols, {
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
      guarded,
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
      this.options.log.warn(`origin ws error on ${frame.path}: ${e.message}`);
    });
  }
}
