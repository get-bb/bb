#!/usr/bin/env node

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  BRIDGE_JSON_RPC_ERRORS,
  BRIDGE_NOTIFICATION_METHODS,
  BRIDGE_REQUEST_METHODS,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
  THREAD_DELTA_GRAMMAR_V3,
  THREAD_DELTA_NOTIFICATION_METHOD,
  experimental_buildProviderCliEnv as buildProviderCliEnv,
  bridgeRequestEnvelopeSchema,
  createBridgeIo,
  createBridgeLineHandler,
  createPendingToolCallTracker,
  decodeBridgeJsonRpcResponse,
  experimental_defineProviderBridge,
  initializeParamsSchema,
  providerInstallationRunParamsSchema,
  providerInstallationStatusParamsSchema,
  providerMaintenanceParamsSchema,
  isStandaloneBuiltinCompactCommand,
  modelListParamsSchema,
  runBridgeRequest,
  skillsConfigureParamsSchema,
  threadDiscardParamsSchema,
  threadForkParamsSchema,
  threadResumeParamsSchema,
  threadStartParamsSchema,
  threadOpenWorkParamsSchema,
  threadStopParamsSchema,
  turnStartParamsSchema,
  turnSteerParamsSchema,
  type BridgeToolCallRequest,
  type InitializeResult,
  type OpenWorkItem,
  type SessionSettingsDeclaration,
  type ThreadOpenWorkResult,
  type TurnInputResult,
  type ThreadDelta,
  type ThreadEventContextWindowUsage,
} from "@get-bb/plugin-sdk/provider-bridge";
import type { ImageContent } from "@earendil-works/pi-ai";
import { createPiDeltaTranslator } from "../delta-translation.js";
import {
  buildPiSessionParams,
  buildPiTurnOptions,
  type PiSessionParams,
} from "../session-params.js";
import {
  piSessionNeedsRelocation,
  readPiSessionFileState,
} from "./session-cwd.js";
import { BB_PI_EXTENSION_SOURCE } from "./bb-pi-extension.js";
import {
  createExtensionUiCoordinator,
  type ExtensionUiCoordinator,
} from "./extension-ui.js";
import { type InteractionUiRequest } from "../extension-ui-contract.js";
import {
  getPiInstallGate,
  getPiProviderInstallationRun,
  getPiProviderInstallationStatus,
  piHealthResult,
  resetPiInstallGateForTests,
} from "./provider-maintenance.js";
import {
  closeAllPiCatalogs,
  createLiveContextWindowResolver,
  getPiCatalog,
} from "./catalog.js";
import {
  PiRpcSession,
  type PiRpcSessionOptions,
  type ToolCallForwarder,
} from "./rpc-session.js";
import {
  resolvePiBridgeSessionDir,
  resolvePiSessionFilePath,
} from "./session-paths.js";
import { extractPiPromptInput } from "./turn-input.js";

const piCommandSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("initialize"),
    params: initializeParamsSchema,
  }),
  z.object({ method: z.literal("model/list"), params: modelListParamsSchema }),
  z.object({
    method: z.literal("provider/health"),
    params: providerMaintenanceParamsSchema,
  }),
  z.object({
    method: z.literal("provider/usage"),
    params: providerMaintenanceParamsSchema,
  }),
  z.object({
    method: z.literal("provider/installation/status"),
    params: providerInstallationStatusParamsSchema,
  }),
  z.object({
    method: z.literal("provider/installation/run"),
    params: providerInstallationRunParamsSchema,
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
  z.object({ method: z.literal("turn/start"), params: turnStartParamsSchema }),
  z.object({ method: z.literal("turn/steer"), params: turnSteerParamsSchema }),
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
  z.object({
    method: z.literal(BRIDGE_REQUEST_METHODS.threadOpenWork),
    params: threadOpenWorkParamsSchema,
  }),
]);

type PiCommand = z.infer<typeof piCommandSchema>;

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

interface ThreadSession {
  session: PiRpcSession;
  sessionSerial: number;
  closing: boolean;
  providerThreadId: string;
  cwd: string;
  construction: PiSessionParams;
}

const PI_SESSION_SETTINGS: SessionSettingsDeclaration = {
  model: { apply: "live" },
  reasoningLevel: { apply: "live" },
  env: { apply: "resume" },
  instructions: { apply: "resume" },
  dynamicTools: { apply: "resume" },
  skills: { apply: "resume" },
};

let sessionSerialCounter = 0;
const THREAD_STOP_CLOSE_TIMEOUT_MS = 8_000;

const { send, sendResult, sendError } = createBridgeIo<
  BridgeEventNotification | BridgeToolCallRequest | InteractionUiRequest
>();

const sessions = new Map<string, ThreadSession>();
const closingSessions = new Map<string, Promise<string | undefined>>();
const { forwardToolCall, handleToolCallResponse, resolvePendingToolCalls } =
  createPendingToolCallTracker({ sendToolCall: send });

const extensionUi: ExtensionUiCoordinator = createExtensionUiCoordinator({
  sendInteractionRequest: send,
  sendThreadDeltas: (threadId, deltas) => sendThreadDeltas(threadId, deltas),
  sendRequestCancelled: (requestId) =>
    send({
      jsonrpc: "2.0",
      method: BRIDGE_NOTIFICATION_METHODS.requestCancelled,
      params: { requestId },
    }),
});

let configuredSkillPaths: string[] | null = null;

let scratchDir: string | null = null;
let scratchDirIsPrivate = false;
let bridgeDataDir: string | undefined;
let extensionPath: string | null = null;

function requireScratchDir(): string {
  if (scratchDir === null) {
    scratchDir = join(
      tmpdir(),
      `bb-pi-bridge-${process.pid}-${Math.random().toString(16).slice(2)}`,
    );
    scratchDirIsPrivate = true;
    mkdirSync(scratchDir, { recursive: true });
  }
  return scratchDir;
}

function requireExtensionPath(): string {
  if (extensionPath === null) {
    const path = join(requireScratchDir(), "bb-pi-extension.mjs");
    writeFileSync(path, BB_PI_EXTENSION_SOURCE, "utf8");
    extensionPath = path;
  }
  return extensionPath;
}

const contextWindows = createLiveContextWindowResolver();
const piDeltaTranslator = createPiDeltaTranslator({
  resolveModelContextWindow: contextWindows.resolve,
});

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
  extensionUi.cancelPendingForScope(threadSession);
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

function emitForSession(
  threadId: string,
  method: string,
  params: Record<string, unknown>,
): void {
  sendThreadDeltas(
    threadId,
    piDeltaTranslator.translate(
      { jsonrpc: "2.0", method, params },
      { threadId, cwd: sessions.get(threadId)?.cwd },
    ),
  );
}

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
  emitForSession(threadId, "error", { threadId, message });
  sendSessionScopedError(threadId, threadSession.providerThreadId, message);
}

function toContextWindowUsagePayload(
  contextUsage: { tokens: number | null; contextWindow: number } | null,
): ThreadEventContextWindowUsage | null {
  if (!contextUsage) {
    return null;
  }
  return {
    usedTokens: contextUsage.tokens,
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
  if (
    !threadSession ||
    threadSession.closing ||
    threadSession.sessionSerial !== args.sessionSerial
  ) {
    return undefined;
  }
  return threadSession;
}

function createOnPiEvent(
  args: CurrentThreadSessionArgs,
): (event: Record<string, unknown>) => void {
  return (event) => {
    const threadSession = getCurrentThreadSession(args);
    if (!threadSession) return;
    emitForSession(args.threadId, "sdk/message", {
      threadId: args.threadId,
      message: event,
    });
    if (event.type === "turn_end" || event.type === "compaction_end") {
      emitContextWindowUsage(args.threadId);
    }
  };
}

function createOnExtensionUiRequest(
  args: CurrentThreadSessionArgs,
): (request: Record<string, unknown>) => void {
  return (request) => {
    const threadSession = getCurrentThreadSession(args);
    if (!threadSession || threadSession.closing) return;
    extensionUi.handle({
      scope: threadSession,
      request,
      threadId: args.threadId,
      providerThreadId: threadSession.providerThreadId,
      respond: (requestId, fields) =>
        threadSession.session.respondToExtensionUi(requestId, fields),
    });
  };
}

function createOnSessionDone(
  args: CurrentThreadSessionArgs,
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
      message: "Pi session ended while tool call was pending",
      threadId: args.threadId,
    }).catch((shutdownError: unknown) => {
      sendSessionScopedError(
        args.threadId,
        threadSession.providerThreadId,
        shutdownError instanceof Error
          ? shutdownError.message
          : String(shutdownError),
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
  args: CurrentThreadSessionArgs & { error: unknown },
): void {
  const threadSession = getCurrentThreadSession(args);
  if (!threadSession) return;
  emitSessionError(
    threadSession,
    args.threadId,
    args.error instanceof Error ? args.error.message : String(args.error),
  );
}

async function handleRequest(
  request: PiCommand & { id: string | number },
): Promise<void> {
  switch (request.method) {
    case "initialize": {
      const result: InitializeResult = {
        protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
        capabilities: {
          sessionRestore: true,
          threadArchive: false,
          threadRename: false,
          threadGoalClear: false,
          fork: "checkpoint",
          approvalEnforcedBy: "runtime",
          grammarVersions: [THREAD_DELTA_GRAMMAR_V3, THREAD_DELTA_GRAMMAR_V3],
          steerMode: "inject",
          skills: { configure: true },
          commands: { list: false },
          openWork: { list: true },
          sessionSettings: PI_SESSION_SETTINGS,
        },
      };
      sendResult(request.id, result);
      break;
    }
    case "model/list":
      await handleModelList(request.id, request.params);
      break;
    case "provider/health":
      await handleProviderHealth(request.id, request.params);
      break;
    case "provider/usage":
      sendResult(request.id, { supported: false });
      break;
    case "provider/installation/status":
      sendResult(
        request.id,
        await getPiProviderInstallationStatus(
          buildProviderCliEnv(request.params.envVars),
          request.params.checkUpdates,
        ),
      );
      break;
    case "provider/installation/run":
      sendResult(
        request.id,
        await getPiProviderInstallationRun(
          buildProviderCliEnv(request.params.envVars),
          request.params.action,
        ),
      );
      break;
    case "thread/start":
      await handleThreadConstruction(
        request.id,
        request.params.threadId,
        `pi_${randomUUID()}`,
        toPiSessionParams(request.params),
      );
      break;
    case "thread/resume": {
      await handleThreadConstruction(
        request.id,
        request.params.threadId,
        request.params.providerThreadId,
        toPiSessionParams(request.params),
      );
      break;
    }
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
      await handleThreadStop(request.id, request.params);
      break;
    case "thread/discard":
      sendResult(request.id, await handleThreadDiscard(request.params));
      break;
    case "skills/configure":
      configuredSkillPaths = request.params.roots.map((root) => root.path);
      sendResult(request.id, { ok: true });
      break;
    case BRIDGE_REQUEST_METHODS.threadOpenWork:
      sendResult(request.id, await listOpenWork(request.params.threadId));
      break;
  }
}

type ThreadForkParams = z.infer<typeof threadForkParamsSchema>;
type TurnStartParams = z.infer<typeof turnStartParamsSchema>;
type TurnSteerParams = z.infer<typeof turnSteerParamsSchema>;
type ThreadStopParams = z.infer<typeof threadStopParamsSchema>;
type ThreadRefParams = z.infer<typeof threadDiscardParamsSchema>;

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
  params: { cwd?: string; envVars?: Record<string, string> },
): Promise<void> {
  const gate = await getPiInstallGate(buildProviderCliEnv(params.envVars));
  if (!gate.ok) {
    sendError(
      id,
      gate.status === "not_installed"
        ? BRIDGE_JSON_RPC_ERRORS.MISSING_EXECUTABLE
        : -32000,
      gate.status === "not_installed"
        ? "Could not find the pi CLI on this host. Install @earendil-works/pi-coding-agent and retry."
        : (gate.statusMessage ?? "Pi is not supported on this host."),
    );
    return;
  }
  try {
    const catalog = await getPiCatalog(
      params.cwd ?? process.cwd(),
      requireExtensionPath(),
      params.envVars ?? {},
    );
    contextWindows.learn(await catalog.rawModels());
    sendResult(id, await catalog.listModels());
  } catch (error) {
    sendError(
      id,
      -32000,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function handleProviderHealth(
  id: string | number,
  params: { cwd?: string; envVars?: Record<string, string> },
): Promise<void> {
  const gate = await getPiInstallGate(buildProviderCliEnv(params.envVars));
  if (!gate.ok) {
    sendResult(id, gate.result);
    return;
  }
  const installedVersion = gate.installedVersion;
  try {
    const catalog = await getPiCatalog(
      params.cwd ?? process.cwd(),
      requireExtensionPath(),
      params.envVars ?? {},
    );
    await catalog.probe();
    const models = await catalog.rawModels();
    sendResult(
      id,
      models.length > 0
        ? piHealthResult("ready", { installedVersion })
        : piHealthResult("unauthenticated", {
            installedVersion,
            statusMessage: "Pi has no authenticated model provider available.",
          }),
    );
  } catch (error) {
    sendResult(
      id,
      piHealthResult("unknown", {
        installedVersion,
        statusMessage: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function buildSessionOptions(args: {
  params: PiSessionParams;
  providerThreadId: string;
  threadId: string;
  sessionSerial: number;
}): PiRpcSessionOptions {
  return {
    cwd: args.params.cwd,
    ...(args.params.model ? { model: args.params.model } : {}),
    sessionFilePath: resolvePiSessionFilePath({
      ...piSessionPaths(),
      threadId: args.providerThreadId,
    }),
    sessionDir: resolvePiBridgeSessionDir(piSessionPaths()),
    systemPrompt: args.params.baseInstructions,
    appendSystemPrompt: args.params.appendSystemPrompt,
    shellEnvOverrides: args.params.shellEnvOverrides,
    ...(args.params.additionalSkillPaths
      ? { additionalSkillPaths: [...args.params.additionalSkillPaths] }
      : {}),
    ...(args.params.thinkingLevel
      ? { thinkingLevel: args.params.thinkingLevel }
      : {}),
    ...(args.params.dynamicTools && args.params.dynamicTools.length > 0
      ? { dynamicTools: args.params.dynamicTools }
      : {}),
    scratchDir: requireScratchDir(),
    extensionPath: requireExtensionPath(),
    recordThreadId: args.threadId,
    onExtensionUiRequest: createOnExtensionUiRequest({
      sessionSerial: args.sessionSerial,
      threadId: args.threadId,
    }),
  };
}

async function constructPiThreadSession(
  threadId: string,
  providerThreadId: string,
  params: PiSessionParams,
): Promise<ThreadSession> {
  const sessionSerial = nextSessionSerial();
  const sessionOptions = buildSessionOptions({
    params,
    providerThreadId,
    threadId,
    sessionSerial,
  });
  const session = new PiRpcSession(
    sessionOptions,
    createForwardToolCall(() => threadId),
    createOnPiEvent({ sessionSerial, threadId }),
    createOnSessionDone({ sessionSerial, threadId }),
  );
  const threadSession: ThreadSession = {
    session,
    sessionSerial,
    closing: false,
    providerThreadId,
    cwd: params.cwd,
    construction: params,
  };
  sessions.set(threadId, threadSession);
  try {
    await session.start();
    const liveModel = session.getLiveModel();
    if (
      liveModel &&
      typeof liveModel.id === "string" &&
      typeof liveModel.provider === "string"
    ) {
      contextWindows.learn([
        {
          id: liveModel.id,
          provider: liveModel.provider,
          contextWindow: liveModel.contextWindow,
        },
      ]);
    }
    return threadSession;
  } catch (error) {
    if (sessions.get(threadId) === threadSession) {
      sessions.delete(threadId);
    }
    session.kill();
    throw error;
  }
}

function retireReplacedPiChild(replaced: ThreadSession): void {
  replaced.closing = true;
  resolvePendingToolCalls(
    replaced,
    "Pi thread session replaced while tool call was pending",
  );
  extensionUi.cancelPendingForScope(replaced);
  void replaced.session
    .closeGracefully(THREAD_STOP_CLOSE_TIMEOUT_MS)
    .catch(() => undefined);
}

async function rebuildThreadSession(
  threadId: string,
  previous: ThreadSession,
  params: PiSessionParams,
  providerThreadId: string,
): Promise<ThreadSession> {
  let replacement: ThreadSession;
  try {
    replacement = await constructPiThreadSession(
      threadId,
      providerThreadId,
      params,
    );
  } catch (error) {
    if (!sessions.has(threadId) && !previous.closing) {
      sessions.set(threadId, previous);
    }
    throw error;
  }
  retireReplacedPiChild(previous);
  return replacement;
}

function sendSessionResetBoundary(threadId: string): void {
  piDeltaTranslator.resetThread(threadId);
  sendThreadDeltas(threadId, [{ kind: "session.reset" }]);
}

function sendThreadSessionResult(
  id: string | number,
  threadId: string,
  providerThreadId: string,
): void {
  sendThreadIdentity(threadId, providerThreadId);
  sendSessionResetBoundary(threadId);
  sendResult(id, { providerThreadId, sessionRestorable: true });
}

async function handleThreadConstruction(
  id: string | number,
  threadId: string,
  providerThreadId: string,
  params: PiSessionParams,
): Promise<void> {
  const existing = sessions.get(threadId);
  if (existing) {
    await closeThreadSession({
      message: "Pi thread session replaced while tool call was pending",
      threadId,
    });
  }
  const sourceFile = resolvePiSessionFilePath({
    ...piSessionPaths(),
    threadId: providerThreadId,
  });
  const relocate = piSessionNeedsRelocation(sourceFile, params.cwd);
  const nextProviderThreadId = relocate
    ? `pi_${randomUUID()}`
    : providerThreadId;
  const targetFile = resolvePiSessionFilePath({
    ...piSessionPaths(),
    threadId: nextProviderThreadId,
  });
  try {
    if (relocate) {
      await PiRpcSession.forkSessionFile({
        sourceFile,
        targetFile,
        cwd: params.cwd,
        sessionDir: resolvePiBridgeSessionDir(piSessionPaths()),
        extensionPath: requireExtensionPath(),
        scratchDir: requireScratchDir(),
        recordThreadId: threadId,
      });
    }
    await constructPiThreadSession(threadId, nextProviderThreadId, params);
  } catch (error) {
    if (relocate) rmSync(targetFile, { force: true });
    throw error;
  }
  sendThreadSessionResult(id, threadId, nextProviderThreadId);
}

async function handleThreadFork(
  id: string | number,
  params: ThreadForkParams,
): Promise<void> {
  const sourceSessionFile = resolvePiSessionFilePath({
    ...piSessionPaths(),
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
    ...piSessionPaths(),
    threadId: params.threadId,
  });
  mkdirSync(resolvePiBridgeSessionDir(piSessionPaths()), {
    recursive: true,
  });
  try {
    await PiRpcSession.forkSessionFile({
      sourceFile: sourceSessionFile,
      targetFile: targetSessionFile,
      cwd: params.cwd,
      sessionDir: resolvePiBridgeSessionDir(piSessionPaths()),
      ...(params.sourceProviderCheckpointId === undefined
        ? {}
        : { checkpointId: params.sourceProviderCheckpointId }),
      extensionPath: requireExtensionPath(),
      scratchDir: requireScratchDir(),
      recordThreadId: params.threadId,
    });
  } catch (error) {
    rmSync(targetSessionFile, { force: true });
    sendError(
      id,
      -32000,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }
  await handleThreadConstruction(
    id,
    params.threadId,
    params.threadId,
    toPiSessionParams(params),
  );
}

function sendTurnInputResult(
  id: string | number,
  result: TurnInputResult,
): void {
  sendResult(id, result);
}

function recordAcceptedTurn(threadId: string, clientRequestId: string): void {
  sendThreadDeltas(threadId, [
    { kind: "input.accepted", clientRequestId },
    { kind: "turn.open" },
  ]);
}

async function applyLiveSettings(
  threadSession: ThreadSession,
  params: TurnStartParams,
): Promise<void> {
  const changed = new Set(params.apply.settings);
  const turnOptions = buildPiTurnOptions(params.options);
  if (changed.has("model") && turnOptions.model !== undefined) {
    const model = await threadSession.session.setModel(
      await threadSession.session.resolveModel(turnOptions.model),
    );
    if (
      model &&
      typeof model.id === "string" &&
      typeof model.provider === "string"
    ) {
      contextWindows.learn([
        {
          id: model.id,
          provider: model.provider,
          contextWindow: model.contextWindow,
        },
      ]);
    }
  }
  if (
    (changed.has("model") || changed.has("reasoningLevel")) &&
    turnOptions.thinkingLevel !== undefined
  ) {
    await threadSession.session.setThinkingLevel(turnOptions.thinkingLevel);
  }
}

async function startPiCompaction(
  id: string | number,
  threadSession: ThreadSession,
  params: TurnStartParams,
): Promise<void> {
  const start = await threadSession.session.startCompaction();
  if (start.admission === "busy") {
    sendTurnInputResult(id, { admission: "busy", message: start.message });
    return;
  }
  recordAcceptedTurn(params.threadId, params.clientRequestId);
  sendTurnInputResult(id, { admission: "accepted" });
  void start.compactionEndDelivered.then(
    (delivered) => {
      if (!delivered) {
        reportPromptSettled({
          sessionSerial: threadSession.sessionSerial,
          threadId: params.threadId,
        });
      }
    },
    (error: unknown) =>
      reportPromptSettled({
        error,
        sessionSerial: threadSession.sessionSerial,
        threadId: params.threadId,
      }),
  );
}

async function startPiPrompt(
  id: string | number,
  threadSession: ThreadSession,
  params: TurnStartParams,
): Promise<void> {
  const input = extractPiPromptInput(params.input);
  if (input === null) {
    sendError(id, BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS, "Missing input text");
    return;
  }
  const dispatch = threadSession.session.prompt(
    input.text,
    input.images.length > 0 ? input.images : undefined,
  );
  const admission = await dispatch.admitted;
  if (admission.admission === "busy") {
    sendTurnInputResult(id, { admission: "busy", message: admission.message });
    return;
  }
  recordAcceptedTurn(params.threadId, params.clientRequestId);
  sendTurnInputResult(id, { admission: "accepted" });
  void dispatch.settled.then((outcome) => {
    if (outcome === null || outcome.boundaryDelivered) {
      return;
    }
    reportPromptSettled({
      ...(outcome.error !== undefined ? { error: outcome.error } : {}),
      sessionSerial: threadSession.sessionSerial,
      threadId: params.threadId,
    });
  });
}

async function restoreExitedPiSession(
  threadId: string,
  threadSession: ThreadSession,
  options: TurnStartParams["options"],
): Promise<ThreadSession> {
  const turnOptions = buildPiTurnOptions(options);
  const rebuildParams: PiSessionParams = {
    ...threadSession.construction,
    ...(turnOptions.model === undefined ? {} : { model: turnOptions.model }),
    ...(turnOptions.thinkingLevel === undefined
      ? {}
      : { thinkingLevel: turnOptions.thinkingLevel }),
  };
  const sessionFileState = readPiSessionFileState(
    resolvePiSessionFilePath({
      ...piSessionPaths(),
      threadId: threadSession.providerThreadId,
    }),
  );
  const reason =
    sessionFileState === "missing"
      ? "pi's session file was missing, so the conversation continues without its earlier context."
      : sessionFileState === "invalid"
        ? "pi's session file is not a valid pi session, so the conversation continues in a new session without its earlier context."
        : "pi exited; the session was restored from its session file.";
  const replacement = await rebuildThreadSession(
    threadId,
    threadSession,
    rebuildParams,
    sessionFileState === "invalid"
      ? `pi_${randomUUID()}`
      : threadSession.providerThreadId,
  );
  sendThreadIdentity(threadId, replacement.providerThreadId);
  sendSessionResetBoundary(threadId);
  send({
    jsonrpc: "2.0",
    method: BRIDGE_NOTIFICATION_METHODS.sessionReplaced,
    params: {
      threadId,
      providerThreadId: replacement.providerThreadId,
      reason,
      contextLost: sessionFileState !== "valid",
    },
  });
  return replacement;
}

async function handleTurnStart(
  id: string | number,
  params: TurnStartParams,
): Promise<void> {
  const liveSession = sessions.get(params.threadId);
  if (!liveSession || liveSession.closing) {
    sendError(id, -32000, "No active pi session");
    return;
  }
  let threadSession: ThreadSession;
  try {
    threadSession = liveSession.session.hasExited()
      ? await restoreExitedPiSession(
          params.threadId,
          liveSession,
          params.options,
        )
      : liveSession;
  } catch (error) {
    sendError(
      id,
      -32000,
      error instanceof Error ? error.message : String(error),
    );
    return;
  }
  const busy = threadSession.session.inputBusyMessage();
  if (busy !== null) {
    sendTurnInputResult(id, { admission: "busy", message: busy });
    return;
  }
  try {
    await applyLiveSettings(threadSession, params);
    if (isStandaloneBuiltinCompactCommand(params.input)) {
      await startPiCompaction(id, threadSession, params);
      return;
    }
    await startPiPrompt(id, threadSession, params);
  } catch (error) {
    sendError(
      id,
      -32000,
      error instanceof Error ? error.message : String(error),
    );
  }
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
  const input = extractPiPromptInput(params.input);
  if (input === null) {
    sendError(id, BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS, "Missing input text");
    return;
  }
  if (threadSession.session.hasExited()) {
    rejectStaleSteer(id);
    return;
  }
  try {
    const admission = await threadSession.session.steer(
      input.text,
      input.images.length > 0 ? input.images : undefined,
    );
    if (admission.admission === "busy") {
      sendTurnInputResult(id, {
        admission: "busy",
        message: admission.message,
      });
      return;
    }
    sendThreadDeltas(params.threadId, [
      { kind: "input.accepted", clientRequestId: params.clientRequestId },
    ]);
    sendTurnInputResult(id, { admission: "accepted" });
  } catch (error) {
    if (threadSession.session.hasExited()) {
      rejectStaleSteer(id);
      return;
    }
    sendError(
      id,
      -32000,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function rejectStaleSteer(id: string | number): void {
  const message = "pi exited before it took the steer";
  sendError(id, BRIDGE_JSON_RPC_ERRORS.NO_ACTIVE_TURN, message, {
    recovery: { kind: "staleTurn", message, retryable: false },
  });
}

async function listOpenWork(threadId: string): Promise<ThreadOpenWorkResult> {
  const threadSession = sessions.get(threadId);
  if (!threadSession || threadSession.closing || !threadSession.session.alive) {
    return { items: [] };
  }
  const items: OpenWorkItem[] = extensionUi
    .pendingForScope(threadSession)
    .map((pending) => ({
      id: pending.interactionId,
      kind: "interaction",
      description: `Pi is waiting for an answer: ${pending.title}`,
    }));
  const state = await threadSession.session.getState();
  if (state.isStreaming) {
    items.push({
      id: "pi-agent-run",
      kind: "turn",
      description: "Pi is running an agent turn.",
    });
  }
  if (state.isCompacting) {
    items.push({
      id: "pi-compaction",
      kind: "turn",
      description: "Pi is compacting the context.",
    });
  }
  const queued = state.pendingMessageCount ?? 0;
  if (queued > 0) {
    items.push({
      id: "pi-queued-messages",
      kind: "turn",
      description: `Pi has ${String(queued)} queued message${queued === 1 ? "" : "s"} to run.`,
    });
  }
  return { items };
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
    sendThreadDeltas(params.threadId, [{ kind: "session.ended" }]);
  }
  const providerCheckpointId =
    (await closeThreadSession({
      message: "Pi thread stopped while tool call was pending",
      threadId: params.threadId,
    })) ?? null;
  sendResult(id, { ok: true, providerCheckpointId });
}

async function handleThreadDiscard(
  params: ThreadRefParams,
): Promise<{ ok: true }> {
  await closeThreadSession({
    message: "Pi staged thread discarded while tool call was pending",
    threadId: params.threadId,
  });
  rmSync(
    resolvePiSessionFilePath({
      ...piSessionPaths(),
      threadId: params.providerThreadId,
    }),
    {
      force: true,
    },
  );
  return { ok: true };
}

function handleParsedMessage(parsed: unknown): void {
  const response = decodeBridgeJsonRpcResponse(parsed);
  if (response) {
    if (extensionUi.handleRuntimeResponse(response)) {
      return;
    }
    if (handleToolCallResponse(response)) {
      return;
    }
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

/** @internal Test inspection: where this process writes its scratch files. */
export function experimental_scratchDirForTests(): string {
  return requireScratchDir();
}

/**
 * @internal Test cleanup: every pi child this process runs, and the private
 * scratch dir (a suite never runs the entry's `start`, so nothing else would
 * remove it).
 */
export async function experimental_closeAllForTests(): Promise<void> {
  await closeThreadSessionsGracefully("Pi bridge test teardown");
  await closeAllPiCatalogs();
  resetPiInstallGateForTests();
  if (scratchDir !== null && scratchDirIsPrivate) {
    rmSync(scratchDir, { recursive: true, force: true });
    scratchDir = null;
    scratchDirIsPrivate = false;
    extensionPath = null;
  }
}

function piSessionPaths(): {
  env: NodeJS.ProcessEnv;
  bridgeDataDir: string | undefined;
} {
  return { env: process.env, bridgeDataDir };
}

export const experimental_providerBridge = experimental_defineProviderBridge({
  handleLine,
  start: (context) => {
    bridgeDataDir = context.dataDir;
    scratchDir = join(context.tempDir, "pi");
    scratchDirIsPrivate = false;
    mkdirSync(scratchDir, { recursive: true });
  },
  onClose: () => {
    void closeThreadSessionsGracefully(
      "Pi bridge shutting down while tool call was pending",
    ).finally(() => {
      void closeAllPiCatalogs();
      process.exit(0);
    });
  },
  onSigterm: () => {
    void closeThreadSessionsGracefully(
      "Pi bridge terminated while tool call was pending",
    ).finally(() => {
      void closeAllPiCatalogs();
      process.exit(0);
    });
  },
});
