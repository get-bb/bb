import type { IncomingMessage } from "node:http";
import {
  buildHostDaemonWebSocketProtocols,
  HOST_DAEMON_PROTOCOL_VERSION,
} from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { z } from "zod";
import { isSameMachineWebSocketPeer } from "../../src/ws/compression.js";
import {
  createTestDaemonHostKey,
  startTestServer,
  type RunningTestServer,
} from "../helpers/test-app.js";

interface OpenedSocket {
  response: IncomingMessage;
  socket: WebSocket;
}

const sockets = new Set<WebSocket>();
let server: RunningTestServer | null = null;

function websocketUrl(baseUrl: string, path: string): string {
  const url = new URL(path, baseUrl);
  url.protocol = "ws:";
  return url.href;
}

function openSocket(
  url: string,
  options: { headers?: Record<string, string>; protocols?: string[] } = {},
): Promise<OpenedSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, options.protocols ?? [], {
      headers: options.headers,
    });
    sockets.add(socket);
    let response: IncomingMessage | null = null;
    socket.once("upgrade", (upgrade) => {
      response = upgrade;
    });
    socket.once("open", () => {
      if (response === null) {
        reject(new Error("WebSocket opened without an upgrade response"));
        return;
      }
      resolve({ response, socket });
    });
    socket.once("unexpected-response", (_request, unexpected) => {
      reject(new Error(`WebSocket upgrade failed: ${unexpected.statusCode}`));
    });
    socket.once("error", reject);
  });
}

function nextMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    socket.once("message", (data: Buffer) => resolve(data.toString("utf8")));
  });
}

function messageContaining(socket: WebSocket, text: string): Promise<string> {
  return new Promise((resolve) => {
    const onMessage = (data: Buffer) => {
      const message = data.toString("utf8");
      if (!message.includes(text)) return;
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

function timelineLikePayload(): unknown {
  return {
    rows: Array.from({ length: 1500 }, (_, index) => ({
      id: `row_${index}`,
      kind: index % 3 === 0 ? "tool-call" : "assistant-message",
      sequence: index,
      createdAt: new Date(Date.UTC(2026, 9, 23, 0, 0, index)).toISOString(),
      text: `Step ${index}: read apps/server/src/ws/hub.ts and summarize the change`,
    })),
  };
}

async function openDaemonSession(
  running: RunningTestServer,
): Promise<{ authorization: string; sessionId: string }> {
  const authorization = `Bearer ${createTestDaemonHostKey({ hostId: "host-1" })}`;
  const opened = await fetch(`${running.baseUrl}/internal/session/open`, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({
      hostId: "host-1",
      instanceId: "instance-1",
      hostName: "Host",
      hasMachineCredential: false,
      platform: "darwin",
      dataDir: "/tmp/host-data",
      localApiPort: null,
      protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
      activeThreads: [],
      openThreadWork: [],
    }),
  });
  expect(opened.status).toBe(201);
  const { sessionId } = z
    .object({ sessionId: z.string() })
    .parse(await opened.json());
  return { authorization, sessionId };
}

afterEach(async () => {
  for (const socket of sockets) {
    socket.terminate();
  }
  sockets.clear();
  if (server !== null) {
    await server.close();
    server = null;
  }
});

describe("WebSocket compression", () => {
  it("compresses large realtime pushes and leaves small replies uncompressed", async () => {
    server = await startTestServer();
    const { response, socket } = await openSocket(
      websocketUrl(server.baseUrl, "/ws"),
    );
    expect(socket.extensions).toContain("permessage-deflate");

    socket.send(JSON.stringify({ type: "ping" }));
    const pongBefore = response.socket.bytesRead;
    await expect(nextMessage(socket)).resolves.toBe('{"type":"pong"}');
    expect(response.socket.bytesRead - pongBefore).toBe(
      2 + '{"type":"pong"}'.length,
    );

    const payload = timelineLikePayload();
    const pushBefore = response.socket.bytesRead;
    const received = nextMessage(socket);
    server.hub.notifyPluginSignal("test-plugin", "timeline", payload);
    const message = await received;
    const wireBytes = response.socket.bytesRead - pushBefore;

    expect(JSON.parse(message)).toEqual({
      type: "plugin-signal",
      pluginId: "test-plugin",
      channel: "timeline",
      payload,
    });
    expect(wireBytes).toBeLessThan(Buffer.byteLength(message) / 4);
  });

  it("treats only unforwarded loopback peers as the same machine", () => {
    expect(isSameMachineWebSocketPeer("127.0.0.1", false)).toBe(true);
    expect(isSameMachineWebSocketPeer("::1", false)).toBe(true);
    expect(isSameMachineWebSocketPeer("::ffff:127.0.0.1", false)).toBe(true);
    expect(isSameMachineWebSocketPeer("127.0.0.1", true)).toBe(false);
    expect(isSameMachineWebSocketPeer("192.168.4.28", false)).toBe(false);
    expect(isSameMachineWebSocketPeer("100.84.175.40", false)).toBe(false);
    expect(isSameMachineWebSocketPeer(undefined, false)).toBe(false);
  });

  it("compresses daemon and terminal sockets for a peer on another machine", async () => {
    server = await startTestServer();
    const forwarded = { "x-forwarded-for": "192.168.4.40" };
    const terminal = await openSocket(
      websocketUrl(server.baseUrl, "/ws/terminals/missing-terminal"),
      { headers: forwarded },
    );
    expect(terminal.socket.extensions).toContain("permessage-deflate");

    const { authorization, sessionId } = await openDaemonSession(server);
    const daemon = await openSocket(
      websocketUrl(server.baseUrl, `/internal/ws?sessionId=${sessionId}`),
      {
        headers: { authorization, ...forwarded },
        protocols: buildHostDaemonWebSocketProtocols(),
      },
    );
    expect(daemon.socket.extensions).toContain("permessage-deflate");

    const requests = Array.from({ length: 400 }, (_, index) => ({
      threadId: `thr_${index}`,
      providerId: "claude-code",
      providerThreadId: `provider-thread-${index}`,
      providerRequestId: `provider-request-${index}`,
    }));
    const before = daemon.response.socket.bytesRead;
    const received = messageContaining(
      daemon.socket,
      '"type":"interactive-requests.end"',
    );
    expect(
      server.hub.sendDaemonSessionMessage(sessionId, {
        type: "interactive-requests.end",
        requests,
        reason: "test",
      }),
    ).toBe(true);
    const frame = await received;
    expect(JSON.parse(frame)).toMatchObject({
      message: { type: "interactive-requests.end", requests },
    });
    expect(daemon.response.socket.bytesRead - before).toBeLessThan(
      Buffer.byteLength(frame) / 4,
    );
  });

  it("declines compression on terminal and daemon sockets from the same machine", async () => {
    server = await startTestServer();
    const terminal = await openSocket(
      websocketUrl(server.baseUrl, "/ws/terminals/missing-terminal"),
    );
    expect(terminal.response.headers["sec-websocket-extensions"]).toBe(
      undefined,
    );
    expect(terminal.socket.extensions).toBe("");

    const { authorization, sessionId } = await openDaemonSession(server);
    const daemon = await openSocket(
      websocketUrl(server.baseUrl, `/internal/ws?sessionId=${sessionId}`),
      {
        headers: { authorization },
        protocols: buildHostDaemonWebSocketProtocols(),
      },
    );
    expect(daemon.response.headers["sec-websocket-extensions"]).toBe(undefined);
    expect(daemon.socket.extensions).toBe("");
  });
});
