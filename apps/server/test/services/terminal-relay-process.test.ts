import { Worker } from "node:worker_threads";
import WebSocket from "ws";
import { createTerminalSession } from "@bb/db";
import {
  buildHostDaemonWebSocketAuthorizationHeader,
  buildHostDaemonWebSocketProtocols,
} from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { seedHostSession } from "../helpers/seed.js";
import {
  createTestDaemonHostKey,
  startTestServer,
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
      server = await startTestServer();
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
