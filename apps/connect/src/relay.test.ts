import { describe, expect, it, vi } from "vitest";
import {
  MAX_CHUNK_BYTES,
  decodeFrame,
  encodeFrame,
  type Frame,
} from "@bb/tunnel-contract";

import type { GateProgress } from "./gate-deadline.js";
import {
  RELAY_CONTENT_LENGTH_HEADER,
  RELAY_HAS_BODY_HEADER,
  RELAY_HEADER,
  RELAY_METHOD_HEADER,
} from "./protocol-headers.js";
import {
  fetchThroughRelay,
  relayUpgradeRequest,
  workerHeldResponsesEnabled,
} from "./relay.js";

class FakeRelaySocket extends EventTarget {
  binaryType = "blob";
  accepted = false;
  readonly sent: Frame[] = [];
  readonly closes: Array<{ code: number; reason: string }> = [];

  accept(): void {
    this.accepted = true;
  }

  send(data: Uint8Array): void {
    this.sent.push(decodeFrame(data));
  }

  close(code: number, reason: string): void {
    this.closes.push({ code, reason });
  }

  deliver(frame: Frame): void {
    const bytes = encodeFrame(frame);
    const event = new Event("message");
    Object.defineProperty(event, "data", {
      value: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ),
    });
    this.dispatchEvent(event);
  }

  peerClose(code: number, reason: string): void {
    const event = new Event("close");
    Object.defineProperty(event, "code", { value: code });
    Object.defineProperty(event, "reason", { value: reason });
    this.dispatchEvent(event);
  }
}

function upgradedWith(socket: FakeRelaySocket, relayHeader = "1") {
  const requests: Request[] = [];
  const stub = {
    fetch: async (request: Request) => {
      requests.push(request);
      return {
        status: 101,
        headers: new Headers(
          relayHeader === "" ? {} : { [RELAY_HEADER]: relayHeader },
        ),
        webSocket: socket,
      } as unknown as Response;
    },
  };
  return { stub, requests };
}

const STREAM_ID = 7;

function newProgress(): GateProgress {
  return { stage: "routing", tunnelObjectAttempts: 0, routingKey: null };
}

describe("relay upgrade request", () => {
  it("carries the visitor request as a bodiless websocket upgrade", () => {
    const upgrade = relayUpgradeRequest(
      new Request("https://sawyer.getbb.app/api/v1/threads?limit=5", {
        method: "POST",
        headers: {
          "content-length": "11",
          "content-type": "application/json",
          cookie: "a=b",
        },
        body: '{"ok":true}',
      }),
    );

    expect(upgrade.method).toBe("GET");
    expect(upgrade.url).toBe("https://sawyer.getbb.app/api/v1/threads?limit=5");
    expect(upgrade.body).toBeNull();
    expect(upgrade.headers.get("upgrade")).toBe("websocket");
    expect(upgrade.headers.get(RELAY_HEADER)).toBe("1");
    expect(upgrade.headers.get(RELAY_METHOD_HEADER)).toBe("POST");
    expect(upgrade.headers.get(RELAY_HAS_BODY_HEADER)).toBe("1");
    expect(upgrade.headers.get("content-length")).toBeNull();
    expect(upgrade.headers.get(RELAY_CONTENT_LENGTH_HEADER)).toBe("11");
    expect(upgrade.headers.get("content-type")).toBe("application/json");
    expect(upgrade.headers.get("cookie")).toBe("a=b");
  });

  it("marks a request without a body", () => {
    const upgrade = relayUpgradeRequest(
      new Request("https://sawyer.getbb.app/app.js"),
    );
    expect(upgrade.headers.get(RELAY_METHOD_HEADER)).toBe("GET");
    expect(upgrade.headers.get(RELAY_HAS_BODY_HEADER)).toBe("0");
    expect(upgrade.headers.get(RELAY_CONTENT_LENGTH_HEADER)).toBeNull();
  });
});

describe("workerHeldResponsesEnabled", () => {
  it("is on only for the exact value on, so a mistyped setting keeps the object-held path", () => {
    expect(workerHeldResponsesEnabled({})).toBe(false);
    expect(workerHeldResponsesEnabled({ WORKER_HELD_RESPONSES: "off" })).toBe(
      false,
    );
    expect(workerHeldResponsesEnabled({ WORKER_HELD_RESPONSES: "on" })).toBe(
      true,
    );
    expect(workerHeldResponsesEnabled({ WORKER_HELD_RESPONSES: " on " })).toBe(
      true,
    );
    expect(workerHeldResponsesEnabled({ WORKER_HELD_RESPONSES: "true" })).toBe(
      false,
    );
    expect(workerHeldResponsesEnabled({ WORKER_HELD_RESPONSES: "ON" })).toBe(
      false,
    );
  });
});

describe("fetchThroughRelay", () => {
  it("streams the origin response from relayed frames and closes the relay when it ends", async () => {
    const socket = new FakeRelaySocket();
    const { stub } = upgradedWith(socket);
    const pending = fetchThroughRelay(
      stub,
      new Request("https://sawyer.getbb.app/api/v1/threads"),
      newProgress(),
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(socket.accepted).toBe(true));
    expect(socket.binaryType).toBe("arraybuffer");

    socket.deliver({
      type: "resp-head",
      streamId: STREAM_ID,
      status: 200,
      headers: [
        ["content-type", "application/json"],
        ["connection", "keep-alive"],
      ],
    });
    const response = await pending;
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("application/json");
    expect(response?.headers.get("connection")).toBeNull();

    const encoder = new TextEncoder();
    socket.deliver({
      type: "body-chunk",
      streamId: STREAM_ID,
      data: encoder.encode('{"answer":'),
    });
    socket.deliver({
      type: "body-chunk",
      streamId: STREAM_ID,
      data: encoder.encode('"ready"}'),
    });
    socket.deliver({ type: "body-end", streamId: STREAM_ID });

    await expect(response?.json()).resolves.toEqual({ answer: "ready" });
    expect(socket.closes).toEqual([{ code: 1000, reason: "done" }]);
  });

  it("answers bodiless statuses without a body stream", async () => {
    const socket = new FakeRelaySocket();
    const { stub } = upgradedWith(socket);
    const pending = fetchThroughRelay(
      stub,
      new Request("https://sawyer.getbb.app/app.js", {
        headers: { "if-none-match": 'W/"abc"' },
      }),
      newProgress(),
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(socket.accepted).toBe(true));
    socket.deliver({
      type: "resp-head",
      streamId: STREAM_ID,
      status: 304,
      headers: [["etag", 'W/"abc"']],
    });
    const response = await pending;
    expect(response?.status).toBe(304);
    expect(response?.body).toBeNull();
    expect(response?.headers.get("etag")).toBe('W/"abc"');
    expect(socket.closes).toEqual([{ code: 1000, reason: "done" }]);
  });

  it("sends the request body as frames the tunnel object can re-address", async () => {
    const socket = new FakeRelaySocket();
    const { stub, requests } = upgradedWith(socket);
    void fetchThroughRelay(
      stub,
      new Request("https://sawyer.getbb.app/api/v1/upload", {
        method: "POST",
        body: "hello body",
      }),
      newProgress(),
      new AbortController().signal,
    );
    await vi.waitFor(() =>
      expect(socket.sent.map((frame) => frame.type)).toEqual([
        "body-chunk",
        "body-end",
      ]),
    );
    const chunk = socket.sent[0];
    expect(
      chunk?.type === "body-chunk" && new TextDecoder().decode(chunk.data),
    ).toBe("hello body");
    expect(requests[0]?.headers.get(RELAY_HAS_BODY_HEADER)).toBe("1");
  });

  it("coalesces small body reads into full-size frames", async () => {
    const socket = new FakeRelaySocket();
    const { stub } = upgradedWith(socket);
    const readBytes = 4 * 1024;
    const bytes = new Uint8Array(2 * MAX_CHUNK_BYTES + readBytes).map(
      (_, index) => index % 251,
    );
    void fetchThroughRelay(
      stub,
      new Request("https://sawyer.getbb.app/api/v1/upload", {
        method: "POST",
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            for (let offset = 0; offset < bytes.length; offset += readBytes) {
              controller.enqueue(bytes.slice(offset, offset + readBytes));
            }
            controller.close();
          },
        }),
        duplex: "half",
      } as RequestInit),
      newProgress(),
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(socket.sent.at(-1)?.type).toBe("body-end"));
    const chunks = socket.sent.flatMap((frame) =>
      frame.type === "body-chunk" ? [frame.data] : [],
    );
    expect(chunks.map((chunk) => chunk.length)).toEqual([
      MAX_CHUNK_BYTES,
      MAX_CHUNK_BYTES,
      readBytes,
    ]);
    expect(Buffer.concat(chunks).equals(bytes)).toBe(true);
  });

  it("answers 504 and closes the relay when the gate gives up on the head", async () => {
    const socket = new FakeRelaySocket();
    const { stub } = upgradedWith(socket);
    const gate = new AbortController();
    const pending = fetchThroughRelay(
      stub,
      new Request("https://sawyer.getbb.app/slow"),
      newProgress(),
      gate.signal,
    );
    await vi.waitFor(() => expect(socket.accepted).toBe(true));
    gate.abort();
    const response = await pending;
    expect(response?.status).toBe(504);
    await expect(response?.text()).resolves.toContain(
      "timed out waiting for the tunnel client",
    );
    expect(socket.closes).toHaveLength(1);
  });

  it("answers 502 when the tunnel drops before the response head", async () => {
    const socket = new FakeRelaySocket();
    const { stub } = upgradedWith(socket);
    const pending = fetchThroughRelay(
      stub,
      new Request("https://sawyer.getbb.app/pending"),
      newProgress(),
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(socket.accepted).toBe(true));
    socket.peerClose(1011, "tunnel reconnected mid-request");
    const response = await pending;
    expect(response?.status).toBe(502);
    await expect(response?.text()).resolves.toBe(
      "bb connect: tunnel reconnected mid-request\n",
    );
  });

  it("answers 502 when the tunnel client aborts before the response head", async () => {
    const socket = new FakeRelaySocket();
    const { stub } = upgradedWith(socket);
    const pending = fetchThroughRelay(
      stub,
      new Request("https://sawyer.getbb.app/broken"),
      newProgress(),
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(socket.accepted).toBe(true));
    socket.deliver({
      type: "close-stream",
      streamId: STREAM_ID,
      code: 1011,
      reason: "ECONNREFUSED",
    });
    const response = await pending;
    expect(response?.status).toBe(502);
    await expect(response?.text()).resolves.toContain(
      "tunnel client aborted: ECONNREFUSED",
    );
  });

  it("errors the body when the tunnel drops after the response head", async () => {
    const socket = new FakeRelaySocket();
    const { stub } = upgradedWith(socket);
    const pending = fetchThroughRelay(
      stub,
      new Request("https://sawyer.getbb.app/mid-body"),
      newProgress(),
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(socket.accepted).toBe(true));
    socket.deliver({
      type: "resp-head",
      streamId: STREAM_ID,
      status: 200,
      headers: [["content-type", "text/plain"]],
    });
    const response = await pending;
    socket.peerClose(1011, "tunnel disconnected mid-request");
    await expect(response?.text()).rejects.toBeTruthy();
  });

  it("closes the relay with the cancel reason when the visitor stops reading", async () => {
    const socket = new FakeRelaySocket();
    const { stub } = upgradedWith(socket);
    const pending = fetchThroughRelay(
      stub,
      new Request("https://sawyer.getbb.app/stream"),
      newProgress(),
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(socket.accepted).toBe(true));
    socket.deliver({
      type: "resp-head",
      streamId: STREAM_ID,
      status: 200,
      headers: [["content-type", "text/event-stream"]],
    });
    const response = await pending;
    await response?.body?.cancel("visitor left");
    expect(socket.closes).toEqual([
      { code: 1000, reason: "visitor canceled response body" },
    ]);
  });

  it("answers 502 for a status that cannot be relayed", async () => {
    const socket = new FakeRelaySocket();
    const { stub } = upgradedWith(socket);
    const pending = fetchThroughRelay(
      stub,
      new Request("https://sawyer.getbb.app/weird"),
      newProgress(),
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(socket.accepted).toBe(true));
    socket.deliver({
      type: "resp-head",
      streamId: STREAM_ID,
      status: 199,
      headers: [],
    });
    const response = await pending;
    expect(response?.status).toBe(502);
    await expect(response?.text()).resolves.toContain("unrelayable");
  });

  it("passes a plain tunnel-object answer through untouched", async () => {
    const offline = new Response("offline", { status: 503 });
    const stub = { fetch: async () => offline };
    await expect(
      fetchThroughRelay(
        stub,
        new Request("https://sawyer.getbb.app/"),
        newProgress(),
        new AbortController().signal,
      ),
    ).resolves.toBe(offline);
  });

  it("reports no relay when the tunnel object predates it, leaving the request body unread", async () => {
    const socket = new FakeRelaySocket();
    const { stub } = upgradedWith(socket, "");
    const request = new Request("https://sawyer.getbb.app/api/v1/upload", {
      method: "POST",
      body: "kept",
    });
    await expect(
      fetchThroughRelay(
        stub,
        request,
        newProgress(),
        new AbortController().signal,
      ),
    ).resolves.toBeNull();
    expect(socket.closes).toEqual([
      { code: 1000, reason: "relay unsupported" },
    ]);
    expect(request.bodyUsed).toBe(false);
    expect(socket.sent).toEqual([]);
  });
});
