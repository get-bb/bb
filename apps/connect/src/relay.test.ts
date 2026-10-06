import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeFrame, encodeFrame, type Frame } from "@bb/tunnel-contract";

import {
  RELAY_CONTENT_LENGTH_HEADER,
  RELAY_HAS_BODY_HEADER,
  RELAY_HEADER,
  RELAY_METHOD_HEADER,
  TUNNEL_TARGET_HEADER,
} from "./protocol-headers.js";
import { RESP_HEAD_TIMEOUT_MS } from "./response-head-timeout.js";
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

afterEach(() => {
  vi.useRealTimers();
});

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

  it("answers 504 when the tunnel client never sends a response head", async () => {
    vi.useFakeTimers();
    const socket = new FakeRelaySocket();
    const { stub } = upgradedWith(socket);
    const pending = fetchThroughRelay(
      stub,
      new Request("https://sawyer.getbb.app/slow"),
    );
    await vi.advanceTimersByTimeAsync(RESP_HEAD_TIMEOUT_MS);
    const response = await pending;
    expect(response?.status).toBe(504);
    await expect(response?.text()).resolves.toContain(
      "timed out waiting for the tunnel client",
    );
    expect(socket.closes).toHaveLength(1);
  });

  describe("voice transcription response head", () => {
    function voiceRequest(
      init: { method?: string; headers?: Record<string, string> } = {},
    ) {
      return new Request(
        "https://sawyer.getbb.app/api/v1/system/voice-transcription",
        {
          method: init.method ?? "POST",
          ...(init.method === "GET" ? {} : { body: "audio" }),
          headers: init.headers ?? {},
        },
      );
    }

    it("relays a transcript whose head arrives after 85 seconds", async () => {
      vi.useFakeTimers();
      const socket = new FakeRelaySocket();
      const { stub } = upgradedWith(socket);
      let settled = false;
      const pending = fetchThroughRelay(stub, voiceRequest()).then(
        (response) => {
          settled = true;
          return response;
        },
      );
      await vi.advanceTimersByTimeAsync(85_000);
      expect(settled).toBe(false);
      socket.deliver({
        type: "resp-head",
        streamId: STREAM_ID,
        status: 200,
        headers: [["content-type", "application/json"]],
      });
      socket.deliver({
        type: "body-chunk",
        streamId: STREAM_ID,
        data: new TextEncoder().encode('{"text":"a long note"}'),
      });
      socket.deliver({ type: "body-end", streamId: STREAM_ID });
      const response = await pending;
      expect(response?.status).toBe(200);
      await expect(response?.json()).resolves.toEqual({ text: "a long note" });
    });

    it("answers 504 and closes the relay after 90 seconds without a head", async () => {
      vi.useFakeTimers();
      const socket = new FakeRelaySocket();
      const { stub } = upgradedWith(socket);
      let settled = false;
      const pending = fetchThroughRelay(stub, voiceRequest()).then(
        (response) => {
          settled = true;
          return response;
        },
      );
      await vi.advanceTimersByTimeAsync(89_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const response = await pending;
      expect(response?.status).toBe(504);
      await expect(response?.text()).resolves.toContain(
        "timed out waiting for the tunnel client",
      );
      expect(socket.closes).toHaveLength(1);
    });

    it.each([
      ["a GET of the voice path", voiceRequest({ method: "GET" })],
      [
        "a port share at the voice path",
        voiceRequest({ headers: { [TUNNEL_TARGET_HEADER]: "8000" } }),
      ],
      [
        "another upload",
        new Request("https://sawyer.getbb.app/api/v1/upload", {
          method: "POST",
          body: "file",
        }),
      ],
    ])("keeps the 30 second head deadline for %s", async (_name, request) => {
      vi.useFakeTimers();
      const socket = new FakeRelaySocket();
      const { stub } = upgradedWith(socket);
      const pending = fetchThroughRelay(stub, request);
      await vi.advanceTimersByTimeAsync(30_000);
      const response = await pending;
      expect(response?.status).toBe(504);
    });
  });

  it("answers 502 when the tunnel drops before the response head", async () => {
    const socket = new FakeRelaySocket();
    const { stub } = upgradedWith(socket);
    const pending = fetchThroughRelay(
      stub,
      new Request("https://sawyer.getbb.app/pending"),
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
      fetchThroughRelay(stub, new Request("https://sawyer.getbb.app/")),
    ).resolves.toBe(offline);
  });

  it("reports no relay when the tunnel object predates it, leaving the request body unread", async () => {
    const socket = new FakeRelaySocket();
    const { stub } = upgradedWith(socket, "");
    const request = new Request("https://sawyer.getbb.app/api/v1/upload", {
      method: "POST",
      body: "kept",
    });
    await expect(fetchThroughRelay(stub, request)).resolves.toBeNull();
    expect(socket.closes).toEqual([
      { code: 1000, reason: "relay unsupported" },
    ]);
    expect(request.bodyUsed).toBe(false);
    expect(socket.sent).toEqual([]);
  });
});
