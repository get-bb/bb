import type { IncomingMessage } from "node:http";
import {
  buildHostDaemonWebSocketProtocols,
  HOST_DAEMON_PROTOCOL_VERSION,
} from "@bb/host-daemon-contract";
import { setExperiments } from "@bb/db";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { z } from "zod";
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
    setExperiments(server.db, { websocketCompression: true });
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

  it("follows the experiment on each new realtime connection", async () => {
    server = await startTestServer();
    const realtimeUrl = websocketUrl(server.baseUrl, "/ws");
    const putExperiment = async (websocketCompression: boolean) => {
      const response = await fetch(
        `${server?.baseUrl}/api/v1/settings/experiments`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ websocketCompression }),
        },
      );
      expect(response.status).toBe(200);
    };

    const off = await openSocket(realtimeUrl);
    expect(off.response.headers["sec-websocket-extensions"]).toBe(undefined);
    expect(off.socket.extensions).toBe("");

    await putExperiment(true);
    const on = await openSocket(realtimeUrl);
    expect(on.socket.extensions).toContain("permessage-deflate");
    expect(off.socket.extensions).toBe("");

    await putExperiment(false);
    const offAgain = await openSocket(realtimeUrl);
    expect(offAgain.socket.extensions).toBe("");
    expect(on.socket.extensions).toContain("permessage-deflate");
  });

  it("declines compression on terminal and daemon sockets with the experiment on", async () => {
    server = await startTestServer();
    setExperiments(server.db, { websocketCompression: true });
    const terminal = await openSocket(
      websocketUrl(server.baseUrl, "/ws/terminals/missing-terminal"),
    );
    expect(terminal.response.headers["sec-websocket-extensions"]).toBe(
      undefined,
    );
    expect(terminal.socket.extensions).toBe("");

    const authorization = `Bearer ${createTestDaemonHostKey({ hostId: "host-1" })}`;
    const opened = await fetch(`${server.baseUrl}/internal/session/open`, {
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
      }),
    });
    expect(opened.status).toBe(201);
    const { sessionId } = z
      .object({ sessionId: z.string() })
      .parse(await opened.json());
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
