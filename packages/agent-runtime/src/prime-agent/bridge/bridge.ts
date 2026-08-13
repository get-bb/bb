#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  sanitizeInheritedChildProcessEnv,
  spawnPortablePipedProcess,
  type PortablePipedChildProcess,
} from "@bb/process-utils";
import { z } from "zod";
import { extractEnvOverrides } from "../../shared/adapter-utils.js";
import {
  createBridgeIo,
  createBridgeLineHandler,
  runBridgeRequest,
  startBridgeStdio,
} from "../../shared/bridge-harness.js";
import { withoutBridgeRuntimeEnv } from "../../shared/bridge-runtime-env.js";
import { mimeTypeFromExtension } from "../../shared/mime-types.js";
import { buildPrimeAgentAvailableModels } from "../model-list.js";

const reasoningLevelSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);

const sessionParamsSchema = z
  .object({
    threadId: z.string().min(1),
    sourceThreadId: z.string().min(1).optional(),
    cwd: z.string().min(1),
    additionalSkillPaths: z.array(z.string()).optional(),
    baseInstructions: z.string().optional(),
    appendSystemPrompt: z.string().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    model: z.string().optional(),
    reasoningLevel: reasoningLevelSchema.optional(),
    dynamicTools: z.array(z.unknown()).optional(),
  })
  .refine(
    (params) =>
      params.baseInstructions === undefined ||
      params.appendSystemPrompt === undefined,
    {
      message:
        "Provide either baseInstructions or appendSystemPrompt, not both",
      path: ["appendSystemPrompt"],
    },
  );

const primeAgentCommandSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("initialize"),
    params: z.object({
      clientInfo: z.object({ name: z.string(), version: z.string() }),
    }),
  }),
  z.object({
    method: z.literal("model/list"),
    params: z.object({ cwd: z.string().optional() }),
  }),
  z.object({ method: z.literal("thread/start"), params: sessionParamsSchema }),
  z.object({ method: z.literal("thread/resume"), params: sessionParamsSchema }),
  z.object({
    method: z.literal("turn/start"),
    params: z.object({
      threadId: z.string().min(1),
      input: z.array(z.unknown()),
      model: z.string().optional(),
    }),
  }),
  z.object({
    method: z.literal("turn/steer"),
    params: z.object({
      threadId: z.string().min(1),
      expectedTurnId: z.string(),
      input: z.array(z.unknown()),
    }),
  }),
  z.object({
    method: z.literal("thread/stop"),
    params: z.object({ threadId: z.string().min(1) }),
  }),
  z.object({
    method: z.literal("thread/compact"),
    params: z.object({ threadId: z.string().min(1) }),
  }),
  z.object({
    method: z.literal("thread/discard"),
    params: z.object({ threadId: z.string().min(1) }),
  }),
  z.object({
    method: z.literal("thread/name/set"),
    params: z.object({
      threadId: z.string().min(1),
      title: z.string(),
    }),
  }),
]);

type PrimeAgentCommand = z.infer<typeof primeAgentCommandSchema>;
type PrimeAgentSessionParams = z.infer<typeof sessionParamsSchema>;

const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.unknown().optional(),
});

const primeRpcResponseSchema = z
  .object({
    id: z.string().optional(),
    type: z.literal("response"),
    command: z.string(),
    success: z.boolean(),
    data: z.unknown().optional(),
    error: z.string().optional(),
  })
  .passthrough();

const primeStateSchema = z
  .object({
    sessionFile: z.string().min(1),
  })
  .passthrough();

const extensionUiRequestSchema = z
  .object({
    type: z.literal("extension_ui_request"),
    id: z.string(),
    method: z.string(),
  })
  .passthrough();

interface PrimeRpcPendingRequest {
  reject: (error: Error) => void;
  resolve: (data: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PrimeThreadSession {
  client: PrimeRpcClient;
  providerThreadId: string;
  sourceThreadId: string;
}

interface ExtractedInput {
  images: Array<{ type: "image"; data: string; mimeType: string }>;
  text?: string;
}

const { send, sendError, sendResult } = createBridgeIo();
const sessions = new Map<string, PrimeThreadSession>();
let requestSequence = 0;

function nextPrimeRequestId(): string {
  requestSequence += 1;
  return `bb-prime-${requestSequence}`;
}

function decodePrimeAgentRequest(
  raw: unknown,
): (PrimeAgentCommand & { id: string | number }) | null {
  const envelope = jsonRpcRequestSchema.safeParse(raw);
  if (!envelope.success) return null;
  const command = primeAgentCommandSchema.safeParse({
    method: envelope.data.method,
    params: envelope.data.params ?? {},
  });
  if (!command.success) return null;
  return { ...command.data, id: envelope.data.id };
}

function isDialogExtensionMethod(method: string): boolean {
  return ["select", "confirm", "input", "editor"].includes(method);
}

function appendStderrTail(current: string, chunk: Buffer): string {
  const next = current + chunk.toString("utf8");
  return next.length <= 8_192 ? next : next.slice(next.length - 8_192);
}

class PrimeRpcClient {
  private buffer = "";
  private closed = false;
  private exited = false;
  private exitResolve: (() => void) | undefined;
  private readonly exitPromise = new Promise<void>((resolve) => {
    this.exitResolve = resolve;
  });
  private readonly pending = new Map<string, PrimeRpcPendingRequest>();
  private stderrTail = "";

  constructor(
    private readonly child: PortablePipedChildProcess,
    private readonly onEvent: (event: unknown) => void,
  ) {
    child.stdout.on("data", (chunk: Buffer) => this.handleStdoutChunk(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderrTail = appendStderrTail(this.stderrTail, chunk);
      process.stderr.write(`prime-agent: ${chunk.toString("utf8")}`);
    });
    child.once("error", (error) => this.finishExit(error));
    child.once("exit", (code, signal) => {
      const detail = this.stderrTail.trim();
      this.finishExit(
        this.closed
          ? undefined
          : new Error(
              `Prime Agent RPC exited unexpectedly (${signal ?? code ?? "unknown"})${detail ? `: ${detail}` : ""}`,
            ),
      );
    });
  }

  request(
    command: Record<string, unknown>,
    timeoutMs = 30_000,
  ): Promise<unknown> {
    if (this.closed || this.exited) {
      return Promise.reject(new Error("Prime Agent RPC session is closed."));
    }
    const id = nextPrimeRequestId();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `Prime Agent RPC command ${String(command.type)} timed out after ${timeoutMs}ms.`,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, { reject, resolve, timeout });
      this.write({ ...command, id }, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(pending.timeout);
        pending.reject(error);
      });
    });
  }

  async close(abort = true): Promise<void> {
    if (this.closed) {
      await this.exitPromise;
      return;
    }
    if (abort && !this.exited) {
      await this.request({ type: "abort" }, 5_000).catch(() => undefined);
    }
    this.closed = true;
    this.child.stdin.end();
    const exited = await Promise.race([
      this.exitPromise.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
    ]);
    if (!exited && !this.exited) {
      this.child.kill("SIGTERM");
      await Promise.race([
        this.exitPromise,
        new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
      ]);
    }
  }

  private write(
    message: Record<string, unknown>,
    callback?: (error?: Error | null) => void,
  ): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`, callback);
  }

  private handleStdoutChunk(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).replace(/\r$/u, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (line.trim().length === 0) continue;
      try {
        this.handleMessage(JSON.parse(line));
      } catch (error) {
        process.stderr.write(
          `prime-agent bridge: invalid RPC output: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    }
  }

  private handleMessage(raw: unknown): void {
    const response = primeRpcResponseSchema.safeParse(raw);
    if (response.success && response.data.id) {
      const pending = this.pending.get(response.data.id);
      if (!pending) return;
      this.pending.delete(response.data.id);
      clearTimeout(pending.timeout);
      if (response.data.success) {
        pending.resolve(response.data.data);
      } else {
        pending.reject(
          new Error(response.data.error ?? "Prime Agent RPC command failed."),
        );
      }
      return;
    }

    const extensionRequest = extensionUiRequestSchema.safeParse(raw);
    if (extensionRequest.success) {
      if (isDialogExtensionMethod(extensionRequest.data.method)) {
        this.write({
          type: "extension_ui_response",
          id: extensionRequest.data.id,
          cancelled: true,
        });
      }
      return;
    }

    this.onEvent(raw);
  }

  private finishExit(error?: Error): void {
    if (this.exited) return;
    this.exited = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error ?? new Error("Prime Agent RPC session closed."));
    }
    this.pending.clear();
    this.exitResolve?.();
  }
}

function resolvePrimeDaemonSocket(): string {
  const identity = process.env.BB_DATA_DIR?.trim() || process.cwd();
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, 16);
  const directory = path.join(tmpdir(), `bb-prime-agent-${hash}`);
  mkdirSync(directory, { recursive: true });
  return path.join(directory, "daemon.sock");
}

function resolvePrimeSessionDir(
  env: Record<string, string>,
  threadId: string,
): string {
  const threadStoragePath = env.BB_THREAD_STORAGE_PATH?.trim();
  if (threadStoragePath) {
    return path.join(threadStoragePath, "prime-agent-sessions");
  }
  const hash = createHash("sha256").update(threadId).digest("hex").slice(0, 20);
  const base = process.env.BB_DATA_DIR?.trim() || tmpdir();
  return path.join(base, "runtime", "prime-agent-sessions", hash);
}

function splitCanonicalModel(model: string): {
  modelId: string;
  provider: string;
} {
  const separator = model.indexOf("/");
  if (separator <= 0 || separator === model.length - 1) {
    throw new Error(
      `Prime Agent model "${model}" must use <provider>/<model> format.`,
    );
  }
  return {
    provider: model.slice(0, separator),
    modelId: model.slice(separator + 1),
  };
}

function buildPrimeAgentArgs(args: {
  params: PrimeAgentSessionParams;
  resume?: string;
}): string[] {
  const env = extractEnvOverrides(args.params.config);
  const sessionDir = resolvePrimeSessionDir(env, args.params.threadId);
  mkdirSync(sessionDir, { recursive: true });
  const cliArgs = [
    "--mode",
    "rpc",
    "--offline",
    "--no-context-files",
    "--cwd",
    args.params.cwd,
    "--session-dir",
    sessionDir,
    "--daemon-socket",
    resolvePrimeDaemonSocket(),
  ];
  if (args.resume) cliArgs.push("--resume", args.resume);
  if (args.params.model) {
    const model = splitCanonicalModel(args.params.model);
    cliArgs.push("--provider", model.provider, "--model", model.modelId);
  }
  if (args.params.reasoningLevel) {
    cliArgs.push("--thinking", args.params.reasoningLevel);
  }
  if (args.params.baseInstructions) {
    cliArgs.push("--system-prompt", args.params.baseInstructions);
  }
  if (args.params.appendSystemPrompt) {
    cliArgs.push("--append-system-prompt", args.params.appendSystemPrompt);
  }
  for (const skillPath of args.params.additionalSkillPaths ?? []) {
    cliArgs.push("--skill", skillPath);
  }
  return cliArgs;
}

function createPrimeRpcClient(args: {
  cliArgs: string[];
  cwd: string;
  env: Record<string, string>;
  onEvent: (event: unknown) => void;
}): PrimeRpcClient {
  const inherited = sanitizeInheritedChildProcessEnv({ env: process.env });
  const child = spawnPortablePipedProcess({
    command: "prime-agent",
    args: args.cliArgs,
    cwd: args.cwd,
    env: {
      ...withoutBridgeRuntimeEnv(inherited),
      ...args.env,
    },
  });
  return new PrimeRpcClient(child, args.onEvent);
}

function extractInput(input: readonly unknown[]): ExtractedInput {
  const chunks: string[] = [];
  const images: ExtractedInput["images"] = [];
  for (const item of input) {
    const parsed = z
      .object({
        type: z.string(),
        text: z.string().optional(),
        path: z.string().optional(),
        mimeType: z.string().optional(),
      })
      .passthrough()
      .safeParse(item);
    if (!parsed.success) continue;
    if (parsed.data.type === "text" && parsed.data.text !== undefined) {
      chunks.push(parsed.data.text);
      continue;
    }
    if (parsed.data.type === "localImage" && parsed.data.path !== undefined) {
      const data = readFileSync(parsed.data.path).toString("base64");
      images.push({
        type: "image",
        data,
        mimeType:
          parsed.data.mimeType ?? mimeTypeFromExtension(parsed.data.path),
      });
    }
  }
  return {
    images,
    ...(chunks.length > 0 ? { text: chunks.join("\n") } : {}),
  };
}

function sendSessionEvent(session: PrimeThreadSession, event: unknown): void {
  send({
    jsonrpc: "2.0",
    method: "sdk/message",
    params: { threadId: session.sourceThreadId, message: event },
  });
}

async function closeSession(session: PrimeThreadSession): Promise<void> {
  sessions.delete(session.providerThreadId);
  await session.client.close();
}

async function findAndCloseSourceThread(threadId: string): Promise<void> {
  const session =
    sessions.get(threadId) ??
    Array.from(sessions.values()).find(
      (candidate) => candidate.sourceThreadId === threadId,
    );
  if (session) await closeSession(session);
}

async function startThreadSession(args: {
  params: PrimeAgentSessionParams;
  resume?: string;
}): Promise<PrimeThreadSession> {
  if (args.params.dynamicTools && args.params.dynamicTools.length > 0) {
    throw new Error(
      "Prime Agent native RPC does not support BB dynamic tools.",
    );
  }
  const sourceThreadId = args.params.sourceThreadId ?? args.params.threadId;
  await findAndCloseSourceThread(sourceThreadId);
  const env = extractEnvOverrides(args.params.config);
  let session: PrimeThreadSession | undefined;
  const client = createPrimeRpcClient({
    cliArgs: buildPrimeAgentArgs(args),
    cwd: args.params.cwd,
    env,
    onEvent: (event) => {
      if (session) sendSessionEvent(session, event);
    },
  });
  try {
    const state = primeStateSchema.parse(
      await client.request({ type: "get_state" }, 60_000),
    );
    session = {
      client,
      providerThreadId: state.sessionFile,
      sourceThreadId,
    };
    sessions.set(session.providerThreadId, session);
    return session;
  } catch (error) {
    await client.close(false);
    throw error;
  }
}

async function handleModelList(
  id: string | number,
  cwd: string | undefined,
): Promise<void> {
  const client = createPrimeRpcClient({
    cliArgs: [
      "--mode",
      "rpc",
      "--offline",
      "--no-context-files",
      "--no-session",
      "--daemon-socket",
      resolvePrimeDaemonSocket(),
      ...(cwd ? ["--cwd", cwd] : []),
    ],
    cwd: cwd ?? process.cwd(),
    env: {},
    onEvent: () => undefined,
  });
  try {
    const result = await client.request(
      { type: "get_available_models" },
      60_000,
    );
    sendResult(id, buildPrimeAgentAvailableModels(result));
  } finally {
    await client.close(false);
  }
}

function requireSession(threadId: string): PrimeThreadSession {
  const session = sessions.get(threadId);
  if (!session) {
    throw new Error(`No active Prime Agent session for "${threadId}".`);
  }
  return session;
}

async function applyTurnModel(
  session: PrimeThreadSession,
  model: string | undefined,
): Promise<void> {
  if (!model) return;
  const selected = splitCanonicalModel(model);
  await session.client.request({
    type: "set_model",
    provider: selected.provider,
    modelId: selected.modelId,
  });
}

async function handleRequest(
  request: PrimeAgentCommand & { id: string | number },
): Promise<void> {
  switch (request.method) {
    case "initialize":
      sendResult(request.id, { ok: true });
      return;
    case "model/list":
      await handleModelList(request.id, request.params.cwd);
      return;
    case "thread/start": {
      const session = await startThreadSession({ params: request.params });
      sendResult(request.id, {
        threadId: request.params.threadId,
        providerThreadId: session.providerThreadId,
      });
      send({
        jsonrpc: "2.0",
        method: "thread/identity",
        params: {
          threadId: request.params.threadId,
          providerThreadId: session.providerThreadId,
        },
      });
      return;
    }
    case "thread/resume": {
      const session = await startThreadSession({
        params: request.params,
        resume: request.params.threadId,
      });
      sendResult(request.id, {
        threadId: session.sourceThreadId,
        providerThreadId: session.providerThreadId,
      });
      return;
    }
    case "turn/start": {
      const session = requireSession(request.params.threadId);
      const input = extractInput(request.params.input);
      if (!input.text) throw new Error("Prime Agent requires prompt text.");
      await applyTurnModel(session, request.params.model);
      await session.client.request({
        type: "prompt",
        message: input.text,
        ...(input.images.length > 0 ? { images: input.images } : {}),
      });
      sendResult(request.id, { threadId: request.params.threadId });
      return;
    }
    case "turn/steer": {
      const session = requireSession(request.params.threadId);
      const input = extractInput(request.params.input);
      if (!input.text) throw new Error("Prime Agent requires steering text.");
      await session.client.request({
        type: "steer",
        message: input.text,
        ...(input.images.length > 0 ? { images: input.images } : {}),
      });
      sendResult(request.id, { threadId: request.params.threadId });
      return;
    }
    case "thread/stop": {
      const session = sessions.get(request.params.threadId);
      if (session) await closeSession(session);
      sendResult(request.id, { ok: true, providerCheckpointId: null });
      return;
    }
    case "thread/compact": {
      const session = requireSession(request.params.threadId);
      void session.client
        .request({ type: "compact" }, 120_000)
        .catch((error) => {
          send({
            jsonrpc: "2.0",
            method: "error",
            params: {
              threadId: session.sourceThreadId,
              message: error instanceof Error ? error.message : String(error),
            },
          });
        });
      sendResult(request.id, { threadId: request.params.threadId });
      return;
    }
    case "thread/discard": {
      const session = sessions.get(request.params.threadId);
      if (session) await closeSession(session);
      sendResult(request.id, { ok: true });
      return;
    }
    case "thread/name/set": {
      const session = requireSession(request.params.threadId);
      await session.client.request({
        type: "set_session_name",
        name: request.params.title,
      });
      sendResult(request.id, { ok: true });
      return;
    }
  }
}

function handleParsedMessage(parsed: unknown): void {
  const request = decodePrimeAgentRequest(parsed);
  if (!request) return;
  runBridgeRequest({ request, handleRequest, sendError });
}

export const handleLine = createBridgeLineHandler({ handleParsedMessage });

async function closeAllSessions(): Promise<void> {
  await Promise.all(
    Array.from(sessions.values()).map((session) => closeSession(session)),
  );
}

function shutdown(): void {
  void closeAllSessions().finally(() => process.exit(0));
}

startBridgeStdio({
  importMetaUrl: import.meta.url,
  handleLine,
  onClose: shutdown,
  onSigint: shutdown,
  onSigterm: shutdown,
});
