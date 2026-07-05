// bb connect M0 spike tunnel client (plans/bb-connect-v1.md).
//
// Connects out to the TunnelDO and proxies relayed streams to a local origin
// (a bb server, or scripts/spike-origin.mts for protocol testing). The real
// client lands in apps/host-daemon in M3; this script exists to validate the
// wire protocol end to end.
//
//   BB_CONNECT_TUNNEL_URL  ws endpoint (default ws://127.0.0.1:8787/__tunnel)
//   BB_CONNECT_SECRET      spike shared secret (default local-dev-secret)
//   BB_CONNECT_ORIGIN      local origin to proxy to (default http://127.0.0.1:9999)

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

const TUNNEL_URL = process.env.BB_CONNECT_TUNNEL_URL ?? "ws://127.0.0.1:8787/__tunnel";
const SECRET = process.env.BB_CONNECT_SECRET ?? "local-dev-secret";
const ORIGIN = (process.env.BB_CONNECT_ORIGIN ?? "http://127.0.0.1:9999").replace(/\/$/, "");

const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_DEADLINE_MS = 60_000;

const SKIP_REQUEST_HEADERS = new Set(["host", "content-length", "connection", "accept-encoding"]);

function log(message: string): void {
  console.log(`[spike-client ${new Date().toISOString()}] ${message}`);
}

interface HttpStream {
  meta: OpenHttpFrame;
  chunks: Buffer[];
  abort: AbortController;
}

interface WsStream {
  socket: WebSocket;
  /** ws-data frames that arrived before the origin socket opened. */
  buffered: Frame[];
  open: boolean;
}

class TunnelSession {
  private readonly httpStreams = new Map<number, HttpStream>();
  private readonly wsStreams = new Map<number, WsStream>();
  private lastHeartbeatAck = Date.now();

  constructor(private readonly tunnel: WebSocket) {}

  start(): void {
    const heartbeat = setInterval(() => {
      if (Date.now() - this.lastHeartbeatAck > HEARTBEAT_DEADLINE_MS) {
        log("heartbeat deadline missed; terminating socket to force reconnect");
        this.tunnel.terminate();
        return;
      }
      this.tunnel.send(HEARTBEAT_REQUEST);
    }, HEARTBEAT_INTERVAL_MS);

    this.tunnel.on("message", (data: Buffer, isBinary: boolean) => {
      if (!isBinary) {
        if (data.toString() === HEARTBEAT_RESPONSE) this.lastHeartbeatAck = Date.now();
        return;
      }
      try {
        this.onFrame(decodeFrame(data));
      } catch (error) {
        log(`bad frame: ${String(error)}`);
      }
    });

    this.tunnel.on("close", () => {
      clearInterval(heartbeat);
      for (const stream of this.httpStreams.values()) stream.abort.abort();
      for (const stream of this.wsStreams.values()) stream.socket.close(1001, "tunnel closed");
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
        // Spike simplification: request bodies are buffered, not streamed.
        if (!frame.hasBody) void this.executeHttp(frame.streamId, stream);
        return;
      }
      case "body-chunk":
        this.httpStreams.get(frame.streamId)?.chunks.push(Buffer.from(frame.data));
        return;
      case "body-end": {
        const stream = this.httpStreams.get(frame.streamId);
        if (stream) void this.executeHttp(frame.streamId, stream);
        return;
      }
      case "open-ws":
        this.openOriginWebSocket(frame);
        return;
      case "ws-data": {
        const stream = this.wsStreams.get(frame.streamId);
        if (!stream) return;
        if (!stream.open) {
          stream.buffered.push(frame);
          return;
        }
        stream.socket.send(frame.isBinary ? frame.data : Buffer.from(frame.data).toString());
        return;
      }
      case "close-stream": {
        const http = this.httpStreams.get(frame.streamId);
        if (http) {
          http.abort.abort();
          this.httpStreams.delete(frame.streamId);
          return;
        }
        const ws = this.wsStreams.get(frame.streamId);
        if (ws) {
          ws.socket.close(frame.code, frame.reason);
          this.wsStreams.delete(frame.streamId);
        }
        return;
      }
      case "resp-head":
      case "ws-open-ack":
        return; // client-originated frames; never received
    }
  }

  private async executeHttp(streamId: number, stream: HttpStream): Promise<void> {
    const { meta } = stream;
    const headers: Record<string, string> = {};
    for (const [name, value] of meta.headers) {
      if (!SKIP_REQUEST_HEADERS.has(name.toLowerCase())) headers[name] = value;
    }
    try {
      const body = meta.hasBody ? Buffer.concat(stream.chunks) : undefined;
      const response = await fetch(`${ORIGIN}${meta.path}`, {
        method: meta.method,
        headers,
        body,
        redirect: "manual",
        signal: stream.abort.signal,
      });
      const responseHeaders: HeaderPair[] = [];
      response.headers.forEach((value, name) => {
        if (name.toLowerCase() !== "content-encoding") responseHeaders.push([name, value]);
      });
      this.send({ type: "resp-head", streamId, status: response.status, headers: responseHeaders });
      if (response.body) {
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const chunk of chunkBody(streamId, value)) this.send(chunk);
        }
      }
      this.send({ type: "body-end", streamId });
      log(`${meta.method} ${meta.path} → ${response.status}`);
    } catch (error) {
      if (!stream.abort.signal.aborted) {
        log(`${meta.method} ${meta.path} failed: ${String(error)}`);
        this.send({ type: "close-stream", streamId, code: 1011, reason: String(error) });
      }
    } finally {
      this.httpStreams.delete(streamId);
    }
  }

  private openOriginWebSocket(frame: OpenWsFrame): void {
    const wsOrigin = ORIGIN.replace(/^http/, "ws");
    const headers: Record<string, string> = {};
    for (const [name, value] of frame.headers) {
      if (!SKIP_REQUEST_HEADERS.has(name.toLowerCase())) headers[name] = value;
    }
    const socket = new WebSocket(`${wsOrigin}${frame.path}`, frame.protocols, { headers });
    const stream: WsStream = { socket, buffered: [], open: false };
    this.wsStreams.set(frame.streamId, stream);

    socket.on("open", () => {
      stream.open = true;
      this.send({
        type: "ws-open-ack",
        streamId: frame.streamId,
        protocol: socket.protocol || null,
      });
      for (const buffered of stream.buffered) this.onFrame(buffered);
      stream.buffered = [];
      log(`ws open ${frame.path}`);
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
    socket.on("error", (error: Error) => {
      log(`ws ${frame.path} error: ${error.message}`);
    });
  }
}

let attempt = 0;

function connect(): void {
  log(`connecting to ${TUNNEL_URL} (origin ${ORIGIN})`);
  const tunnel = new WebSocket(TUNNEL_URL, {
    headers: { authorization: `Bearer ${SECRET}` },
  });
  const connectedAt = { value: 0 };

  tunnel.on("open", () => {
    connectedAt.value = Date.now();
    log("tunnel connected");
    new TunnelSession(tunnel).start();
  });
  tunnel.on("error", (error: Error) => {
    log(`tunnel error: ${error.message}`);
  });
  tunnel.on("close", (code: number, reason: Buffer) => {
    const stableFor = connectedAt.value ? Date.now() - connectedAt.value : 0;
    attempt = stableFor > 10_000 ? 0 : attempt + 1;
    const delay = Math.min(1000 * 2 ** attempt, 30_000);
    log(`tunnel closed (${code} ${reason.toString()}); reconnecting in ${delay}ms`);
    setTimeout(connect, delay);
  });
}

connect();
