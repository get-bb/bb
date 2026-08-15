/**
 * Minimal JSON-RPC 2.0 endpoint over a spawned ACP agent's stdio.
 *
 * ACP frames messages as newline-delimited JSON. BB only consumes a small,
 * stable subset of the protocol, so the bridge validates traffic with the
 * schemas in `../wire.ts` instead of depending on an external ACP SDK.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { z } from "zod";

const STDERR_TAIL_MAX_CHUNKS = 40;

export interface AcpAgentRequestResponder {
  result(value: unknown): void;
  error(code: number, message: string): void;
}

export interface AcpAgentExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderrTail: string;
}

export interface CreateAcpAgentConnectionOptions {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  onNotification(method: string, params: unknown): void;
  onRequest(
    method: string,
    params: unknown,
    responder: AcpAgentRequestResponder,
  ): void;
  onExit(info: AcpAgentExitInfo): void;
}

export interface AcpAgentRequestArgs<TResult> {
  method: string;
  params: unknown;
  resultSchema: z.ZodType<TResult>;
}

export interface AcpAgentConnection {
  request<TResult>(args: AcpAgentRequestArgs<TResult>): Promise<TResult>;
  notify(method: string, params: unknown): void;
  kill(): void;
  readonly exited: boolean;
}

export class AcpAgentExitedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcpAgentExitedError";
  }
}

interface PendingAgentRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

interface ParsedAgentMessage {
  id?: string | number;
  method?: string;
  result?: unknown;
  error?: { code?: number; message?: string };
  params?: unknown;
}

function parseAgentLine(line: string): ParsedAgentMessage | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  return parsed as ParsedAgentMessage;
}

export function createAcpAgentConnection(
  options: CreateAcpAgentConnectionOptions,
): AcpAgentConnection {
  const child: ChildProcess = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const pending = new Map<number, PendingAgentRequest>();
  const stderrChunks: string[] = [];
  let nextRequestId = 1;
  let exited = false;

  function writeLine(message: object): void {
    const stdin = child.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) {
      return;
    }
    stdin.write(JSON.stringify(message) + "\n");
  }

  function rejectAllPending(error: Error): void {
    for (const [, request] of pending) {
      request.reject(error);
    }
    pending.clear();
  }

  if (child.stdout) {
    const stdoutLines = createInterface({
      input: child.stdout,
      terminal: false,
    });
    stdoutLines.on("line", (line) => {
      const message = parseAgentLine(line);
      if (!message) {
        return;
      }

      const id = message.id;
      if (
        (typeof id === "string" || typeof id === "number") &&
        message.method === undefined
      ) {
        const numericId = typeof id === "number" ? id : Number(id);
        const request = pending.get(numericId);
        if (!request) {
          return;
        }
        pending.delete(numericId);
        if (message.error) {
          request.reject(
            new Error(
              message.error.message ??
                `ACP agent returned error code ${message.error.code ?? "unknown"}`,
            ),
          );
        } else {
          request.resolve(message.result);
        }
        return;
      }

      if (typeof message.method !== "string") {
        return;
      }

      if (typeof id === "string" || typeof id === "number") {
        let settled = false;
        options.onRequest(message.method, message.params, {
          result(value) {
            if (settled) return;
            settled = true;
            writeLine({ jsonrpc: "2.0", id, result: value ?? null });
          },
          error(code, errorMessage) {
            if (settled) return;
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
    if (exited) {
      return;
    }
    exited = true;
    rejectAllPending(
      new AcpAgentExitedError(
        `Failed to launch ACP agent "${options.command}": ${error.message}`,
      ),
    );
    options.onExit({ code: null, signal: null, stderrTail: error.message });
  });

  child.on("exit", (code, signal) => {
    if (exited) {
      return;
    }
    exited = true;
    const stderrTail = stderrChunks.join("\n");
    rejectAllPending(
      new AcpAgentExitedError(
        `ACP agent "${options.command}" exited (code ${code ?? "null"}, signal ${signal ?? "null"})${
          stderrTail ? `: ${stderrTail}` : ""
        }`,
      ),
    );
    options.onExit({ code, signal, stderrTail });
  });

  return {
    get exited() {
      return exited;
    },

    request({ method, params, resultSchema }) {
      if (exited) {
        return Promise.reject(
          new AcpAgentExitedError(
            `ACP agent "${options.command}" is not running`,
          ),
        );
      }
      const id = nextRequestId;
      nextRequestId += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, {
          resolve: (value) => {
            const parsed = resultSchema.safeParse(value);
            if (parsed.success) {
              resolve(parsed.data);
            } else {
              reject(
                new Error(
                  `ACP agent returned an unexpected ${method} result: ${parsed.error.message}`,
                ),
              );
            }
          },
          reject,
        });
        writeLine({ jsonrpc: "2.0", id, method, params });
      });
    },

    notify(method, params) {
      if (exited) {
        return;
      }
      writeLine({ jsonrpc: "2.0", method, params });
    },

    kill() {
      if (exited) {
        return;
      }
      child.kill("SIGTERM");
    },
  };
}
