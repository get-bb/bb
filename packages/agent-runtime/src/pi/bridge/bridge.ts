#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { extractEnvOverrides } from "../../shared/adapter-utils.js";
import {
  decodeBridgeJsonRpcResponse,
  jsonRpcEnvelopeSchema,
  type BridgeToolCallRequest,
} from "../../shared/bridge-tool-calls.js";
import {
  createBridgeIo,
  createBridgeLineHandler,
  runBridgeRequest,
  startBridgeStdio,
} from "../../shared/bridge-harness.js";
import {
  createBridgeSessionRegistry,
  type PendingBridgeToolCall,
} from "../../shared/bridge-session-registry.js";
import { mimeTypeFromExtension } from "../../shared/mime-types.js";
import type { ThreadEventContextWindowUsage } from "@bb/domain";
import {
  SessionManager,
  type AgentSessionEvent,
  type ContextUsage,
} from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";
import {
  PiSdkSession,
  type PiSdkSessionOptions,
  type ShellEnvOverrides,
} from "./sdk-session.js";
import {
  resolvePiBridgeSessionDir,
  resolvePiSessionFilePath,
} from "./session-paths.js";
import { buildDynamicTools, type DynamicToolDefinition } from "./tool-proxy.js";
import { listPiBridgeModels } from "./model-list.js";
import { getPiModelRuntime } from "./model-runtime.js";
import {
  takeOverPiBridgeStdout,
  writePiBridgeProtocol,
} from "./output-guard.js";

// ---------------------------------------------------------------------------
// Command schema — defines what JSON-RPC requests this bridge accepts
// ---------------------------------------------------------------------------

interface PiInstructionOverrideParams {
  baseInstructions?: string;
  appendSystemPrompt?: string;
}

interface BuildPiSessionOptionsParams extends PiInstructionOverrideParams {
  additionalSkillPaths?: readonly string[];
  cwd: string;
  model?: string;
  sessionPath?: string;
  thinkingLevel?: PiReasoningLevel;
}

interface BuildPiSessionOptionsArgs {
  params: BuildPiSessionOptionsParams;
  shellEnvOverrides: ShellEnvOverrides;
  threadId: string;
}

function hasAtMostOnePiInstructionOverride(
  params: PiInstructionOverrideParams,
): boolean {
  return (
    params.baseInstructions === undefined ||
    params.appendSystemPrompt === undefined
  );
}

const piInstructionOverrideSchemaOptions = {
  message: "Provide either baseInstructions or appendSystemPrompt, not both",
  path: ["appendSystemPrompt"],
};

const piReasoningLevelValues = [
  "off",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
const piReasoningLevelSchema = z.enum(piReasoningLevelValues);
export type PiReasoningLevel = z.infer<typeof piReasoningLevelSchema>;
const piAdditionalSkillPathsSchema = z.array(z.string()).optional();

const piThreadStartParamsSchema = z
  .object({
    threadId: z.string().optional(),
    cwd: z.string(),
    additionalSkillPaths: piAdditionalSkillPathsSchema,
    baseInstructions: z.string().optional(),
    appendSystemPrompt: z.string().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    model: z.string().optional(),
    reasoningLevel: piReasoningLevelSchema.optional(),
    input: z.array(z.unknown()).optional(),
    dynamicTools: z
      .array(
        z.object({
          name: z.string(),
          description: z.string(),
          inputSchema: z.unknown(),
        }),
      )
      .optional(),
  })
  .refine(
    hasAtMostOnePiInstructionOverride,
    piInstructionOverrideSchemaOptions,
  );

const piThreadResumeParamsSchema = z
  .object({
    threadId: z.string(),
    cwd: z.string(),
    sessionPath: z.string().optional(),
    additionalSkillPaths: piAdditionalSkillPathsSchema,
    baseInstructions: z.string().optional(),
    appendSystemPrompt: z.string().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    model: z.string().optional(),
    reasoningLevel: piReasoningLevelSchema.optional(),
    dynamicTools: z
      .array(
        z.object({
          name: z.string(),
          description: z.string(),
          inputSchema: z.unknown(),
        }),
      )
      .optional(),
  })
  .refine(
    hasAtMostOnePiInstructionOverride,
    piInstructionOverrideSchemaOptions,
  );

const piThreadForkParamsSchema = z
  .object({
    threadId: z.string(),
    sourceProviderThreadId: z.string(),
    cwd: z.string(),
    providerCheckpointId: z.string().min(1).optional(),
    additionalSkillPaths: piAdditionalSkillPathsSchema,
    baseInstructions: z.string().optional(),
    appendSystemPrompt: z.string().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    model: z.string().optional(),
    reasoningLevel: piReasoningLevelSchema.optional(),
    dynamicTools: z
      .array(
        z.object({
          name: z.string(),
          description: z.string(),
          inputSchema: z.unknown(),
        }),
      )
      .optional(),
  })
  .refine(
    hasAtMostOnePiInstructionOverride,
    piInstructionOverrideSchemaOptions,
  );

const piThreadIdParamsSchema = z.object({
  threadId: z.string(),
});

const piCommandSchema = z.discriminatedUnion("method", [
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
  z.object({
    method: z.literal("thread/start"),
    params: piThreadStartParamsSchema,
  }),
  z.object({
    method: z.literal("thread/resume"),
    params: piThreadResumeParamsSchema,
  }),
  z.object({
    method: z.literal("thread/fork"),
    params: piThreadForkParamsSchema,
  }),
  z.object({
    method: z.literal("turn/start"),
    params: z.object({
      threadId: z.string(),
      input: z.array(z.unknown()),
      model: z.string().optional(),
    }),
  }),
  z.object({
    method: z.literal("turn/steer"),
    params: z.object({
      threadId: z.string(),
      expectedTurnId: z.string(),
      input: z.array(z.unknown()),
    }),
  }),
  z.object({
    method: z.literal("thread/stop"),
    params: piThreadIdParamsSchema,
  }),
  z.object({
    method: z.literal("thread/compact"),
    params: piThreadIdParamsSchema,
  }),
  z.object({
    method: z.literal("thread/discard"),
    params: z.object({
      threadId: z.string(),
    }),
  }),
]);

export type PiCommand = z.infer<typeof piCommandSchema>;

function decodePiJsonRpcRequest(
  raw: unknown,
): (PiCommand & { jsonrpc: "2.0"; id: string | number }) | null {
  const envelope = jsonRpcEnvelopeSchema.safeParse(raw);
  if (!envelope.success) return null;

  const command = piCommandSchema.safeParse({
    method: envelope.data.method,
    params: envelope.data.params ?? {},
  });
  if (!command.success) return null;

  return { ...command.data, jsonrpc: "2.0", id: envelope.data.id };
}

interface SdkEventNotification {
  jsonrpc: "2.0";
  method: "sdk/message";
  params: { threadId: string; message: AgentSessionEvent };
}

interface BridgeEventNotification {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}

interface CurrentThreadSessionArgs {
  sessionSerial: number;
  threadId: string;
}

interface CreateSessionCallbackArgs {
  sessionSerial: number;
  threadId: string;
}

interface ThreadSession {
  session: PiSdkSession;
  sessionSerial: number;
  closing: boolean;
  pendingToolCalls: Map<string | number, PendingBridgeToolCall>;
}

interface StartPiThreadSessionArgs {
  id: string | number;
  params: PiSessionParams;
  threadId: string;
}

interface PiThreadStopResult {
  ok: true;
  providerCheckpointId: string | null;
}

interface PiCommandOkResult {
  ok: true;
}

let sessionSerialCounter = 0;

// Runtime waits on thread/stop until Pi aborts the active operation or this
// timeout forces disposal. Stop remains a best-effort success boundary.
const THREAD_STOP_CLOSE_TIMEOUT_MS = 4_000;

const { send, sendResult, sendError } = createBridgeIo<
  SdkEventNotification | BridgeEventNotification | BridgeToolCallRequest
>({ write: writePiBridgeProtocol });

const {
  closeThreadSession,
  closeThreadSessionsGracefully,
  createForwardToolCall,
  handleToolCallResponse,
  sessions,
} = createBridgeSessionRegistry<ThreadSession, string | undefined>({
  closeSessionGracefully: (threadSession) =>
    threadSession.session.closeGracefully(THREAD_STOP_CLOSE_TIMEOUT_MS),
  getProviderThreadId: (_threadSession, threadId) => threadId,
  sendToolCall: send,
});

function toContextWindowUsagePayload(
  contextUsage: ContextUsage | undefined,
): ThreadEventContextWindowUsage | null {
  if (!contextUsage) {
    return null;
  }

  return {
    usedTokens: contextUsage.tokens ?? null,
    modelContextWindow:
      contextUsage.contextWindow > 0 ? contextUsage.contextWindow : null,
    estimated: true,
  };
}

function emitContextWindowUsage(threadId: string): void {
  const threadSession = sessions.get(threadId);
  if (!threadSession) {
    return;
  }

  const contextWindowUsage = toContextWindowUsagePayload(
    threadSession.session.getContextUsage(),
  );
  if (!contextWindowUsage) {
    return;
  }

  send({
    jsonrpc: "2.0",
    method: "thread/contextWindowUsage/updated",
    params: {
      threadId,
      contextWindowUsage,
    },
  });
}

function nextSessionSerial(): number {
  sessionSerialCounter += 1;
  return sessionSerialCounter;
}

function getCurrentThreadSession(
  args: CurrentThreadSessionArgs,
): ThreadSession | undefined {
  const threadSession = sessions.get(args.threadId);
  // Runtime treats stop as a terminal boundary for pending acks and active turn
  // state, so callbacks from a closing session must not leak stale SDK events.
  if (
    !threadSession ||
    threadSession.closing ||
    threadSession.sessionSerial !== args.sessionSerial
  ) {
    return undefined;
  }
  return threadSession;
}

function removeThreadSessionIfCurrent(args: CurrentThreadSessionArgs): void {
  const threadSession = sessions.get(args.threadId);
  if (threadSession?.sessionSerial === args.sessionSerial) {
    sessions.delete(args.threadId);
  }
}

function createOnPiEvent(
  args: CreateSessionCallbackArgs,
): (event: AgentSessionEvent) => void {
  return (event: AgentSessionEvent) => {
    const threadSession = getCurrentThreadSession({
      sessionSerial: args.sessionSerial,
      threadId: args.threadId,
    });
    if (!threadSession) return;
    const providerCheckpointId =
      event.type === "agent_end"
        ? threadSession.session.getProviderCheckpointId()
        : undefined;
    send({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: args.threadId,
        message:
          providerCheckpointId === undefined
            ? event
            : { ...event, providerCheckpointId },
      },
    });
    if (event.type === "agent_end" || event.type === "compaction_end") {
      emitContextWindowUsage(args.threadId);
    }
  };
}

function createOnSessionDone(
  args: CreateSessionCallbackArgs,
): (error?: unknown) => void {
  return (error?: unknown) => {
    if (error) {
      reportSessionError({ ...args, error });
      return;
    }
    if (!getCurrentThreadSession(args)) {
      return;
    }
    void closeThreadSession({
      message:
        "Pi extension requested thread shutdown while tool call was pending",
      threadId: args.threadId,
    }).catch((shutdownError: unknown) => {
      const message =
        shutdownError instanceof Error
          ? shutdownError.message
          : String(shutdownError);
      send({
        jsonrpc: "2.0",
        method: "error",
        params: { threadId: args.threadId, message },
      });
    });
  };
}

function reportPromptSettled(args: {
  error?: unknown;
  sessionSerial: number;
  threadId: string;
}): void {
  if (!getCurrentThreadSession(args)) {
    return;
  }
  const errorMessage =
    args.error === undefined
      ? undefined
      : args.error instanceof Error
        ? args.error.message
        : String(args.error);
  send({
    jsonrpc: "2.0",
    method: "pi/prompt/settled",
    params: {
      threadId: args.threadId,
      status: errorMessage === undefined ? "completed" : "failed",
      ...(errorMessage !== undefined ? { error: errorMessage } : {}),
    },
  });
}

function reportSessionError(
  args: CreateSessionCallbackArgs & { error: unknown },
): void {
  const threadSession = getCurrentThreadSession({
    sessionSerial: args.sessionSerial,
    threadId: args.threadId,
  });
  if (!threadSession) return;

  const message =
    args.error instanceof Error ? args.error.message : String(args.error);

  send({
    jsonrpc: "2.0",
    method: "error",
    params: { threadId: args.threadId, message },
  });
}

function normalizeShellEnvOverrides(
  shellEnvOverrides: ShellEnvOverrides,
): ShellEnvOverrides | undefined {
  return Object.keys(shellEnvOverrides).length > 0
    ? shellEnvOverrides
    : undefined;
}

function buildSessionOptions(
  args: BuildPiSessionOptionsArgs,
): PiSdkSessionOptions {
  const shellEnvOverrides = normalizeShellEnvOverrides(args.shellEnvOverrides);
  const sessionFilePath = resolvePiSessionFilePath({
    env: process.env,
    sessionPath: args.params.sessionPath,
    threadId: args.threadId,
  });

  return {
    cwd: args.params.cwd,
    model: args.params.model,
    sessionFilePath,
    systemPrompt: args.params.baseInstructions,
    appendSystemPrompt: args.params.appendSystemPrompt,
    ...(args.params.additionalSkillPaths
      ? { additionalSkillPaths: args.params.additionalSkillPaths }
      : {}),
    ...(shellEnvOverrides ? { shellEnvOverrides } : {}),
    ...(args.params.thinkingLevel
      ? { thinkingLevel: args.params.thinkingLevel }
      : {}),
  };
}

function applyDynamicTools(
  sessionOptions: PiSdkSessionOptions,
  dynamicTools: DynamicToolDefinition[] | undefined,
  threadId: string,
): void {
  if (dynamicTools && dynamicTools.length > 0) {
    sessionOptions.customTools = buildDynamicTools(
      dynamicTools,
      createForwardToolCall(() => threadId),
    );
  }
}

async function handleRequest(
  request: PiCommand & { id: string | number },
): Promise<void> {
  switch (request.method) {
    case "initialize":
      sendResult(request.id, { ok: true });
      break;
    case "model/list":
      await handleModelList(request.id, request.params);
      break;
    case "thread/start":
      await handleThreadStart(request.id, request.params);
      break;
    case "thread/resume":
      await handleThreadResume(request.id, request.params);
      break;
    case "thread/fork":
      await handleThreadFork(request.id, request.params);
      break;
    case "turn/start":
      await handleTurnStart(request.id, request.params);
      break;
    case "turn/steer":
      await handleTurnSteer(request.id, request.params);
      break;
    case "thread/stop":
      sendResult(request.id, await handleThreadStop(request.params));
      break;
    case "thread/compact":
      handleThreadCompact(request.id, request.params);
      break;
    case "thread/discard":
      sendResult(request.id, await handleThreadDiscard(request.params));
      break;
  }
}

type ThreadStartParams = Extract<
  PiCommand,
  { method: "thread/start" }
>["params"];
type ThreadResumeParams = Extract<
  PiCommand,
  { method: "thread/resume" }
>["params"];
type ThreadForkParams = Extract<PiCommand, { method: "thread/fork" }>["params"];
type TurnStartParams = Extract<PiCommand, { method: "turn/start" }>["params"];
type TurnSteerParams = Extract<PiCommand, { method: "turn/steer" }>["params"];
type ThreadIdParams = Extract<PiCommand, { method: "thread/stop" }>["params"];
type ThreadDiscardParams = Extract<
  PiCommand,
  { method: "thread/discard" }
>["params"];
type PiSessionParams =
  | ThreadStartParams
  | ThreadResumeParams
  | ThreadForkParams;

function buildPiSessionParams(
  params: PiSessionParams,
): BuildPiSessionOptionsParams {
  return {
    ...(params.additionalSkillPaths && params.additionalSkillPaths.length > 0
      ? { additionalSkillPaths: [...params.additionalSkillPaths] }
      : {}),
    cwd: params.cwd,
    ...(params.model ? { model: params.model } : {}),
    ...("sessionPath" in params && params.sessionPath
      ? { sessionPath: params.sessionPath }
      : {}),
    ...(params.baseInstructions
      ? { baseInstructions: params.baseInstructions }
      : {}),
    ...(params.appendSystemPrompt
      ? { appendSystemPrompt: params.appendSystemPrompt }
      : {}),
    ...(params.reasoningLevel ? { thinkingLevel: params.reasoningLevel } : {}),
  };
}

async function handleModelList(
  id: string | number,
  params: { cwd?: string },
): Promise<void> {
  try {
    sendResult(
      id,
      await listPiBridgeModels(await getPiModelRuntime(params.cwd)),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendError(id, -32000, message);
  }
}

async function startPiThreadSession({
  id,
  params,
  threadId,
}: StartPiThreadSessionArgs): Promise<void> {
  // Stop existing session for this thread if any
  const existing = sessions.get(threadId);
  if (existing) {
    await closeThreadSession({
      message: "Pi thread session replaced while tool call was pending",
      threadId,
    });
  }

  const shellEnvOverrides = extractEnvOverrides(params.config);
  const sessionOptions = buildSessionOptions({
    params: buildPiSessionParams(params),
    shellEnvOverrides,
    threadId,
  });
  applyDynamicTools(sessionOptions, params.dynamicTools, threadId);

  const sessionSerial = nextSessionSerial();
  const session = new PiSdkSession(
    sessionOptions,
    createOnPiEvent({ sessionSerial, threadId }),
    createOnSessionDone({ sessionSerial, threadId }),
  );

  const threadSession: ThreadSession = {
    session,
    sessionSerial,
    closing: false,
    pendingToolCalls: new Map(),
  };
  sessions.set(threadId, threadSession);

  try {
    await session.start();
  } catch (error) {
    removeThreadSessionIfCurrent({ sessionSerial, threadId });
    throw error;
  }

  // Pi has no separately minted session id: its provider identity is the BB
  // thread id. Return that identity synchronously so callers do not have to
  // race the thread/identity notification emitted after start/fork.
  sendResult(id, { threadId, providerThreadId: threadId });
}

async function handleThreadStart(
  id: string | number,
  params: ThreadStartParams,
): Promise<void> {
  const threadId = params.threadId ?? `pi-${Date.now()}`;
  await startPiThreadSession({ id, params, threadId });
  send({
    jsonrpc: "2.0",
    method: "thread/identity",
    params: { threadId, providerThreadId: threadId },
  });
}

async function handleThreadResume(
  id: string | number,
  params: ThreadResumeParams,
): Promise<void> {
  await startPiThreadSession({ id, params, threadId: params.threadId });
}

// Pi keeps no provider-minted session id: provider identity == bb threadId, and
// the session file is the deterministic path for that threadId. Forking therefore
// means materializing the source thread's full history at the NEW thread's
// deterministic path, then launching like thread/start (which SessionManager.open's
// that path). A dedicated handler — rather than a sessionPath hint on thread/start —
// keeps "open my own file fresh" (start) distinct from "copy another file's history
// into my file" (fork). SessionManager.forkFrom picks its own filename inside the
// bridge session dir, so we rename the forked file onto the new thread's path before
// startPiThreadSession opens it. The forked header's parentSession still points at
// the source file, preserving lineage.
async function handleThreadFork(
  id: string | number,
  params: ThreadForkParams,
): Promise<void> {
  const sourceSessionFile = resolvePiSessionFilePath({
    env: process.env,
    threadId: params.sourceProviderThreadId,
  });
  if (!existsSync(sourceSessionFile)) {
    sendError(
      id,
      -32000,
      `Cannot fork: source pi session file not found for thread "${params.sourceProviderThreadId}"`,
    );
    return;
  }

  const targetSessionFile = resolvePiSessionFilePath({
    env: process.env,
    threadId: params.threadId,
  });

  const bridgeSessionDir = resolvePiBridgeSessionDir({ env: process.env });
  const forkedFile =
    params.providerCheckpointId === undefined
      ? SessionManager.forkFrom(
          sourceSessionFile,
          params.cwd,
          bridgeSessionDir,
        ).getSessionFile()
      : SessionManager.open(
          sourceSessionFile,
          bridgeSessionDir,
          params.cwd,
        ).createBranchedSession(params.providerCheckpointId);
  if (!forkedFile) {
    sendError(id, -32000, "Cannot fork: forked pi session was not persisted");
    return;
  }
  try {
    const targetDir = dirname(targetSessionFile);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }
    if (forkedFile !== targetSessionFile) {
      renameSync(forkedFile, targetSessionFile);
    }
  } catch (error) {
    // forkFrom already wrote the forked session to its own filename; if moving
    // it onto the target path fails, that file would be orphaned in the bridge
    // session dir. Best-effort remove it before surfacing the error.
    rmSync(forkedFile, { force: true });
    const message = error instanceof Error ? error.message : String(error);
    sendError(id, -32000, message);
    return;
  }

  await startPiThreadSession({ id, params, threadId: params.threadId });
  send({
    jsonrpc: "2.0",
    method: "thread/identity",
    params: { threadId: params.threadId, providerThreadId: params.threadId },
  });
}

async function handleTurnStart(
  id: string | number,
  params: TurnStartParams,
): Promise<void> {
  const threadSession = sessions.get(params.threadId);
  if (!threadSession || threadSession.closing) {
    sendError(id, -32000, "No active pi session");
    return;
  }

  const { text, images } = extractInput(params.input);
  if (!text) {
    sendError(id, -32602, "Missing input text");
    return;
  }

  void threadSession.session
    .prompt(text, images.length > 0 ? images : undefined)
    .then(
      () =>
        reportPromptSettled({
          sessionSerial: threadSession.sessionSerial,
          threadId: params.threadId,
        }),
      (error: unknown) =>
        reportPromptSettled({
          error,
          sessionSerial: threadSession.sessionSerial,
          threadId: params.threadId,
        }),
    );
  sendResult(id, { threadId: params.threadId });
}

async function handleTurnSteer(
  id: string | number,
  params: TurnSteerParams,
): Promise<void> {
  const threadSession = sessions.get(params.threadId);
  if (!threadSession || threadSession.closing) {
    sendError(id, -32000, "No active pi session");
    return;
  }

  const { text, images } = extractInput(params.input);
  if (!text) {
    sendError(id, -32602, "Missing input text");
    return;
  }

  if (threadSession.session.getIsCompacting()) {
    sendError(id, -32000, "Cannot steer while context compaction is active");
    return;
  }

  try {
    await threadSession.session.steer(
      text,
      images.length > 0 ? images : undefined,
    );
    sendResult(id, { threadId: params.threadId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendError(id, -32000, message);
  }
}

async function handleThreadStop(
  params: ThreadIdParams,
): Promise<PiThreadStopResult> {
  const providerCheckpointId =
    (await closeThreadSession({
      message: "Pi thread stopped while tool call was pending",
      threadId: params.threadId,
    })) ?? null;
  return { ok: true, providerCheckpointId };
}

function handleThreadCompact(
  id: string | number,
  params: ThreadIdParams,
): void {
  const threadSession = sessions.get(params.threadId);
  if (!threadSession || threadSession.closing) {
    sendError(id, -32000, "No active pi session");
    return;
  }
  if (threadSession.session.getIsProcessing()) {
    sendError(id, -32000, "Cannot compact context while a turn is active");
    return;
  }
  // Pi reports the terminal outcome through compaction_end. The command result
  // only acknowledges that the validated maintenance operation was started.
  void threadSession.session.compact().catch((error: unknown) => {
    reportSessionError({
      error,
      sessionSerial: threadSession.sessionSerial,
      threadId: params.threadId,
    });
  });
  sendResult(id, { threadId: params.threadId });
}

async function handleThreadDiscard(
  params: ThreadDiscardParams,
): Promise<PiCommandOkResult> {
  await closeThreadSession({
    message: "Pi staged thread discarded while tool call was pending",
    threadId: params.threadId,
  });
  rmSync(
    resolvePiSessionFilePath({ env: process.env, threadId: params.threadId }),
    { force: true },
  );
  return { ok: true };
}

interface ExtractedInput {
  text?: string;
  images: ImageContent[];
}

function extractInput(input: unknown): ExtractedInput {
  if (typeof input === "string") return { text: input, images: [] };
  if (!Array.isArray(input)) return { images: [] };

  const chunks: string[] = [];
  const images: ImageContent[] = [];

  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const typed = item as {
      type?: string;
      text?: string;
      path?: string;
      url?: string;
      mimeType?: string;
    };

    if (typed.type === "text" && typeof typed.text === "string") {
      chunks.push(typed.text);
    } else if (typed.type === "localImage" && typeof typed.path === "string") {
      try {
        const data = readFileSync(typed.path).toString("base64");
        const mimeType = typed.mimeType ?? mimeTypeFromExtension(typed.path);
        images.push({ type: "image", data, mimeType });
      } catch {
        // Skip unreadable images silently
      }
    }
  }

  return {
    text: chunks.length > 0 ? chunks.join("\n") : undefined,
    images,
  };
}

function handleParsedMessage(parsed: unknown): void {
  const response = decodeBridgeJsonRpcResponse(parsed);
  if (response && handleToolCallResponse(response)) {
    return;
  }

  const request = decodePiJsonRpcRequest(parsed);
  if (!request) return;
  runBridgeRequest({ request, handleRequest, sendError });
}

export const handleLine = createBridgeLineHandler({ handleParsedMessage });

startBridgeStdio({
  importMetaUrl: import.meta.url,
  handleLine,
  beforeStart: takeOverPiBridgeStdout,
  onClose: () => {
    // Stdin close is a process shutdown boundary; wait briefly for per-thread
    // abort/dispose so SDK work does not continue while the bridge exits.
    void closeThreadSessionsGracefully(
      "Pi bridge shutting down while tool call was pending",
    ).finally(() => {
      process.exit(0);
    });
  },
});
