import { describe, expect, it } from "vitest";
import {
  MAX_CHUNK_BYTES,
  chunkBody,
  decodeFrame,
  encodeFrame,
  type Frame,
} from "../src/index.js";

function roundTrip(frame: Frame): Frame {
  return decodeFrame(encodeFrame(frame));
}

describe("frame round-trips", () => {
  it("open-http", () => {
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
    expect(roundTrip(frame)).toEqual(frame);
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

  it("body-end", () => {
    expect(roundTrip({ type: "body-end", streamId: 3 })).toEqual({
      type: "body-end",
      streamId: 3,
    });
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

  it("open-ws / ws-open-ack / ws-data / close-stream", () => {
    const open: Frame = {
      type: "open-ws",
      streamId: 20,
      path: "/ws",
      headers: [["cookie", "a=b"]],
      protocols: ["bb.v1"],
    };
    expect(roundTrip(open)).toEqual(open);

    expect(roundTrip({ type: "ws-open-ack", streamId: 20, protocol: null })).toEqual({
      type: "ws-open-ack",
      streamId: 20,
      protocol: null,
    });
    expect(roundTrip({ type: "ws-open-ack", streamId: 20, protocol: "bb.v1" })).toEqual({
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
      roundTrip({ type: "close-stream", streamId: 20, code: 1000, reason: "done" }),
    ).toEqual({ type: "close-stream", streamId: 20, code: 1000, reason: "done" });
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
    expect(() => encodeFrame({ type: "body-end", streamId: -1 })).toThrow(/out of range/);
    expect(() => encodeFrame({ type: "body-end", streamId: 2 ** 32 })).toThrow(/out of range/);
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
    expect(() => decodeFrame(new Uint8Array([99, 0, 0, 0, 1]))).toThrow(/unknown frame type/);
  });

  it("rejects malformed JSON metadata", () => {
    const bad = new Uint8Array(5 + 3);
    bad[0] = 1; // open-http
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
    // Native memcmp — element-wise toEqual over ~2 MiB of numbers blows the
    // test timeout on slower CI runners.
    expect(Buffer.compare(Buffer.from(total), Buffer.from(data))).toBe(0);
  });

  it("yields nothing for an empty body", () => {
    expect([...chunkBody(5, new Uint8Array(0))]).toEqual([]);
  });
});
