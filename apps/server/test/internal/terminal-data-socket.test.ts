import { createTerminalSession, getTerminalSession } from "@bb/db";
import {
  buildHostDaemonWebSocketProtocols,
  hostDaemonTerminalDataServerMessageSchema,
} from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import {
  startTestServer,
  type RunningTestServer,
} from "../helpers/test-app.js";
import { seedHostSession } from "../helpers/seed.js";
import { internalAuthHeaders } from "../helpers/commands.js";
import { feedRawDaemonWebSocketMessage } from "../helpers/daemon-ws.js";

let server: RunningTestServer | null = null;
const sockets = new Set<WebSocket>();
const queuedMessages = new WeakMap<WebSocket, unknown[]>();
const messageWaiters = new WeakMap<WebSocket, (message: unknown) => void>();

function url(path: string): string {
  if (!server) throw new Error("Missing test server");
  return new URL(path, server.baseUrl).href.replace(/^http:/, "ws:");
}

function connect(
  path: string,
  options: {
    headers?: Record<string, string>;
    protocols?: string[];
    origin?: string;
  } = {},
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url(path), options.protocols, {
      headers: options.headers,
      origin: options.origin,
    });
    sockets.add(socket);
    queuedMessages.set(socket, []);
    socket.on("message", (bytes) => {
      const message: unknown = JSON.parse(bytes.toString());
      const waiter = messageWaiters.get(socket);
      if (waiter) {
        messageWaiters.delete(socket);
        waiter(message);
      } else {
        queuedMessages.get(socket)?.push(message);
      }
    });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function rejectedStatus(
  path: string,
  options: { headers?: Record<string, string>; protocols?: string[] },
): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url(path), options.protocols, {
      headers: options.headers,
    });
    sockets.add(socket);
    socket.once("open", () => reject(new Error("Unexpected data socket open")));
    socket.once("unexpected-response", (_request, response) => {
      const status = response.statusCode;
      response.resume();
      if (status === undefined) reject(new Error("Missing response status"));
      else resolve(status);
    });
    socket.once("error", () => {});
  });
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  const buffered = queuedMessages.get(socket)?.shift();
  if (buffered !== undefined) return Promise.resolve(buffered);
  return new Promise((resolve) => messageWaiters.set(socket, resolve));
}

afterEach(async () => {
  for (const socket of sockets) socket.terminate();
  sockets.clear();
  if (server) {
    await server.close();
    server = null;
  }
});

describe("daemon terminal data socket", () => {
  it("rejects invalid protocol and unknown session, then forwards output and catches up after reconnection", async () => {
    server = await startTestServer();
    const { host, session } = seedHostSession(server.deps);
    const headers = Object.fromEntries(
      new Headers(internalAuthHeaders(server, { hostId: host.id })),
    );
    const path = `/internal/ws/terminals?sessionId=${session.id}`;
    expect(await rejectedStatus(path, { headers })).toBe(400);
    expect(
      await rejectedStatus("/internal/ws/terminals?sessionId=missing", {
        headers,
        protocols: buildHostDaemonWebSocketProtocols(),
      }),
    ).toBe(401);
    const other = seedHostSession(server.deps, { id: "other-host" });
    expect(
      await rejectedStatus(
        `/internal/ws/terminals?sessionId=${other.session.id}`,
        { headers, protocols: buildHostDaemonWebSocketProtocols() },
      ),
    ).toBe(403);

    const terminal = createTerminalSession(server.db, {
      cols: 80,
      rows: 24,
      daemonSessionId: session.id,
      hostId: host.id,
      initialCwd: "/tmp",
      status: "running",
      title: "Socket test terminal",
      environmentId: null,
      threadId: null,
    });
    const data = await connect(path, {
      headers,
      protocols: buildHostDaemonWebSocketProtocols(),
    });
    const browser = await connect(`/ws/terminals/${terminal.id}?sinceSeq=0`, {
      origin: server.baseUrl,
    });
    const attach = hostDaemonTerminalDataServerMessageSchema.parse(
      await nextMessage(data),
    );
    expect(attach).toMatchObject({
      type: "terminal.attach",
      terminalId: terminal.id,
      sinceSeq: 0,
    });
    if (attach.type !== "terminal.attach")
      throw new Error("Missing terminal attach");
    const attached = nextMessage(browser);
    data.send(
      JSON.stringify({
        type: "terminal.replay",
        requestId: attach.requestId,
        terminalId: terminal.id,
        chunks: [],
        replayStartSeq: 0,
        nextSeq: 0,
      }),
    );
    expect(await attached).toMatchObject({ type: "attached" });
    const output = nextMessage(browser);
    data.send(
      JSON.stringify({
        type: "terminal.output",
        terminalId: terminal.id,
        chunk: { seq: 0, dataBase64: "YQ==" },
      }),
    );
    expect(await output).toMatchObject({
      type: "output",
      chunk: { seq: 0, dataBase64: "YQ==" },
    });
    const closed = new Promise<void>((resolve) =>
      data.once("close", () => resolve()),
    );
    data.close();
    await closed;
    expect(
      getTerminalSession(server.db, {
        kind: "terminal",
        terminalId: terminal.id,
      }),
    ).toMatchObject({ status: "running", daemonSessionId: session.id });
    const reopened = await connect(path, {
      headers,
      protocols: buildHostDaemonWebSocketProtocols(),
    });
    expect(
      hostDaemonTerminalDataServerMessageSchema.parse(
        await nextMessage(reopened),
      ),
    ).toMatchObject({
      type: "terminal.attach",
      terminalId: terminal.id,
      sinceSeq: 1,
    });
  });

  it("rejects old-daemon output on control without throwing", async () => {
    const runningServer = await startTestServer();
    server = runningServer;
    const warn = vi.spyOn(runningServer.deps.logger, "warn");
    const { host, session } = seedHostSession(runningServer.deps);
    const socket = { send: vi.fn(), close: vi.fn() };
    expect(() =>
      feedRawDaemonWebSocketMessage({
        harness: runningServer,
        hostId: host.id,
        sessionId: session.id,
        socket,
        rawMessage: {
          type: "terminal.output",
          terminalId: "term-old",
          chunk: { seq: 0, dataBase64: "YQ==" },
        },
      }),
    ).not.toThrow();
    expect(socket.close).toHaveBeenCalledWith(1008, "invalid-message");
    expect(warn).toHaveBeenCalledWith(
      { sessionId: session.id },
      "Invalid daemon control websocket message",
    );
  });
});
