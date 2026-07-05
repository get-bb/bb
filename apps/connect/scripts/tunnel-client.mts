// bb connect tunnel client (M3). Redeems a connect code for a durable
// credential, holds an outbound WebSocket to the per-handle gate, and proxies
// relayed HTTP/WS streams to a local origin (your bb server).
//
// This standalone script proves the full authenticated tunnel e2e on staging;
// the same logic moves into apps/host-daemon for productization.
//
//   --code <CODE>          one-time connect code from the dashboard (first pair)
//   --server <url>         https://<handle>.<domain>  (from the dashboard)
//   --app-url <url>        https://<domain>  (redemption endpoint; default derives from --server)
//   --origin <url>         local server to expose (default http://127.0.0.1:9999)
//   --store <path>         credential store (default ~/.bb/cloud.json)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import WebSocket from "ws";
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

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const SERVER_URL = arg("server");
if (!SERVER_URL) throw new Error("--server https://<handle>.<domain> is required");
const APP_URL = arg("app-url") ?? new URL(SERVER_URL).origin.replace(/\/\/[^.]+\./, "//");
const ORIGIN = (arg("origin") ?? "http://127.0.0.1:9999").replace(/\/$/, "");
const STORE = arg("store") ?? `${homedir()}/.bb/cloud.json`;
const CODE = arg("code");

const TUNNEL_URL = SERVER_URL.replace(/^http/, "ws").replace(/\/$/, "") + "/__tunnel";
const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_DEADLINE_MS = 60_000;
const SKIP_REQUEST_HEADERS = new Set(["host", "content-length", "connection", "accept-encoding"]);

function log(m: string): void {
  console.log(`[tunnel-client ${new Date().toISOString()}] ${m}`);
}

interface Stored {
  [serverUrl: string]: { credential: string; handle: string };
}

function loadStore(): Stored {
  try {
    return JSON.parse(readFileSync(STORE, "utf8")) as Stored;
  } catch {
    return {};
  }
}

function saveCredential(credential: string, handle: string): void {
  const store = loadStore();
  store[SERVER_URL!] = { credential, handle };
  mkdirSync(dirname(STORE), { recursive: true });
  writeFileSync(STORE, JSON.stringify(store, null, 2), { mode: 0o600 });
}

async function redeem(code: string): Promise<{ credential: string; handle: string }> {
  const res = await fetch(`${APP_URL}/api/connect/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    throw new Error(`redeem failed: ${res.status} ${JSON.stringify(await res.json().catch(() => ({})))}`);
  }
  const data = (await res.json()) as { credential: string; handle: string };
  saveCredential(data.credential, data.handle);
  log(`paired as ${data.handle}; credential stored in ${STORE}`);
  return data;
}

async function resolveCredential(): Promise<string> {
  if (CODE) return (await redeem(CODE)).credential;
  const stored = loadStore()[SERVER_URL!];
  if (stored) return stored.credential;
  throw new Error("no stored credential for this server; pass --code to pair");
}

interface HttpStream {
  meta: OpenHttpFrame;
  chunks: Buffer[];
  abort: AbortController;
}
interface WsStream {
  socket: WebSocket;
  buffered: Frame[];
  open: boolean;
}

class TunnelSession {
  private readonly httpStreams = new Map<number, HttpStream>();
  private readonly wsStreams = new Map<number, WsStream>();
  private lastAck = Date.now();

  constructor(private readonly tunnel: WebSocket) {}

  start(): void {
    const hb = setInterval(() => {
      if (Date.now() - this.lastAck > HEARTBEAT_DEADLINE_MS) {
        log("heartbeat deadline missed; terminating to reconnect");
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
        log(`bad frame: ${String(e)}`);
      }
    });
    this.tunnel.on("close", () => {
      clearInterval(hb);
      for (const s of this.httpStreams.values()) s.abort.abort();
      for (const s of this.wsStreams.values()) s.socket.close(1001, "tunnel closed");
      this.httpStreams.clear();
      this.wsStreams.clear();
    });
  }

  private send(frame: Frame): void {
    if (this.tunnel.readyState === WebSocket.OPEN) this.tunnel.send(encodeFrame(frame));
  }

  private onFrame(frame: Frame): void {
    switch (frame.type) {
      case "open-http": {
        const stream: HttpStream = { meta: frame, chunks: [], abort: new AbortController() };
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

  private async executeHttp(streamId: number, stream: HttpStream): Promise<void> {
    const { meta } = stream;
    const headers: Record<string, string> = {};
    for (const [n, v] of meta.headers) if (!SKIP_REQUEST_HEADERS.has(n.toLowerCase())) headers[n] = v;
    try {
      const body = meta.hasBody ? Buffer.concat(stream.chunks) : undefined;
      const res = await fetch(`${ORIGIN}${meta.path}`, {
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
      this.send({ type: "resp-head", streamId, status: res.status, headers: respHeaders });
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
    const wsOrigin = ORIGIN.replace(/^http/, "ws");
    const headers: Record<string, string> = {};
    for (const [n, v] of frame.headers) if (!SKIP_REQUEST_HEADERS.has(n.toLowerCase())) headers[n] = v;
    const socket = new WebSocket(`${wsOrigin}${frame.path}`, frame.protocols, { headers });
    const stream: WsStream = { socket, buffered: [], open: false };
    this.wsStreams.set(frame.streamId, stream);
    socket.on("open", () => {
      stream.open = true;
      this.send({ type: "ws-open-ack", streamId: frame.streamId, protocol: socket.protocol || null });
      for (const b of stream.buffered) this.onFrame(b);
      stream.buffered = [];
    });
    socket.on("message", (data: Buffer, isBinary: boolean) => {
      this.send({
        type: "ws-data",
        streamId: frame.streamId,
        isBinary,
        data: isBinary ? new Uint8Array(data) : new Uint8Array(Buffer.from(data.toString())),
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
    socket.on("error", (e: Error) => log(`origin ws ${frame.path} error: ${e.message}`));
  }
}

let attempt = 0;

async function connect(credential: string): Promise<void> {
  log(`connecting to ${TUNNEL_URL} (origin ${ORIGIN})`);
  const tunnel = new WebSocket(TUNNEL_URL, { headers: { authorization: `Bearer ${credential}` } });
  let connectedAt = 0;
  tunnel.on("open", () => {
    connectedAt = Date.now();
    log("tunnel connected");
    new TunnelSession(tunnel).start();
  });
  tunnel.on("unexpected-response", (_req, res) => {
    log(`tunnel rejected: HTTP ${res.statusCode}`);
  });
  tunnel.on("error", (e: Error) => log(`tunnel error: ${e.message}`));
  tunnel.on("close", (code: number, reason: Buffer) => {
    const stable = connectedAt ? Date.now() - connectedAt : 0;
    attempt = stable > 10_000 ? 0 : attempt + 1;
    const delay = Math.min(1000 * 2 ** attempt, 30_000);
    log(`tunnel closed (${code} ${reason.toString()}); reconnecting in ${delay}ms`);
    setTimeout(() => void connect(credential), delay);
  });
}

const credential = await resolveCredential();
void connect(credential);
