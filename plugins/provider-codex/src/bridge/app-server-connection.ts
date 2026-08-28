import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type { JsonValue } from "@get-bb/plugin-sdk";
import { experimental_recordProviderChildIo } from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";

const STDERR_TAIL_MAX_CHUNKS = 40;
const CLOSE_AFTER_EXIT_GRACE_MS = 1_000;
const KILL_ESCALATION_MS = 4_000;
const jsonValueSchema = z.json();

export interface CodexAppServerRequestResponder {
  result(value: JsonValue | undefined): void;
  error(code: number, message: string): void;
}

export interface CodexAppServerExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderrTail: string;
  spawnFailed: boolean;
}

interface CreateCodexAppServerConnectionOptions {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  recordThreadId: string | null;
  onNotification(method: string, params: JsonValue | undefined): void;
  onRequest(
    method: string,
    params: JsonValue | undefined,
    responder: CodexAppServerRequestResponder,
  ): void;
  onExit(info: CodexAppServerExitInfo): void;
}

interface CodexAppServerRequestArgs<TResult> {
  method: string;
  params?: JsonValue;
  resultSchema: z.ZodType<TResult>;
  timeoutMs?: number;
}

export interface CodexAppServerConnection {
  request<TResult>(args: CodexAppServerRequestArgs<TResult>): Promise<TResult>;
  notify(method: string, params?: JsonValue): void;
  kill(): void;
  readonly exited: boolean;
}

export class CodexAppServerExitedError extends Error {
  readonly spawnFailed: boolean;

  constructor(message: string, options?: { spawnFailed?: boolean }) {
    super(message);
    this.name = "CodexAppServerExitedError";
    this.spawnFailed = options?.spawnFailed ?? false;
  }
}

interface PendingChildRequest {
  resolve(value: JsonValue | undefined): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout | null;
}

const childMessageSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    method: z.string().optional(),
    result: jsonValueSchema.optional(),
    error: z
      .object({
        code: z.number().optional(),
        message: z.string().optional(),
      })
      .optional(),
    params: jsonValueSchema.optional(),
  })
  .passthrough();

type ParsedChildMessage = z.infer<typeof childMessageSchema>;

function parseChildLine(line: string): ParsedChildMessage | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  let parsed: JsonValue;
  try {
    parsed = jsonValueSchema.parse(JSON.parse(trimmed));
  } catch {
    return null;
  }
  const message = childMessageSchema.safeParse(parsed);
  if (!message.success) {
    return null;
  }
  return message.data;
}

export function createCodexAppServerConnection(
  options: CreateCodexAppServerConnectionOptions,
): CodexAppServerConnection {
  const child: ChildProcess = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  experimental_recordProviderChildIo(child, {
    threadId: options.recordThreadId,
  });

  const pending = new Map<number, PendingChildRequest>();
  const stderrChunks: string[] = [];
  let nextRequestId = 1;
  let finalized = false;
  let spawnFailed = false;
  let exitStatus: {
    code: number | null;
    signal: NodeJS.Signals | null;
  } | null = null;
  let closeGraceTimer: NodeJS.Timeout | null = null;
  let stdoutLines: Interface | null = null;

  function writeLine<TMessage extends object>(message: TMessage): void {
    const stdin = child.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) {
      return;
    }
    stdin.write(JSON.stringify(jsonValueSchema.parse(message)) + "\n");
  }

  function rejectAllPending(error: Error): void {
    for (const [, request] of pending) {
      if (request.timeout !== null) {
        clearTimeout(request.timeout);
      }
      request.reject(error);
    }
    pending.clear();
  }

  function finalizeExit(status: {
    code: number | null;
    signal: NodeJS.Signals | null;
  }): void {
    if (finalized) {
      return;
    }
    finalized = true;
    if (closeGraceTimer !== null) {
      clearTimeout(closeGraceTimer);
      closeGraceTimer = null;
    }
    stdoutLines?.close();
    child.stdout?.destroy();
    child.stderr?.destroy();
    const stderrTail = stderrChunks.join("\n");
    rejectAllPending(
      new CodexAppServerExitedError(
        `codex app-server exited (code ${status.code ?? "null"}, signal ${status.signal ?? "null"})${
          stderrTail ? `: ${stderrTail}` : ""
        }`,
        { spawnFailed },
      ),
    );
    options.onExit({ ...status, stderrTail, spawnFailed });
  }

  if (child.stdout) {
    stdoutLines = createInterface({ input: child.stdout, terminal: false });
    stdoutLines.on("line", (line) => {
      if (finalized) {
        return;
      }
      const message = parseChildLine(line);
      if (!message) {
        return;
      }

      const id = message.id;
      if (id !== undefined && message.method === undefined) {
        const numericId = Number(id);
        const request = pending.get(numericId);
        if (!request) {
          return;
        }
        pending.delete(numericId);
        if (request.timeout !== null) {
          clearTimeout(request.timeout);
        }
        if (message.error) {
          request.reject(
            new Error(
              message.error.message ??
                `codex app-server returned error code ${message.error.code ?? "unknown"}`,
            ),
          );
        } else {
          request.resolve(message.result);
        }
        return;
      }

      if (message.method === undefined) {
        return;
      }

      if (id !== undefined) {
        let settled = false;
        options.onRequest(message.method, message.params, {
          result(value) {
            if (settled || finalized) return;
            settled = true;
            writeLine({ jsonrpc: "2.0", id, result: value ?? null });
          },
          error(code, errorMessage) {
            if (settled || finalized) return;
            settled = true;
            writeLine({
              jsonrpc: "2.0",
              id,
              error: { code, message: errorMessage },
            });
          },
        });
        return;
      }

      options.onNotification(message.method, message.params);
    });
  }

  if (child.stderr) {
    const stderrLines = createInterface({
      input: child.stderr,
      terminal: false,
    });
    stderrLines.on("line", (line) => {
      stderrChunks.push(line);
      if (stderrChunks.length > STDERR_TAIL_MAX_CHUNKS) {
        stderrChunks.shift();
      }
    });
  }

  child.on("error", (error) => {
    spawnFailed = true;
    stderrChunks.push(error.message);
    finalizeExit({ code: null, signal: null });
  });

  child.on("exit", (code, signal) => {
    exitStatus = { code: code ?? null, signal: signal ?? null };
    closeGraceTimer = setTimeout(() => {
      finalizeExit(exitStatus ?? { code: null, signal: null });
    }, CLOSE_AFTER_EXIT_GRACE_MS);
    closeGraceTimer.unref?.();
  });

  child.on("close", (code, signal) => {
    finalizeExit(exitStatus ?? { code: code ?? null, signal: signal ?? null });
  });

  return {
    get exited() {
      return finalized;
    },

    request({ method, params, resultSchema, timeoutMs }) {
      if (finalized) {
        return Promise.reject(
          new CodexAppServerExitedError("codex app-server is not running", {
            spawnFailed,
          }),
        );
      }
      const id = nextRequestId;
      nextRequestId += 1;
      return new Promise((resolve, reject) => {
        const entry: PendingChildRequest = {
          resolve: (value) => {
            const parsed = resultSchema.safeParse(value);
            if (parsed.success) {
              resolve(parsed.data);
            } else {
              reject(
                new Error(
                  `codex app-server returned an unexpected ${method} result: ${parsed.error.message}`,
                ),
              );
            }
          },
          reject,
          timeout: null,
        };
        if (timeoutMs !== undefined) {
          entry.timeout = setTimeout(() => {
            pending.delete(id);
            reject(
              new Error(
                `codex app-server did not answer ${method} within ${timeoutMs}ms`,
              ),
            );
          }, timeoutMs);
          entry.timeout.unref?.();
        }
        pending.set(id, entry);
        writeLine({ jsonrpc: "2.0", id, method, params });
      });
    },

    notify(method, params) {
      if (finalized) {
        return;
      }
      writeLine({ jsonrpc: "2.0", method, params });
    },

    kill() {
      if (finalized) {
        return;
      }
      const escalation = setTimeout(() => {
        if (!finalized) {
          child.kill("SIGKILL");
        }
      }, KILL_ESCALATION_MS);
      escalation.unref?.();
      child.kill("SIGTERM");
    },
  };
}
