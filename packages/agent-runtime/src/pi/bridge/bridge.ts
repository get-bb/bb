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
import type { ThreadEventContextWindowUsage } from "@bb/domain";
import { isStandaloneBuiltinCompactCommand } from "@bb/domain";
import {
  BRIDGE_JSON_RPC_ERRORS,
  BRIDGE_NOTIFICATION_METHODS,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
  THREAD_DELTA_NOTIFICATION_METHOD,
  modelListParamsSchema,
  threadDiscardParamsSchema,
  threadForkParamsSchema,
  threadResumeParamsSchema,
  threadStartParamsSchema,
  threadStopParamsSchema,
  turnStartParamsSchema,
  turnSteerParamsSchema,
  skillsConfigureParamsSchema,
  type InitializeResult,
  type ThreadDelta,
} from "@bb/provider-bridge-protocol";
import {
  bridgeRequestEnvelopeSchema,
  createBridgeIo,
  createBridgeLineHandler,
  createPendingToolCallTracker,
  decodeBridgeJsonRpcResponse,
  mimeTypeFromExtension,
  runBridgeRequest,
  experimental_defineProviderBridge,
} from "@bb/provider-bridge-protocol/bridge-kit";
import type { BridgeToolCallRequest } from "@bb/provider-bridge-protocol/bridge-kit";
import {
  SessionManager,
  type AgentSessionEvent,
  type ContextUsage,
} from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";
import { createPiDeltaTranslator } from "../delta-translation.js";
import {
  buildPiSessionParams,
  type PiSessionParams,
} from "../session-params.js";
import { PiSdkSession, type PiSdkSessionOptions } from "./sdk-session.js";
import {
  resolvePiBridgeSessionDir,
  resolvePiSessionFilePath,
} from "./session-paths.js";
import {
  buildDynamicTools,
  type DynamicToolDefinition,
  type ToolCallForwarder,
} from "./tool-proxy.js";
import { listPiBridgeModels } from "./model-list.js";
import { getPiModelRuntime } from "./model-runtime.js";
import {
  takeOverPiBridgeStdout,
  writePiBridgeProtocol,
} from "./output-guard.js";

// ---------------------------------------------------------------------------
// Command schema — defines what JSON-RPC requests this bridge accepts
// ---------------------------------------------------------------------------

interface BuildPiSessionOptionsArgs {
  params: PiSessionParams;
  providerThreadId: string;
}

/**
 * The canonical Provider Bridge Protocol params, per method. A new Pi session
 * uses its bb thread id as provider identity; a resumed session can have a new
 * bb thread id while retaining the provider id that names its persisted file.
 */
const piCommandSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("initialize"),
    params: z
      .object({
        protocolVersion: z.number().int().positive(),
        client: z.object({ name: z.string(), version: z.string() }),
      })
      .passthrough(),
  }),
  z.object({
    method: z.literal("model/list"),
    params: modelListParamsSchema,
  }),
  z.object({
    method: z.literal("thread/start"),
    params: threadStartParamsSchema,
  }),
  z.object({
    method: z.literal("thread/resume"),
    params: threadResumeParamsSchema,
  }),
  z.object({
    method: z.literal("thread/fork"),
    params: threadForkParamsSchema,
  }),
  z.object({
    method: z.literal("turn/start"),
    params: turnStartParamsSchema,
  }),
  z.object({
    method: z.literal("turn/steer"),
    params: turnSteerParamsSchema,
  }),
  z.object({
    method: z.literal("thread/stop"),
    params: threadStopParamsSchema,
  }),
  z.object({
    method: z.literal("thread/discard"),
    params: threadDiscardParamsSchema,
  }),
  z.object({
    method: z.literal("skills/configure"),
    params: skillsConfigureParamsSchema,
  }),
]);

export type PiCommand = z.infer<typeof piCommandSchema>;

/**
 * The known-method set, derived from the schema union so it cannot drift
 * (#853): the bridge answers unknown methods with METHOD_NOT_FOUND and
 * schema-invalid params with INVALID_PARAMS instead of dropping them.
 */
const piCommandMethodValues = piCommandSchema.options.map(
  (option) => option.shape.method.value,
);

type DecodedPiBridgeRequest =
  | { kind: "request"; request: PiCommand & { id: string | number } }
  | { kind: "unknown-method"; id: string | number; method: string }
  | {
      kind: "invalid-params";
      id: string | number;
      method: string;
      issues: string;
    }
  | { kind: "ignored" };

function decodePiJsonRpcRequest(raw: unknown): DecodedPiBridgeRequest {
  const envelope = bridgeRequestEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    return { kind: "ignored" };
  }

  const command = piCommandSchema.safeParse({
    method: envelope.data.method,
    params: envelope.data.params ?? {},
  });
  if (command.success) {
    return {
      kind: "request",
      request: { ...command.data, id: envelope.data.id },
    };
  }
  // Reply, never drop (#853): a silently dropped request is an undebuggable
  // 30-second timeout on the runtime side.
  if (
    !(piCommandMethodValues as readonly string[]).includes(envelope.data.method)
  ) {
    return {
      kind: "unknown-method",
      id: envelope.data.id,
      method: envelope.data.method,
    };
  }
  return {
    kind: "invalid-params",
    id: envelope.data.id,
    method: envelope.data.method,
    issues: command.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; "),
  };
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
  /** Stable provider identity used to resolve the persisted session file. */
  providerThreadId: string;
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
  BridgeEventNotification | BridgeToolCallRequest
>({ write: writePiBridgeProtocol });

const sessions = new Map<string, ThreadSession>();
const closingSessions = new Map<string, Promise<string | undefined>>();
const { forwardToolCall, handleToolCallResponse, resolvePendingToolCalls } =
  createPendingToolCallTracker({ sendToolCall: send });

function createForwardToolCall(getThreadId: () => string): ToolCallForwarder {
  return (toolName, args) => {
    const threadId = getThreadId();
    const threadSession = sessions.get(threadId);
    if (!threadSession || threadSession.closing) {
      return Promise.resolve({
        content: "Thread session not found",
        isError: true,
      });
    }
    return forwardToolCall({
      arguments: args,
      // The stable provider identity, not the bb thread id: a resumed session
      // can run under a new thread id while keeping its persisted-file name.
      providerThreadId: threadSession.providerThreadId,
      scope: threadSession,
      threadId,
      toolName,
    });
  };
}

async function closeThreadSession(args: {
  message: string;
  threadId: string;
}): Promise<string | undefined> {
  const existingClose = closingSessions.get(args.threadId);
  if (existingClose) {
    return existingClose;
  }

  const threadSession = sessions.get(args.threadId);
  if (!threadSession) {
    return;
  }

  threadSession.closing = true;
  resolvePendingToolCalls(threadSession, args.message);
  const closePromise = Promise.resolve()
    .then(() =>
      threadSession.session.closeGracefully(THREAD_STOP_CLOSE_TIMEOUT_MS),
    )
    .finally(() => {
      if (sessions.get(args.threadId) === threadSession) {
        sessions.delete(args.threadId);
      }
      closingSessions.delete(args.threadId);
    });
  closingSessions.set(args.threadId, closePromise);
  return closePromise;
}

async function closeThreadSessionsGracefully(message: string): Promise<void> {
  await Promise.all(
    Array.from(sessions.keys()).map((threadId) =>
      closeThreadSession({ message, threadId }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Thread-delta emission
// ---------------------------------------------------------------------------

/**
 * Skill directories latched by the `skills/configure` request. Pi takes
 * additional skill paths at session construction only, so the payload is
 * applied to every session started afterwards. `null` means the runtime never
 * configured skills for this process.
 */
let configuredSkillPaths: string[] | null = null;

/**
 * One stateless dialect translator for the whole process: the pi dialect
 * carries every join key the runtime's delta assembler needs, so no
 * per-session turn/item/id state lives bridge-side anymore.
 */
const piDeltaTranslator = createPiDeltaTranslator();

function sendThreadDeltas(
  threadId: string,
  deltas: readonly ThreadDelta[],
): void {
  if (deltas.length === 0) {
    return;
  }
  send({
    jsonrpc: "2.0",
    method: THREAD_DELTA_NOTIFICATION_METHOD,
    params: { threadId, deltas: [...deltas] },
  });
}

/**
 * The one session-scoped emitter: it runs the pi-flavored notification through
 * the dialect translator and emits the parsed semantic deltas as one batched
 * `thread/delta` notification. The pi-flavored envelope never reaches the
 * wire — it is only the translator's input vocabulary.
 */
function emitForSession(
  threadId: string,
  method: string,
  params: Record<string, unknown>,
): void {
  sendThreadDeltas(
    threadId,
    piDeltaTranslator.translate(
      { jsonrpc: "2.0", method, params },
      { threadId },
    ),
  );
}

/**
 * A session announces identity before any `thread/delta`. Pi sessions always
 * persist to the file named by their stable provider identity, so every
 * session is restorable even when bb resumes it under a new thread id.
 */
function sendThreadIdentity(threadId: string, providerThreadId: string): void {
  send({
    jsonrpc: "2.0",
    method: BRIDGE_NOTIFICATION_METHODS.threadIdentity,
    params: { threadId, providerThreadId, sessionRestorable: true },
  });
}

function sendSessionScopedError(
  threadId: string,
  providerThreadId: string,
  message: string,
): void {
  send({
    jsonrpc: "2.0",
    method: BRIDGE_NOTIFICATION_METHODS.error,
    params: { threadId, providerThreadId, message },
  });
}

function emitSessionError(
  threadSession: ThreadSession,
  threadId: string,
  message: string,
): void {
  // A settling error delta: the assembler fails the turn the error owns (an
  // open turn, or one proven by pending accepted input) and settles nothing
  // when the thread is idle — fabricating a failed turn bb never accepted
  // stays impossible. The runtime notification below always goes out.
  emitForSession(threadId, "error", { threadId, message });
  sendSessionScopedError(threadId, threadSession.providerThreadId, message);
}

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

  emitForSession(threadId, "thread/contextWindowUsage/updated", {
    threadId,
    contextWindowUsage,
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
    emitForSession(args.threadId, "sdk/message", {
      threadId: args.threadId,
      message:
        providerCheckpointId === undefined
          ? event
          : { ...event, providerCheckpointId },
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
    const threadSession = getCurrentThreadSession(args);
    if (!threadSession) {
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
      sendSessionScopedError(
        args.threadId,
        threadSession.providerThreadId,
        message,
      );
    });
  };
}

function reportPromptSettled(args: {
  error?: unknown;
  sessionSerial: number;
  threadId: string;
}): void {
  const threadSession = getCurrentThreadSession(args);
  if (!threadSession) {
    return;
  }
  const errorMessage =
    args.error === undefined
      ? undefined
      : args.error instanceof Error
        ? args.error.message
        : String(args.error);
  emitForSession(args.threadId, "pi/prompt/settled", {
    threadId: args.threadId,
    status: errorMessage === undefined ? "completed" : "failed",
    ...(errorMessage !== undefined ? { error: errorMessage } : {}),
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

  emitSessionError(threadSession, args.threadId, message);
}

function buildSessionOptions(
  args: BuildPiSessionOptionsArgs,
): PiSdkSessionOptions {
  return {
    cwd: args.params.cwd,
    model: args.params.model,
    sessionFilePath: resolvePiSessionFilePath({
      env: process.env,
      threadId: args.providerThreadId,
    }),
    systemPrompt: args.params.baseInstructions,
    appendSystemPrompt: args.params.appendSystemPrompt,
    shellEnvOverrides: args.params.shellEnvOverrides,
    ...(args.params.additionalSkillPaths
      ? { additionalSkillPaths: [...args.params.additionalSkillPaths] }
      : {}),
    ...(args.params.thinkingLevel
      ? { thinkingLevel: args.params.thinkingLevel }
      : {}),
  };
}

function applyDynamicTools(
  sessionOptions: PiSdkSessionOptions,
  dynamicTools: readonly DynamicToolDefinition[] | undefined,
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
      // The canonical handshake (@bb/provider-bridge-protocol): the bridge
      // reports the session-behavior facts its own code implements.
      // sessionRestore is true — every pi session persists to a session file
      // resolved from the thread id, and thread/resume reopens it. fork is
      // "checkpoint" — thread/fork accepts providerCheckpointId and
      // materializes the source history up to that entry
      // (SessionManager.createBranchedSession).
      // Typed so a capability rename cannot silently degrade this bridge:
      // an unrenamed key would be missing from InitializeResult, not
      // defaulted false.
      const result: InitializeResult = {
        protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
        capabilities: {
          sessionRestore: true,
          threadArchive: false,
          threadRename: false,
          threadGoalClear: false,
          fork: "checkpoint",
          approvalEnforcedBy: "runtime",
        },
      };
      sendResult(request.id, result);
      break;
    case "model/list":
      // Pi model listing needs no launch spec, only the cwd whose project
      // configuration decides which providers are configured.
      await handleModelList(request.id, request.params);
      break;
    // A start mints provider identity from the bb thread id. Resume keeps the
    // caller's stable provider identity while registering the live session
    // under the new bb thread id used by later turn commands.
    case "thread/start":
      await handleThreadConstruction(
        request.id,
        request.params.threadId,
        request.params.threadId,
        toPiSessionParams(request.params),
      );
      break;
    case "thread/resume":
      await handleThreadConstruction(
        request.id,
        request.params.threadId,
        request.params.providerThreadId,
        toPiSessionParams(request.params),
      );
      break;
    case "thread/fork":
      // Pi supports checkpoint forks natively.
      await handleThreadFork(request.id, request.params);
      break;
    case "turn/start":
      handleTurnStart(request.id, request.params);
      break;
    case "turn/steer":
      await handleTurnSteer(request.id, request.params);
      break;
    case "thread/stop":
      await handleThreadStop(request.id, request.params);
      break;
    case "thread/discard":
      sendResult(request.id, await handleThreadDiscard(request.params));
      break;
    case "skills/configure":
      // Pi loads staged skill roots as additional skill paths, read once when
      // a session is constructed, so the payload is latched here and applied
      // to every session started afterwards.
      configuredSkillPaths = request.params.roots.map((root) => root.path);
      sendResult(request.id, { ok: true });
      break;
  }
}

type ThreadForkParams = z.infer<typeof threadForkParamsSchema>;
type TurnStartParams = z.infer<typeof turnStartParamsSchema>;
type TurnSteerParams = z.infer<typeof turnSteerParamsSchema>;
type ThreadStopParams = z.infer<typeof threadStopParamsSchema>;
type ThreadRefParams = z.infer<typeof threadDiscardParamsSchema>;

/**
 * The session-construction fields every constructing method carries, mapped
 * onto pi session params with this process's latched skill paths.
 */
function toPiSessionParams(
  params: z.infer<typeof threadStartParamsSchema>,
): PiSessionParams {
  return buildPiSessionParams({
    threadId: params.threadId,
    cwd: params.cwd,
    options: params.options,
    instructionMode: params.instructionMode,
    dynamicTools: params.dynamicTools,
    additionalSkillPaths: configuredSkillPaths ?? undefined,
  });
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

async function startPiThreadSession(
  threadId: string,
  providerThreadId: string,
  params: PiSessionParams,
): Promise<void> {
  // Stop existing session for this thread if any
  const existing = sessions.get(threadId);
  if (existing) {
    await closeThreadSession({
      message: "Pi thread session replaced while tool call was pending",
      threadId,
    });
  }

  const sessionOptions = buildSessionOptions({ params, providerThreadId });
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
    providerThreadId,
  };
  sessions.set(threadId, threadSession);

  try {
    await session.start();
  } catch (error) {
    removeThreadSessionIfCurrent({ sessionSerial, threadId });
    throw error;
  }
}

/**
 * Announce the constructed session. Starts mint identity from the bb thread
 * id; resumes return the earlier identity whose session file was reopened.
 * The synchronous result keeps callers from racing the notification.
 */
function sendThreadSessionResult(
  id: string | number,
  threadId: string,
  providerThreadId: string,
): void {
  sendThreadIdentity(threadId, providerThreadId);
  // The provider id-space boundary: a new pi session was constructed for this
  // thread (start/resume/fork all announce through here), so the assembler
  // drops the thread's assembly state — settled item keys, id maps,
  // accumulated usage — before any of the new session's deltas.
  sendThreadDeltas(threadId, [{ kind: "session.reset" }]);
  sendResult(id, { providerThreadId, sessionRestorable: true });
}

async function handleThreadConstruction(
  id: string | number,
  threadId: string,
  providerThreadId: string,
  params: PiSessionParams,
): Promise<void> {
  await startPiThreadSession(threadId, providerThreadId, params);
  sendThreadSessionResult(id, threadId, providerThreadId);
}

// Pi mints provider identity from the bb thread id for new sessions, and the
// session file is the deterministic path for that provider id. Forking means
// materializing source history at the NEW thread's path, then launching like
// thread/start. A dedicated handler keeps "open my own file fresh" distinct
// from "copy another file's history into my file". SessionManager.forkFrom
// picks its own filename, so move it onto the new identity's path before open.
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
    params.sourceProviderCheckpointId === undefined
      ? SessionManager.forkFrom(
          sourceSessionFile,
          params.cwd,
          bridgeSessionDir,
        ).getSessionFile()
      : SessionManager.open(
          sourceSessionFile,
          bridgeSessionDir,
          params.cwd,
        ).createBranchedSession(params.sourceProviderCheckpointId);
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

  await handleThreadConstruction(
    id,
    params.threadId,
    params.threadId,
    toPiSessionParams(params),
  );
}

function startPiPrompt(
  threadSession: ThreadSession,
  threadId: string,
  text: string,
  images: ImageContent[],
): void {
  void threadSession.session
    .prompt(text, images.length > 0 ? images : undefined)
    .then(
      () =>
        reportPromptSettled({
          sessionSerial: threadSession.sessionSerial,
          threadId,
        }),
      (error: unknown) =>
        reportPromptSettled({
          error,
          sessionSerial: threadSession.sessionSerial,
          threadId,
        }),
    );
}

/**
 * Manual compaction travels the prompt path: bb's compact affordance sends a
 * standalone builtin `/compact` mention as turn input. Pi's own `/compact`
 * slash command belongs to its interactive mode, so the bridge runs the SDK
 * compaction directly; the resulting `compaction_start`/`compaction_end`
 * events carry the turn. The settle report is the fallback that closes the
 * requested turn when pi refuses to compact and emits no events at all.
 */
function startPiCompaction(
  threadSession: ThreadSession,
  threadId: string,
): void {
  void threadSession.session.compact().then(
    () =>
      reportPromptSettled({
        sessionSerial: threadSession.sessionSerial,
        threadId,
      }),
    (error: unknown) =>
      reportPromptSettled({
        error,
        sessionSerial: threadSession.sessionSerial,
        threadId,
      }),
  );
}

/**
 * Accepted-input correlation (turn/input/accepted): the assembler owns the
 * queue-until-turn-opens behavior, so the bridge only reports the acceptance.
 */
function recordAcceptedTurnInput(params: TurnStartParams): void {
  sendThreadDeltas(params.threadId, [
    { kind: "input.accepted", clientRequestId: params.clientRequestId },
  ]);
}

function handleTurnStart(id: string | number, params: TurnStartParams): void {
  // Requests resolve the session by bb threadId — pi's stable session handle.
  const threadSession = sessions.get(params.threadId);
  if (!threadSession || threadSession.closing) {
    sendError(id, -32000, "No active pi session");
    return;
  }

  // A standalone builtin `/compact` mention is bb's manual-compaction request,
  // not model input. Prompting with the literal text would make the model talk
  // about compaction while the context keeps growing.
  if (isStandaloneBuiltinCompactCommand(params.input)) {
    recordAcceptedTurnInput(params);
    startPiCompaction(threadSession, params.threadId);
    sendResult(id, { threadId: params.threadId });
    return;
  }

  const { text, images } = extractInput(params.input);
  if (!text) {
    sendError(id, BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS, "Missing input text");
    return;
  }

  recordAcceptedTurnInput(params);
  startPiPrompt(threadSession, params.threadId, text, images);
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
    sendError(id, BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS, "Missing input text");
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
    // A steer joins the active turn; its acceptance is reported only once
    // the SDK actually accepted the queued input.
    sendThreadDeltas(params.threadId, [
      { kind: "input.accepted", clientRequestId: params.clientRequestId },
    ]);
    sendResult(id, { threadId: params.threadId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendError(id, -32000, message);
  }
}

async function closePiThreadSession(
  threadId: string,
): Promise<PiThreadStopResult> {
  const providerCheckpointId =
    (await closeThreadSession({
      message: "Pi thread stopped while tool call was pending",
      threadId,
    })) ?? null;
  return { ok: true, providerCheckpointId };
}

async function handleThreadStop(
  id: string | number,
  params: ThreadStopParams,
): Promise<void> {
  const threadSession = sessions.get(params.threadId);
  if (
    params.intent === "interrupt" &&
    threadSession !== undefined &&
    !threadSession.closing
  ) {
    // An interrupt settles the active turn as interrupted before teardown;
    // the SDK session is detached on close, so no further events flow. The
    // assembler settles only a turn it actually holds open (or one owed to
    // pending accepted input), so an idle interrupt fabricates nothing.
    sendThreadDeltas(params.threadId, [
      { kind: "session.ended" },
    ]);
  }
  // A release detaches the idle session and must not fabricate an
  // interruption (#1584): the close path emits no turn events.
  sendResult(id, await closePiThreadSession(params.threadId));
}

async function handleThreadDiscard(
  params: ThreadRefParams,
): Promise<PiCommandOkResult> {
  await closeThreadSession({
    message: "Pi staged thread discarded while tool call was pending",
    threadId: params.threadId,
  });
  rmSync(
    resolvePiSessionFilePath({
      env: process.env,
      threadId: params.providerThreadId,
    }),
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

  const decoded = decodePiJsonRpcRequest(parsed);
  if (decoded.kind === "ignored") {
    return;
  }
  if (decoded.kind === "unknown-method") {
    sendError(
      decoded.id,
      BRIDGE_JSON_RPC_ERRORS.METHOD_NOT_FOUND,
      `Unknown method "${decoded.method}"`,
    );
    return;
  }
  if (decoded.kind === "invalid-params") {
    sendError(
      decoded.id,
      BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS,
      `Invalid params for "${decoded.method}": ${decoded.issues}`,
    );
    return;
  }
  runBridgeRequest({ request: decoded.request, handleRequest, sendError });
}

export const handleLine = createBridgeLineHandler({ handleParsedMessage });

export const experimental_providerBridge = experimental_defineProviderBridge({
  handleLine,
  start: takeOverPiBridgeStdout,
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
