import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { jsonValueSchema, type JsonValue } from "@bb/domain";
import { experimental_recordProviderChildIo } from "@bb/provider-bridge-protocol/bridge-kit";
import { z } from "zod";

const STDERR_TAIL_MAX_CHUNKS = 40;
const CLOSED_STDIN_ERROR_CODES = new Set(["EPIPE", "ERR_STREAM_DESTROYED"]);
const agentErrorSchema = z.object({
  code: z.number().optional(),
  data: jsonValueSchema.optional(),
  message: z.string().optional(),
});
const agentMessageSchema = z.object({
  error: agentErrorSchema.optional(),
  id: z.union([z.string(), z.number()]).optional(),
  jsonrpc: z.literal("2.0").optional(),
  method: z.string().optional(),
  params: jsonValueSchema.optional(),
  result: jsonValueSchema.optional(),
});
const agentErrorCodeSchema = z.object({ code: z.string() });

type AgentMessageValue = JsonValue | undefined;
type AgentMessage = z.infer<typeof agentMessageSchema>;
type AgentError = z.infer<typeof agentErrorSchema>;
type AgentOutgoingMessage = {
  error?: { code: number; message: string };
  id?: string | number;
  jsonrpc: "2.0";
  method?: string;
  params?: AgentMessageValue;
  result?: AgentMessageValue;
};

export interface AcpAgentRequestResponder {
  result(value: AgentMessageValue): void;
  error(code: number, message: string): void;
}

export interface AcpAgentExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderrTail: string;
}

interface CreateAcpAgentConnectionOptions {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  recordThreadId: string | null;
  onNotification(method: string, params: AgentMessageValue): void;
  onRequest(
    method: string,
    params: AgentMessageValue,
    responder: AcpAgentRequestResponder,
  ): void;
  onExit(info: AcpAgentExitInfo): void;
}

interface AcpAgentRequestArgs<TResult> {
  method: string;
  params: AgentMessageValue;
  resultSchema: z.ZodType<TResult>;
}

export interface AcpAgentConnection {
  request<TResult>(args: AcpAgentRequestArgs<TResult>): Promise<TResult>;
  notify(method: string, params: AgentMessageValue): void;
  kill(): void;
  readonly exited: boolean;
}

export class AcpAgentExitedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcpAgentExitedError";
  }
}

export class AcpAgentResponseError extends Error {
  readonly code: number | undefined;

  constructor(message: string, code: number | undefined) {
    super(message);
    this.name = "AcpAgentResponseError";
    this.code = code;
  }
}

interface PendingAgentRequest {
  resolve(value: AgentMessageValue): void;
  reject(error: Error): void;
}

function isClosedAgentStdinError(error: Error): boolean {
  const parsed = agentErrorCodeSchema.safeParse(error);
  return parsed.success && CLOSED_STDIN_ERROR_CODES.has(parsed.data.code);
}

export function formatAgentError(error: AgentError): string {
  const message =
    error.message ?? `ACP agent returned error code ${error.code ?? "unknown"}`;
  const details = formatAgentErrorData(error.data);
  return details === undefined ? message : `${message}: ${details}`;
}

function formatAgentErrorData(data: AgentMessageValue): string | undefined {
  if (data === undefined || data === null) {
    return undefined;
  }
  const stringData = z.string().safeParse(data);
  if (stringData.success) {
    return stringData.data.trim() === "" ? undefined : stringData.data;
  }
  const details = z.object({ details: z.string() }).safeParse(data);
  if (details.success && details.data.details.trim() !== "") {
    return details.data.details;
  }
  try {
    return JSON.stringify(data);
  } catch {
    return undefined;
  }
}

function parseAgentLine(line: string): AgentMessage | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const result = agentMessageSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

export function createAcpAgentConnection(
  options: CreateAcpAgentConnectionOptions,
): AcpAgentConnection {
  const child: ChildProcess = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  experimental_recordProviderChildIo(child, {
    threadId: options.recordThreadId,
  });

  const pending = new Map<number, PendingAgentRequest>();
  const stderrChunks: string[] = [];
  let nextRequestId = 1;
  let exited = false;
  let stopping = false;

  function rejectAllPending(error: Error): void {
    for (const [, request] of pending) {
      request.reject(error);
    }
    pending.clear();
  }

  function closeForAgentStdin(error: Error): void {
    if (exited) {
      return;
    }
    exited = true;
    const parsedCode = agentErrorCodeSchema.safeParse(error);
    const code = parsedCode.success ? ` (${parsedCode.data.code})` : "";
    const detail = `stdin closed${code}: ${error.message}`;
    rejectAllPending(
      new AcpAgentExitedError(`ACP agent "${options.command}" ${detail}`),
    );
    child.kill("SIGKILL");
    const stderrTail = [...stderrChunks, detail].join("\n");
    options.onExit({ code: null, signal: null, stderrTail });
  }

  function writeLine(message: AgentOutgoingMessage): void {
    if (stopping) {
      return;
    }
    const stdin = child.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) {
      closeForAgentStdin(new Error("stdin is not writable"));
      return;
    }
    stdin.write(JSON.stringify(message) + "\n");
  }

  child.stdin?.on("error", (error) => {
    if (!isClosedAgentStdinError(error)) {
      throw error;
    }
    if (stopping) {
      child.kill("SIGKILL");
      return;
    }
    closeForAgentStdin(error);
  });

  if (child.stdout) {
    const stdoutLines = createInterface({
      input: child.stdout,
      terminal: false,
    });
    stdoutLines.on("line", (line) => {
      if (stopping) {
        return;
      }
      const message = parseAgentLine(line);
      if (!message) {
        return;
      }

      const id = message.id;
      if (id !== undefined && message.method === undefined) {
        const numericIdResult = z.coerce.number().safeParse(id);
        if (!numericIdResult.success) {
          return;
        }
        const numericId = numericIdResult.data;
        const request = pending.get(numericId);
        if (!request) {
          return;
        }
        pending.delete(numericId);
        if (message.error) {
          request.reject(
            new AcpAgentResponseError(
              formatAgentError(message.error),
              message.error.code,
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
      return stopping || exited;
    },

    request({ method, params, resultSchema }) {
      if (stopping || exited) {
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
      if (stopping || exited) {
        return;
      }
      writeLine({ jsonrpc: "2.0", method, params });
    },

    kill() {
      if (stopping || exited) {
        return;
      }
      stopping = true;
      rejectAllPending(
        new AcpAgentExitedError(
          `ACP agent "${options.command}" is not running`,
        ),
      );
      child.kill("SIGTERM");
    },
  };
}
