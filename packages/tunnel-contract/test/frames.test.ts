import { describe, expect, it } from "vitest";
import {
  MAX_CHUNK_BYTES,
  chunkBody,
  decodeFrame,
  encodeFrame,
  peekFrame,
  parseReaderRequestContext,
  setFrameStreamId,
  type Frame,
} from "../src/index.js";

function roundTrip(frame: Frame): Frame {
  return decodeFrame(encodeFrame(frame));
}

describe("frame round-trips", () => {
  it("open-http without target", () => {
    const frame: Frame = {
      type: "open-http",
      streamId: 7,
      method: "POST",
      path: "/api/v1/threads?limit=5",
      headers: [
        ["content-type", "application/json"],
        ["accept", "*/*"],
      ],
      hasBody: true,
    };
    const out = roundTrip(frame);
    expect(out).toEqual(frame);
    expect(out.type).toBe("open-http");
    if (out.type !== "open-http") throw new Error("unreachable");
    expect(out.target).toBeUndefined();
  });

  it("open-http with target", () => {
    const frame: Frame = {
      type: "open-http",
      streamId: 7,
      method: "GET",
      path: "/",
      headers: [],
      hasBody: false,
      target: "8000",
    };
    expect(roundTrip(frame)).toEqual(frame);
  });

  it("open-http encoded without target decodes with target undefined", () => {
    const encoded = encodeFrame({
      type: "open-http",
      streamId: 1,
      method: "GET",
      path: "/",
      headers: [],
      hasBody: false,
    });
    const payload = new TextDecoder().decode(encoded.subarray(5));
    expect(payload).not.toContain("target");
    const out = decodeFrame(encoded);
    if (out.type !== "open-http") throw new Error("unreachable");
    expect(out.target).toBeUndefined();
  });

  it("body-chunk preserves bytes exactly", () => {
    const data = new Uint8Array(1000);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const out = roundTrip({ type: "body-chunk", streamId: 0xffffffff, data });
    expect(out.type).toBe("body-chunk");
    if (out.type !== "body-chunk") throw new Error("unreachable");
    expect(out.streamId).toBe(0xffffffff);
    expect(Array.from(out.data)).toEqual(Array.from(data));
  });

  it("resp-head", () => {
    const frame: Frame = {
      type: "resp-head",
      streamId: 12,
      status: 204,
      headers: [["x-thing", "value with spaces / unicode ✓"]],
    };
    expect(roundTrip(frame)).toEqual(frame);
  });

  it("open-ws without target", () => {
    const open: Frame = {
      type: "open-ws",
      streamId: 20,
      path: "/ws",
      headers: [["cookie", "a=b"]],
      protocols: ["bb.v1"],
    };
    const out = roundTrip(open);
    expect(out).toEqual(open);
    if (out.type !== "open-ws") throw new Error("unreachable");
    expect(out.target).toBeUndefined();
  });

  it("open-ws with target", () => {
    const open: Frame = {
      type: "open-ws",
      streamId: 21,
      path: "/ws",
      headers: [],
      protocols: [],
      target: "5173",
    };
    expect(roundTrip(open)).toEqual(open);
  });

  it("open-ws encoded without target decodes with target undefined", () => {
    const encoded = encodeFrame({
      type: "open-ws",
      streamId: 2,
      path: "/ws",
      headers: [],
      protocols: [],
    });
    const payload = new TextDecoder().decode(encoded.subarray(5));
    expect(payload).not.toContain("target");
    const out = decodeFrame(encoded);
    if (out.type !== "open-ws") throw new Error("unreachable");
    expect(out.target).toBeUndefined();
  });

  it("ws-open-ack / ws-data / close-stream", () => {
    expect(
      roundTrip({ type: "ws-open-ack", streamId: 20, protocol: null }),
    ).toEqual({
      type: "ws-open-ack",
      streamId: 20,
      protocol: null,
    });
    expect(
      roundTrip({ type: "ws-open-ack", streamId: 20, protocol: "bb.v1" }),
    ).toEqual({
      type: "ws-open-ack",
      streamId: 20,
      protocol: "bb.v1",
    });

    const text = roundTrip({
      type: "ws-data",
      streamId: 20,
      isBinary: false,
      data: new TextEncoder().encode("hello"),
    });
    if (text.type !== "ws-data") throw new Error("unreachable");
    expect(text.isBinary).toBe(false);
    expect(new TextDecoder().decode(text.data)).toBe("hello");

    const binary = roundTrip({
      type: "ws-data",
      streamId: 20,
      isBinary: true,
      data: new Uint8Array([0, 1, 2, 255]),
    });
    if (binary.type !== "ws-data") throw new Error("unreachable");
    expect(binary.isBinary).toBe(true);

    expect(
      roundTrip({
        type: "close-stream",
        streamId: 20,
        code: 1000,
        reason: "done",
      }),
    ).toEqual({
      type: "close-stream",
      streamId: 20,
      code: 1000,
      reason: "done",
    });
  });

  it("decodes from an ArrayBuffer (worker message shape)", () => {
    const encoded = encodeFrame({ type: "body-end", streamId: 9 });
    const copy = new ArrayBuffer(encoded.length);
    new Uint8Array(copy).set(encoded);
    expect(decodeFrame(copy)).toEqual({ type: "body-end", streamId: 9 });
  });
});

describe("validation", () => {
  it("rejects out-of-range stream ids", () => {
    expect(() => encodeFrame({ type: "body-end", streamId: -1 })).toThrow(
      /out of range/,
    );
    expect(() => encodeFrame({ type: "body-end", streamId: 2 ** 32 })).toThrow(
      /out of range/,
    );
  });

  it("rejects oversized chunks and truncated/unknown frames", () => {
    expect(() =>
      encodeFrame({
        type: "body-chunk",
        streamId: 1,
        data: new Uint8Array(MAX_CHUNK_BYTES + 1),
      }),
    ).toThrow(/exceeds MAX_CHUNK_BYTES/);
    expect(() => decodeFrame(new Uint8Array([1, 0, 0]))).toThrow(/too short/);
    expect(() => decodeFrame(new Uint8Array([99, 0, 0, 0, 1]))).toThrow(
      /unknown frame type/,
    );
  });

  it("rejects malformed JSON metadata", () => {
    const bad = new Uint8Array(5 + 3);
    bad[0] = 1;
    bad.set(new TextEncoder().encode("{no"), 5);
    expect(() => decodeFrame(bad)).toThrow(/malformed open-http/);
  });
});

describe("chunkBody", () => {
  it("splits at MAX_CHUNK_BYTES and reassembles losslessly", () => {
    const data = new Uint8Array(MAX_CHUNK_BYTES * 2 + 123);
    for (let i = 0; i < data.length; i += 4096) data[i] = (i / 4096) % 256;
    const chunks = [...chunkBody(5, data)];
    expect(chunks.length).toBe(3);
    expect(chunks[0].data.length).toBe(MAX_CHUNK_BYTES);
    expect(chunks[2].data.length).toBe(123);
    const total = new Uint8Array(data.length);
    let offset = 0;
    for (const chunk of chunks) {
      total.set(chunk.data, offset);
      offset += chunk.data.length;
    }
    expect(Buffer.compare(Buffer.from(total), Buffer.from(data))).toBe(0);
  });

  it("yields nothing for an empty body", () => {
    expect([...chunkBody(5, new Uint8Array(0))]).toEqual([]);
  });
});

describe("frame header access", () => {
  it("reads the type and stream id without decoding the payload", () => {
    const head = encodeFrame({
      type: "resp-head",
      streamId: 4_000_000_000,
      status: 200,
      headers: [["content-type", "text/plain"]],
    });
    expect(peekFrame(head)).toEqual({
      type: "resp-head",
      streamId: 4_000_000_000,
    });
    const malformedPayload = new Uint8Array(5 + 3);
    malformedPayload[0] = 4;
    malformedPayload.set(new TextEncoder().encode("{no"), 5);
    expect(peekFrame(malformedPayload).type).toBe("resp-head");
  });

  it("re-addresses a frame in place, including through an ArrayBuffer and a subarray view", () => {
    const chunk = encodeFrame({
      type: "body-chunk",
      streamId: 0,
      data: new Uint8Array([1, 2, 3]),
    });
    const buffer = chunk.buffer.slice(
      chunk.byteOffset,
      chunk.byteOffset + chunk.byteLength,
    ) as ArrayBuffer;
    expect(decodeFrame(setFrameStreamId(buffer, 42))).toEqual({
      type: "body-chunk",
      streamId: 42,
      data: new Uint8Array([1, 2, 3]),
    });

    const padded = new Uint8Array(chunk.length + 4);
    padded.set(chunk, 4);
    const view = padded.subarray(4);
    setFrameStreamId(view, 7);
    expect(peekFrame(view).streamId).toBe(7);
    expect([...padded.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
  });

  it("rejects short frames, unknown types, and out-of-range stream ids", () => {
    expect(() => peekFrame(new Uint8Array(4))).toThrow(/too short/u);
    expect(() => peekFrame(new Uint8Array([99, 0, 0, 0, 1]))).toThrow(
      /unknown frame type/u,
    );
    const frame = encodeFrame({ type: "body-end", streamId: 1 });
    expect(() => setFrameStreamId(frame, -1)).toThrow(/out of range/u);
    expect(() => setFrameStreamId(new Uint8Array(2), 1)).toThrow(/too short/u);
  });
});

describe("experimental reader-only frames", () => {
  const context = {
    schema: "bb-reader-context-v1",
    issuer: "https://gate.test",
    subject: "person-a",
    sessionId: "opaque-session",
    generation: 1,
    serverId: "server-a",
    pluginId: "tower",
    rpcMethod: "page",
    nonce: "nonce-a",
    checkedAt: 100,
    issuedAt: 101,
    expiresAt: 1000,
    method: "POST",
    path: "/api/v1/plugins/tower/rpc/page",
    bodySha256: "a".repeat(64),
    bodyBytes: 2,
  };
  function bytes(value: unknown): Uint8Array {
    const payload = new TextEncoder().encode(JSON.stringify(value));
    const valueBytes = new Uint8Array(5 + payload.length);
    valueBytes[0] = 9;
    new DataView(valueBytes.buffer).setUint32(1, 7);
    valueBytes.set(payload, 5);
    return valueBytes;
  }
  it("decodes a separate reader-only frame without interpreting it as ordinary HTTP", () => {
    expect(decodeFrame(bytes({ context }))).toEqual({
      type: "open-reader-http",
      streamId: 7,
      context,
    });
  });
  it.each([
    { ...context, schema: "other" },
    { ...context, generation: 1.5 },
    { ...context, bodyBytes: 8193 },
    { ...context, checkedAt: null },
    { ...context, method: "GET" },
    { ...context, bodySha256: "A".repeat(64) },
    { ...context, extra: true },
    { ...context, path: "/api/v1/plugins/other/rpc/page" },
  ])("refuses malformed reader claims without downgrading them", (bad) => {
    expect(() => decodeFrame(bytes({ context: bad }))).toThrow();
  });
  it("supports the existing RPC method grammar including leading underscores", () => {
    expect(
      decodeFrame(
        bytes({
          context: {
            ...context,
            rpcMethod: "_page.next",
            path: "/api/v1/plugins/tower/rpc/_page.next",
          },
        }),
      ).type,
    ).toBe("open-reader-http");
  });
  it("refuses accessors without calling their getters", () => {
    let reads = 0;
    const input = { ...context };
    Object.defineProperty(input, "pluginId", {
      enumerable: true,
      get() {
        reads++;
        return "tower";
      },
    });
    expect(() => parseReaderRequestContext(input)).toThrow(
      "invalid reader context",
    );
    expect(reads).toBe(0);
  });
  it("owns data descriptors without reading changing Proxy properties", () => {
    let reads = 0;
    const source = { ...context };
    const input = new Proxy(source, {
      get(target, key, receiver) {
        reads++;
        return key === "pluginId"
          ? "other"
          : Reflect.get(target, key, receiver);
      },
    });
    let result: ReturnType<typeof parseReaderRequestContext> | null = null;
    try {
      result = parseReaderRequestContext(input);
    } catch {}
    expect(result !== null).toBe(true);
    if (result === null) return;
    expect(result).toEqual(context);
    expect(reads).toBe(0);
    source.subject = "changed";
    expect(result.subject).toBe(context.subject);
    expect(Object.isFrozen(result)).toBe(true);
  });
  it("refuses symbol extras", () => {
    expect(() =>
      parseReaderRequestContext({ ...context, [Symbol("extra")]: true }),
    ).toThrow("invalid reader context");
  });
  it.each(["ownKeys", "getOwnPropertyDescriptor", "revoked"])(
    "gives a fresh fixed refusal after a %s trap fault",
    (kind) => {
      let reads = 0;
      const error = new Proxy(
        {},
        {
          get() {
            reads++;
            throw new Error("must not read");
          },
        },
      );
      const proxy = Proxy.revocable(
        { ...context },
        kind === "ownKeys"
          ? {
              ownKeys() {
                throw error;
              },
            }
          : kind === "getOwnPropertyDescriptor"
            ? {
                getOwnPropertyDescriptor() {
                  throw error;
                },
              }
            : {},
      );
      if (kind === "revoked") proxy.revoke();
      let caught: unknown;
      try {
        parseReaderRequestContext(proxy.proxy);
      } catch (failure) {
        caught = failure;
      }
      expect(caught instanceof Error).toBe(true);
      expect((caught as Error).message).toBe("invalid reader context");
      expect((caught as Error).cause).toBeUndefined();
      expect(caught === error).toBe(false);
      expect(reads).toBe(0);
    },
  );
  it("refuses boxed numeric values without coercion", () => {
    let reads = 0;
    const value = {
      valueOf() {
        reads++;
        return 1;
      },
      toString() {
        reads++;
        return "1";
      },
    };
    expect(() =>
      parseReaderRequestContext({ ...context, generation: value }),
    ).toThrow("invalid reader context");
    expect(reads).toBe(0);
  });
  it("refuses reader envelope extras", () => {
    expect(() => decodeFrame(bytes({ context, target: "8000" }))).toThrow();
  });
});
