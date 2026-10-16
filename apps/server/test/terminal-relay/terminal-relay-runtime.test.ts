import { createServer, type Server } from "node:http";
import { connect, Socket } from "node:net";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  createTerminalRelayRuntime,
  type TerminalRelayRuntime,
} from "../../src/terminal-relay/terminal-relay-runtime.js";
import type { TerminalRelayToMainMessage } from "../../src/terminal-relay/terminal-relay-ipc.js";
import { testLogger } from "../helpers/test-app.js";

const session = {
  id: "term-1",
  threadId: null,
  environmentId: null,
  hostId: "host-1",
  title: "Shell",
  initialCwd: "/tmp",
  cols: 80,
  rows: 24,
  status: "running" as const,
  exitCode: null,
  closeReason: null,
  createdAt: 0,
  updatedAt: 0,
  lastUserInputAt: null,
};
const servers: Server[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  }
});

async function setup(onMessage: (message: TerminalRelayToMainMessage) => void) {
  const runtime = createTerminalRelayRuntime({
    logger: testLogger,
    send: onMessage,
  });
  const server = createServer();
  servers.push(server);
  let headSize = 0;
  server.on("upgrade", (request, socket, head) => {
    if (!(socket instanceof Socket)) throw new Error("Expected a TCP socket");
    headSize = head.length;
    const daemon = request.url === "/daemon";
    const details = {
      head: Buffer.from(head).toString("base64"),
      headers: Object.fromEntries(
        Object.entries(request.headers)
          .filter(
            (entry): entry is [string, string | string[]] =>
              entry[1] !== undefined,
          )
          .map(([key, value]) => [
            key,
            Array.isArray(value) ? value.join(", ") : value,
          ]),
      ),
      method: request.method ?? "GET",
      url: request.url ?? "/",
    };
    if (daemon)
      runtime.acceptSocket(
        {
          type: "accept-daemon-data",
          grant: {
            kind: "daemon-data",
            sessionId: "daemon-1",
            hostId: "host-1",
          },
          ...details,
        },
        socket,
      );
    else
      runtime.acceptSocket(
        {
          type: "accept-browser",
          grant: {
            kind: "browser",
            terminalId: session.id,
            sinceSeq: 0,
            outputAcks: false,
          },
          ...details,
        },
        socket,
      );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test address");
  return { runtime, port: address.port, headSize: () => headSize };
}

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    sockets.push(socket);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function message(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.once("message", (bytes) => resolve(JSON.parse(bytes.toString())));
  });
}

describe("terminal relay socket runtime", () => {
  it("replays daemon output, sends input without main, and closes on shutdown", async () => {
    let runtime: TerminalRelayRuntime;
    const messages: TerminalRelayToMainMessage[] = [];
    const setupResult = await setup((event) => {
      messages.push(event);
      if (event.type === "attach-requested")
        runtime.handleMainMessage({
          type: "attach-decision",
          socketId: event.socketId,
          decision: "running",
          session,
        });
    });
    runtime = setupResult.runtime;
    runtime.handleMainMessage({
      type: "terminal-state",
      terminalId: session.id,
      state: {
        daemonSessionId: "daemon-1",
        hostId: "host-1",
        session,
        status: "running",
      },
    });
    const daemon = await open(`ws://127.0.0.1:${setupResult.port}/daemon`);
    const daemonAttach = message(daemon);
    const browser = await open(`ws://127.0.0.1:${setupResult.port}/browser`);
    const attach = await daemonAttach;
    if (
      !attach ||
      typeof attach !== "object" ||
      !("requestId" in attach) ||
      typeof attach.requestId !== "string"
    )
      throw new Error("Missing daemon attach");
    const attached = message(browser);
    daemon.send(
      JSON.stringify({
        type: "terminal.replay",
        terminalId: session.id,
        requestId: attach.requestId,
        chunks: [],
        replayStartSeq: 0,
        nextSeq: 0,
      }),
    );
    expect(attached).resolves.toMatchObject({ type: "attached", session });
    await attached;
    const output = message(browser);
    daemon.send(
      JSON.stringify({
        type: "terminal.output",
        terminalId: session.id,
        chunk: { seq: 0, dataBase64: "aGk=" },
      }),
    );
    await expect(output).resolves.toMatchObject({
      type: "output",
      chunk: { seq: 0, dataBase64: "aGk=" },
    });
    const input = message(daemon);
    browser.send(JSON.stringify({ type: "input", dataBase64: "YQ==" }));
    await expect(input).resolves.toMatchObject({
      type: "terminal.input",
      dataBase64: "YQ==",
    });
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: "browser-input",
        terminalId: session.id,
      }),
    );
    const fencedDaemon = once(daemon, "close");
    runtime.handleMainMessage({ type: "move-fence", pending: true });
    expect((await fencedDaemon)[0]).toBe(1012);
    const closed = once(browser, "close");
    runtime.handleMainMessage({ type: "shutdown" });
    const [code] = await closed;
    expect(code).toBe(1012);
  });

  it("delivers a frame appended to the upgrade request through a copied non-empty head", async () => {
    let runtime: TerminalRelayRuntime;
    const setupResult = await setup((event) => {
      if (event.type === "attach-requested")
        runtime.handleMainMessage({
          type: "attach-decision",
          socketId: event.socketId,
          decision: "running",
          session,
        });
    });
    runtime = setupResult.runtime;
    const { port, headSize } = setupResult;
    runtime.handleMainMessage({
      type: "terminal-state",
      terminalId: session.id,
      state: {
        daemonSessionId: "daemon-1",
        hostId: "host-1",
        session,
        status: "running",
      },
    });
    const socket = connect(port, "127.0.0.1");
    await once(socket, "connect");
    let resolveResponse: (value: string) => void = () => {};
    const response = new Promise<string>((resolve) => {
      resolveResponse = resolve;
    });
    let received = "";
    socket.on("data", (data) => {
      received += data.toString("latin1");
      if (received.includes('"type":"pong"')) resolveResponse(received);
    });
    const key = Buffer.alloc(16, 1).toString("base64");
    const request = Buffer.from(
      `GET /browser HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`,
    );
    const payload = Buffer.from(JSON.stringify({ type: "ping" }));
    const mask = Buffer.from([1, 2, 3, 4]);
    const frame = Buffer.alloc(6 + payload.length);
    frame[0] = 0x81;
    frame[1] = 0x80 | payload.length;
    mask.copy(frame, 2);
    for (let index = 0; index < payload.length; index++)
      frame[6 + index] = payload[index]! ^ mask[index % 4]!;
    socket.write(Buffer.concat([request, frame]));
    expect(await response).toContain("101 Switching Protocols");
    expect(headSize()).toBeGreaterThan(0);
    socket.destroy();
    runtime.dispose();
  });
});
