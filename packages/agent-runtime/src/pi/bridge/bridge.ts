#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { ThreadEvent, ThreadEventContextWindowUsage } from "@bb/domain";
import { turnScope } from "@bb/domain";
import {
  BRIDGE_JSON_RPC_ERRORS,
  BRIDGE_NOTIFICATION_METHODS,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
  threadForkParamsSchema as canonicalThreadForkParamsSchema,
  threadResumeParamsSchema as canonicalThreadResumeParamsSchema,
  threadStartParamsSchema as canonicalThreadStartParamsSchema,
  threadStopParamsSchema as canonicalThreadStopParamsSchema,
  turnStartParamsSchema as canonicalTurnStartParamsSchema,
  turnSteerParamsSchema as canonicalTurnSteerParamsSchema,
} from "@bb/provider-bridge-protocol";
import { extractEnvOverrides } from "../../shared/adapter-utils.js";
import {
  buildAcceptedUserMessageEvent,
  queueAcceptedUserMessage,
} from "../../shared/accepted-user-messages.js";
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
import { UNSTAMPED_THREAD_ID } from "../../shared/unstamped-thread-id.js";
import {
  SessionManager,
  type AgentSessionEvent,
  type ContextUsage,
} from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";
import {
  createPiEventTranslator,
  type PiEventTranslator,
} from "../event-translation.js";
import {
  buildPiCanonicalSessionParams,
  piReasoningLevelSchema,
  type PiReasoningLevel,
} from "../session-params.js";
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

const piTurnStartParamsSchema = z.object({
  threadId: z.string(),
  input: z.array(z.unknown()),
  model: z.string().optional(),
});

const piTurnSteerParamsSchema = z.object({
  threadId: z.string(),
  expectedTurnId: z.string(),
  input: z.array(z.unknown()),
});

/**
 * Per-method params accept both dialects during the phase-2b migration: the
 * canonical Provider Bridge Protocol shapes (imported from
 * `@bb/provider-bridge-protocol`, listed first — required fields such as
 * `options` or `intent` discriminate them from the legacy shapes) and the
 * legacy adapter shapes. Handlers narrow on the same fields. `model/list`,
 * `thread/compact`, and `thread/discard` keep one schema: the canonical
 * params parse under the legacy shape (pi's provider identity is the bb
 * thread id, so `threadId` addresses the same session in both dialects).
 */
const piCommandSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("initialize"),
    // Accepts both the legacy shape ({clientInfo}) and the canonical
    // Provider Bridge Protocol shape ({protocolVersion, client}); the reply
    // is always the canonical handshake, which the legacy adapter ignores.
    params: z.union([
      z.object({
        clientInfo: z.object({ name: z.string(), version: z.string() }),
      }),
      z
        .object({
          protocolVersion: z.number().int().positive(),
          client: z.object({ name: z.string(), version: z.string() }),
        })
        .passthrough(),
    ]),
  }),
  z.object({
    method: z.literal("model/list"),
    params: z.object({ cwd: z.string().optional() }),
  }),
  z.object({
    method: z.literal("thread/start"),
    params: z.union([
      canonicalThreadStartParamsSchema,
      piThreadStartParamsSchema,
    ]),
  }),
  z.object({
    method: z.literal("thread/resume"),
    params: z.union([
      canonicalThreadResumeParamsSchema,
      piThreadResumeParamsSchema,
    ]),
  }),
  z.object({
    method: z.literal("thread/fork"),
    params: z.union([
      canonicalThreadForkParamsSchema,
      piThreadForkParamsSchema,
    ]),
  }),
  z.object({
    method: z.literal("turn/start"),
    params: z.union([canonicalTurnStartParamsSchema, piTurnStartParamsSchema]),
  }),
  z.object({
    method: z.literal("turn/steer"),
    params: z.union([canonicalTurnSteerParamsSchema, piTurnSteerParamsSchema]),
  }),
  z.object({
    method: z.literal("thread/stop"),
    params: z.union([canonicalThreadStopParamsSchema, piThreadIdParamsSchema]),
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
  const envelope = jsonRpcEnvelopeSchema.safeParse(raw);
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
  if (!(piCommandMethodValues as readonly string[]).includes(envelope.data.method)) {
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

/**
 * Which wire dialect the session's runtime speaks. "legacy" keeps today's
 * `sdk/message` (and other pi-flavored) notifications translated
 * adapter-side; "canonical" runs every session-scoped notification through
 * the bridge-held translator and emits finished `ThreadEvent`s as
 * `thread/event` per the Provider Bridge Protocol.
 */
type PiSessionDialect = "legacy" | "canonical";

interface ThreadSession {
  session: PiSdkSession;
  sessionSerial: number;
  closing: boolean;
  dialect: PiSessionDialect;
  /** Per-session translator; non-null exactly for canonical sessions. */
  translator: PiEventTranslator | null;
  pendingToolCalls: Map<string | number, PendingBridgeToolCall>;
}

interface StartPiThreadSessionArgs {
  dialect: PiSessionDialect;
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

// ---------------------------------------------------------------------------
// Canonical-dialect emission
// ---------------------------------------------------------------------------

/**
 * Per-process entropy for canonical turn/item id prefixes (#1224): combined
 * with a per-session serial below, ids never collide across process restarts
 * or session resumes.
 */
const canonicalIdEntropyPrefix = `bt${randomUUID().slice(0, 8)}-`;
let canonicalSessionSerial = 0;
const PI_CANONICAL_PROVIDER_ID = "pi";

function createCanonicalSessionTranslator(): PiEventTranslator {
  canonicalSessionSerial += 1;
  const idPrefix = `${canonicalIdEntropyPrefix}${canonicalSessionSerial}-`;
  return createPiEventTranslator({
    providerId: PI_CANONICAL_PROVIDER_ID,
    turnIdPrefix: idPrefix,
    itemIdPrefix: idPrefix,
    synthesizeItemStarted: true,
  });
}

function sendThreadEvents(
  threadId: string,
  events: readonly ThreadEvent[],
): void {
  for (const event of events) {
    send({
      jsonrpc: "2.0",
      method: BRIDGE_NOTIFICATION_METHODS.threadEvent,
      params: { threadId, event },
    });
  }
}

/**
 * The one session-scoped emitter. Legacy sessions get today's notification
 * verbatim; canonical sessions run it through the session translator and emit
 * the finished `ThreadEvent`s as `thread/event` notifications.
 */
function emitForSession(
  threadSession: ThreadSession,
  threadId: string,
  method: string,
  params: Record<string, unknown>,
): void {
  if (threadSession.dialect === "legacy" || threadSession.translator === null) {
    send({ jsonrpc: "2.0", method, params });
    return;
  }
  sendThreadEvents(
    threadId,
    threadSession.translator.translatePiEvent(
      { jsonrpc: "2.0", method, params },
      { threadId },
    ),
  );
}

/**
 * Canonical sessions announce identity before any `thread/event`; pi's
 * provider identity is the bb threadId and pi sessions always persist to a
 * session file, so every session is restorable.
 */
function sendCanonicalThreadIdentity(threadId: string): void {
  send({
    jsonrpc: "2.0",
    method: BRIDGE_NOTIFICATION_METHODS.threadIdentity,
    params: { threadId, providerThreadId: threadId, sessionRestorable: true },
  });
}

function sendSessionScopedError(threadId: string, message: string): void {
  if (sessions.get(threadId)?.dialect === "canonical") {
    send({
      jsonrpc: "2.0",
      method: BRIDGE_NOTIFICATION_METHODS.error,
      params: { threadId, providerThreadId: threadId, message },
    });
    return;
  }
  send({
    jsonrpc: "2.0",
    method: "error",
    params: { threadId, message },
  });
}

function emitSessionError(
  threadSession: ThreadSession,
  threadId: string,
  message: string,
): void {
  if (threadSession.dialect === "canonical" && threadSession.translator !== null) {
    // Settle any open translator turn first: every accepted turn reaches
    // exactly one terminal state, and settlement events precede the error
    // signal. Without an open turn the error stays a runtime notification —
    // translating it would fabricate a failed turn bb never accepted.
    const state = threadSession.translator.resolveState({ threadId });
    if (state.currentTurnId !== undefined) {
      emitForSession(threadSession, threadId, "error", { threadId, message });
    }
    send({
      jsonrpc: "2.0",
      method: BRIDGE_NOTIFICATION_METHODS.error,
      params: { threadId, providerThreadId: threadId, message },
    });
    return;
  }
  send({ jsonrpc: "2.0", method: "error", params: { threadId, message } });
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

  emitForSession(threadSession, threadId, "thread/contextWindowUsage/updated", {
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
    emitForSession(threadSession, args.threadId, "sdk/message", {
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
      sendSessionScopedError(args.threadId, message);
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
  emitForSession(threadSession, args.threadId, "pi/prompt/settled", {
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
      // The canonical handshake (@bb/provider-bridge-protocol): the bridge
      // reports the session-behavior facts its own code implements.
      // sessionRestore is true — every pi session persists to a session file
      // resolved from the thread id, and thread/resume reopens it. fork is
      // "checkpoint" — thread/fork accepts providerCheckpointId and
      // materializes the source history up to that entry
      // (SessionManager.createBranchedSession). manualCompaction is true —
      // thread/compact is implemented below. The legacy adapter ignores this
      // result (plus `ok` for its historical shape).
      sendResult(request.id, {
        ok: true,
        protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
        capabilities: {
          sessionRestore: true,
          archiveSync: false,
          nameSync: false,
          goalState: false,
          manualCompaction: true,
          fork: "checkpoint",
          approvalRequestPolicy: "runtime",
        },
      });
      break;
    case "model/list":
      // Pi model listing needs no launch spec; the canonical params carry
      // the same optional cwd as the legacy shape.
      await handleModelList(request.id, request.params);
      break;
    case "thread/start": {
      if ("options" in request.params) {
        const params = request.params;
        await handleThreadStart(
          request.id,
          piThreadStartParamsSchema.parse(
            buildPiCanonicalSessionParams({
              threadId: params.threadId,
              cwd: params.cwd,
              options: params.options,
              instructionMode: params.instructionMode,
              dynamicTools: params.dynamicTools,
            }),
          ),
          "canonical",
        );
        break;
      }
      await handleThreadStart(request.id, request.params, "legacy");
      break;
    }
    case "thread/resume": {
      if ("options" in request.params) {
        const params = request.params;
        // Pi's provider identity is the bb threadId (the canonical
        // providerThreadId equals it for sessions this bridge minted), so
        // resume reopens the deterministic session file for the thread id.
        await handleThreadResume(
          request.id,
          piThreadResumeParamsSchema.parse(
            buildPiCanonicalSessionParams({
              threadId: params.threadId,
              cwd: params.cwd,
              options: params.options,
              instructionMode: params.instructionMode,
              dynamicTools: params.dynamicTools,
            }),
          ),
          "canonical",
        );
        break;
      }
      await handleThreadResume(request.id, request.params, "legacy");
      break;
    }
    case "thread/fork": {
      if ("options" in request.params) {
        const params = request.params;
        // Pi supports checkpoint forks natively: sourceProviderCheckpointId
        // maps onto the legacy providerCheckpointId param.
        await handleThreadFork(
          request.id,
          piThreadForkParamsSchema.parse({
            ...buildPiCanonicalSessionParams({
              threadId: params.threadId,
              cwd: params.cwd,
              options: params.options,
              instructionMode: params.instructionMode,
              dynamicTools: params.dynamicTools,
            }),
            sourceProviderThreadId: params.sourceProviderThreadId,
            ...(params.sourceProviderCheckpointId !== undefined
              ? { providerCheckpointId: params.sourceProviderCheckpointId }
              : {}),
          }),
          "canonical",
        );
        break;
      }
      await handleThreadFork(request.id, request.params, "legacy");
      break;
    }
    case "turn/start":
      if ("options" in request.params) {
        handleCanonicalTurnStart(request.id, request.params);
        break;
      }
      await handleTurnStart(request.id, request.params);
      break;
    case "turn/steer":
      if ("options" in request.params) {
        await handleCanonicalTurnSteer(request.id, request.params);
        break;
      }
      await handleTurnSteer(request.id, request.params);
      break;
    case "thread/stop": {
      if ("intent" in request.params) {
        await handleCanonicalThreadStop(request.id, request.params);
        break;
      }
      sendResult(request.id, await handleThreadStop(request.params));
      break;
    }
    case "thread/compact":
      handleThreadCompact(request.id, request.params);
      break;
    case "thread/discard":
      sendResult(request.id, await handleThreadDiscard(request.params));
      break;
  }
}

type ThreadStartParams = z.infer<typeof piThreadStartParamsSchema>;
type ThreadResumeParams = z.infer<typeof piThreadResumeParamsSchema>;
type ThreadForkParams = z.infer<typeof piThreadForkParamsSchema>;
type TurnStartParams = z.infer<typeof piTurnStartParamsSchema>;
type TurnSteerParams = z.infer<typeof piTurnSteerParamsSchema>;
type CanonicalTurnStartParams = z.infer<typeof canonicalTurnStartParamsSchema>;
type CanonicalTurnSteerParams = z.infer<typeof canonicalTurnSteerParamsSchema>;
type CanonicalThreadStopParams = z.infer<typeof canonicalThreadStopParamsSchema>;
type ThreadIdParams = z.infer<typeof piThreadIdParamsSchema>;
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
  dialect,
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
    dialect,
    translator: dialect === "canonical" ? createCanonicalSessionTranslator() : null,
    pendingToolCalls: new Map(),
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
 * Send the session-construction result for the dialect. Pi has no separately
 * minted session id: its provider identity is the BB thread id. Return that
 * identity synchronously so callers do not have to race the thread/identity
 * notification.
 */
function sendThreadSessionResult(
  id: string | number,
  threadId: string,
  dialect: PiSessionDialect,
): void {
  if (dialect === "canonical") {
    sendCanonicalThreadIdentity(threadId);
    sendResult(id, { providerThreadId: threadId, sessionRestorable: true });
    return;
  }
  sendResult(id, { threadId, providerThreadId: threadId });
}

async function handleThreadStart(
  id: string | number,
  params: ThreadStartParams,
  dialect: PiSessionDialect,
): Promise<void> {
  const threadId = params.threadId ?? `pi-${Date.now()}`;
  await startPiThreadSession({ dialect, params, threadId });
  sendThreadSessionResult(id, threadId, dialect);
  if (dialect === "legacy") {
    send({
      jsonrpc: "2.0",
      method: "thread/identity",
      params: { threadId, providerThreadId: threadId },
    });
  }
}

async function handleThreadResume(
  id: string | number,
  params: ThreadResumeParams,
  dialect: PiSessionDialect,
): Promise<void> {
  await startPiThreadSession({ dialect, params, threadId: params.threadId });
  sendThreadSessionResult(id, params.threadId, dialect);
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
  dialect: PiSessionDialect,
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

  await startPiThreadSession({ dialect, params, threadId: params.threadId });
  sendThreadSessionResult(id, params.threadId, dialect);
  if (dialect === "legacy") {
    send({
      jsonrpc: "2.0",
      method: "thread/identity",
      params: { threadId: params.threadId, providerThreadId: params.threadId },
    });
  }
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

  startPiPrompt(threadSession, params.threadId, text, images);
  sendResult(id, { threadId: params.threadId });
}

function handleCanonicalTurnStart(
  id: string | number,
  params: CanonicalTurnStartParams,
): void {
  // Canonical requests resolve the session by bb threadId — pi's stable
  // session handle in both dialects.
  const threadSession = sessions.get(params.threadId);
  if (
    !threadSession ||
    threadSession.closing ||
    threadSession.translator === null
  ) {
    sendError(id, -32000, "No active pi session");
    return;
  }

  const { text, images } = extractInput(params.input);
  if (!text) {
    sendError(id, BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS, "Missing input text");
    return;
  }

  // Accepted-input correlation (turn/input/accepted): queue onto the
  // translator so its onTurnStart drains it into the opening turn; a
  // still-open translator turn gets the event immediately instead.
  const state = threadSession.translator.resolveState({
    threadId: params.threadId,
  });
  if (state.currentTurnId !== undefined) {
    sendThreadEvents(
      params.threadId,
      buildAcceptedUserMessageEvent({
        clientRequestId: params.clientRequestId,
        providerThreadId: params.providerThreadId,
        threadId: params.threadId,
        turnId: state.currentTurnId,
      }),
    );
  } else {
    queueAcceptedUserMessage({
      clientRequestId: params.clientRequestId,
      state,
    });
  }

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

async function handleCanonicalTurnSteer(
  id: string | number,
  params: CanonicalTurnSteerParams,
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
    // A steer joins the active turn; its acceptance is emitted only once the
    // SDK actually accepted the queued input, against the expected turn id.
    sendThreadEvents(
      params.threadId,
      buildAcceptedUserMessageEvent({
        clientRequestId: params.clientRequestId,
        providerThreadId: params.providerThreadId,
        threadId: params.threadId,
        turnId: params.expectedTurnId,
      }),
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

async function handleCanonicalThreadStop(
  id: string | number,
  params: CanonicalThreadStopParams,
): Promise<void> {
  const threadSession = sessions.get(params.threadId);
  if (
    params.intent === "interrupt" &&
    threadSession !== undefined &&
    !threadSession.closing &&
    threadSession.translator !== null
  ) {
    // An interrupt settles the active turn as interrupted before teardown;
    // the SDK session is detached on close, so no further events flow.
    const state = threadSession.translator.resolveState({
      threadId: params.threadId,
    });
    if (state.currentTurnId !== undefined) {
      sendThreadEvents(params.threadId, [
        {
          type: "turn/completed",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(state.currentTurnId),
          status: "interrupted",
        },
      ]);
      threadSession.translator.turnState.finishTurn({
        state,
        threadId: params.threadId,
      });
    }
  }
  // A release detaches the idle session and must not fabricate an
  // interruption (#1584): the close path emits no turn events.
  sendResult(id, await handleThreadStop({ threadId: params.threadId }));
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
