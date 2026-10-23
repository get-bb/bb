import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { Worker } from "node:worker_threads";
import WebSocket from "ws";
import { createTerminalSession } from "@bb/db";
import {
  buildHostDaemonWebSocketAuthorizationHeader,
  buildHostDaemonWebSocketProtocols,
} from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { startTerminalRelayProcess } from "../../src/services/terminals/terminal-relay-transport.js";
import { seedHostSession } from "../helpers/seed.js";
import {
  createTestDaemonHostKey,
  startTestServer,
  testLogger,
  type RunningTestServer,
} from "../helpers/test-app.js";

const MAIN_THREAD_BLOCK_MS = 1_000;

const workerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({
    type: z.literal("samples"),
    samples: z.array(
      z.object({ sentAt: z.number(), latencyMs: z.number().nullable() }),
    ),
  }),
]);
type WorkerMessage = z.infer<typeof workerMessageSchema>;

let server: RunningTestServer | null = null;
let worker: Worker | null = null;

afterEach(async () => {
  await worker?.terminate();
  worker = null;
  await server?.close();
  server = null;
});

function nextWorkerMessage(
  source: Worker,
  type: WorkerMessage["type"],
): Promise<WorkerMessage> {
  return new Promise((resolve, reject) => {
    const onMessage = (raw: unknown) => {
      const message = workerMessageSchema.parse(raw);
      if (message.type !== type) {
        return;
      }
      source.off("message", onMessage);
      source.off("error", reject);
      resolve(message);
    };
    source.on("message", onMessage);
    source.once("error", reject);
  });
}

describe("terminal relay process", () => {
  it(
    "keeps echoing keystrokes while the main server event loop is blocked",
    async () => {
      server = await startTestServer({ forkTerminalRelay: true });
      const enabled = await server.app.request("/api/v1/settings/experiments", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ terminalRelayProcess: true }),
      });
      expect(enabled.status).toBe(200);
      const { host, session } = seedHostSession(server.deps);
      const terminal = createTerminalSession(server.db, {
        cols: 80,
        daemonSessionId: session.id,
        environmentId: null,
        hostId: host.id,
        initialCwd: "/tmp",
        rows: 24,
        status: "running",
        threadId: null,
        title: "Terminal 1",
      });
      worker = new Worker(
        new URL("../fixtures/terminal-echo-worker.mjs", import.meta.url),
        {
          workerData: {
            baseUrl: server.baseUrl,
            daemonAuthorization: buildHostDaemonWebSocketAuthorizationHeader(
              createTestDaemonHostKey({ hostId: host.id }),
            ),
            daemonProtocols: buildHostDaemonWebSocketProtocols(),
            echoTimeoutMs: 5_000,
            sessionId: session.id,
            terminalId: terminal.id,
          },
        },
      );
      await nextWorkerMessage(worker, "ready");

      const samples = nextWorkerMessage(worker, "samples");
      worker.postMessage({ type: "type", keys: 60, intervalMs: 20 });
      const blockedFrom = Date.now();
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, MAIN_THREAD_BLOCK_MS);
      const blockedUntil = Date.now();

      const result = await samples;
      if (result.type !== "samples") {
        throw new Error("Expected typing samples");
      }
      const typed = result.samples;
      const typedWhileBlocked = typed.filter(
        (sample) => sample.sentAt >= blockedFrom && sample.sentAt < blockedUntil,
      );
      expect(typed.every((sample) => sample.latencyMs !== null)).toBe(true);
      expect(typedWhileBlocked.length).toBeGreaterThanOrEqual(10);
      expect(
        Math.max(...typedWhileBlocked.map((sample) => sample.latencyMs ?? Infinity)),
      ).toBeLessThan(250);
    },
    30_000,
  );
});

describe("terminal relay shutdown", () => {
  it("closes open terminal sockets so the server can shut down", async () => {
    server = await startTestServer();
    const { host, session } = seedHostSession(server.deps);
    const terminal = createTerminalSession(server.db, {
      cols: 80,
      daemonSessionId: session.id,
      environmentId: null,
      hostId: host.id,
      initialCwd: "/tmp",
      rows: 24,
      status: "running",
      threadId: null,
      title: "Terminal 1",
    });
    const socket = new WebSocket(
      `${server.baseUrl.replace(/^http/u, "ws")}/ws/terminals/${terminal.id}?sinceSeq=0`,
    );
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });

    const closed = server.close().then(() => "closed");
    const timedOut = new Promise((resolve) => {
      setTimeout(() => resolve("timed out"), 5_000).unref();
    });
    expect(await Promise.race([closed, timedOut])).toBe("closed");
    server = null;
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });
});

const relayRestartLogSchema = z.object({ restartDelayMs: z.number() });

interface TerminalOutput {
  seq: number;
  text: string;
}

function terminalSocketUrl(baseUrl: string, path: string): URL {
  const url = new URL(path, baseUrl);
  url.protocol = "ws:";
  return url;
}

async function openSocket(
  url: URL,
  protocols: string[] = [],
  headers: Record<string, string> = {},
): Promise<WebSocket> {
  for (let attempt = 0; ; attempt += 1) {
    const socket = new WebSocket(url, protocols, { headers });
    try {
      await once(socket, "open");
      return socket;
    } catch (error) {
      if (attempt >= 100) {
        throw error;
      }
      await sleep(100);
    }
  }
}

function startFakeDaemon(args: {
  authorization: string;
  baseUrl: string;
  protocols: string[];
  sessionId: string;
}) {
  const chunks: { seq: number; dataBase64: string }[] = [];
  let socket: WebSocket | null = null;
  const output = (text: string) => {
    const chunk = { seq: chunks.length, dataBase64: Buffer.from(text).toString("base64") };
    chunks.push(chunk);
    return chunk;
  };
  const connect = async () => {
    const url = terminalSocketUrl(args.baseUrl, "/internal/ws/terminals");
    url.searchParams.set("sessionId", args.sessionId);
    const next = await openSocket(url, args.protocols, {
      authorization: args.authorization,
    });
    next.on("message", (raw) => {
      const message = z
        .object({
          type: z.string(),
          requestId: z.string().optional(),
          terminalId: z.string(),
          sinceSeq: z.number().optional(),
          dataBase64: z.string().optional(),
        })
        .parse(JSON.parse(String(raw)));
      if (message.type === "terminal.attach") {
        const sinceSeq = message.sinceSeq ?? 0;
        next.send(
          JSON.stringify({
            type: "terminal.replay",
            requestId: message.requestId,
            terminalId: message.terminalId,
            chunks: chunks.filter((chunk) => chunk.seq >= sinceSeq),
            replayStartSeq: sinceSeq,
            nextSeq: chunks.length,
          }),
        );
      }
      if (message.type === "terminal.input" && message.dataBase64 !== undefined) {
        const text = Buffer.from(message.dataBase64, "base64").toString();
        next.send(
          JSON.stringify({
            type: "terminal.output",
            terminalId: message.terminalId,
            chunk: output(text),
          }),
        );
      }
    });
    socket = next;
    return next;
  };
  return {
    connect,
    output,
    get socket() {
      return socket;
    },
  };
}

async function openBrowser(baseUrl: string, terminalId: string, sinceSeq: number) {
  const socket = await openSocket(
    terminalSocketUrl(baseUrl, `/ws/terminals/${terminalId}?sinceSeq=${sinceSeq}`),
  );
  const outputs: TerminalOutput[] = [];
  socket.on("message", (raw) => {
    const message = z
      .object({
        type: z.string(),
        chunk: z.object({ seq: z.number(), dataBase64: z.string() }).optional(),
      })
      .parse(JSON.parse(String(raw)));
    if (message.type === "output" && message.chunk) {
      outputs.push({
        seq: message.chunk.seq,
        text: Buffer.from(message.chunk.dataBase64, "base64").toString(),
      });
    }
  });
  const type = (text: string) =>
    socket.send(
      JSON.stringify({ type: "input", dataBase64: Buffer.from(text).toString("base64") }),
    );
  return { outputs, socket, type };
}

describe("terminal relay crash recovery", () => {
  it("backs off restarts while the relay keeps exiting before it is ready", async () => {
    const restartDelays: number[] = [];
    const relay = startTerminalRelayProcess({
      entryUrl: new URL("../fixtures/terminal-relay-exits.mjs", import.meta.url),
      execArgv: [],
      logger: {
        ...testLogger,
        warn: (...args: unknown[]) => {
          if (args[1] === "Terminal relay exited; restarting") {
            restartDelays.push(relayRestartLogSchema.parse(args[0]).restartDelayMs);
          }
        },
      },
    });
    try {
      await vi.waitFor(() => expect(restartDelays.length).toBeGreaterThanOrEqual(3), {
        timeout: 10_000,
      });
      expect(restartDelays.slice(0, 3)).toEqual([250, 500, 1_000]);
    } finally {
      await relay.close();
    }
  });

  it(
    "reconnects a browser and replays the output it missed after the relay process crashes",
    async () => {
      server = await startTestServer({ forkTerminalRelay: true });
      const forked = server.forkedTerminalRelay;
      if (forked === null) {
        throw new Error("Expected a forked terminal relay");
      }
      await server.app.request("/api/v1/settings/experiments", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ terminalRelayProcess: true }),
      });
      const { host, session } = seedHostSession(server.deps);
      const terminal = createTerminalSession(server.db, {
        cols: 80,
        daemonSessionId: session.id,
        environmentId: null,
        hostId: host.id,
        initialCwd: "/tmp",
        rows: 24,
        status: "running",
        threadId: null,
        title: "Terminal 1",
      });
      const daemon = startFakeDaemon({
        authorization: buildHostDaemonWebSocketAuthorizationHeader(
          createTestDaemonHostKey({ hostId: host.id }),
        ),
        baseUrl: server.baseUrl,
        protocols: buildHostDaemonWebSocketProtocols(),
        sessionId: session.id,
      });
      const firstDaemonSocket = await daemon.connect();
      const first = await openBrowser(server.baseUrl, terminal.id, 0);
      first.type("a");
      await vi.waitFor(() => expect(first.outputs).toEqual([{ seq: 0, text: "a" }]));
      const crashedPid = forked.pid;
      if (crashedPid === null) {
        throw new Error("Expected a running relay process");
      }

      process.kill(crashedPid, "SIGKILL");
      await Promise.all([once(first.socket, "close"), once(firstDaemonSocket, "close")]);
      daemon.output("missed");
      await vi.waitFor(() => expect(forked.pid).not.toBe(crashedPid), { timeout: 5_000 });
      await daemon.connect();
      const second = await openBrowser(server.baseUrl, terminal.id, 1);
      second.type("b");

      await vi.waitFor(() =>
        expect(second.outputs).toEqual([
          { seq: 1, text: "missed" },
          { seq: 2, text: "b" },
        ]),
      );
      second.socket.close();
      daemon.socket?.close();
    },
    30_000,
  );
});
