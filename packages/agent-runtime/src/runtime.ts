import { createHash } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  permissionModeRank,
  normalizeProviderThreadNameEvent,
  toProviderExternalThreadName,
} from "@bb/domain";
import type { DynamicTool, InstructionMode, ThreadEvent } from "@bb/domain";
import type { AdapterCommand } from "./provider-adapter.js";
import {
  BRIDGE_JSON_RPC_ERRORS,
  EMPTY_SESSION_SETTINGS_APPLY,
  PROVIDER_BRIDGE_PROTOCOL_V2,
  commandListResultSchema,
  mergeSessionSettingsDeclarations,
  threadOpenWorkResultSchema,
  type SessionSettingsApply,
  type SessionSettingsDeclaration,
  providerHealthResultSchema,
  providerInstallationRunResultSchema,
  providerInstallationStatusSchema,
  providerUsageResultSchema,
  ThreadEventGrammar,
  threadIdentityResultSchema,
} from "@bb/provider-bridge-protocol";
import {
  JsonRpcRequestTimeoutError,
  JsonRpcResponseError,
  PROVIDER_TOOL_CALL_CANCELLED_METHOD,
  providerToolCallCancellationSchema,
  getJsonRpcStringParam,
  ignoredJsonRpcResultSchema,
  parseJsonRpcLine,
  sendJsonRpcError,
  sendJsonRpcRequest,
  settleJsonRpcResponse,
} from "@bb/provider-bridge-protocol/bridge-kit";
import type {
  JsonRpcObject,
  ProviderCommandPlan,
  ProviderRequestCommandPlan,
  SendJsonRpcRequestArgs,
} from "@bb/provider-bridge-protocol/bridge-kit";
import {
  assertProviderSupportsExecutionOptions,
  toProviderExecutionContext,
} from "./execution-options.js";
import {
  handleRuntimeProviderRequest,
  RuntimeToolCalls,
  type ResolveRuntimeProviderRequestThreadIdArgs,
  type RuntimeProviderRequestKind,
} from "./runtime-provider-requests.js";
import {
  RuntimeProviderProcessManager,
  hasChildProcessExited,
  type RuntimeProviderProcess,
} from "./runtime-provider-process.js";
import {
  RuntimeThreadIdentityRegistry,
  stampThreadEventScope,
} from "./runtime-thread-identity.js";
import { RuntimeThreadGoalState } from "./runtime-thread-goal-state.js";
import { RuntimeBackgroundWorkState } from "./runtime-background-work-state.js";
import {
  RuntimeSessionStates,
  type RuntimeSessionPhase,
} from "./runtime-session-state.js";
import {
  composeSessionSettingsRecord,
  describeSessionSettingChanges,
  listUserSettingChanges,
  planSessionSettings,
  toSessionSettingsApply,
  type PlannedSessionSettingChange,
  type SessionSettingsRecord,
} from "./runtime-session-settings.js";
import type {
  AgentRuntimeContributedEnvEntry,
  AgentRuntime,
  AgentRuntimeProviderRecoveryHint,
  AgentRuntimeBridgeLaunch,
  AgentRuntimeExecutionOptions,
  AgentRuntimeOptions,
  AgentRuntimeSkillRoot,
  ReapedIdleProviderSession,
  RunTurnResult,
} from "./types.js";
import {
  resolveContributedEnvironment,
  resolveThreadEnvironment,
  type DroppedThreadEnvironmentContribution,
  type ResolvedThreadEnvironmentEntry,
} from "./thread-shell-environment.js";
import { bridgeLaunchProcessKey } from "./bridge-launch-process-key.js";

interface RestartThreadBridgeArgs {
  threadId: string;
}

interface RunThreadOperationArgs<TResult> {
  threadId: string;
  work: () => Promise<TResult>;
}

interface PreparedThreadRewind {
  state: "prepared";
  cleanupPromise: Promise<void> | null;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  processKey: string;
  providerId: string;
  providerState: RuntimeProviderProcess["identity"];
  providerThreadId: string;
  stagingThreadId: string;
  threadId: string;
}

interface PreparingThreadRewind {
  state: "preparing";
  promise: Promise<{ providerThreadId: string }>;
}

type StagedThreadRewind = PreparingThreadRewind | PreparedThreadRewind;

interface ReapIdleProviderSessionCandidate {
  idleSinceMs: number;
  providerThreadId: string;
  threadId: string;
  runtimeConfig: ThreadRuntimeConfig;
}

interface FindReapableIdleProviderSessionArgs {
  idleForMs: number;
  nowMs: number;
  threadId: string;
}

interface ResolveProviderProcessKeyArgs {
  bridgeLaunch: AgentRuntimeBridgeLaunch;
  skillRoots?: readonly AgentRuntimeSkillRoot[];
  providerId: string;
}

interface ArchiveOrUnarchiveThreadArgs {
  bridgeLaunch?: AgentRuntimeBridgeLaunch;
  commandType: "thread/archive" | "thread/unarchive";
  providerId: string;
  providerThreadId: string;
  threadId: string;
}

interface RequestRecoveryArgs {
  bridgeLaunch?: AgentRuntimeBridgeLaunch;
  providerId: string;
  providerThreadId: string;
  threadId: string;
}

export class AgentRuntimeRecoveryError extends Error {
  readonly code: "auth_required" | "rate_limited";
  readonly recovery: AgentRuntimeProviderRecoveryHint;

  constructor(args: {
    code: "auth_required" | "rate_limited";
    message: string;
    recovery: AgentRuntimeProviderRecoveryHint;
    cause: unknown;
  }) {
    super(args.message, { cause: args.cause });
    this.name = "AgentRuntimeRecoveryError";
    this.code = args.code;
    this.recovery = args.recovery;
  }
}

const DEFAULT_RATE_LIMITED_RETRY_DELAYS_MS = [2_000, 8_000] as const;

interface ResolveProviderRequestThreadIdArgs extends ResolveRuntimeProviderRequestThreadIdArgs {
  proc: ProviderProcess;
}

interface ResolveThreadStoragePathArgs {
  options: AgentRuntimeOptions;
  threadId: string;
}

const providerThreadStopResultSchema = z
  .object({
    providerCheckpointId: z.string().min(1).nullable().optional(),
  })
  .passthrough();

function defaultBridgeNodeEnv(): Record<string, string> | undefined {
  if (process.versions.electron === undefined) {
    return undefined;
  }
  return { ELECTRON_RUN_AS_NODE: "1" };
}

type ProviderProcess = RuntimeProviderProcess;

const threadGoalClearResultSchema = z.object({ cleared: z.boolean() }).strict();
const THREAD_GOAL_CLEAR_EVENT_TIMEOUT_MS = 5_000;
const PREPARED_THREAD_REWIND_TTL_MS = 5 * 60_000;
const PREPARED_THREAD_REWIND_RETRY_MS = 30_000;

interface ThreadRuntimeConfig {
  bridgeLaunch: AgentRuntimeBridgeLaunch;
  skillRoots: readonly AgentRuntimeSkillRoot[];
  contributedEnv: readonly AgentRuntimeContributedEnvEntry[];
  dynamicTools?: DynamicTool[];
  environmentId: string;
  instructionMode: InstructionMode;
  instructions?: string;
  envVars: Record<string, string>;
  options: AgentRuntimeExecutionOptions;
  requestedOptions: AgentRuntimeExecutionOptions;
  processKey: string;
  projectId?: string;
  providerId: string;
  sessionRestorable: boolean;
  sessionSettings: SessionSettingsDeclaration | undefined;
  pendingSettingsNote: string | null;
  openWorkProbeFailures: number;
}

interface OpenWorkAssessment {
  blockers: string[];
  probeFailed: boolean;
}

const OPEN_WORK_PROBE_FAILURES_BEFORE_STOP_NOTE = 3;

const OPEN_WORK_PROBE_TIMEOUT_MS = 5_000;

interface RuntimeParsedMessageArgs {
  parsed: JsonRpcObject;
  proc: ProviderProcess;
}

interface EmitTranslatedEventsArgs {
  events: ThreadEvent[];
  proc: ProviderProcess;
  sourceThreadId?: string;
}

interface RequireProviderRequestPlanArgs {
  commandType: AdapterCommand["type"];
  plan: ProviderCommandPlan;
  providerId: string;
}

const DEFAULT_THREAD_CREATION_REQUEST_TIMEOUT_MS = 2 * 60_000;
const FAILED_CONSTRUCTION_RELEASE_TIMEOUT_MS = 5_000;

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolveThreadStoragePath(
  args: ResolveThreadStoragePathArgs,
): string | undefined {
  const rootPath = args.options.threadStorageRootPath;
  if (!rootPath) {
    return undefined;
  }
  return path.join(rootPath, args.threadId);
}

export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
  const additionalWorkspaceWriteRoots =
    options.additionalWorkspaceWriteRoots ?? [];
  const skillRoots = options.skillRoots ?? [];
  for (const skillRoot of skillRoots) {
    if (!path.isAbsolute(skillRoot.path)) {
      throw new Error(
        `Agent runtime skill root "${skillRoot.id}" must use an absolute path: ${skillRoot.path}`,
      );
    }
  }
  let nextRequestId = 1;
  const threadIdentityRegistry = new RuntimeThreadIdentityRegistry();
  const threadRuntimeConfigs = new Map<string, ThreadRuntimeConfig>();
  const rateLimitedRetryDelaysMs =
    options.rateLimitRetry?.delaysMs ?? DEFAULT_RATE_LIMITED_RETRY_DELAYS_MS;
  const threadCreationRequestTimeoutMs =
    options.threadCreation?.requestTimeoutMs ??
    DEFAULT_THREAD_CREATION_REQUEST_TIMEOUT_MS;
  const threadsAwaitingBridgeRestart = new Map<
    string,
    AgentRuntimeProviderRecoveryHint
  >();
  const threadsRetryingBridgeRestartOnIdle = new Set<string>();
  const sessions = new RuntimeSessionStates();
  const turnStartWatchdogThresholdMs =
    options.turnStartWatchdog?.thresholdMs ?? 120_000;
  const turnStartWatchdogTimer = setInterval(() => {
    for (const { threadId } of sessions.takeOverdueTurnStarts(
      turnStartWatchdogThresholdMs,
    )) {
      options.onEvent({
        type: "system/error",
        threadId,
        scope: { kind: "thread" },
        code: "provider_turn_start_timeout",
        message: `The provider accepted a turn but did not start it within ${Math.round(turnStartWatchdogThresholdMs / 1000)}s. The request may be stalled; stopping the thread interrupts it.`,
      });
    }
  }, options.turnStartWatchdog?.intervalMs ?? 15_000);
  turnStartWatchdogTimer.unref?.();
  const threadOperationCounts = new Map<string, number>();
  const stagedThreadRewinds = new Map<string, StagedThreadRewind>();
  const suppressedThreadEventIds = new Set<string>();
  const threadGoalState = new RuntimeThreadGoalState();
  const toolCalls = new RuntimeToolCalls();
  const backgroundWorkState = new RuntimeBackgroundWorkState();
  const threadEventGrammar = new ThreadEventGrammar();
  const bridgeNodeEnv = defaultBridgeNodeEnv();

  const providerProcesses = new RuntimeProviderProcessManager({
    additionalWorkspaceWriteRoots,
    bridgeBundleDir: options.bridgeBundleDir,
    ...(bridgeNodeEnv !== undefined ? { bridgeNodeEnv } : {}),
    bridgeNodeExecutablePath: process.execPath,
    captureThreadExitState: (threadId) => ({
      activeTurnId: sessions.getActiveTurnId(threadId),
      pendingTurnStart: sessions.hasTurnStart(threadId),
      providerThreadId:
        threadIdentityRegistry.getProviderThreadId(threadId) ?? null,
      threadId,
    }),
    createProviderIdentityState: (providerId) =>
      threadIdentityRegistry.createProviderState({ providerId }),
    getEnv: () => options.getProcessEnv?.(),
    getNextRequestId: () => nextRequestId++,
    handleDeferredEvents: (args) => {
      if (suppressedThreadEventIds.has(args.sourceThreadId)) {
        return;
      }
      emitTranslatedEvents({
        events: args.events,
        proc: args.providerProcess,
        sourceThreadId: args.sourceThreadId,
      });
    },
    handleStdoutLine: (args) =>
      handleStdoutLine(args.line, args.providerProcess),
    onProcessExit: options.onProcessExit,
    onProviderThreadDetached: (threadId) => {
      toolCalls.cancelThread(threadId);
      threadIdentityRegistry.clearThread(threadId);
      clearThreadRuntimeConfig(threadId);
      sessions.forget(threadId);
      const settlements = backgroundWorkState.settleThread(threadId);
      if (!suppressedThreadEventIds.has(threadId)) {
        for (const event of settlements) {
          options.onEvent(event);
        }
      }
      threadEventGrammar.clearThread(threadId);
    },
    onStderr: options.onStderr,
    skillRoots,
    workspacePath: options.workspacePath,
  });

  function resolveProviderProcessKey(
    args: ResolveProviderProcessKeyArgs,
  ): string {
    const roots = args.skillRoots ?? skillRoots;
    for (const root of roots) {
      if (!path.isAbsolute(root.path)) {
        throw new Error(
          `Agent runtime skill root "${root.id}" must use an absolute path: ${root.path}`,
        );
      }
    }
    const catalogKey =
      roots.length === 0
        ? ""
        : `#skills:${createHash("sha256").update(JSON.stringify(roots)).digest("hex")}`;
    return `${args.providerId}#bridge:${bridgeLaunchProcessKey(args.bridgeLaunch)}${catalogKey}`;
  }

  function requireProviderProcessForThread(threadId: string): ProviderProcess {
    const providerId =
      threadIdentityRegistry.resolveProviderForThread(threadId);
    const config = threadRuntimeConfigs.get(threadId);
    if (config === undefined) {
      throw new Error(
        `Thread "${threadId}" has no live provider session on "${providerId}"`,
      );
    }
    return providerProcesses.requireProviderProcess({
      processKey: config.processKey,
      providerId,
    });
  }

  async function releaseThreadOnBridgeBestEffort(args: {
    proc: ProviderProcess;
    threadId: string;
  }): Promise<void> {
    if (hasChildProcessExited(args.proc.child)) {
      return;
    }
    const providerThreadId =
      threadIdentityRegistry.getProviderThreadId(args.threadId) ??
      args.threadId;
    const plan = args.proc.adapter.buildCommandPlan({
      type: "thread/stop",
      threadId: args.threadId,
      providerThreadId,
      activeTurnId: null,
    });
    if (plan.kind !== "request") {
      return;
    }
    try {
      await sendCommand({
        proc: args.proc,
        message: plan,
        resultSchema: ignoredJsonRpcResultSchema,
        timeoutMs: FAILED_CONSTRUCTION_RELEASE_TIMEOUT_MS,
      });
    } catch (error) {
      options.onStderr?.(
        `Best-effort release of thread "${args.threadId}" after a failed session construction did not complete: ${error instanceof Error ? error.message : String(error)}`,
        args.threadId,
      );
    }
  }

  async function releaseIdleProviderProcess(
    proc: ProviderProcess,
  ): Promise<void> {
    if (proc.identity.threadIds.size > 0) {
      return;
    }
    await providerProcesses.shutdownProvider({
      processKey: proc.processKey,
      providerId: proc.providerId,
    });
  }

  async function abandonFailedSessionConstruction(args: {
    proc: ProviderProcess;
    threadId: string;
  }): Promise<void> {
    await releaseThreadOnBridgeBestEffort(args);
    forgetThreadRuntimeStateForProviderState(args.proc.identity, args.threadId);
    try {
      await releaseIdleProviderProcess(args.proc);
    } catch (shutdownError) {
      options.onStderr?.(
        `Failed to retire the provider after thread "${args.threadId}" session construction failed: ${shutdownError instanceof Error ? shutdownError.message : String(shutdownError)}`,
      );
    }
  }

  async function sendCommand<TResult>(args: {
    proc: ProviderProcess;
    message: SendJsonRpcRequestArgs<TResult>["message"];
    resultSchema: SendJsonRpcRequestArgs<TResult>["resultSchema"];
    timeoutMs?: number;
    afterTimeout?: SendJsonRpcRequestArgs<TResult>["afterTimeout"];
    recovery?: RequestRecoveryArgs;
  }): Promise<TResult> {
    return sendRequestWithRecovery({
      allowUnarchive: true,
      proc: args.proc,
      recovery: args.recovery,
      request: {
        child: args.proc.child,
        getNextId: () => nextRequestId++,
        message: args.message,
        pending: args.proc.pending,
        resultSchema: args.resultSchema,
        ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
        ...(args.afterTimeout !== undefined
          ? { afterTimeout: args.afterTimeout }
          : {}),
      },
    });
  }

  interface RequestRecoveryPolicy<TResult> {
    allowUnarchive: boolean;
    proc: ProviderProcess;
    recovery: RequestRecoveryArgs | undefined;
    request: SendJsonRpcRequestArgs<TResult>;
  }

  async function sendRequestWithRecovery<TResult>(
    args: RequestRecoveryPolicy<TResult>,
  ): Promise<TResult> {
    try {
      return await sendJsonRpcRequest({
        ...args.request,
        child: args.proc.child,
        pending: args.proc.pending,
      });
    } catch (error) {
      const hint = rejectionHint(error, {
        providerId: args.proc.providerId,
        ...(args.recovery === undefined
          ? {}
          : { threadId: args.recovery.threadId }),
      });
      if (hint === null) {
        throw error;
      }
      return await actOnRejection({ ...args, error, hint });
    }
  }

  async function actOnRejection<TResult>(
    args: RequestRecoveryPolicy<TResult> & {
      error: unknown;
      hint: AgentRuntimeProviderRecoveryHint;
    },
  ): Promise<TResult> {
    const { error, hint, recovery } = args;
    switch (hint.kind) {
      case "sessionArchived":
        if (recovery !== undefined && hint.retryable && args.allowUnarchive) {
          return await unarchiveAndRetryRequest({
            error,
            proc: args.proc,
            recovery,
            request: args.request,
          });
        }
        throw error;
      case "rateLimited":
        if (recovery !== undefined && hint.retryable) {
          return await retryRateLimitedRequest({
            allowUnarchive: args.allowUnarchive,
            error,
            hint,
            proc: args.proc,
            recovery,
            request: args.request,
          });
        }
        handleRecoveryHint({ hint, proc: args.proc, source: "rejection" });
        throw toRecoveryError({ cause: error, code: "rate_limited", hint });
      case "authRequired":
        handleRecoveryHint({ hint, proc: args.proc, source: "rejection" });
        throw toRecoveryError({ cause: error, code: "auth_required", hint });
      case "restartRecommended":
        handleRecoveryHint({ hint, proc: args.proc, source: "rejection" });
        throw error;
      case "staleTurn":
        throw error;
    }
  }

  function rejectionHint(
    error: unknown,
    scope: { providerId: string; threadId?: string },
  ): AgentRuntimeProviderRecoveryHint | null {
    if (!(error instanceof JsonRpcResponseError) || error.recovery === null) {
      return null;
    }
    return { ...scope, ...error.recovery };
  }

  function toRecoveryError(args: {
    cause: unknown;
    code: AgentRuntimeRecoveryError["code"];
    hint: AgentRuntimeProviderRecoveryHint;
  }): AgentRuntimeRecoveryError {
    return new AgentRuntimeRecoveryError({
      cause: args.cause,
      code: args.code,
      message: args.hint.message,
      recovery: args.hint,
    });
  }

  interface RetryableRequestArgs<TResult> {
    error: unknown;
    proc: ProviderProcess;
    recovery: RequestRecoveryArgs;
    request: SendJsonRpcRequestArgs<TResult>;
  }

  async function unarchiveAndRetryRequest<TResult>(
    args: RetryableRequestArgs<TResult>,
  ): Promise<TResult> {
    const { error, recovery } = args;
    options.onStderr?.(
      `Session "${recovery.providerThreadId}" is archived; unarchiving before retrying thread "${recovery.threadId}".`,
    );
    let retryProc: ProviderProcess;
    try {
      await archiveOrUnarchiveThread({
        commandType: "thread/unarchive",
        ...recovery,
      });
      retryProc = providerProcesses.requireProviderProcess({
        processKey: args.proc.processKey,
        providerId: args.proc.providerId,
      });
    } catch (recoveryError) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message, { cause: recoveryError });
    }

    return sendRequestWithRecovery({
      allowUnarchive: false,
      proc: retryProc,
      recovery,
      request: args.request,
    });
  }

  async function retryRateLimitedRequest<TResult>(
    args: RetryableRequestArgs<TResult> & {
      allowUnarchive: boolean;
      hint: AgentRuntimeProviderRecoveryHint;
    },
  ): Promise<TResult> {
    let lastError = args.error;
    let lastHint = args.hint;
    for (const retryDelayMs of rateLimitedRetryDelaysMs) {
      options.onStderr?.(
        `Provider "${args.recovery.providerId}" is rate limited; retrying thread "${args.recovery.threadId}" in ${retryDelayMs}ms.`,
      );
      await delay(retryDelayMs);
      const proc = providerProcesses.requireProviderProcess({
        processKey: args.proc.processKey,
        providerId: args.proc.providerId,
      });
      try {
        return await sendJsonRpcRequest({
          ...args.request,
          child: proc.child,
          pending: proc.pending,
        });
      } catch (retryError) {
        const nextHint = rejectionHint(retryError, {
          providerId: args.recovery.providerId,
          threadId: args.recovery.threadId,
        });
        if (nextHint === null) {
          throw retryError;
        }
        if (!(nextHint.kind === "rateLimited" && nextHint.retryable)) {
          return await actOnRejection({
            allowUnarchive: args.allowUnarchive,
            error: retryError,
            hint: nextHint,
            proc,
            recovery: args.recovery,
            request: args.request,
          });
        }
        lastError = retryError;
        lastHint = nextHint;
      }
    }
    handleRecoveryHint({
      hint: lastHint,
      proc: args.proc,
      source: "rejection",
    });
    throw toRecoveryError({
      cause: lastError,
      code: "rate_limited",
      hint: lastHint,
    });
  }

  function resolveBbThreadIdForProcess(
    proc: ProviderProcess,
    providerThreadId: string | undefined,
  ): string | undefined {
    return threadIdentityRegistry.resolveBbThreadIdForProviderThread({
      providerState: proc.identity,
      providerThreadId,
    });
  }

  function formatProviderRequestKindForSentence(
    requestKind: RuntimeProviderRequestKind,
  ): string {
    return requestKind === "tool call" ? "Tool call" : "Interactive request";
  }

  function resolveProviderRequestThreadId(
    args: ResolveProviderRequestThreadIdArgs,
  ): string | null {
    const resolvedThreadId = resolveBbThreadIdForProcess(
      args.proc,
      args.providerThreadId,
    );
    if (!resolvedThreadId) {
      sendJsonRpcError({
        child: args.proc.child,
        id: args.parsedId,
        message: `Unable to resolve BB thread id for ${args.requestKind} on provider thread "${args.providerThreadId}"`,
      });
      return null;
    }
    if (args.threadIdHint && args.threadIdHint !== resolvedThreadId) {
      sendJsonRpcError({
        child: args.proc.child,
        id: args.parsedId,
        message: `${formatProviderRequestKindForSentence(args.requestKind)} thread hint "${args.threadIdHint}" did not match resolved BB thread "${resolvedThreadId}" for provider thread "${args.providerThreadId}"`,
      });
      return null;
    }

    return resolvedThreadId;
  }

  function requireProviderRequestPlan(
    args: RequireProviderRequestPlanArgs,
  ): ProviderRequestCommandPlan {
    if (args.plan.kind === "request") {
      return args.plan;
    }
    throw new Error(
      `Adapter "${args.providerId}" returned no provider request for ${args.commandType}: ${args.plan.reason}`,
    );
  }

  function setThreadRuntimeConfig(
    threadId: string,
    config: ThreadRuntimeConfig,
  ): void {
    threadRuntimeConfigs.set(threadId, config);
  }

  function updateSessionCapabilities(
    threadId: string,
    result: {
      sessionRestorable?: boolean | undefined;
      sessionSettings?: SessionSettingsDeclaration | undefined;
    },
  ): void {
    const current = threadRuntimeConfigs.get(threadId);
    if (!current) {
      return;
    }
    const proc = providerProcesses.requireProviderProcess({
      processKey: current.processKey,
      providerId: current.providerId,
    });
    threadRuntimeConfigs.set(threadId, {
      ...current,
      sessionRestorable:
        result.sessionRestorable ?? proc.adapter.sessionRestore,
      sessionSettings: result.sessionSettings,
    });
  }

  function clearThreadRuntimeConfig(threadId: string): void {
    threadsAwaitingBridgeRestart.delete(threadId);
    threadsRetryingBridgeRestartOnIdle.delete(threadId);
    threadGoalState.clearThread(threadId);
    threadRuntimeConfigs.delete(threadId);
  }

  function beginThreadOperation(threadId: string): void {
    threadOperationCounts.set(
      threadId,
      (threadOperationCounts.get(threadId) ?? 0) + 1,
    );
  }

  function finishThreadOperation(threadId: string): void {
    const current = threadOperationCounts.get(threadId);
    if (current === undefined || current <= 1) {
      threadOperationCounts.delete(threadId);
      sessions.resolveWaitersWithoutTurn(threadId);
      retryBridgeRestartOnIdle(threadId);
      return;
    }
    threadOperationCounts.set(threadId, current - 1);
  }

  function retryBridgeRestartOnIdle(threadId: string): void {
    if (!threadsRetryingBridgeRestartOnIdle.has(threadId)) {
      return;
    }
    queueMicrotask(() => {
      const hint = threadsAwaitingBridgeRestart.get(threadId);
      if (hint === undefined) {
        threadsRetryingBridgeRestartOnIdle.delete(threadId);
        return;
      }
      if (threadHasInFlightOperation(threadId) || !sessions.isIdle(threadId)) {
        return;
      }
      threadsRetryingBridgeRestartOnIdle.delete(threadId);
      scheduleBridgeRestart({ hint, threadId, retryOnIdle: true });
    });
  }

  function threadHasInFlightOperation(threadId: string): boolean {
    return threadOperationCounts.has(threadId);
  }

  async function runThreadOperation<TResult>(
    args: RunThreadOperationArgs<TResult>,
  ): Promise<TResult> {
    beginThreadOperation(args.threadId);
    try {
      return await args.work();
    } finally {
      finishThreadOperation(args.threadId);
    }
  }

  function recordProviderThreadIdentity(
    proc: ProviderProcess,
    threadId: string,
    providerThreadId: string,
  ): void {
    threadIdentityRegistry.recordProviderThreadIdentity({
      providerState: proc.identity,
      threadId,
      providerThreadId,
    });
  }

  function forgetThreadRuntimeStateForProviderState(
    providerState: RuntimeProviderProcess["identity"],
    threadId: string,
  ): void {
    threadIdentityRegistry.forgetThread({
      providerState,
      threadId,
    });
    clearThreadRuntimeConfig(threadId);
    sessions.forget(threadId);
    backgroundWorkState.clearThread(threadId);
    threadEventGrammar.clearThread(threadId);
  }

  function describeBusyPhase(phase: RuntimeSessionPhase): string | null {
    switch (phase.phase) {
      case "idle":
      case "dead":
        return null;
      case "starting":
        return "the provider session is starting";
      case "turnStarting":
      case "turnRunning":
        return "a turn is running";
      case "compacting":
        return "the agent is compacting context";
      case "waitingOnUser":
        return "the agent is waiting on the user";
      case "stopping":
        return "the provider session is stopping";
    }
  }

  async function probeBridgeOpenWork(
    threadId: string,
  ): Promise<OpenWorkAssessment> {
    const config = threadRuntimeConfigs.get(threadId);
    const providerThreadId =
      threadIdentityRegistry.getProviderThreadId(threadId);
    if (config === undefined || providerThreadId === undefined) {
      return { blockers: [], probeFailed: false };
    }
    let proc: ProviderProcess;
    try {
      proc = providerProcesses.requireProviderProcess({
        processKey: config.processKey,
        providerId: config.providerId,
      });
    } catch {
      return { blockers: [], probeFailed: false };
    }
    const plan = proc.adapter.buildCommandPlan({
      type: "thread/openWork",
      threadId,
      providerThreadId,
    });
    if (plan.kind === "noop") {
      return { blockers: [], probeFailed: false };
    }
    try {
      const result = await sendCommand({
        proc,
        message: plan,
        resultSchema: threadOpenWorkResultSchema,
        timeoutMs: OPEN_WORK_PROBE_TIMEOUT_MS,
      });
      return {
        blockers: result.items.map((item) =>
          item.description.trim().length > 0
            ? item.description
            : `${item.kind} ${item.id}`,
        ),
        probeFailed: false,
      };
    } catch (error) {
      options.onStderr?.(
        `The open-work check for thread "${threadId}" failed: ${error instanceof Error ? error.message : String(error)}`,
        threadId,
      );
      return {
        blockers: ["the provider could not report its open work"],
        probeFailed: true,
      };
    }
  }

  async function assessThreadOpenWork(
    threadId: string,
  ): Promise<OpenWorkAssessment> {
    const blockers: string[] = [];
    const busyPhase = describeBusyPhase(sessions.phase(threadId));
    if (busyPhase !== null) {
      blockers.push(busyPhase);
    }
    if (backgroundWorkState.hasOpenThreadWork(threadId)) {
      blockers.push("background work is running");
    }
    if (toolCalls.hasThread(threadId)) {
      blockers.push("a plugin tool call is running");
    }
    if (blockers.length > 0) {
      return { blockers, probeFailed: false };
    }
    return probeBridgeOpenWork(threadId);
  }

  async function assessProcessOpenWork(args: {
    proc: ProviderProcess;
    excludeThreadId: string;
  }): Promise<{ threadId: string; blockers: string[] } | null> {
    for (const threadId of args.proc.identity.threadIds) {
      if (threadId === args.excludeThreadId) {
        continue;
      }
      if (threadHasInFlightOperation(threadId)) {
        return { threadId, blockers: ["a thread operation is in flight"] };
      }
      const assessment = await assessThreadOpenWork(threadId);
      if (assessment.blockers.length > 0) {
        return { threadId, blockers: assessment.blockers };
      }
    }
    return null;
  }

  function findReapableIdleProviderSession(
    args: FindReapableIdleProviderSessionArgs,
  ): ReapIdleProviderSessionCandidate | null {
    if (threadHasInFlightOperation(args.threadId)) {
      return null;
    }
    const phase = sessions.phase(args.threadId);
    if (phase.phase !== "idle") {
      return null;
    }

    const runtimeConfig = threadRuntimeConfigs.get(args.threadId);
    if (!runtimeConfig?.sessionRestorable) {
      return null;
    }

    const providerThreadId = threadIdentityRegistry.getProviderThreadId(
      args.threadId,
    );
    if (!providerThreadId) {
      return null;
    }

    if (args.nowMs - phase.sinceMs < args.idleForMs) {
      return null;
    }

    return {
      idleSinceMs: phase.sinceMs,
      providerThreadId,
      runtimeConfig,
      threadId: args.threadId,
    };
  }

  function requireProviderThreadId(threadId: string): string {
    const providerThreadId =
      threadIdentityRegistry.getProviderThreadId(threadId);
    if (!providerThreadId) {
      throw new Error(`No provider thread id available for ${threadId}`);
    }
    return providerThreadId;
  }

  function handleRecoveryHint(args: {
    hint: AgentRuntimeProviderRecoveryHint;
    proc: ProviderProcess;
    source: "rejection" | "unsolicited";
  }): void {
    const { hint } = args;
    options.onProviderRecovery?.(hint);
    if (hint.kind === "restartRecommended" && hint.threadId !== undefined) {
      scheduleBridgeRestart({
        hint,
        retryOnIdle: args.source === "unsolicited",
        threadId: hint.threadId,
      });
    }
  }

  function scheduleBridgeRestart(args: {
    hint: AgentRuntimeProviderRecoveryHint;
    retryOnIdle: boolean;
    threadId: string;
  }): void {
    if (!threadRuntimeConfigs.has(args.threadId)) {
      return;
    }
    threadsAwaitingBridgeRestart.set(args.threadId, args.hint);
    if (!sessions.isIdle(args.threadId)) {
      return;
    }
    if (threadHasInFlightOperation(args.threadId)) {
      if (args.retryOnIdle) {
        threadsRetryingBridgeRestartOnIdle.add(args.threadId);
      }
      return;
    }
    threadsRetryingBridgeRestartOnIdle.delete(args.threadId);
    void runThreadOperation({
      threadId: args.threadId,
      work: async () => {
        if (!threadRuntimeConfigs.has(args.threadId)) {
          threadsAwaitingBridgeRestart.delete(args.threadId);
          return;
        }
        await restartThreadBridgeIfRecommended({ threadId: args.threadId });
      },
    }).catch((error: unknown) => {
      options.onStderr?.(
        `Bridge restart for thread "${args.threadId}" failed: ${error instanceof Error ? error.message : String(error)}`,
        args.threadId,
      );
    });
  }

  async function restartThreadBridgeIfRecommended(
    args: RestartThreadBridgeArgs,
  ): Promise<void> {
    const hint = threadsAwaitingBridgeRestart.get(args.threadId);
    if (hint === undefined) {
      return;
    }
    const currentConfig = threadRuntimeConfigs.get(args.threadId);
    if (!currentConfig) {
      threadsAwaitingBridgeRestart.delete(args.threadId);
      return;
    }
    const proc = providerProcesses.requireProviderProcess({
      processKey: currentConfig.processKey,
      providerId: currentConfig.providerId,
    });
    const ownWork = await assessThreadOpenWork(args.threadId);
    const busy =
      ownWork.blockers.length > 0
        ? { threadId: args.threadId, blockers: ownWork.blockers }
        : await assessProcessOpenWork({
            proc,
            excludeThreadId: args.threadId,
          });
    if (busy !== null) {
      options.onStderr?.(
        `Deferring the "${currentConfig.providerId}" bridge restart recommended for thread "${args.threadId}": thread "${busy.threadId}" has open work (${busy.blockers.join("; ")}).`,
        args.threadId,
      );
      return;
    }
    threadsAwaitingBridgeRestart.delete(args.threadId);
    const providerThreadId = requireProviderThreadId(args.threadId);
    const hostedThreadIds = [...proc.identity.threadIds].filter(
      (threadId) => threadId !== args.threadId,
    );
    const hostedSessions = hostedThreadIds.flatMap((threadId) => {
      const config = threadRuntimeConfigs.get(threadId);
      const hostedProviderThreadId =
        threadIdentityRegistry.getProviderThreadId(threadId);
      return config !== undefined && hostedProviderThreadId !== undefined
        ? [{ config, providerThreadId: hostedProviderThreadId, threadId }]
        : [];
    });
    options.onStderr?.(
      `Restarting the "${currentConfig.providerId}" bridge for thread "${args.threadId}": ${hint.message}`,
      args.threadId,
    );
    await providerProcesses.shutdownProvider({
      processKey: proc.processKey,
      providerId: proc.providerId,
    });
    await resumeThreadFromRecord({
      config: currentConfig,
      contributedEnv: currentConfig.contributedEnv,
      record: settingsRecordOf(currentConfig),
      providerThreadId,
      threadId: args.threadId,
    });
    for (const hosted of hostedSessions) {
      if (
        threadIdentityRegistry.getProviderSession(hosted.threadId) !== null ||
        threadHasInFlightOperation(hosted.threadId)
      ) {
        continue;
      }
      try {
        await resumeThreadFromRecord({
          config: hosted.config,
          contributedEnv: hosted.config.contributedEnv,
          record: settingsRecordOf(hosted.config),
          providerThreadId: hosted.providerThreadId,
          threadId: hosted.threadId,
        });
      } catch (error) {
        options.onStderr?.(
          `Failed to resume thread "${hosted.threadId}" after the bridge restart: ${error instanceof Error ? error.message : String(error)}`,
          hosted.threadId,
        );
      }
    }
  }

  function settingsRecordOf(
    config: ThreadRuntimeConfig,
  ): SessionSettingsRecord {
    return {
      bridgeLaunch: config.bridgeLaunch,
      dynamicTools: config.dynamicTools,
      envVars: config.envVars,
      instructionMode: config.instructionMode,
      instructions: config.instructions,
      options: config.options,
      skillRoots: config.skillRoots,
    };
  }

  async function resumeThreadFromRecord(args: {
    config: ThreadRuntimeConfig;
    contributedEnv: readonly AgentRuntimeContributedEnvEntry[];
    record: SessionSettingsRecord;
    providerThreadId: string;
    threadId: string;
  }): Promise<void> {
    const { config, record } = args;
    await runtime.resumeThread({
      bridgeLaunch: record.bridgeLaunch,
      skillRoots: record.skillRoots,
      environmentId: config.environmentId,
      threadId: args.threadId,
      ...(config.projectId !== undefined
        ? { projectId: config.projectId }
        : {}),
      providerThreadId: args.providerThreadId,
      providerId: config.providerId,
      contributedEnv: args.contributedEnv,
      options: record.options,
      ...(record.instructions !== undefined
        ? { instructions: record.instructions }
        : {}),
      ...(record.dynamicTools !== undefined
        ? { dynamicTools: record.dynamicTools }
        : {}),
      instructionMode: record.instructionMode,
    });
  }

  async function releaseAndResumeThread(args: {
    config: ThreadRuntimeConfig;
    contributedEnv: readonly AgentRuntimeContributedEnvEntry[];
    record: SessionSettingsRecord;
    threadId: string;
  }): Promise<void> {
    const providerThreadId = requireProviderThreadId(args.threadId);
    const proc = requireProviderProcessForThread(args.threadId);
    const plan = proc.adapter.buildCommandPlan({
      type: "thread/stop",
      threadId: args.threadId,
      providerThreadId,
      activeTurnId: null,
    });
    sessions.markStopping(args.threadId);
    if (plan.kind === "request") {
      try {
        await sendCommand({
          proc,
          message: plan,
          resultSchema: providerThreadStopResultSchema,
        });
      } catch (error) {
        sessions.cancelStopping(args.threadId);
        throw error;
      }
    }
    forgetThreadRuntimeStateForProviderState(proc.identity, args.threadId);
    await resumeThreadFromRecord({
      config: args.config,
      contributedEnv: args.contributedEnv,
      record: args.record,
      providerThreadId,
      threadId: args.threadId,
    });
    await releaseIdleProviderProcess(proc);
  }

  function lowersPermissions(
    applied: AgentRuntimeExecutionOptions,
    requested: AgentRuntimeExecutionOptions,
  ): boolean {
    const appliedRank = permissionModeRank(applied.permissionMode);
    const requestedRank = permissionModeRank(requested.permissionMode);
    if (requestedRank !== appliedRank) {
      return requestedRank < appliedRank;
    }
    return (
      applied.permissionEscalation === "ask" &&
      requested.permissionEscalation === "deny"
    );
  }

  function emitSessionSettingsNote(args: {
    threadId: string;
    summary: string;
    details?: string;
  }): void {
    const providerThreadId = threadIdentityRegistry.getProviderThreadId(
      args.threadId,
    );
    if (providerThreadId === undefined) {
      return;
    }
    options.onEvent({
      type: "provider/warning",
      threadId: args.threadId,
      providerThreadId,
      category: "session-settings",
      summary: args.summary,
      ...(args.details === undefined ? {} : { details: args.details }),
      scope: { kind: "thread" },
    });
  }

  function notePendingSettings(args: {
    threadId: string;
    note: string | null;
  }): void {
    const config = threadRuntimeConfigs.get(args.threadId);
    if (config === undefined || config.pendingSettingsNote === args.note) {
      return;
    }
    setThreadRuntimeConfig(args.threadId, {
      ...config,
      pendingSettingsNote: args.note,
    });
    if (args.note !== null) {
      emitSessionSettingsNote({ threadId: args.threadId, summary: args.note });
    }
  }

  interface ProtocolV2SteerSettings {
    contributedEnv: readonly AgentRuntimeContributedEnvEntry[];
    environment: ReturnType<typeof resolveRuntimeThreadEnvironment>;
  }

  function resolveProtocolV2SteerSettings(args: {
    contributedEnv: readonly AgentRuntimeContributedEnvEntry[] | undefined;
    currentConfig: ThreadRuntimeConfig;
    threadId: string;
  }): ProtocolV2SteerSettings {
    const contributedEnv =
      args.contributedEnv ?? args.currentConfig.contributedEnv;
    return {
      contributedEnv,
      environment: resolveRuntimeThreadEnvironment({
        contributedEnv,
        environmentId: args.currentConfig.environmentId,
        projectId: args.currentConfig.projectId,
        threadId: args.threadId,
      }),
    };
  }

  function recordProtocolV2Steer(args: {
    currentConfig: ThreadRuntimeConfig;
    execOpts: AgentRuntimeExecutionOptions;
    providerThreadId: string;
    steer: ProtocolV2SteerSettings;
    threadId: string;
  }): void {
    const { environment } = args.steer;
    setThreadRuntimeConfig(args.threadId, {
      ...args.currentConfig,
      contributedEnv: args.steer.contributedEnv,
      envVars: environment.envVars,
      options: args.execOpts,
      requestedOptions: args.execOpts,
    });
    if (!isDeepStrictEqual(args.currentConfig.envVars, environment.envVars)) {
      emitResolvedProviderEnvironment({
        droppedContributions: environment.droppedContributions,
        entries: environment.entries,
        providerThreadId: args.providerThreadId,
        threadId: args.threadId,
      });
    }
  }

  interface ReconciledTurnSettings {
    apply: SessionSettingsApply;
    record: SessionSettingsRecord;
  }

  async function reconcileThreadSettings(args: {
    contributedEnv: readonly AgentRuntimeContributedEnvEntry[];
    desired: SessionSettingsRecord;
    threadId: string;
  }): Promise<ReconciledTurnSettings> {
    const config = threadRuntimeConfigs.get(args.threadId);
    if (config === undefined) {
      throw new Error(`No runtime configuration for thread ${args.threadId}`);
    }
    const proc = requireProviderProcessForThread(args.threadId);
    const applied = settingsRecordOf(config);
    const plan = planSessionSettings({
      applied,
      declaration: mergeSessionSettingsDeclarations(
        proc.adapter.sessionSettings,
        config.sessionSettings,
      ),
      desired: args.desired,
      sessionRestorable: config.sessionRestorable,
    });
    const pendingNotes: string[] = [];
    if (plan.fresh.length > 0) {
      pendingNotes.push(
        `Changed ${describeSessionSettingChanges(plan.fresh)} can't apply to this provider session; it takes effect when the session next starts.`,
      );
    }
    let resumed: PlannedSessionSettingChange[] = [];
    if (plan.resume.length > 0) {
      const { blockers, probeFailed } = await assessThreadOpenWork(
        args.threadId,
      );
      const probeFailures = probeFailed ? config.openWorkProbeFailures + 1 : 0;
      setThreadRuntimeConfig(args.threadId, {
        ...config,
        openWorkProbeFailures: probeFailures,
      });
      if (probeFailures >= OPEN_WORK_PROBE_FAILURES_BEFORE_STOP_NOTE) {
        pendingNotes.push(
          `Changed ${describeSessionSettingChanges(plan.resume)} needs a provider session restart, but bb can't confirm the agent has no running work: its open-work check failed ${OPEN_WORK_PROBE_FAILURES_BEFORE_STOP_NOTE} times in a row. bb won't restart the session without that, so stop the thread to apply the change now; stopping ends anything the agent may still be running.`,
        );
      } else if (blockers.length > 0) {
        pendingNotes.push(
          `Changed ${describeSessionSettingChanges(plan.resume)} needs a provider session restart, which waits while work is open (${blockers.join("; ")}); it applies at the first turn after that.`,
        );
      } else {
        resumed = plan.resume;
      }
    }
    if (resumed.length > 0) {
      const resumeRecord = composeSessionSettingsRecord({
        applied,
        desired: args.desired,
        taken: [...resumed, ...plan.live],
      });
      emitSessionSettingsNote({
        threadId: args.threadId,
        summary: `Restarting the provider session to apply ${describeSessionSettingChanges(resumed)}. Background processes the agent started that bb does not track may stop.`,
      });
      await releaseAndResumeThread({
        config,
        contributedEnv: args.contributedEnv,
        record: resumeRecord,
        threadId: args.threadId,
      });
      emitSessionSettingsNote({
        threadId: args.threadId,
        summary: `Applied ${describeSessionSettingChanges([...resumed, ...plan.live])}; the provider session resumed with its history.`,
      });
      notePendingSettings({
        threadId: args.threadId,
        note: pendingNotes.length > 0 ? pendingNotes.join(" ") : null,
      });
      return { apply: EMPTY_SESSION_SETTINGS_APPLY, record: resumeRecord };
    }
    notePendingSettings({
      threadId: args.threadId,
      note: pendingNotes.length > 0 ? pendingNotes.join(" ") : null,
    });
    return {
      apply: toSessionSettingsApply(plan.live),
      record: composeSessionSettingsRecord({
        applied,
        desired: args.desired,
        taken: plan.live,
      }),
    };
  }

  async function reconcileProtocolV2Settings(args: {
    contributedEnv: readonly AgentRuntimeContributedEnvEntry[];
    desired: SessionSettingsRecord;
    threadId: string;
  }): Promise<ReconciledTurnSettings> {
    const config = threadRuntimeConfigs.get(args.threadId);
    if (config === undefined) {
      throw new Error(`No runtime configuration for thread ${args.threadId}`);
    }
    const { resume } = planSessionSettings({
      applied: settingsRecordOf(config),
      declaration: {},
      desired: args.desired,
      sessionRestorable: config.sessionRestorable,
    });
    if (resume.length > 0) {
      emitSessionSettingsNote({
        threadId: args.threadId,
        summary: `Restarting the provider session to apply ${describeSessionSettingChanges(resume)}. Background processes the agent started that bb does not track may stop.`,
      });
      await releaseAndResumeThread({
        config,
        contributedEnv: args.contributedEnv,
        record: args.desired,
        threadId: args.threadId,
      });
      emitSessionSettingsNote({
        threadId: args.threadId,
        summary: `Applied ${describeSessionSettingChanges(resume)}; the provider session resumed with its history.`,
      });
    }
    return { apply: EMPTY_SESSION_SETTINGS_APPLY, record: args.desired };
  }

  async function archiveOrUnarchiveThread(
    args: ArchiveOrUnarchiveThreadArgs,
  ): Promise<void> {
    const { commandType, providerId, providerThreadId, threadId } = args;
    const threadConfig = threadRuntimeConfigs.get(threadId);
    const bridgeLaunch = args.bridgeLaunch ?? threadConfig?.bridgeLaunch;
    if (bridgeLaunch === undefined) {
      throw new Error(
        `Cannot ${commandType} thread "${threadId}" on "${providerId}": the thread has no live session and the request carried no bridge launch`,
      );
    }
    const processKey =
      threadConfig?.processKey ??
      resolveProviderProcessKey({ bridgeLaunch, providerId });
    await providerProcesses.ensureProvider({
      processKey,
      providerId,
      bridgeLaunch,
      skillRoots: threadConfig?.skillRoots,
    });
    const proc = providerProcesses.requireProviderProcess({
      processKey,
      providerId,
    });
    if (!proc.adapter.capabilities.supportsThreadArchive) {
      throw new Error(
        `Provider "${providerId}" does not support thread archive.`,
      );
    }

    const adapterCommand: AdapterCommand = {
      type: commandType,
      threadId,
      providerThreadId,
    };
    const cmd = requireProviderRequestPlan({
      commandType: adapterCommand.type,
      plan: proc.adapter.buildCommandPlan(adapterCommand),
      providerId,
    });
    await sendCommand({
      proc,
      message: cmd,
      resultSchema: ignoredJsonRpcResultSchema,
    });
    if (commandType === "thread/archive") {
      forgetThreadRuntimeStateForProviderState(proc.identity, threadId);
    }
    await releaseIdleProviderProcess(proc);
  }

  function emitResolvedProviderEnvironment(args: {
    droppedContributions: DroppedThreadEnvironmentContribution[];
    entries: ResolvedThreadEnvironmentEntry[];
    providerThreadId: string;
    threadId: string;
  }): void {
    options.onEvent({
      type: "provider.env-resolved",
      threadId: args.threadId,
      providerThreadId: args.providerThreadId,
      entries: args.entries,
      scope: { kind: "thread" },
    });
    for (const contribution of args.droppedContributions) {
      options.onEvent({
        type: "provider/warning",
        threadId: args.threadId,
        providerThreadId: args.providerThreadId,
        category: "config",
        summary: `Dropped environment variable "${contribution.name}" from plugin "${contribution.plugin}".`,
        details:
          "BB_SERVER_URL is unavailable, so its serverPath contribution was not applied.",
        scope: { kind: "thread" },
      });
    }
  }

  function resolveRuntimeThreadEnvironment(args: {
    contributedEnv: readonly AgentRuntimeContributedEnvEntry[];
    environmentId: string;
    projectId?: string;
    threadId: string;
  }): {
    droppedContributions: DroppedThreadEnvironmentContribution[];
    envVars: Record<string, string>;
    entries: ResolvedThreadEnvironmentEntry[];
  } {
    return resolveThreadEnvironment({
      baseShellEnv: options.getShellEnv?.(),
      contributedEnv: args.contributedEnv,
      environmentId: args.environmentId,
      projectId: args.projectId,
      threadStoragePath: resolveThreadStoragePath({
        options,
        threadId: args.threadId,
      }),
      threadId: args.threadId,
    });
  }

  function emitTranslatedEvents(args: EmitTranslatedEventsArgs): void {
    for (const event of args.events) {
      const scope = {
        eventThreadId: event.threadId,
        providerState: args.proc.identity,
        sourceThreadId: args.sourceThreadId,
      };
      const resolvedBbThreadId =
        event.type === "thread/identity"
          ? threadIdentityRegistry.resolveProviderIdentityThreadId(scope)
          : threadIdentityRegistry.resolveProviderEventThreadId(scope);

      if (!resolvedBbThreadId) {
        options.onStderr?.(
          `Dropping unscoped provider event ${event.type}; no bb thread could be resolved`,
        );
        continue;
      }
      const targetThreadId = resolvedBbThreadId;

      if (suppressedThreadEventIds.has(targetThreadId)) {
        continue;
      }
      if (event.type === "thread/identity" && event.providerThreadId) {
        recordProviderThreadIdentity(
          args.proc,
          targetThreadId,
          event.providerThreadId,
        );
      }
      const stampedEvent = stampThreadEventScope({
        event,
        providerThreadId:
          threadIdentityRegistry.getProviderThreadId(targetThreadId),
        threadId: targetThreadId,
      });

      const grammarResult = threadEventGrammar.observe(stampedEvent);
      if (grammarResult.kind === "violation") {
        options.onStderr?.(
          `Dropping ${stampedEvent.type} from provider "${args.proc.providerId}" in thread "${targetThreadId}" (${grammarResult.rule}): ${grammarResult.reason}.`,
        );
        continue;
      }

      const normalizedEvent = normalizeProviderThreadNameEvent(stampedEvent);
      if (
        normalizedEvent.type === "turn/completed" &&
        normalizedEvent.scope.kind === "turn"
      ) {
        toolCalls.cancelThread(targetThreadId, normalizedEvent.scope.turnId);
      }
      sessions.observe(normalizedEvent);
      backgroundWorkState.observe(normalizedEvent);
      options.onEvent(normalizedEvent);
      threadGoalState.observe(normalizedEvent);
    }
  }

  function handleProviderNotification(args: RuntimeParsedMessageArgs): void {
    if (args.parsed.method === PROVIDER_TOOL_CALL_CANCELLED_METHOD) {
      const cancellation = providerToolCallCancellationSchema.safeParse(
        args.parsed.params,
      );
      if (cancellation.success) {
        toolCalls.cancel(
          args.proc.interactiveRequestScope,
          cancellation.data.requestId,
        );
      }
      return;
    }
    const sourceThreadId = getJsonRpcStringParam(args.parsed, "threadId");
    if (
      sourceThreadId !== undefined &&
      suppressedThreadEventIds.has(sourceThreadId)
    ) {
      return;
    }
    const recoveryHint = args.proc.adapter.decodeRecoveryHint?.(args.parsed);
    if (recoveryHint !== null && recoveryHint !== undefined) {
      if (
        recoveryHint.threadId !== undefined &&
        !args.proc.identity.threadIds.has(recoveryHint.threadId)
      ) {
        options.onStderr?.(
          `Dropping provider/recovery ${recoveryHint.kind} from "${args.proc.providerId}": it names thread "${recoveryHint.threadId}", which that process does not host.`,
        );
        return;
      }
      handleRecoveryHint({
        hint: { providerId: args.proc.providerId, ...recoveryHint },
        proc: args.proc,
        source: "unsolicited",
      });
      return;
    }
    emitTranslatedEvents({
      events: args.proc.adapter.translateEvent(args.parsed),
      proc: args.proc,
      sourceThreadId,
    });
  }

  function handleStdoutLine(line: string, proc: ProviderProcess): void {
    const parsedLine = parseJsonRpcLine(line);
    if (
      parsedLine.kind === "non_json" ||
      parsedLine.kind === "invalid_json_rpc"
    ) {
      options.onStderr?.(line);
      return;
    }

    if (parsedLine.kind === "response") {
      settleJsonRpcResponse({
        id: parsedLine.parsedId,
        pending: proc.pending,
        response: parsedLine.parsed,
      });
      return;
    }

    if (parsedLine.kind === "request") {
      handleRuntimeProviderRequest({
        getActiveTurnId: (threadId) => sessions.getActiveTurnId(threadId),
        sessions,
        getThreadExecutionOptions: (threadId) =>
          threadRuntimeConfigs.get(threadId)?.options,
        onInteractiveRequest: options.onInteractiveRequest,
        onToolCall: options.onToolCall,
        toolCalls,
        parsedId: parsedLine.parsedId,
        parsedMethod: parsedLine.parsedMethod,
        providerProcess: proc,
        rawRequest: parsedLine.rawRequest,
        resolveThreadId: (request) =>
          resolveProviderRequestThreadId({
            ...request,
            proc,
          }),
      });
      return;
    }

    handleProviderNotification({
      parsed: parsedLine.parsed,
      proc,
    });
  }

  function schedulePreparedThreadRewindCleanup(
    leaseId: string,
    prepared: PreparedThreadRewind,
    delayMs: number,
  ): void {
    if (prepared.cleanupTimer !== null) {
      clearTimeout(prepared.cleanupTimer);
    }
    prepared.cleanupTimer = setTimeout(() => {
      void discardStagedThreadRewind(leaseId);
    }, delayMs);
    prepared.cleanupTimer.unref?.();
  }

  function finishPreparedThreadRewindCleanup(
    leaseId: string,
    prepared: PreparedThreadRewind,
  ): void {
    if (prepared.cleanupTimer !== null) {
      clearTimeout(prepared.cleanupTimer);
      prepared.cleanupTimer = null;
    }
    if (stagedThreadRewinds.get(leaseId) === prepared) {
      stagedThreadRewinds.delete(leaseId);
    }
    suppressedThreadEventIds.delete(prepared.stagingThreadId);
  }

  async function sendStagedThreadDiscard(
    proc: ProviderProcess,
    stagingThreadId: string,
    providerThreadId: string,
  ): Promise<void> {
    const command = proc.adapter.buildCommandPlan({
      type: "thread/discard",
      threadId: stagingThreadId,
      providerThreadId,
    });
    if (command.kind === "request") {
      await sendCommand({
        proc,
        message: command,
        resultSchema: ignoredJsonRpcResultSchema,
      });
    }
  }

  async function discardStagedThreadRewind(leaseId: string): Promise<void> {
    const staged = stagedThreadRewinds.get(leaseId);
    if (staged?.state === "preparing") {
      try {
        await staged.promise;
      } catch {
        return;
      }
    }
    const prepared = stagedThreadRewinds.get(leaseId);
    if (prepared === undefined || prepared.state !== "prepared") {
      return;
    }
    if (prepared.cleanupPromise !== null) {
      await prepared.cleanupPromise;
      return;
    }

    const cleanup = (async () => {
      let proc: ProviderProcess;
      try {
        proc = providerProcesses.requireProviderProcess({
          processKey: prepared.processKey,
          providerId: prepared.providerId,
        });
      } catch {
        forgetThreadRuntimeStateForProviderState(
          prepared.providerState,
          prepared.stagingThreadId,
        );
        finishPreparedThreadRewindCleanup(leaseId, prepared);
        return;
      }

      try {
        await sendStagedThreadDiscard(
          proc,
          prepared.stagingThreadId,
          prepared.providerThreadId,
        );
      } catch (error) {
        schedulePreparedThreadRewindCleanup(
          leaseId,
          prepared,
          PREPARED_THREAD_REWIND_RETRY_MS,
        );
        options.onStderr?.(
          `Failed to discard staged rewind ${leaseId}; retrying: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }

      forgetThreadRuntimeStateForProviderState(
        proc.identity,
        prepared.stagingThreadId,
      );
      finishPreparedThreadRewindCleanup(leaseId, prepared);
      try {
        await releaseIdleProviderProcess(proc);
      } catch (error) {
        options.onStderr?.(
          `Failed to stop the idle provider after discarding staged rewind ${leaseId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    })();
    prepared.cleanupPromise = cleanup;
    try {
      await cleanup;
    } finally {
      if (
        stagedThreadRewinds.get(leaseId) === prepared &&
        prepared.cleanupPromise === cleanup
      ) {
        prepared.cleanupPromise = null;
      }
    }
  }

  const runtime: AgentRuntime = {
    async ensureProvider({
      providerId,
      bridgeLaunch,
      skillRoots: sessionSkillRoots = skillRoots,
    }) {
      await providerProcesses.ensureProvider({
        processKey: resolveProviderProcessKey({
          bridgeLaunch,
          providerId,
          skillRoots: sessionSkillRoots,
        }),
        providerId,
        bridgeLaunch,
        skillRoots: sessionSkillRoots,
      });
    },

    async startThread({
      environmentId,
      threadId,
      projectId,
      providerId,
      bridgeLaunch,
      skillRoots: sessionSkillRoots = skillRoots,
      contributedEnv = [],
      clientRequestId,
      input,
      options: execOpts,
      instructions,
      dynamicTools,
      instructionMode = "append",
      fork,
    }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const processKey = resolveProviderProcessKey({
            bridgeLaunch,
            providerId,
            skillRoots: sessionSkillRoots,
          });
          await runtime.ensureProvider({
            providerId,
            bridgeLaunch,
            skillRoots: sessionSkillRoots,
          });

          const proc = providerProcesses.requireProviderProcess({
            processKey,
            providerId,
          });
          assertProviderSupportsExecutionOptions({
            adapter: proc.adapter,
            options: execOpts,
            providerId,
          });
          const resolvedEnvironment = resolveRuntimeThreadEnvironment({
            contributedEnv,
            environmentId,
            projectId,
            threadId,
          });
          threadIdentityRegistry.registerThreadProvider({
            providerId,
            providerState: proc.identity,
            threadId,
          });
          setThreadRuntimeConfig(threadId, {
            bridgeLaunch,
            skillRoots: sessionSkillRoots,
            contributedEnv,
            dynamicTools,
            environmentId,
            envVars: resolvedEnvironment.envVars,
            instructionMode,
            instructions,
            options: execOpts,
            requestedOptions: execOpts,
            processKey,
            projectId,
            providerId,
            sessionRestorable: false,
            sessionSettings: undefined,
            pendingSettingsNote: null,
            openWorkProbeFailures: 0,
          });
          sessions.beginConstruction(threadId);

          const providerExecutionContext = toProviderExecutionContext({
            envVars: resolvedEnvironment.envVars,
            execOpts,
            instructions,
          });
          const adapterCommand: AdapterCommand = fork
            ? {
                type: "thread/fork",
                threadId,
                cwd: options.workspacePath,
                sourceProviderThreadId: fork.sourceProviderThreadId,
                ...(fork.sourceProviderCheckpointId !== undefined
                  ? {
                      sourceProviderCheckpointId:
                        fork.sourceProviderCheckpointId,
                    }
                  : {}),
                options: providerExecutionContext,
                dynamicTools,
                instructionMode,
              }
            : {
                type: "thread/start",
                threadId,
                cwd: options.workspacePath,
                options: providerExecutionContext,
                dynamicTools,
                instructionMode,
              };
          let resolved: string;
          try {
            const cmd = requireProviderRequestPlan({
              commandType: adapterCommand.type,
              plan: proc.adapter.buildCommandPlan(adapterCommand),
              providerId,
            });
            const result = await sendCommand({
              proc,
              message: cmd,
              resultSchema: threadIdentityResultSchema,
              timeoutMs: threadCreationRequestTimeoutMs,
              ...(fork
                ? {
                    recovery: {
                      providerId,
                      providerThreadId: fork.sourceProviderThreadId,
                      threadId,
                    },
                  }
                : {}),
            });
            updateSessionCapabilities(threadId, result);
            recordProviderThreadIdentity(
              proc,
              threadId,
              result.providerThreadId,
            );
            resolved = result.providerThreadId;
            emitResolvedProviderEnvironment({
              droppedContributions: resolvedEnvironment.droppedContributions,
              entries: resolvedEnvironment.entries,
              providerThreadId: resolved,
              threadId,
            });
          } catch (startError) {
            await abandonFailedSessionConstruction({ proc, threadId });
            throw startError;
          }

          sessions.markLive(threadId);
          if (input && input.length > 0) {
            if (clientRequestId === undefined) {
              throw new Error(
                `Thread start with input requires a client request id for ${threadId}`,
              );
            }
            const firstTurn = await runtime.runTurn({
              threadId,
              input,
              clientRequestId,
              options: execOpts,
              contributedEnv,
              instructions,
            });
            if (
              firstTurn.status === "busy" ||
              firstTurn.status === "rejected"
            ) {
              throw new Error(
                `The provider did not take the first message: ${firstTurn.message}`,
              );
            }
          }

          return { providerThreadId: resolved };
        },
      });
    },

    async prepareThreadRewind({
      environmentId,
      threadId,
      leaseId,
      projectId,
      providerId,
      contributedEnv = [],
      sourceProviderThreadId,
      retainThroughProviderCheckpoint,
      bridgeLaunch,
      skillRoots: sessionSkillRoots = skillRoots,
      options: execOpts,
      instructions,
      dynamicTools,
      instructionMode = "append",
    }) {
      const existing = stagedThreadRewinds.get(leaseId);
      if (existing !== undefined) {
        return existing.state === "preparing"
          ? existing.promise
          : { providerThreadId: existing.providerThreadId };
      }

      const preparation = runThreadOperation({
        threadId,
        work: async () => {
          const processKey = resolveProviderProcessKey({
            bridgeLaunch,
            providerId,
            skillRoots: sessionSkillRoots,
          });
          await runtime.ensureProvider({
            providerId,
            bridgeLaunch,
            skillRoots: sessionSkillRoots,
          });
          const proc = providerProcesses.requireProviderProcess({
            processKey,
            providerId,
          });
          if (!proc.adapter.capabilities.supportsFork) {
            throw new Error(
              `Preparing a thread rewind is not supported by ${providerId}`,
            );
          }
          assertProviderSupportsExecutionOptions({
            adapter: proc.adapter,
            options: execOpts,
            providerId,
          });

          const stagingThreadId = `${threadId}:rewind:${leaseId}`;
          suppressedThreadEventIds.add(stagingThreadId);
          threadIdentityRegistry.registerThreadProvider({
            providerId,
            providerState: proc.identity,
            threadId: stagingThreadId,
          });
          let retainedForDiscard = false;
          let providerThreadIdForCleanup: string | undefined;
          try {
            const resolvedEnvironment = resolveRuntimeThreadEnvironment({
              contributedEnv,
              environmentId,
              projectId,
              threadId,
            });
            const adapterCommand: AdapterCommand = {
              type: "thread/fork",
              threadId: stagingThreadId,
              cwd: options.workspacePath,
              sourceProviderThreadId,
              sourceProviderCheckpointId: retainThroughProviderCheckpoint,
              options: toProviderExecutionContext({
                envVars: resolvedEnvironment.envVars,
                execOpts,
                instructions,
              }),
              dynamicTools,
              instructionMode,
            };
            const command = requireProviderRequestPlan({
              commandType: adapterCommand.type,
              plan: proc.adapter.buildCommandPlan(adapterCommand),
              providerId,
            });
            const result = await sendCommand({
              proc,
              message: command,
              resultSchema: threadIdentityResultSchema,
              timeoutMs: threadCreationRequestTimeoutMs,
              recovery: {
                bridgeLaunch,
                providerId,
                providerThreadId: sourceProviderThreadId,
                threadId: stagingThreadId,
              },
            });
            const providerThreadId = result.providerThreadId;
            providerThreadIdForCleanup = providerThreadId;
            recordProviderThreadIdentity(
              proc,
              stagingThreadId,
              providerThreadId,
            );
            const prepared: PreparedThreadRewind = {
              state: "prepared",
              cleanupPromise: null,
              cleanupTimer: null,
              processKey,
              providerId,
              providerState: proc.identity,
              providerThreadId,
              stagingThreadId,
              threadId,
            };
            stagedThreadRewinds.set(leaseId, prepared);
            schedulePreparedThreadRewindCleanup(
              leaseId,
              prepared,
              PREPARED_THREAD_REWIND_TTL_MS,
            );
            retainedForDiscard = true;
            return { providerThreadId };
          } finally {
            if (!retainedForDiscard) {
              if (providerThreadIdForCleanup !== undefined) {
                try {
                  await sendStagedThreadDiscard(
                    proc,
                    stagingThreadId,
                    providerThreadIdForCleanup,
                  );
                } catch (error) {
                  options.onStderr?.(
                    `Failed to discard unretained staged rewind ${leaseId}: ${error instanceof Error ? error.message : String(error)}`,
                  );
                }
              } else {
                await releaseThreadOnBridgeBestEffort({
                  proc,
                  threadId: stagingThreadId,
                });
              }
              suppressedThreadEventIds.delete(stagingThreadId);
              threadIdentityRegistry.forgetThread({
                providerState: proc.identity,
                threadId: stagingThreadId,
              });
            }
          }
        },
      });
      stagedThreadRewinds.set(leaseId, {
        state: "preparing",
        promise: preparation,
      });
      try {
        return await preparation;
      } catch (error) {
        const current = stagedThreadRewinds.get(leaseId);
        if (current?.state === "preparing" && current.promise === preparation) {
          stagedThreadRewinds.delete(leaseId);
        }
        throw error;
      }
    },

    async discardThreadRewind({ leaseId }) {
      await discardStagedThreadRewind(leaseId);
    },

    async resumeThread({
      environmentId,
      threadId,
      projectId,
      providerThreadId,
      providerId,
      bridgeLaunch,
      skillRoots: sessionSkillRoots = skillRoots,
      contributedEnv = [],
      options: execOpts,
      instructions,
      dynamicTools,
      instructionMode = "append",
    }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const processKey = resolveProviderProcessKey({
            bridgeLaunch,
            providerId,
            skillRoots: sessionSkillRoots,
          });
          await runtime.ensureProvider({
            providerId,
            bridgeLaunch,
            skillRoots: sessionSkillRoots,
          });

          const proc = providerProcesses.requireProviderProcess({
            processKey,
            providerId,
          });
          assertProviderSupportsExecutionOptions({
            adapter: proc.adapter,
            options: execOpts,
            providerId,
          });
          const ownerThreadId =
            threadIdentityRegistry.resolveBbThreadIdForProviderThread({
              providerState: proc.identity,
              providerThreadId,
            });
          if (ownerThreadId !== undefined && ownerThreadId !== threadId) {
            throw new Error(
              `Cannot resume thread "${threadId}" on "${providerId}": provider thread "${providerThreadId}" is already hosted by thread "${ownerThreadId}"`,
            );
          }
          const resolvedEnvironment = resolveRuntimeThreadEnvironment({
            contributedEnv,
            environmentId,
            projectId,
            threadId,
          });
          threadIdentityRegistry.registerThreadProvider({
            providerId,
            providerState: proc.identity,
            threadId,
          });
          setThreadRuntimeConfig(threadId, {
            bridgeLaunch,
            skillRoots: sessionSkillRoots,
            contributedEnv,
            dynamicTools,
            environmentId,
            envVars: resolvedEnvironment.envVars,
            instructionMode,
            instructions,
            options: execOpts,
            requestedOptions: execOpts,
            processKey,
            projectId,
            providerId,
            sessionRestorable: false,
            sessionSettings: undefined,
            pendingSettingsNote: null,
            openWorkProbeFailures: 0,
          });
          sessions.beginConstruction(threadId);

          recordProviderThreadIdentity(proc, threadId, providerThreadId);

          const adapterCommand: AdapterCommand = {
            type: "thread/resume",
            threadId,
            cwd: options.workspacePath,
            providerThreadId,
            options: toProviderExecutionContext({
              envVars: resolvedEnvironment.envVars,
              execOpts,
              instructions,
            }),
            dynamicTools,
            instructionMode,
          };
          const plan = proc.adapter.buildCommandPlan(adapterCommand);
          if (plan.kind === "noop") {
            sessions.markLive(threadId);
            emitResolvedProviderEnvironment({
              droppedContributions: resolvedEnvironment.droppedContributions,
              entries: resolvedEnvironment.entries,
              providerThreadId: adapterCommand.providerThreadId,
              threadId,
            });
            return { providerThreadId: adapterCommand.providerThreadId };
          }

          let resolved: string;
          try {
            const result = await sendCommand({
              proc,
              message: plan,
              resultSchema: threadIdentityResultSchema,
              timeoutMs: threadCreationRequestTimeoutMs,
              recovery: {
                providerId,
                providerThreadId: adapterCommand.providerThreadId,
                threadId,
              },
            });
            recordProviderThreadIdentity(
              proc,
              threadId,
              result.providerThreadId,
            );
            updateSessionCapabilities(threadId, result);
            resolved = result.providerThreadId;
            emitResolvedProviderEnvironment({
              droppedContributions: resolvedEnvironment.droppedContributions,
              entries: resolvedEnvironment.entries,
              providerThreadId: resolved,
              threadId,
            });
          } catch (resumeError) {
            await abandonFailedSessionConstruction({ proc, threadId });
            throw resumeError;
          }
          sessions.markLive(threadId);
          return { providerThreadId: resolved };
        },
      });
    },

    async runTurn({
      threadId,
      input,
      clientRequestId,
      options: execOpts,
      contributedEnv,
      instructions,
      instructionMode,
      dynamicTools,
      skillRoots: desiredSkillRoots,
      bridgeLaunch: desiredBridgeLaunch,
    }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const pid = threadIdentityRegistry.resolveProviderForThread(threadId);
          requireProviderProcessForThread(threadId);
          const preAdmission = sessions.phase(threadId);
          if (preAdmission.phase !== "idle") {
            return {
              status: "busy",
              message: `The thread is not idle: ${describeBusyPhase(preAdmission) ?? "its provider session is gone"}.`,
            } satisfies RunTurnResult;
          }
          await restartThreadBridgeIfRecommended({ threadId });
          const startConfig = threadRuntimeConfigs.get(threadId);
          if (!startConfig) {
            throw new Error(`No runtime configuration for thread ${threadId}`);
          }
          assertProviderSupportsExecutionOptions({
            adapter: requireProviderProcessForThread(threadId).adapter,
            options: execOpts,
            providerId: pid,
          });
          const resolvedContributedEnv =
            contributedEnv ?? startConfig.contributedEnv;
          const resolvedEnvironment = resolveRuntimeThreadEnvironment({
            contributedEnv: resolvedContributedEnv,
            environmentId: startConfig.environmentId,
            projectId: startConfig.projectId,
            threadId,
          });
          const desired: SessionSettingsRecord = {
            bridgeLaunch: desiredBridgeLaunch ?? startConfig.bridgeLaunch,
            dynamicTools: dynamicTools ?? startConfig.dynamicTools,
            envVars: resolvedEnvironment.envVars,
            instructionMode: instructionMode ?? startConfig.instructionMode,
            instructions: instructions ?? startConfig.instructions,
            options: execOpts,
            skillRoots: desiredSkillRoots ?? startConfig.skillRoots,
          };
          const reconciled =
            requireProviderProcessForThread(threadId).adapter
              .protocolVersion === PROVIDER_BRIDGE_PROTOCOL_V2
              ? await reconcileProtocolV2Settings({
                  contributedEnv: resolvedContributedEnv,
                  desired,
                  threadId,
                })
              : await reconcileThreadSettings({
                  contributedEnv: resolvedContributedEnv,
                  desired,
                  threadId,
                });
          const proc = requireProviderProcessForThread(threadId);
          const currentConfig = threadRuntimeConfigs.get(threadId);
          if (!currentConfig) {
            throw new Error(`No runtime configuration for thread ${threadId}`);
          }
          const environmentChanged = !isDeepStrictEqual(
            currentConfig.envVars,
            reconciled.record.envVars,
          );

          const providerThreadId = requireProviderThreadId(threadId);
          const adapterCommand: AdapterCommand = {
            type: "turn/start",
            threadId,
            providerThreadId,
            input,
            clientRequestId,
            options: toProviderExecutionContext({
              envVars: reconciled.record.envVars,
              execOpts: reconciled.record.options,
              instructions: reconciled.record.instructions,
            }),
            apply: reconciled.apply,
            ...(reconciled.apply.settings.includes("dynamicTools") &&
            reconciled.record.dynamicTools !== undefined
              ? { dynamicTools: reconciled.record.dynamicTools }
              : {}),
          };
          const cmd = requireProviderRequestPlan({
            commandType: adapterCommand.type,
            plan: proc.adapter.buildCommandPlan(adapterCommand),
            providerId: pid,
          });
          const admission = sessions.admitTurnStart(threadId);
          if (admission.kind !== "admitted") {
            return {
              status: "busy",
              message:
                admission.kind === "busy"
                  ? admission.message
                  : "Another turn is active.",
            } satisfies RunTurnResult;
          }
          let result: RunTurnResult = { status: "started" };
          try {
            const answer = await sendCommand({
              proc,
              message: cmd,
              resultSchema: proc.adapter.turnInputResultSchema,
              timeoutMs: turnStartWatchdogThresholdMs,
              afterTimeout: {
                resolve: () => {},
                reject: (error) => {
                  if (!sessions.hasTurnStart(threadId)) {
                    return;
                  }
                  sessions.settleTurnStart(threadId);
                  options.onEvent({
                    type: "system/error",
                    threadId,
                    scope: { kind: "thread" },
                    code: "provider_turn_start_failed",
                    message: `The provider failed to start the turn after its request timed out: ${error.message}`,
                  });
                },
              },
              recovery: {
                providerId: pid,
                providerThreadId: adapterCommand.providerThreadId,
                threadId,
              },
            });
            if (answer.admission !== "accepted") {
              sessions.settleTurnStart(threadId);
              return { status: answer.admission, message: answer.message };
            }
          } catch (error) {
            if (!(error instanceof JsonRpcRequestTimeoutError)) {
              sessions.settleTurnStart(threadId);
              throw error;
            }
            options.onStderr?.(
              `Turn start for thread "${threadId}" timed out; whether the provider starts it is unconfirmed.`,
              threadId,
            );
            result = { status: "unconfirmed" };
          }
          setThreadRuntimeConfig(threadId, {
            ...currentConfig,
            bridgeLaunch: reconciled.record.bridgeLaunch,
            contributedEnv: resolvedContributedEnv,
            dynamicTools: reconciled.record.dynamicTools,
            envVars: reconciled.record.envVars,
            instructionMode: reconciled.record.instructionMode,
            instructions: reconciled.record.instructions,
            options: reconciled.record.options,
            requestedOptions: execOpts,
            skillRoots: reconciled.record.skillRoots,
          });
          if (environmentChanged) {
            emitResolvedProviderEnvironment({
              droppedContributions: resolvedEnvironment.droppedContributions,
              entries: resolvedEnvironment.entries,
              providerThreadId,
              threadId,
            });
          }
          return result;
        },
      });
    },

    async steerTurn({
      threadId,
      expectedTurnId,
      input,
      clientRequestId,
      options: execOpts,
      contributedEnv,
      instructions,
    }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const pid = threadIdentityRegistry.resolveProviderForThread(threadId);
          const proc = requireProviderProcessForThread(threadId);
          assertProviderSupportsExecutionOptions({
            adapter: proc.adapter,
            options: execOpts,
            providerId: pid,
          });
          const admission = sessions.admitSteer(threadId, expectedTurnId);
          if (admission.kind === "stale") {
            options.onStderr?.(
              `Ignoring stale steer for thread "${threadId}" on turn "${expectedTurnId}"; active turn is ${admission.activeTurnId ?? "none"}.`,
            );
            return { status: "stale", activeTurnId: admission.activeTurnId };
          }
          if (admission.kind === "busy") {
            return { status: "busy", message: admission.message };
          }
          const currentConfig = threadRuntimeConfigs.get(threadId);
          if (!currentConfig) {
            throw new Error(`No runtime configuration for thread ${threadId}`);
          }
          const protocolV2Steer =
            proc.adapter.protocolVersion === PROVIDER_BRIDGE_PROTOCOL_V2
              ? resolveProtocolV2SteerSettings({
                  contributedEnv,
                  currentConfig,
                  threadId,
                })
              : null;
          const settingChanges =
            protocolV2Steer === null
              ? listUserSettingChanges(currentConfig.requestedOptions, execOpts)
              : [];
          if (
            protocolV2Steer === null &&
            lowersPermissions(currentConfig.options, execOpts)
          ) {
            return {
              status: "busy",
              message:
                "This message lowers the thread's permissions, so it runs as the next turn instead of joining a turn that has broader access.",
            };
          }

          const providerThreadId = requireProviderThreadId(threadId);
          const adapterCommand: AdapterCommand = {
            type: "turn/steer",
            threadId,
            providerThreadId,
            expectedTurnId,
            input,
            clientRequestId,
            options:
              protocolV2Steer === null
                ? toProviderExecutionContext({
                    envVars: currentConfig.envVars,
                    execOpts: currentConfig.options,
                    instructions: currentConfig.instructions,
                  })
                : toProviderExecutionContext({
                    envVars: protocolV2Steer.environment.envVars,
                    execOpts,
                    instructions: instructions ?? currentConfig.instructions,
                  }),
          };
          const cmd = requireProviderRequestPlan({
            commandType: adapterCommand.type,
            plan: proc.adapter.buildCommandPlan(adapterCommand),
            providerId: pid,
          });
          try {
            const answer = await sendCommand({
              proc,
              message: cmd,
              resultSchema: proc.adapter.turnInputResultSchema,
              timeoutMs: turnStartWatchdogThresholdMs,
              recovery: {
                providerId: pid,
                providerThreadId: adapterCommand.providerThreadId,
                threadId,
              },
            });
            if (answer.admission !== "accepted") {
              return { status: answer.admission, message: answer.message };
            }
          } catch (error) {
            if (
              error instanceof JsonRpcResponseError &&
              (error.recovery?.kind === "staleTurn" ||
                error.code === BRIDGE_JSON_RPC_ERRORS.NO_ACTIVE_TURN)
            ) {
              options.onStderr?.(
                `Dropping stale steer for thread "${threadId}": ${error.message}`,
                threadId,
              );
              sessions.clearStaleTurn(threadId, expectedTurnId);
              return {
                status: "stale",
                activeTurnId: sessions.getActiveTurnId(threadId),
              };
            }
            if (error instanceof JsonRpcRequestTimeoutError) {
              options.onStderr?.(
                `Steer for thread "${threadId}" on turn "${expectedTurnId}" timed out; its delivery is unconfirmed.`,
                threadId,
              );
              return { status: "unconfirmed" };
            }
            throw error;
          }
          if (protocolV2Steer !== null) {
            recordProtocolV2Steer({
              currentConfig,
              execOpts,
              providerThreadId,
              steer: protocolV2Steer,
              threadId,
            });
          }
          if (settingChanges.length > 0) {
            setThreadRuntimeConfig(threadId, {
              ...currentConfig,
              requestedOptions: execOpts,
            });
            emitSessionSettingsNote({
              threadId,
              summary: `Changed ${describeSessionSettingChanges(
                settingChanges.map((change) => ({ change, apply: "live" })),
              )} applies from the next turn; this message joined the running turn on its current settings.`,
            });
          }
          return { status: "steered" };
        },
      });
    },

    async stopThread({ threadId }) {
      toolCalls.cancelThread(threadId);
      return runThreadOperation({
        threadId,
        work: async () => {
          const pid = threadIdentityRegistry.resolveProviderForThread(threadId);
          const proc = requireProviderProcessForThread(threadId);
          const providerThreadId = requireProviderThreadId(threadId);
          const activeTurnId = sessions.getActiveTurnId(threadId);
          sessions.markStopping(threadId);
          const adapterCommand: AdapterCommand = {
            type: "thread/stop",
            threadId,
            providerThreadId,
            activeTurnId,
          };
          const cmd = proc.adapter.buildCommandPlan(adapterCommand);

          if (cmd.kind === "noop") {
            if (activeTurnId) {
              throw new Error(
                `Adapter "${pid}" returned no provider request for thread/stop with active turn: ${cmd.reason}`,
              );
            }
            forgetThreadRuntimeStateForProviderState(proc.identity, threadId);
            await releaseIdleProviderProcess(proc);
            return { providerCheckpointId: null };
          }

          let result: z.infer<typeof providerThreadStopResultSchema>;
          try {
            result = await sendCommand({
              proc,
              message: cmd,
              resultSchema: providerThreadStopResultSchema,
            });
          } catch (error) {
            sessions.cancelStopping(threadId);
            throw error;
          }
          forgetThreadRuntimeStateForProviderState(proc.identity, threadId);
          await releaseIdleProviderProcess(proc);
          return {
            providerCheckpointId: result.providerCheckpointId ?? null,
          };
        },
      });
    },

    async clearThreadGoal({ threadId }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const pid = threadIdentityRegistry.resolveProviderForThread(threadId);
          const proc = requireProviderProcessForThread(threadId);
          const adapterCommand: AdapterCommand = {
            type: "thread/goal/clear",
            threadId,
            providerThreadId: requireProviderThreadId(threadId),
          };
          const cmd = requireProviderRequestPlan({
            commandType: adapterCommand.type,
            plan: proc.adapter.buildCommandPlan(adapterCommand),
            providerId: pid,
          });
          const clearRevision = threadGoalState.getClearRevision(threadId);
          const result = await sendCommand({
            proc,
            message: cmd,
            resultSchema: threadGoalClearResultSchema,
          });
          if (
            !result.cleared &&
            threadGoalState.getClearRevision(threadId) > clearRevision
          ) {
            return { cleared: true };
          }
          const confirmed = await threadGoalState.waitForGoalClear({
            afterRevision: clearRevision,
            threadId,
            timeoutMs: THREAD_GOAL_CLEAR_EVENT_TIMEOUT_MS,
          });
          return { cleared: confirmed };
        },
      });
    },

    async renameThread({ threadId, title }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const pid = threadIdentityRegistry.resolveProviderForThread(threadId);
          const proc = requireProviderProcessForThread(threadId);
          if (!proc.adapter.capabilities.supportsThreadRename) {
            throw new Error(
              `Provider "${pid}" does not support thread rename.`,
            );
          }

          const adapterCommand: AdapterCommand = {
            type: "thread/name/set",
            threadId,
            providerThreadId: requireProviderThreadId(threadId),
            title: toProviderExternalThreadName(title),
          };
          const cmd = requireProviderRequestPlan({
            commandType: adapterCommand.type,
            plan: proc.adapter.buildCommandPlan(adapterCommand),
            providerId: pid,
          });
          await sendCommand({
            proc,
            message: cmd,
            resultSchema: ignoredJsonRpcResultSchema,
            recovery: {
              providerId: pid,
              providerThreadId: adapterCommand.providerThreadId,
              threadId,
            },
          });
        },
      });
    },

    async archiveThread({
      threadId,
      providerId,
      providerThreadId,
      bridgeLaunch,
    }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          await archiveOrUnarchiveThread({
            bridgeLaunch,
            commandType: "thread/archive",
            providerId,
            providerThreadId,
            threadId,
          });
        },
      });
    },

    async unarchiveThread({
      threadId,
      providerId,
      providerThreadId,
      bridgeLaunch,
    }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          await archiveOrUnarchiveThread({
            bridgeLaunch,
            commandType: "thread/unarchive",
            providerId,
            providerThreadId,
            threadId,
          });
        },
      });
    },

    async listModels({
      providerId,
      bridgeLaunch,
      cwd,
      selectedModel,
      contributedEnv = [],
    }) {
      await runtime.ensureProvider({ providerId, bridgeLaunch });
      const proc = providerProcesses.requireProviderProcess({
        processKey: resolveProviderProcessKey({ bridgeLaunch, providerId }),
        providerId,
      });
      const command = requireProviderRequestPlan({
        commandType: "model/list",
        plan: proc.adapter.buildCommandPlan({
          type: "model/list",
          ...(selectedModel === undefined ? {} : { selectedModel }),
          ...(cwd !== undefined ? { cwd } : {}),
          envVars: resolveContributedEnvironment(
            contributedEnv,
            options.getShellEnv?.(),
          ),
        }),
        providerId,
      });
      const result = await sendCommand({
        proc,
        message: command,
        resultSchema: ignoredJsonRpcResultSchema,
      });
      return proc.adapter.parseModelListResult(result);
    },

    async listCommands({ providerId, bridgeLaunch, cwd }) {
      await runtime.ensureProvider({ providerId, bridgeLaunch });
      const proc = providerProcesses.requireProviderProcess({
        processKey: resolveProviderProcessKey({ bridgeLaunch, providerId }),
        providerId,
      });
      const plan = proc.adapter.buildCommandPlan({
        type: "commands/list",
        cwd,
      });
      if (plan.kind === "noop") {
        return { commands: [] };
      }
      return await sendCommand({
        proc,
        message: plan,
        resultSchema: commandListResultSchema,
      });
    },

    async providerHealth({ providerId, bridgeLaunch, cwd }) {
      await runtime.ensureProvider({ providerId, bridgeLaunch });
      const proc = providerProcesses.requireProviderProcess({
        processKey: resolveProviderProcessKey({ bridgeLaunch, providerId }),
        providerId,
      });
      const plan = proc.adapter.buildCommandPlan({
        type: "provider/health",
        ...(cwd !== undefined ? { cwd } : {}),
      });
      if (plan.kind === "noop") {
        return { supported: false };
      }
      return await sendCommand({
        proc,
        message: plan,
        resultSchema: providerHealthResultSchema,
      });
    },

    async providerUsage({ providerId, bridgeLaunch, cwd }) {
      await runtime.ensureProvider({ providerId, bridgeLaunch });
      const proc = providerProcesses.requireProviderProcess({
        processKey: resolveProviderProcessKey({ bridgeLaunch, providerId }),
        providerId,
      });
      const plan = proc.adapter.buildCommandPlan({
        type: "provider/usage",
        ...(cwd !== undefined ? { cwd } : {}),
      });
      if (plan.kind === "noop") {
        return { supported: false };
      }
      return await sendCommand({
        proc,
        message: plan,
        resultSchema: providerUsageResultSchema,
      });
    },

    async providerInstallationStatus({
      providerId,
      bridgeLaunch,
      cwd,
      requirement,
      checkUpdates = true,
    }) {
      await runtime.ensureProvider({ providerId, bridgeLaunch });
      const proc = providerProcesses.requireProviderProcess({
        processKey: resolveProviderProcessKey({ bridgeLaunch, providerId }),
        providerId,
      });
      const plan = requireProviderRequestPlan({
        commandType: "provider/installation/status",
        plan: proc.adapter.buildCommandPlan({
          type: "provider/installation/status",
          checkUpdates,
          ...(cwd !== undefined ? { cwd } : {}),
          ...(requirement !== undefined ? { requirement } : {}),
        }),
        providerId,
      });
      return await sendCommand({
        proc,
        message: plan,
        resultSchema: providerInstallationStatusSchema,
      });
    },

    async providerInstallationRun({ providerId, bridgeLaunch, cwd, action }) {
      await runtime.ensureProvider({ providerId, bridgeLaunch });
      const proc = providerProcesses.requireProviderProcess({
        processKey: resolveProviderProcessKey({ bridgeLaunch, providerId }),
        providerId,
      });
      const plan = requireProviderRequestPlan({
        commandType: "provider/installation/run",
        plan: proc.adapter.buildCommandPlan({
          type: "provider/installation/run",
          action,
          ...(cwd !== undefined ? { cwd } : {}),
        }),
        providerId,
      });
      return await sendCommand({
        proc,
        message: plan,
        resultSchema: providerInstallationRunResultSchema,
      });
    },

    listRunningProviders() {
      return providerProcesses.listRunningProviders();
    },

    getActiveTurnId(threadId) {
      return sessions.getActiveTurnId(threadId);
    },

    getSessionPhase(threadId) {
      return sessions.phase(threadId).phase;
    },

    waitForActiveTurn(threadId, args) {
      if (
        sessions.getActiveTurnId(threadId) === null &&
        !sessions.hasTurnStart(threadId) &&
        !threadHasInFlightOperation(threadId)
      ) {
        return Promise.resolve(null);
      }
      return sessions.waitForActiveTurn({
        threadId,
        timeoutMs: args.timeoutMs,
      });
    },

    getProviderSession(threadId) {
      return threadIdentityRegistry.getProviderSession(threadId);
    },

    async reapIdleProviderSessions({ idleForMs, nowMs, runThreadExclusive }) {
      const reapedSessions: ReapedIdleProviderSession[] = [];
      for (const threadId of [...threadRuntimeConfigs.keys()]) {
        const release = async (): Promise<ReapedIdleProviderSession | null> => {
          const candidate = findReapableIdleProviderSession({
            idleForMs,
            nowMs,
            threadId,
          });
          if (!candidate) {
            return null;
          }

          try {
            providerProcesses.requireProviderProcess({
              processKey: candidate.runtimeConfig.processKey,
              providerId: candidate.runtimeConfig.providerId,
            });
          } catch {
            return null;
          }
          const openWork = await assessThreadOpenWork(candidate.threadId);
          if (openWork.blockers.length > 0) {
            return null;
          }

          try {
            await runtime.stopThread({ threadId: candidate.threadId });
          } catch (error) {
            options.onStderr?.(
              `Provider session release failed for ${candidate.threadId}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            return null;
          }
          return {
            idleForMs: Math.max(0, nowMs - candidate.idleSinceMs),
            providerId: candidate.runtimeConfig.providerId,
            providerThreadId: candidate.providerThreadId,
            threadId: candidate.threadId,
          };
        };
        const reaped = runThreadExclusive
          ? await runThreadExclusive(threadId, release)
          : await release();
        if (reaped) {
          reapedSessions.push(reaped);
        }
      }

      return { reapedSessions };
    },

    hasThread(threadId) {
      return threadIdentityRegistry.getProviderSession(threadId) !== null;
    },

    getLiveThreadIds() {
      return [
        ...new Set([
          ...sessions.getActiveThreadIds(),
          ...[...threadRuntimeConfigs.keys()].filter((threadId) =>
            sessions.hasTurnStart(threadId),
          ),
        ]),
      ];
    },

    hasOpenBackgroundWork() {
      return backgroundWorkState.hasOpenWork();
    },

    listOpenBackgroundWork() {
      return backgroundWorkState.listOpenWork();
    },

    async shutdown() {
      clearInterval(turnStartWatchdogTimer);
      await Promise.all(
        [...stagedThreadRewinds.keys()].map((leaseId) =>
          discardStagedThreadRewind(leaseId),
        ),
      );
      threadOperationCounts.clear();
      threadGoalState.clear();
      sessions.clear();
      threadEventGrammar.clear();
      await providerProcesses.shutdown();
      for (const event of backgroundWorkState.settleAll()) {
        options.onEvent(event);
      }
    },
  };

  return runtime;
}
