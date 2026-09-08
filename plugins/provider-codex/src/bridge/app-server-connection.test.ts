import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CodexAppServerExitedError,
  createCodexAppServerConnection,
  type CodexAppServerConnection,
  type CodexAppServerExitInfo,
} from "./app-server-connection.js";

const EPIPE_PAYLOAD_SIZE = 1024 * 1024;

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value);
    },
  };
}

async function stopConnection(
  connection: CodexAppServerConnection,
  exit: Promise<CodexAppServerExitInfo>,
): Promise<void> {
  await connection.kill();
  await exit;
}

function childRequestLine(): string {
  return `${JSON.stringify({
    jsonrpc: "2.0",
    id: "child-request",
    method: "fixture/approval",
    params: {},
  })}\n`;
}

describe("codex app-server connection", () => {
  it("preserves final output and exit details while stdio drains", async () => {
    const exited = deferred<CodexAppServerExitInfo>();
    const lateResponseLine = `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { thread: { id: "thread-from-final-output" } },
    })}\n`;
    const descendantScript = [
      `const line = ${JSON.stringify(lateResponseLine)};`,
      "setTimeout(() => process.stdout.write(line, () => process.exit(0)), 250);",
    ].join("");
    const childScript = [
      'const { spawn } = require("node:child_process");',
      'process.stdin.once("data", () => {',
      'process.stderr.write("fixture stderr\\n");',
      `process.stdout.write(${JSON.stringify(childRequestLine())}, () => {`,
      `spawn(process.execPath, ["-e", ${JSON.stringify(descendantScript)}], { stdio: ["ignore", 1, "ignore"] });`,
      "process.exit(7);",
      "});",
      "});",
    ].join("");
    const connection = createCodexAppServerConnection({
      command: process.execPath,
      args: ["-e", childScript],
      cwd: process.cwd(),
      env: process.env,
      recordThreadId: null,
      onNotification: () => undefined,
      onRequest: (_method, _params, responder) => {
        setTimeout(() => responder.result({ decision: "accept" }), 100);
      },
      onExit: exited.resolve,
    });

    try {
      await expect(
        connection.request({
          method: "thread/start",
          resultSchema: z.object({
            thread: z.object({ id: z.string() }),
          }),
        }),
      ).resolves.toEqual({
        thread: { id: "thread-from-final-output" },
      });
      await expect(exited.promise).resolves.toEqual({
        code: 7,
        signal: null,
        stderrTail: "fixture stderr",
        spawnFailed: false,
      });
    } finally {
      await stopConnection(connection, exited.promise);
    }
  }, 30_000);

  it("preserves a natural exit status when EPIPE precedes exit", async () => {
    const exited = deferred<CodexAppServerExitInfo>();
    const connection = createCodexAppServerConnection({
      command: process.execPath,
      args: [
        "-e",
        'process.stderr.write("fixture stderr\\n"); process.exit(7);',
      ],
      cwd: process.cwd(),
      env: process.env,
      recordThreadId: null,
      onNotification: () => undefined,
      onRequest: () => undefined,
      onExit: exited.resolve,
    });

    try {
      await expect(
        connection.request({
          method: "thread/start",
          params: { payload: "x".repeat(EPIPE_PAYLOAD_SIZE) },
          resultSchema: z.unknown(),
        }),
      ).rejects.toThrow(/codex app-server exited \(code 7, signal null\)/);
      await expect(exited.promise).resolves.toMatchObject({
        code: 7,
        signal: null,
        stderrTail: expect.stringContaining("fixture stderr"),
        spawnFailed: false,
      });
    } finally {
      await stopConnection(connection, exited.promise);
    }
  }, 30_000);

  it("makes a broken child stdin immediately terminal", async () => {
    const ready = deferred<void>();
    const exited = deferred<CodexAppServerExitInfo>();
    const connection = createCodexAppServerConnection({
      command: process.execPath,
      args: [
        "-e",
        [
          'require("node:fs").closeSync(0);',
          `process.stdout.write(${JSON.stringify(
            `${JSON.stringify({ jsonrpc: "2.0", method: "ready" })}\n`,
          )});`,
          'process.on("SIGTERM", () => {});',
          "setTimeout(() => process.exit(0), 1000);",
        ].join(""),
      ],
      cwd: process.cwd(),
      env: process.env,
      recordThreadId: null,
      onNotification(method) {
        if (method === "ready") ready.resolve();
      },
      onRequest: () => undefined,
      onExit: exited.resolve,
    });

    try {
      await ready.promise;
      const pendingRequest = connection.request({
        method: "thread/start",
        params: { payload: "x".repeat(EPIPE_PAYLOAD_SIZE) },
        resultSchema: z.unknown(),
      });
      await expect(
        Promise.race([
          pendingRequest,
          delay(500).then(() => {
            throw new Error(
              "Codex request remained pending after stdin closed",
            );
          }),
        ]),
      ).rejects.toBeInstanceOf(CodexAppServerExitedError);
      expect(connection.exited).toBe(true);
      await expect(
        connection.request({
          method: "thread/resume",
          resultSchema: z.unknown(),
        }),
      ).rejects.toBeInstanceOf(CodexAppServerExitedError);
      await expect(exited.promise).resolves.toMatchObject({
        code: null,
        signal: "SIGKILL",
        stderrTail: expect.stringMatching(/stdin failed \(EPIPE\)/),
        spawnFailed: false,
      });
    } finally {
      await stopConnection(connection, exited.promise);
    }
  }, 30_000);
});
