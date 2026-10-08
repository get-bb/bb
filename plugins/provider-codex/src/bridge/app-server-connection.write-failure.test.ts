import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  CodexAppServerExitedError,
  createCodexAppServerConnection,
  type CodexAppServerExitInfo,
} from "./app-server-connection.js";

const failure = vi.hoisted(() => ({ mode: "event" }));

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return {
    ...original,
    spawn(...args: Parameters<typeof original.spawn>) {
      const child = original.spawn(...args);
      const stdin = child.stdin;
      if (stdin) {
        stdin.write = (
          _chunk: string | Uint8Array,
          encodingOrCallback?:
            | BufferEncoding
            | ((error?: Error | null) => void),
          callback?: (error?: Error | null) => void,
        ) => {
          const error = Object.assign(new Error("no buffer space"), {
            code: "ENOBUFS",
          });
          if (failure.mode === "throw") throw error;
          queueMicrotask(() => {
            if (failure.mode === "callback") {
              const onWrite =
                typeof encodingOrCallback === "function"
                  ? encodingOrCallback
                  : callback;
              onWrite?.(error);
            }
            stdin.emit("error", error);
          });
          return false;
        };
      }
      return child;
    },
  };
});

afterEach(() => vi.restoreAllMocks());

it.each(["event", "callback", "throw"])(
  "settles %s ENOBUFS as a child failure without an uncaught exception",
  async (mode) => {
    failure.mode = mode;
    let resolveExit!: (info: CodexAppServerExitInfo) => void;
    const exited = new Promise<CodexAppServerExitInfo>((resolve) => {
      resolveExit = resolve;
    });
    const connection = createCodexAppServerConnection({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: process.cwd(),
      env: process.env,
      recordThreadId: null,
      onNotification: () => undefined,
      onRequest: () => undefined,
      onExit: resolveExit,
    });
    try {
      await expect(
        connection.request({ method: "echo", resultSchema: z.unknown() }),
      ).rejects.toBeInstanceOf(CodexAppServerExitedError);
      expect(connection.exited).toBe(true);
      await expect(
        connection.request({ method: "echo", resultSchema: z.unknown() }),
      ).rejects.toBeInstanceOf(CodexAppServerExitedError);
      await expect(exited).resolves.toMatchObject({
        signal: "SIGKILL",
        stderrTail: expect.stringContaining("stdin failed (ENOBUFS)"),
      });
    } finally {
      await connection.kill();
    }
  },
);
