// Regression cover for the two halves of a truncated relay: a body pushed onto
// the tunnel faster than the peer drains it, and a heartbeat watchdog that
// mistook the resulting send backlog for a dead tunnel and terminated it
// mid-transfer. Together they truncated every large download through bb connect
// (the ~32 MB bb-app package the machine installer fetches), leaving npm to
// fail on a short tarball.
import { createServer, type Server } from "node:http";
import { WebSocket as NodeWebSocket } from "ws";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { decodeFrame, encodeFrame, type Frame } from "@bb/tunnel-contract";
import { TunnelSession } from "../src/session.js";

const BODY_BYTES = 8 * 1024 * 1024;
/** Must match SEND_HIGH_WATER_MARK_BYTES in src/session.ts. */
const HIGH_WATER_MARK_BYTES = 1024 * 1024;

let server: Server;
let origin: string;

beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "application/gzip",
      "content-length": String(BODY_BYTES),
    });
    response.end(Buffer.alloc(BODY_BYTES, 7));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("test origin has no port");
  }
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

interface QueuedSend {
  byteLength: number;
  callback: (error?: Error) => void;
}

/**
 * A tunnel socket whose send queue only drains when the test says so, which is
 * what makes the high-water-mark behavior observable without racing a real
 * kernel socket buffer.
 */
class FakeTunnelSocket {
  readyState: number = NodeWebSocket.OPEN;
  bufferedAmount = 0;
  terminated = 0;
  readonly sentFrames: Frame[] = [];
  readonly textSends: string[] = [];
  private readonly queue: QueuedSend[] = [];
  private readonly listeners = new Map<
    string,
    ((...args: never[]) => void)[]
  >();

  send(data: Uint8Array | string, callback?: (error?: Error) => void): void {
    if (typeof data === "string") {
      this.textSends.push(data);
      callback?.(undefined);
      return;
    }
    this.sentFrames.push(decodeFrame(Buffer.from(data)));
    this.bufferedAmount += data.byteLength;
    this.queue.push({
      byteLength: data.byteLength,
      callback: callback ?? (() => {}),
    });
  }

  /** Flush every queued frame, as a peer catching up would. */
  drain(): void {
    for (const queued of this.queue.splice(0)) {
      this.bufferedAmount -= queued.byteLength;
      queued.callback(undefined);
    }
  }

  terminate(): void {
    this.terminated += 1;
    this.readyState = NodeWebSocket.CLOSED;
  }

  on(event: string, listener: (...args: never[]) => void): this {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
    return this;
  }

  emitFrame(frame: Frame): void {
    for (const listener of this.listeners.get("message") ?? []) {
      (listener as (data: Buffer, isBinary: boolean) => void)(
        Buffer.from(encodeFrame(frame)),
        true,
      );
    }
  }

  bodyBytesSent(): number {
    return this.sentFrames.reduce(
      (total, frame) =>
        frame.type === "body-chunk" ? total + frame.data.byteLength : total,
      0,
    );
  }

  sawBodyEnd(): boolean {
    return this.sentFrames.some((frame) => frame.type === "body-end");
  }
}

function createSession(
  socket: FakeTunnelSocket,
  resolveOrigin: TunnelSessionOptionsOrigin,
): TunnelSession {
  return new TunnelSession({
    tunnel: socket as unknown as NodeWebSocket,
    log: { warn: () => {}, info: () => {} },
    resolveOrigin,
  });
}

type TunnelSessionOptionsOrigin = ConstructorParameters<
  typeof TunnelSession
>[0]["resolveOrigin"];

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("TunnelSession body relay", () => {
  it("holds a large body at the send high-water mark and still relays it whole", async () => {
    const socket = new FakeTunnelSocket();
    const session = createSession(socket, () => ({
      kind: "ok",
      resolved: { origin, publicOrigin: origin },
    }));
    session.start();
    socket.emitFrame({
      type: "open-http",
      streamId: 1,
      method: "GET",
      path: "/install/bb-app.tgz",
      headers: [],
      hasBody: false,
    });

    // The relay must stop while the peer is behind instead of queueing the whole
    // body: that backlog is what starved the heartbeat and got the tunnel killed.
    await waitFor(
      () => socket.bufferedAmount > HIGH_WATER_MARK_BYTES,
      "the send queue to reach the high-water mark",
    );
    const bufferedWhileStalled = socket.bufferedAmount;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(socket.bufferedAmount).toBe(bufferedWhileStalled);
    expect(socket.bodyBytesSent()).toBeLessThan(BODY_BYTES);

    // Draining lets it resume; nothing may be dropped along the way.
    while (!socket.sawBodyEnd()) {
      socket.drain();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(socket.bodyBytesSent()).toBe(BODY_BYTES);
    session.dispose();
  });
});

describe("TunnelSession heartbeat watchdog", () => {
  const unregisteredOrigin: TunnelSessionOptionsOrigin = () => ({
    kind: "unregistered",
  });

  function relayOneFrame(socket: FakeTunnelSocket, streamId: number): void {
    socket.emitFrame({
      type: "open-http",
      streamId,
      method: "GET",
      path: "/",
      headers: [],
      hasBody: false,
    });
    socket.drain();
  }

  it("keeps a tunnel that is still flushing bytes, then drops a silent one", () => {
    vi.useFakeTimers();
    const socket = new FakeTunnelSocket();
    const session = createSession(socket, unregisteredOrigin);
    session.start();

    // Bytes keep reaching the peer but no heartbeat ack ever comes back, which
    // is exactly the shape of a long download: alive, just busy.
    for (let tick = 0; tick < 6; tick += 1) {
      relayOneFrame(socket, tick + 1);
      vi.advanceTimersByTime(20_000);
    }
    expect(socket.terminated).toBe(0);

    // Once nothing is flushing, the overdue ack still ends the tunnel.
    vi.advanceTimersByTime(20_000);
    expect(socket.terminated).toBe(1);
    session.dispose();
  });
});
