import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { WebSocket as NodeWebSocket } from "ws";
import {
  decodeFrame,
  encodeFrame,
  type Frame,
  type ReaderRequestContext,
} from "@bb/tunnel-contract";
import { TunnelSession } from "../src/session.js";

class Tunnel extends EventEmitter {
  readonly readyState = 1;
  readonly frames: Frame[] = [];
  readonly terminate = vi.fn();
  send(data: Uint8Array) {
    this.frames.push(decodeFrame(data));
  }
}
const context: ReaderRequestContext = {
  schema: "bb-reader-context-v1",
  issuer: "https://gate.test",
  subject: "person-a",
  sessionId: "opaque-a",
  generation: 1,
  serverId: "server-a",
  pluginId: "tower",
  rpcMethod: "page",
  nonce: "nonce-a",
  checkedAt: 1,
  issuedAt: 2,
  expiresAt: 100,
  method: "POST",
  path: "/api/v1/plugins/tower/rpc/page",
  bodySha256: "a".repeat(64),
  bodyBytes: 2,
};
function send(tunnel: Tunnel, frame: Frame) {
  tunnel.emit("message", Buffer.from(encodeFrame(frame)), true);
}

describe("reader private tunnel dispatch", () => {
  it("dispatches held bytes only through the private callback", async () => {
    const tunnel = new Tunnel();
    const dispatch = vi.fn(
      async (
        claim: ReaderRequestContext,
        body: Uint8Array,
        signal: AbortSignal,
      ) => {
        expect(claim).toEqual(context);
        expect(Buffer.from(body).toString()).toBe("{}");
        expect(signal.aborted).toBe(false);
        return Response.json({ ok: true });
      },
    );
    const origin = vi.fn(() => {
      throw new Error("ordinary origin reached");
    });
    const session = new TunnelSession({
      tunnel: tunnel as unknown as NodeWebSocket,
      log: { warn: () => {} },
      resolveOrigin: origin,
      readerContext: {
        begin: (claim, signal) => ({
          dispatch: (body) => dispatch(claim, body, signal),
        }),
        close: vi.fn(),
      },
    });
    session.start();
    send(tunnel, { type: "open-reader-http", streamId: 1, context });
    send(tunnel, {
      type: "body-chunk",
      streamId: 1,
      data: new TextEncoder().encode("{}"),
    });
    send(tunnel, { type: "body-end", streamId: 1 });
    await vi.waitFor(() =>
      expect(tunnel.frames).toContainEqual({ type: "body-end", streamId: 1 }),
    );
    expect(dispatch).toHaveBeenCalledOnce();
    expect(origin).not.toHaveBeenCalled();
    session.dispose();
  });
  it("fails closed without a callback and does not resolve an HTTP origin", async () => {
    const tunnel = new Tunnel();
    const origin = vi.fn(() => {
      throw new Error("ordinary origin reached");
    });
    const session = new TunnelSession({
      tunnel: tunnel as unknown as NodeWebSocket,
      log: { warn: () => {} },
      resolveOrigin: origin,
    });
    session.start();
    send(tunnel, { type: "open-reader-http", streamId: 1, context });
    send(tunnel, {
      type: "body-chunk",
      streamId: 1,
      data: new TextEncoder().encode("{}"),
    });
    send(tunnel, { type: "body-end", streamId: 1 });
    await vi.waitFor(() =>
      expect(tunnel.frames).toContainEqual(
        expect.objectContaining({ type: "resp-head", status: 403 }),
      ),
    );
    expect(origin).not.toHaveBeenCalled();
    session.dispose();
  });
  it("preserves full document capacity through the larger escaped RPC envelope", async () => {
    const documentJson = '"' + String.fromCharCode(92, 92).repeat(131071) + '"';
    expect(new TextEncoder().encode(documentJson).byteLength).toBe(262144);
    expect(typeof JSON.parse(documentJson)).toBe("string");
    const encoded = JSON.stringify({
      ok: true,
      result: { state: "ok", documentJson },
    });
    expect(new TextEncoder().encode(encoded).byteLength).toBeGreaterThan(
      262144,
    );
    const tunnel = new Tunnel();
    const session = new TunnelSession({
      tunnel: tunnel as unknown as NodeWebSocket,
      log: { warn: () => {} },
      resolveOrigin: () => ({ kind: "unregistered" }),
      readerContext: {
        begin: () => ({ dispatch: async () => new Response(encoded) }),
        close: vi.fn(),
      },
    });
    session.start();
    send(tunnel, { type: "open-reader-http", streamId: 1, context });
    send(tunnel, {
      type: "body-chunk",
      streamId: 1,
      data: new TextEncoder().encode("{}"),
    });
    send(tunnel, { type: "body-end", streamId: 1 });
    await vi.waitFor(() =>
      expect(
        tunnel.frames.some(
          (frame) => frame.type === "body-end" || frame.type === "close-stream",
        ),
      ).toBe(true),
    );
    expect(tunnel.frames.some((frame) => frame.type === "close-stream")).toBe(
      false,
    );
    const chunks = tunnel.frames.flatMap((frame) =>
      frame.type === "body-chunk" ? [frame.data] : [],
    );
    expect(Buffer.concat(chunks).toString()).toBe(encoded);
    session.dispose();
  });
  it("retires dispatch before awaiting a pending handler and never dispatches duplicate body-end", async () => {
    const tunnel = new Tunnel();
    let finish: (response: Response) => void = () => {};
    const held = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const dispatch = vi.fn(() => held);
    const session = new TunnelSession({
      tunnel: tunnel as unknown as NodeWebSocket,
      log: { warn: () => {} },
      resolveOrigin: () => ({ kind: "unregistered" }),
      readerContext: { begin: () => ({ dispatch }), close: vi.fn() },
    });
    session.start();
    send(tunnel, { type: "open-reader-http", streamId: 1, context });
    send(tunnel, {
      type: "body-chunk",
      streamId: 1,
      data: new TextEncoder().encode("{}"),
    });
    send(tunnel, { type: "body-end", streamId: 1 });
    send(tunnel, { type: "body-end", streamId: 1 });
    expect(dispatch).toHaveBeenCalledOnce();
    finish(Response.json({ ok: true }));
    await vi.waitFor(() =>
      expect(tunnel.frames).toContainEqual({ type: "body-end", streamId: 1 }),
    );
    expect(dispatch).toHaveBeenCalledOnce();
    session.dispose();
  });
  it("closes connection ownership once and cancels every in-flight private call", async () => {
    const tunnel = new Tunnel();
    let signal: AbortSignal | undefined;
    const close = vi.fn();
    const dispatch = vi.fn(
      async (
        _claim: ReaderRequestContext,
        _body: Uint8Array,
        ownedSignal: AbortSignal,
      ) => {
        signal = ownedSignal;
        return new Promise<Response>(() => {});
      },
    );
    const session = new TunnelSession({
      tunnel: tunnel as unknown as NodeWebSocket,
      log: { warn: () => {} },
      resolveOrigin: () => ({ kind: "unregistered" }),
      readerContext: {
        begin: (claim, signal) => ({
          dispatch: (body) => dispatch(claim, body, signal),
        }),
        close,
      },
    });
    session.start();
    send(tunnel, { type: "open-reader-http", streamId: 1, context });
    send(tunnel, {
      type: "body-chunk",
      streamId: 1,
      data: new TextEncoder().encode("{}"),
    });
    send(tunnel, { type: "body-end", streamId: 1 });
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
    session.dispose();
    session.dispose();
    expect(signal?.aborted).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });
});
