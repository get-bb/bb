import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { decodeFrame, encodeFrame, type Frame } from "@bb/tunnel-contract";
import {
  TunnelSession,
  canonicalStreamPath,
  type TunnelTransport,
} from "../src/session.js";

class FakeTunnel extends EventEmitter implements TunnelTransport {
  readonly readyState = 1;
  readonly frames: Frame[] = [];

  send(data: Uint8Array | string): void {
    if (typeof data === "string") return;
    this.frames.push(decodeFrame(data));
  }

  terminate(): void {
    this.emit("close");
  }

  deliver(frame: Frame): void {
    this.emit("message", encodeFrame(frame), true);
  }
}

function startGuardedSession() {
  const tunnel = new FakeTunnel();
  const seen: string[] = [];
  const session = new TunnelSession({
    tunnel,
    log: { warn: () => {} },
    resolveOrigin: () => {
      throw new Error("origin must not be resolved for a refused stream");
    },
    guardStream: (stream) => {
      seen.push(`${stream.kind} ${stream.method} ${stream.path}`);
      return stream.path.startsWith("/allowed")
        ? { allow: true }
        : {
            allow: false,
            status: 403,
            code: "sealed_required",
            message: "sealed connections only",
          };
    },
  });
  session.start();
  return { tunnel, session, seen };
}

describe("tunnel stream guard", () => {
  it("answers a refused HTTP stream with the guard's status and JSON body without touching the origin", async () => {
    const { tunnel, session, seen } = startGuardedSession();
    try {
      tunnel.deliver({
        type: "open-http",
        streamId: 7,
        method: "POST",
        path: "/api/v1/threads?x=1",
        headers: [],
        hasBody: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(seen).toEqual(["http POST /api/v1/threads?x=1"]);
      expect(tunnel.frames.map((frame) => frame.type)).toEqual([
        "resp-head",
        "body-chunk",
        "body-end",
      ]);
      const head = tunnel.frames[0] as Extract<Frame, { type: "resp-head" }>;
      expect(head.status).toBe(403);
      expect(head.headers).toContainEqual([
        "content-type",
        "application/json; charset=utf-8",
      ]);
      const body = tunnel.frames[1] as Extract<Frame, { type: "body-chunk" }>;
      expect(JSON.parse(new TextDecoder().decode(body.data))).toEqual({
        error: "sealed connections only",
        code: "sealed_required",
      });
    } finally {
      session.dispose();
    }
  });

  it("closes a refused websocket stream with a policy code", () => {
    const { tunnel, session, seen } = startGuardedSession();
    try {
      tunnel.deliver({
        type: "open-ws",
        streamId: 9,
        path: "/ws",
        headers: [],
        protocols: [],
      });
      expect(seen).toEqual(["ws GET /ws"]);
      expect(tunnel.frames).toEqual([
        {
          type: "close-stream",
          streamId: 9,
          code: 1008,
          reason: "sealed_required",
        },
      ]);
    } finally {
      session.dispose();
    }
  });
});

describe("tunnel stream reguard", () => {
  it("closes open streams that the guard no longer allows and leaves the rest", async () => {
    const server = createServer();
    const wss = new WebSocketServer({ server });
    const originClosed: string[] = [];
    wss.on("connection", (socket, request) => {
      socket.on("close", () => originClosed.push(request.url ?? ""));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error();
    const origin = `http://127.0.0.1:${address.port}`;
    const tunnel = new FakeTunnel();
    const policy = { required: false };
    const session = new TunnelSession({
      tunnel,
      log: { warn: () => {} },
      resolveOrigin: () => ({
        kind: "ok",
        resolved: { origin, publicOrigin: "https://x.example" },
      }),
      guardStream: (stream) =>
        !policy.required || stream.path.startsWith("/allowed")
          ? { allow: true }
          : {
              allow: false,
              status: 403,
              code: "sealed_required",
              message: "sealed connections only",
            },
    });
    session.start();
    try {
      for (const [streamId, path] of [
        [1, "/ws"],
        [2, "/allowed/sealed"],
      ] as const) {
        tunnel.deliver({
          type: "open-ws",
          streamId,
          path,
          headers: [],
          protocols: [],
        });
      }
      await new Promise<void>((resolve) => {
        const check = () => {
          if (
            tunnel.frames.filter((f) => f.type === "ws-open-ack").length === 2
          )
            resolve();
          else setTimeout(check, 5);
        };
        check();
      });
      expect(session.reguard()).toBe(0);
      policy.required = true;
      expect(session.reguard()).toBe(1);
      expect(tunnel.frames.at(-1)).toEqual({
        type: "close-stream",
        streamId: 1,
        code: 1008,
        reason: "sealed_required",
      });
      await new Promise<void>((resolve) => {
        const check = () =>
          originClosed.length > 0 ? resolve() : setTimeout(check, 5);
        check();
      });
      expect(originClosed).toEqual(["/ws"]);
      expect(session.reguard()).toBe(0);
    } finally {
      session.dispose();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("stream path canonicalization", () => {
  it("refuses dot segments, encoded dot segments, and double slashes before the guard runs", async () => {
    const { tunnel, session, seen } = startGuardedSession();
    try {
      const paths = [
        "/allowed/../api/v1/threads",
        "/allowed/%2e%2e/api/v1/threads",
        "/allowed/.%2e/api/v1/threads",
        "/allowed//api/v1/threads",
        "//evil.example/api",
        "/allowed/./x",
        "api/v1/threads",
      ];
      let streamId = 100;
      for (const path of paths) {
        tunnel.deliver({
          type: "open-http",
          streamId: streamId++,
          method: "GET",
          path,
          headers: [],
          hasBody: false,
        });
      }
      tunnel.deliver({
        type: "open-ws",
        streamId: 200,
        path: "/allowed/../ws",
        headers: [],
        protocols: [],
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(seen).toEqual([]);
      const heads = tunnel.frames.filter((frame) => frame.type === "resp-head");
      expect(heads).toHaveLength(paths.length);
      for (const head of heads) expect(head.status).toBe(400);
      expect(tunnel.frames.at(-1)).toEqual({
        type: "close-stream",
        streamId: 200,
        code: 1008,
        reason: "malformed_path",
      });
    } finally {
      session.dispose();
    }
  });

  it("passes canonical paths with query strings through untouched", () => {
    expect(canonicalStreamPath("/api/v1/threads?limit=1&x=..")).toEqual({
      forward: "/api/v1/threads?limit=1&x=..",
      guard: "/api/v1/threads?limit=1&x=..",
    });
    expect(canonicalStreamPath("/allowed/x.y/z")?.guard).toBe("/allowed/x.y/z");
    expect(canonicalStreamPath("/allowed/..hidden")?.guard).toBe(
      "/allowed/..hidden",
    );
  });

  it("accepts paths the URL parser re-encodes, such as spaces and non-ASCII names", () => {
    expect(canonicalStreamPath("/thread/thr 1/caf\u00e9")?.guard).toBe(
      "/thread/thr 1/caf\u00e9",
    );
    expect(canonicalStreamPath("/thread/thr 1/caf\u00e9")?.forward).toBe(
      "/thread/thr%201/caf%C3%A9",
    );
  });

  it("guards the percent-decoded path the origin router will see while forwarding the raw path", async () => {
    expect(canonicalStreamPath("/%61pi/v1/threads")).toEqual({
      forward: "/%61pi/v1/threads",
      guard: "/api/v1/threads",
    });
    expect(canonicalStreamPath("/a%70i/v1/threads")?.guard).toBe(
      "/api/v1/threads",
    );
    expect(canonicalStreamPath("/allowed/%2e%2e/api")).toBeNull();
    expect(canonicalStreamPath("/allowed/x%2fy")).toBeNull();
    expect(canonicalStreamPath("/allowed/%zz")).toBeNull();
    const { tunnel, session, seen } = startGuardedSession();
    try {
      tunnel.deliver({
        type: "open-http",
        streamId: 300,
        method: "GET",
        path: "/%61llowed/../x",
        headers: [],
        hasBody: false,
      });
      tunnel.deliver({
        type: "open-http",
        streamId: 301,
        method: "GET",
        path: "/%61pi/v1/threads",
        headers: [],
        hasBody: false,
      });
      tunnel.deliver({
        type: "open-ws",
        streamId: 302,
        path: "/w%73",
        headers: [],
        protocols: [],
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(seen).toEqual(["http GET /api/v1/threads", "ws GET /ws"]);
      const statuses = tunnel.frames
        .filter((frame) => frame.type === "resp-head")
        .map((frame) => frame.status);
      expect(statuses).toEqual([400, 403]);
    } finally {
      session.dispose();
    }
  });

  it("forwards port-share streams unchanged because the guard does not apply to them", async () => {
    const tunnel = new FakeTunnel();
    const seen: string[] = [];
    const session = new TunnelSession({
      tunnel,
      log: { warn: () => {} },
      resolveOrigin: () => ({ kind: "unregistered" }),
      guardStream: (stream) => {
        seen.push(stream.path);
        return { allow: true };
      },
    });
    session.start();
    try {
      tunnel.deliver({
        type: "open-http",
        streamId: 400,
        method: "GET",
        path: "/proxy//https://example.com/../x",
        headers: [],
        hasBody: false,
        target: "8000",
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(seen).toEqual([]);
      const head = tunnel.frames.find((frame) => frame.type === "resp-head");
      expect(head?.status).toBe(404);
    } finally {
      session.dispose();
    }
  });
});
