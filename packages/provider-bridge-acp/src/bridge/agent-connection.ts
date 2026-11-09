import {
  spawnManagedProcess,
  isClosedProcessStdinError,
} from "@bb/process-utils";
import { RequestError } from "@agentclientprotocol/sdk";
import { createInterface } from "node:readline";
import { experimental_recordProviderChildIo } from "@bb/provider-bridge-protocol/bridge-kit";
import { connectAcpClient, type AcpClient } from "../client/acp-client.js";
import {
  ACP_CLIENT_PROTOCOL_VERSION,
  readAcpAgentCapabilities,
  type AcpAgentCapabilities,
} from "../client/capabilities.js";
import { z } from "zod";

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

interface CreateAcpAgentConnectionOptions {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  recordThreadId: string | null;
  requestMethods?: readonly string[];
  onResponse?(method: string, result: unknown): void;
  onNotification(method: string, params: unknown): void;
  onRequest(
    method: string,
    params: unknown,
    responder: AcpAgentRequestResponder,
  ): void;
  onExit(info: AcpAgentExitInfo): void;
}

interface AcpAgentRequestArgs<TResult> {
  method: string;
  params: unknown;
  resultSchema: z.ZodType<TResult>;
  timeoutMs?: number;
}

export const ACP_CORE_CLIENT_REQUEST_METHODS = [
  "session/request_permission",
  "fs/read_text_file",
  "fs/write_text_file",
  "elicitation/create",
] as const;

export interface AcpAgentConnection {
  request<TResult>(args: AcpAgentRequestArgs<TResult>): Promise<TResult>;
  notify(method: string, params: unknown): void;
  kill(): Promise<void>;
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
  readonly data: unknown;

  constructor(message: string, code: number | undefined, data?: unknown) {
    super(message);
    this.name = "AcpAgentResponseError";
    this.code = code;
    this.data = data;
  }
}

interface AgentErrorObject {
  code?: number;
  message?: string;
  data?: unknown;
}

export function formatAgentError(error: AgentErrorObject): string {
  const message =
    error.message ?? `ACP agent returned error code ${error.code ?? "unknown"}`;
  const details = formatAgentErrorData(error.data);
  return details === undefined ? message : `${message}: ${details}`;
}

function formatAgentErrorData(data: unknown): string | undefined {
  if (data === undefined || data === null) {
    return undefined;
  }
  if (typeof data === "string") {
    return data.trim() === "" ? undefined : data;
  }
  if (
    typeof data === "object" &&
    "details" in data &&
    typeof data.details === "string" &&
    data.details.trim() !== ""
  ) {
    return data.details;
  }
  try {
    return JSON.stringify(data);
  } catch {
    return undefined;
  }
}

export function createAcpAgentConnection(
  options: CreateAcpAgentConnectionOptions,
): AcpAgentConnection {
  const managed = spawnManagedProcess({
    command: options.command,
    args: options.args,
    cwd: options.cwd,
    env: options.env,
  });
  const { child } = managed;
  experimental_recordProviderChildIo(child, {
    threadId: options.recordThreadId,
  });

  const stderrChunks: string[] = [];
  let client: AcpClient | undefined;
  let exited = false;
  let stopping = false;
  let stopPromise: Promise<void> | undefined;

  function stopAgent(gracePeriodMs = 1_000): Promise<void> {
    stopPromise ??= managed.stop({ gracePeriodMs }).then((result) => {
      if (result.treeTermination === "unverified") {
        stderrChunks.push(
          "ACP agent exited, but descendant cleanup could not be confirmed",
        );
      }
    });
    return stopPromise;
  }

  function rejectAllPending(error: Error): void {
    client?.close(error);
  }

  function notRunningError(): AcpAgentExitedError {
    return new AcpAgentExitedError(
      `ACP agent "${options.command}" is not running`,
    );
  }

  function stdinIsWritable(): boolean {
    const stdin = child.stdin;
    return Boolean(stdin && !stdin.destroyed && stdin.writable);
  }

  function closeForAgentStdin(error: Error): void {
    if (exited) {
      return;
    }
    exited = true;
    const code =
      "code" in error && typeof error.code === "string"
        ? ` (${error.code})`
        : "";
    const detail = `stdin closed${code}: ${error.message}`;
    rejectAllPending(
      new AcpAgentExitedError(`ACP agent "${options.command}" ${detail}`),
    );
    const reportExit = (cleanupError: unknown): void => {
      const cleanupDetail =
        cleanupError === null
          ? []
          : [`Agent cleanup failed: ${String(cleanupError)}`];
      options.onExit({
        code: null,
        signal: null,
        stderrTail: [...stderrChunks, detail, ...cleanupDetail].join("\n"),
      });
    };
    void stopAgent(0).then(() => reportExit(null), reportExit);
  }

  child.stdin?.on("error", (error) => {
    if (!isClosedProcessStdinError(error)) {
      throw error;
    }
    if (stopping) {
      return;
    }
    closeForAgentStdin(error);
  });

  if (child.stdout && child.stdin) {
    const requests: Record<string, (params: unknown) => Promise<unknown>> = {};
    for (const method of options.requestMethods ??
      ACP_CORE_CLIENT_REQUEST_METHODS) {
      requests[method] = (params) =>
        new Promise((resolveResult, rejectResult) => {
          if (stopping) {
            return;
          }
          let settled = false;
          options.onRequest(method, params, {
            result(value) {
              if (settled) return;
              settled = true;
              resolveResult(value ?? null);
            },
            error(code, errorMessage) {
              if (settled) return;
              settled = true;
              rejectResult(new RequestError(code, errorMessage));
            },
          });
        });
    }
    client = connectAcpClient({
      input: child.stdout,
      output: child.stdin,
      requestTimeoutMs: null,
      closeOnInputEnd: false,
      handlers: {
        sessionUpdate: () => {},
        anyNotification: (method, params) => {
          if (stopping) {
            return;
          }
          options.onNotification(method, params);
        },
        requests,
      },
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
    const reportExit = (cleanupError: unknown): void => {
      const cleanupDetail =
        cleanupError === null
          ? []
          : [`Agent cleanup failed: ${String(cleanupError)}`];
      options.onExit({
        code,
        signal,
        stderrTail: [...stderrChunks, ...cleanupDetail].join("\n"),
      });
    };
    void stopAgent().then(() => reportExit(null), reportExit);
  });

  return {
    get exited() {
      return stopping || exited;
    },

    request({ method, params, resultSchema, timeoutMs }) {
      if (stopping || exited || !client) {
        return Promise.reject(notRunningError());
      }
      if (!stdinIsWritable()) {
        closeForAgentStdin(new Error("stdin is not writable"));
        return Promise.reject(notRunningError());
      }
      return client
        .extensionRequest(method, params, { timeoutMs: timeoutMs ?? null })
        .then(
          (value) => {
            options.onResponse?.(method, value);
            const parsed = resultSchema.safeParse(value);
            if (parsed.success) {
              return parsed.data;
            }
            throw new Error(
              `ACP agent returned an unexpected ${method} result: ${parsed.error.message}`,
            );
          },
          (error: unknown) => {
            if (error instanceof RequestError) {
              throw new AcpAgentResponseError(
                formatAgentError(error),
                error.code,
                error.data,
              );
            }
            throw error;
          },
        );
    },

    notify(method, params) {
      if (stopping || exited || !client) {
        return;
      }
      if (!stdinIsWritable()) {
        closeForAgentStdin(new Error("stdin is not writable"));
        return;
      }
      void client.notify(method, params).catch(() => {});
    },

    kill() {
      if (stopping || exited) return stopAgent();
      stopping = true;
      rejectAllPending(notRunningError());
      return stopAgent();
    },
  };
}

function acpClientCapabilities(
  parameterizedModelPicker: boolean,
  fsAccess: boolean,
  elicitation: boolean,
) {
  return {
    fs: { readTextFile: fsAccess, writeTextFile: fsAccess },
    terminal: false,
    auth: { terminal: true },
    ...(elicitation ? { elicitation: { form: {} } } : {}),
    ...(parameterizedModelPicker === true
      ? { _meta: { parameterizedModelPicker: true } }
      : {}),
  };
}

export const ACP_INITIALIZE_TIMEOUT_MS = 60_000;

export async function requestAcpInitialize(
  connection: AcpAgentConnection,
  {
    parameterizedModelPicker,
    fsAccess,
    elicitation = false,
  }: {
    parameterizedModelPicker: boolean;
    fsAccess: boolean;
    elicitation?: boolean;
  },
): Promise<AcpAgentCapabilities> {
  const result = await connection.request({
    method: "initialize",
    params: {
      protocolVersion: ACP_CLIENT_PROTOCOL_VERSION,
      clientInfo: { name: "bb", version: "1.0.0" },
      clientCapabilities: acpClientCapabilities(
        parameterizedModelPicker,
        fsAccess,
        elicitation,
      ),
    },
    resultSchema: z.unknown(),
    timeoutMs: ACP_INITIALIZE_TIMEOUT_MS,
  });
  return readAcpAgentCapabilities(result);
}
