import path from "node:path";
import { z } from "zod";
import { isSessionRestorableProvider } from "./provider-catalog.js";
import {
  normalizeProviderThreadNameEvent,
  toProviderExternalThreadName,
} from "@bb/domain";
import type {
  DynamicTool,
  InstructionMode,
  ThreadEvent,
} from "@bb/domain";
import type { HostDaemonAcpLaunchSpec } from "@bb/host-daemon-contract";
import type { AdapterCommand } from "./provider-adapter.js";
import {
  experimental_providerHealthResultSchema,
  experimental_providerInstallationRunResultSchema,
  experimental_providerInstallationStatusSchema,
  experimental_providerUsageResultSchema,
  ThreadEventGrammar,
} from "@bb/provider-bridge-protocol";
import {
  JsonRpcResponseError,
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
  type ResolveRuntimeProviderRequestThreadIdArgs,
  type RuntimeProviderRequestKind,
} from "./runtime-provider-requests.js";
import {
  RuntimeProviderProcessManager,
  type RuntimeProviderProcess,
} from "./runtime-provider-process.js";
import {
  filterSkillRootsForProvider,
  normalizeSkillRoots,
} from "./runtime-skill-roots.js";
import {
  RuntimeThreadIdentityRegistry,
  stampThreadEventScope,
} from "./runtime-thread-identity.js";
import { RuntimeThreadGoalState } from "./runtime-thread-goal-state.js";
import { RuntimeBackgroundWorkState } from "./runtime-background-work-state.js";
import { RuntimeTurnState } from "./runtime-turn-state.js";
import type {
  AgentRuntime,
  AgentRuntimeProviderRecoveryHint,
  AgentRuntimeBridgeLaunch,
  AgentRuntimeExecutionOptions,
  AgentRuntimeOptions,
  ReapedIdleProviderSession,
  AgentRuntimeSkillRoot,
} from "./types.js";
import { buildThreadShellEnvironment } from "./thread-shell-environment.js";
import {
  resolveThreadIdentityResult,
  threadIdentityResultSchema,
} from "./thread-identity.js";
import {
  fingerprintAcpLaunchSpec,
  bridgeLaunchProcessKey,
} from "./acp-launch-spec-fingerprint.js";

interface ReconfigureThreadIfNeededArgs {
  options: AgentRuntimeExecutionOptions;
  threadId: string;
}

interface RestartThreadBridgeArgs {
  instructions: string | undefined;
  options: AgentRuntimeExecutionOptions;
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

/**
 * A staged rewind fork, keyed by the server-minted per-attempt lease id.
 * Each attempt owns exactly one staged fork; there is no cross-attempt
 * sharing, so discarding a lease can never affect another attempt.
 */
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
  providerSessionReapingEnabled: boolean;
  threadId: string;
}

interface ResolveProviderProcessKeyArgs {
  acpLaunchSpec?: HostDaemonAcpLaunchSpec;
  bridgeLaunch?: AgentRuntimeBridgeLaunch;
  providerId: string;
}

interface ArchiveOrUnarchiveThreadArgs {
  bridgeLaunch?: AgentRuntimeBridgeLaunch;
  commandType: "thread/archive" | "thread/unarchive";
  /** The process to use when the thread has no runtime config (a staging fork). */
  processKey?: string;
  providerId: string;
  providerThreadId: string;
  threadId: string;
}

/**
 * What a request needs so the runtime can act on the recovery hint a bridge
 * attaches to its rejection: the session to unarchive, the thread to retry.
 * `bridgeLaunch`/`processKey` pin the process for a thread that has no
 * runtime config yet (a rewind staging fork).
 */
interface RequestRecoveryArgs {
  bridgeLaunch?: AgentRuntimeBridgeLaunch;
  processKey?: string;
  providerId: string;
  providerThreadId: string;
  threadId: string;
}

/**
 * A runtime request the bridge rejected with a typed recovery hint. `code` is
 * the host-side failure code (`getErrorCode` in the daemon reads a string
 * `code` before any message text), so an `authRequired` rejection reaches the
 * server as `auth_required` without a regex anywhere on the way.
 */
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

/**
 * A `rateLimited { retryable: true }` rejection is retried on this ladder;
 * the failure after the last rung propagates as a typed error.
 */
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

// ---------------------------------------------------------------------------
// Runtime implementation
// ---------------------------------------------------------------------------

type ProviderProcess = RuntimeProviderProcess;

const threadGoalClearResultSchema = z.object({ cleared: z.boolean() }).strict();
const THREAD_GOAL_CLEAR_EVENT_TIMEOUT_MS = 5_000;
const PREPARED_THREAD_REWIND_TTL_MS = 5 * 60_000;
const PREPARED_THREAD_REWIND_RETRY_MS = 30_000;

interface ThreadRuntimeConfig {
  /**
   * The launch spec the live provider session was constructed with. Kept so a
   * runtime-internal re-resume (a `restartRecommended` bridge restart) can
   * rebuild the same process key and adapter for a plugin-delivered bridge,
   * which cannot be resolved from the provider id alone.
   */
  bridgeLaunch?: AgentRuntimeBridgeLaunch;
  dynamicTools?: DynamicTool[];
  disallowedTools?: readonly string[];
  environmentId: string;
  instructionMode: InstructionMode;
  /**
   * The instructions the live provider session was constructed with. Frozen
   * until the next session construction (start, resume, fork).
   */
  instructions?: string;
  options: AgentRuntimeExecutionOptions;
  processKey: string;
  projectId?: string;
  providerId: string;
  sessionRestorable: boolean;
  skillRoots: readonly AgentRuntimeSkillRoot[];
  workspacePath: string;
}

interface RuntimeParsedMessageArgs {
  parsed: JsonRpcObject;
  proc: ProviderProcess;
}

interface EmitTranslatedEventsArgs {
  events: ThreadEvent[];
  proc: ProviderProcess;
  sourceThreadId?: string;
}

interface EmitAcceptedCommandEventsArgs {
  command: AdapterCommand;
  proc: ProviderProcess;
  providerThreadId?: string;
  sourceThreadId?: string;
}

interface RequireProviderRequestPlanArgs {
  commandType: AdapterCommand["type"];
  plan: ProviderCommandPlan;
  providerId: string;
}

/**
 * The one provider id the pre-experiment idle reap releases (the behavior
 * bb shipped before `providerSessionReapingEnabled` extended release to every
 * restorable provider). Product policy, not a process-topology fact: one
 * bridge process serves every thread of a provider in the environment.
 */
const CODEX_PROVIDER_ID = "codex";
const THREAD_CREATION_REQUEST_TIMEOUT_MS = 2 * 60_000;

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

/**
 * Coordinates provider processes for an environment and bridges provider
 * JSON-RPC traffic into bb thread events, dynamic tool calls, and pending
 * interactions.
 */
export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
  const additionalWorkspaceWriteRoots =
    options.additionalWorkspaceWriteRoots ?? [];
  const skillRoots = normalizeSkillRoots({
    skillRoots: options.skillRoots,
  });
  let nextRequestId = 1;
  const threadIdentityRegistry = new RuntimeThreadIdentityRegistry();
  const threadRuntimeConfigs = new Map<string, ThreadRuntimeConfig>();
  const rateLimitedRetryDelaysMs =
    options.rateLimitRetry?.delaysMs ?? DEFAULT_RATE_LIMITED_RETRY_DELAYS_MS;
  /**
   * Threads whose bridge raised `restartRecommended` while a turn was
   * active: the restart runs before the thread's next turn or steer.
   */
  const threadsAwaitingBridgeRestart = new Map<
    string,
    AgentRuntimeProviderRecoveryHint
  >();
  const idleProviderSessionSinceMsByThreadId = new Map<string, number>();
  // Accepted turn dispatches awaiting the provider's turn/started. The
  // watchdog makes a stalled entry visible instead of silently hung (#1156's
  // unimplemented third suggestion; grammar rule 4 in
  // docs/provider-bridge-protocol.md).
  const pendingTurnStarts = new Map<
    string,
    { sinceMs: number; watchdogFired: boolean }
  >();
  const turnStartWatchdogThresholdMs =
    options.turnStartWatchdog?.thresholdMs ?? 120_000;
  const turnStartWatchdogTimer = setInterval(() => {
    const nowMs = Date.now();
    for (const [threadId, entry] of pendingTurnStarts) {
      if (
        entry.watchdogFired ||
        nowMs - entry.sinceMs < turnStartWatchdogThresholdMs
      ) {
        continue;
      }
      entry.watchdogFired = true;
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
  const turnState = new RuntimeTurnState();
  const backgroundWorkState = new RuntimeBackgroundWorkState();
  // The host's live grammar check on bridge event streams: the conformance
  // kit's rules, applied to every bridge including the third-party artifacts
  // nobody ran the kit against.
  const threadEventGrammar = new ThreadEventGrammar();
  const bridgeNodeEnv = defaultBridgeNodeEnv();

  const providerProcesses = new RuntimeProviderProcessManager({
    additionalWorkspaceWriteRoots,
    bridgeBundleDir: options.bridgeBundleDir,
    ...(bridgeNodeEnv !== undefined ? { bridgeNodeEnv } : {}),
    bridgeNodeExecutablePath: process.execPath,
    captureThreadExitState: (threadId) => ({
      activeTurnId: turnState.getActiveTurnId(threadId),
      pendingTurnStart: pendingTurnStarts.has(threadId),
      providerThreadId:
        threadIdentityRegistry.getProviderThreadId(threadId) ?? null,
      threadId,
    }),
    createProviderIdentityState: (providerId) =>
      threadIdentityRegistry.createProviderState({ providerId }),
    env: options.env,
    getNextRequestId: () => nextRequestId++,
    handleStdoutLine: (args) =>
      handleStdoutLine(args.line, args.providerProcess),
    onProcessExit: options.onProcessExit,
    onProviderIdentityWaitersInterrupted: (providerProcess) =>
      threadIdentityRegistry.resolvePendingIdentityWaiters(
        providerProcess.identity,
      ),
    onProviderThreadDetached: (threadId) => {
      // Open background work dies with the provider process: bridges settle
      // it with explicit deltas on their own teardown, and the server's
      // reconciliation settles what a dead process never could.
      threadIdentityRegistry.clearThread(threadId);
      clearThreadRuntimeConfig(threadId);
      turnState.clearThread(threadId);
      backgroundWorkState.clearThread(threadId);
      threadEventGrammar.clearThread(threadId);
    },
    onStderr: options.onStderr,
    skillRoots,
    workspacePath: options.workspacePath,
  });

  /**
   * One process per provider artifact: every thread of a provider in this
   * environment runs on the same bridge process, and the bridge supervises
   * whatever children it needs (the codex bridge runs one `codex app-server`
   * per thread underneath itself). The runtime never scopes a process to a
   * thread.
   */
  function resolveProviderProcessKey(
    args: ResolveProviderProcessKeyArgs,
  ): string {
    const baseKey = args.providerId;
    // A plugin-delivered bridge keys process identity by its artifact hash AND
    // by the declaration facts baked into the adapter at spawn (capabilities,
    // static provider options): a plugin can change either one alone, and
    // whichever changed, the running adapter is the superseded one.
    const bridgeKey =
      args.bridgeLaunch === undefined
        ? baseKey
        : `${baseKey}#bridge:${bridgeLaunchProcessKey(args.bridgeLaunch)}`;
    if (args.acpLaunchSpec === undefined) {
      return bridgeKey;
    }
    return `${bridgeKey}#acp:${fingerprintAcpLaunchSpec(args.acpLaunchSpec)}`;
  }

  function requireProviderProcessForThread(threadId: string): ProviderProcess {
    const providerId =
      threadIdentityRegistry.resolveProviderForThread(threadId);
    const processKey =
      threadRuntimeConfigs.get(threadId)?.processKey ??
      resolveProviderProcessKey({ providerId });
    return providerProcesses.requireProviderProcess({ processKey, providerId });
  }

  /**
   * Releasing a thread is the moment a process can become retirable: a
   * bridge process superseded by a plugin update was only being kept alive
   * by the threads still running on it. A current process stays up for the
   * provider's next thread; its own per-thread children are the bridge's
   * business (the codex bridge kills a thread's app-server on release).
   */
  async function releaseIdleProviderProcess(
    proc: ProviderProcess,
  ): Promise<void> {
    await providerProcesses.retireSupersededBridgeProcessIfIdle(proc);
  }

  async function sendCommand<TResult>(args: {
    proc: ProviderProcess;
    message: SendJsonRpcRequestArgs<TResult>["message"];
    resultSchema: SendJsonRpcRequestArgs<TResult>["resultSchema"];
    timeoutMs?: number;
    recovery?: RequestRecoveryArgs;
  }): Promise<TResult> {
    const request = {
      child: args.proc.child,
      getNextId: () => nextRequestId++,
      message: args.message,
      pending: args.proc.pending,
      resultSchema: args.resultSchema,
      ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
    };

    try {
      return await sendJsonRpcRequest(request);
    } catch (error) {
      const recovery = args.recovery;
      if (!recovery) {
        throw error;
      }
      // The hint rides the rejection itself (`error.data.recovery`), so it
      // can only ever explain this request. A timeout or a bridge exit has no
      // response and therefore no hint.
      const hint = stampRecoveryHint(error, recovery);
      if (hint === null) {
        throw error;
      }
      switch (hint.kind) {
        case "sessionArchived":
          if (!hint.retryable) {
            // The bridge says the session cannot be unarchived from here (a
            // fork source it cannot reopen, for example).
            throw error;
          }
          return await unarchiveAndRetryRequest({
            error,
            proc: args.proc,
            recovery,
            request,
          });
        case "authRequired":
          throw new AgentRuntimeRecoveryError({
            cause: error,
            code: "auth_required",
            message: hint.message,
            recovery: hint,
          });
        case "rateLimited":
          if (!hint.retryable) {
            throw new AgentRuntimeRecoveryError({
              cause: error,
              code: "rate_limited",
              message: hint.message,
              recovery: hint,
            });
          }
          return await retryRateLimitedRequest({
            error,
            hint,
            proc: args.proc,
            recovery,
            request,
          });
        case "restartRecommended":
          // The request itself failed and is reported as is; the restart runs
          // once this operation is over (before the thread's next turn).
          scheduleBridgeRestart({
            hint,
            proc: args.proc,
            threadId: recovery.threadId,
          });
          throw error;
        case "staleTurn":
          // Only a steer can be stale; steerTurn claims this hint itself.
          throw error;
      }
    }
  }

  /** The rejection's hint, stamped with the provider and thread it is about. */
  function stampRecoveryHint(
    error: unknown,
    recovery: RequestRecoveryArgs,
  ): AgentRuntimeProviderRecoveryHint | null {
    if (!(error instanceof JsonRpcResponseError) || error.recovery === null) {
      return null;
    }
    return {
      providerId: recovery.providerId,
      threadId: recovery.threadId,
      ...error.recovery,
    };
  }

  interface RetryableRequestArgs<TResult> {
    error: unknown;
    proc: ProviderProcess;
    recovery: RequestRecoveryArgs;
    request: SendJsonRpcRequestArgs<TResult>;
  }

  /** `sessionArchived`: unarchive the session, then retry the request once. */
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
      // Unarchiving can replace an exited provider process, so resolve the
      // process again instead of writing to the captured child's stdin.
      retryProc = providerProcesses.requireProviderProcess({
        processKey: args.proc.processKey,
        providerId: args.proc.providerId,
      });
    } catch (recoveryError) {
      // The archived-session error names the session and the CLI command
      // that fixes it, so keep it as the reported failure whenever the
      // recovery itself could not run.
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message, { cause: recoveryError });
    }

    return sendJsonRpcRequest({
      ...args.request,
      child: retryProc.child,
      pending: retryProc.pending,
    });
  }

  /**
   * `rateLimited { retryable: true }`: re-send on a short bounded ladder. A
   * rung that rejects with a fresh non-retryable hint stops the ladder; the
   * failure after the last rung surfaces as the typed error.
   */
  async function retryRateLimitedRequest<TResult>(
    args: RetryableRequestArgs<TResult> & {
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
        lastError = retryError;
        const nextHint = stampRecoveryHint(retryError, args.recovery);
        if (nextHint === null) {
          // The bridge rejected for a different, untyped reason: report it.
          throw retryError;
        }
        lastHint = nextHint;
        if (!(nextHint.kind === "rateLimited" && nextHint.retryable)) {
          break;
        }
      }
    }
    throw new AgentRuntimeRecoveryError({
      cause: lastError,
      code: lastHint.kind === "authRequired" ? "auth_required" : "rate_limited",
      message: lastHint.message,
      recovery: lastHint,
    });
  }

  function skillRootsForProvider(
    providerId: string,
  ): readonly AgentRuntimeSkillRoot[] {
    return filterSkillRootsForProvider({
      providerId,
      skillRoots,
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

  function updateSessionRestoreCapability(
    threadId: string,
    sessionRestorable: boolean | undefined,
  ): void {
    if (sessionRestorable === undefined) {
      return;
    }
    const current = threadRuntimeConfigs.get(threadId);
    if (current) {
      threadRuntimeConfigs.set(threadId, { ...current, sessionRestorable });
    }
  }

  function clearThreadRuntimeConfig(threadId: string): void {
    threadsAwaitingBridgeRestart.delete(threadId);
    idleProviderSessionSinceMsByThreadId.delete(threadId);
    pendingTurnStarts.delete(threadId);
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
      return;
    }
    threadOperationCounts.set(threadId, current - 1);
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

  function waitForProviderThreadIdentity(
    proc: ProviderProcess,
    threadId: string,
    timeoutMs: number,
  ): Promise<string | null> {
    return threadIdentityRegistry.waitForProviderThreadIdentity({
      providerState: proc.identity,
      threadId,
      timeoutMs,
    });
  }

  /**
   * Removes one thread's runtime state while its provider process keeps
   * running: identity, execution config, turn state (resolving pending
   * active-turn waiters with `null`), and replay-filter state.
   */
  function forgetThreadRuntimeStateForProviderState(
    providerState: RuntimeProviderProcess["identity"],
    threadId: string,
  ): void {
    threadIdentityRegistry.forgetThread({
      providerState,
      threadId,
    });
    clearThreadRuntimeConfig(threadId);
    turnState.clearThread(threadId);
    backgroundWorkState.clearThread(threadId);
    threadEventGrammar.clearThread(threadId);
  }

  function markProviderSessionNotIdle(threadId: string): void {
    idleProviderSessionSinceMsByThreadId.delete(threadId);
  }

  function markHostedProviderSessionIdle(threadId: string): void {
    if (
      threadIdentityRegistry.getProviderSession(threadId) === null ||
      turnState.getActiveTurnId(threadId) !== null ||
      pendingTurnStarts.has(threadId)
    ) {
      return;
    }
    if (!idleProviderSessionSinceMsByThreadId.has(threadId)) {
      idleProviderSessionSinceMsByThreadId.set(threadId, Date.now());
    }
  }

  function observeProviderSessionIdleState(event: ThreadEvent): void {
    if (event.type === "turn/started") {
      pendingTurnStarts.delete(event.threadId);
      markProviderSessionNotIdle(event.threadId);
      return;
    }

    if (event.type === "turn/completed") {
      pendingTurnStarts.delete(event.threadId);
      markHostedProviderSessionIdle(event.threadId);
      return;
    }

    if (event.type === "provider/error" && event.willRetry !== true) {
      pendingTurnStarts.delete(event.threadId);
      markHostedProviderSessionIdle(event.threadId);
    }
  }

  function findReapableIdleProviderSession(
    args: FindReapableIdleProviderSessionArgs,
  ): ReapIdleProviderSessionCandidate | null {
    if (
      threadHasInFlightOperation(args.threadId) ||
      pendingTurnStarts.has(args.threadId) ||
      turnState.getActiveTurnId(args.threadId) !== null
    ) {
      return null;
    }

    const runtimeConfig = threadRuntimeConfigs.get(args.threadId);
    if (
      !runtimeConfig ||
      // The experiment extends release to every restorable provider. It does
      // not gate release: Codex idle sessions are released without it, which
      // is the behavior BB shipped before the experiment.
      (args.providerSessionReapingEnabled
        ? !runtimeConfig.sessionRestorable
        : runtimeConfig.providerId !== CODEX_PROVIDER_ID)
    ) {
      return null;
    }

    const providerThreadId = threadIdentityRegistry.getProviderThreadId(
      args.threadId,
    );
    if (!providerThreadId) {
      return null;
    }

    const idleSinceMs = idleProviderSessionSinceMsByThreadId.get(args.threadId);
    if (idleSinceMs === undefined) {
      return null;
    }

    if (args.nowMs - idleSinceMs < args.idleForMs) {
      return null;
    }

    return {
      idleSinceMs,
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

  /**
   * An unsolicited `provider/recovery` notification: a condition with no
   * runtime request to ride on (a terminal 401 mid-turn). A hint that
   * explains a rejected request arrives on that request's error response
   * instead (see sendCommand). Actions key on `kind` only; the provider id
   * is never consulted.
   */
  function handleRecoveryHint(args: {
    hint: AgentRuntimeProviderRecoveryHint;
    proc: ProviderProcess;
  }): void {
    const { hint } = args;
    options.onProviderRecovery?.(hint);
    if (hint.kind === "restartRecommended" && hint.threadId !== undefined) {
      scheduleBridgeRestart({ proc: args.proc, hint, threadId: hint.threadId });
    }
  }

  /**
   * `restartRecommended`: replace the bridge process the thread runs on and
   * resume the thread on the fresh one. Runs right away when the thread is
   * idle; a thread with an active turn keeps its turn and restarts before
   * the next turn or steer (`restartThreadBridgeIfRecommended`).
   */
  function scheduleBridgeRestart(args: {
    hint: AgentRuntimeProviderRecoveryHint;
    proc: ProviderProcess;
    threadId: string;
  }): void {
    if (!threadRuntimeConfigs.has(args.threadId)) {
      return;
    }
    threadsAwaitingBridgeRestart.set(args.threadId, args.hint);
    if (
      turnState.getActiveTurnId(args.threadId) !== null ||
      threadHasInFlightOperation(args.threadId)
    ) {
      return;
    }
    void runThreadOperation({
      threadId: args.threadId,
      work: async () => {
        const currentConfig = threadRuntimeConfigs.get(args.threadId);
        if (!currentConfig) {
          threadsAwaitingBridgeRestart.delete(args.threadId);
          return;
        }
        await restartThreadBridgeIfRecommended({
          threadId: args.threadId,
          options: currentConfig.options,
          instructions: currentConfig.instructions,
        });
      },
    }).catch((error: unknown) => {
      options.onStderr?.(
        `Bridge restart for thread "${args.threadId}" failed: ${error instanceof Error ? error.message : String(error)}`,
        args.threadId,
      );
    });
  }

  /**
   * A bridge process hosts every live thread of its provider in the
   * environment, so restarting it for one thread restarts it for all of
   * them. The restart runs only while no other thread on the process is
   * mid-turn — the hint is a recommendation, never a reason to kill another
   * thread's work — and every hosted thread is resumed on the fresh process.
   * A deferred restart stays marked and is tried again at the hinted
   * thread's next turn or steer.
   */
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
    if (turnState.getActiveTurnId(args.threadId) !== null) {
      return;
    }
    const proc = providerProcesses.requireProviderProcess({
      processKey: currentConfig.processKey,
      providerId: currentConfig.providerId,
    });
    const hostedThreadIds = [...proc.identity.threadIds].filter(
      (threadId) => threadId !== args.threadId,
    );
    const busyThreadId = hostedThreadIds.find(
      (threadId) =>
        turnState.getActiveTurnId(threadId) !== null ||
        pendingTurnStarts.has(threadId) ||
        threadHasInFlightOperation(threadId),
    );
    if (busyThreadId !== undefined) {
      options.onStderr?.(
        `Deferring the "${currentConfig.providerId}" bridge restart recommended for thread "${args.threadId}": thread "${busyThreadId}" is mid-turn on the same process.`,
        args.threadId,
      );
      return;
    }
    threadsAwaitingBridgeRestart.delete(args.threadId);
    const providerThreadId = requireProviderThreadId(args.threadId);
    // Snapshot before the shutdown detaches every hosted thread.
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
    await resumeThreadFromConfig({
      currentConfig,
      instructions: args.instructions,
      options: args.options,
      providerThreadId,
      threadId: args.threadId,
    });
    for (const hosted of hostedSessions) {
      try {
        await resumeThreadFromConfig({
          currentConfig: hosted.config,
          instructions: hosted.config.instructions,
          options: hosted.config.options,
          providerThreadId: hosted.providerThreadId,
          threadId: hosted.threadId,
        });
      } catch (error) {
        // The thread is no longer live; the server resumes it on its next
        // turn, as after any provider exit.
        options.onStderr?.(
          `Failed to resume thread "${hosted.threadId}" after the bridge restart: ${error instanceof Error ? error.message : String(error)}`,
          hosted.threadId,
        );
      }
    }
  }

  /** Re-resume a thread from the config its live session was built with. */
  async function resumeThreadFromConfig(args: {
    currentConfig: ThreadRuntimeConfig;
    instructions: string | undefined;
    options: AgentRuntimeExecutionOptions;
    providerThreadId: string;
    threadId: string;
  }): Promise<void> {
    const { currentConfig } = args;
    const resumeInstructions = args.instructions ?? currentConfig.instructions;
    await runtime.resumeThread({
      // A graduated provider has no daemon-bundled bridge, so the restart can
      // only rebuild the session from the launch the session started with.
      ...(currentConfig.bridgeLaunch !== undefined
        ? { bridgeLaunch: currentConfig.bridgeLaunch }
        : {}),
      environmentId: currentConfig.environmentId,
      threadId: args.threadId,
      ...(currentConfig.projectId !== undefined
        ? { projectId: currentConfig.projectId }
        : {}),
      providerThreadId: args.providerThreadId,
      providerId: currentConfig.providerId,
      options: args.options,
      ...(resumeInstructions !== undefined
        ? { instructions: resumeInstructions }
        : {}),
      ...(currentConfig.dynamicTools !== undefined
        ? { dynamicTools: currentConfig.dynamicTools }
        : {}),
      ...(currentConfig.disallowedTools !== undefined
        ? { disallowedTools: currentConfig.disallowedTools }
        : {}),
      instructionMode: currentConfig.instructionMode,
    });
  }

  function isAcceptedThreadArchiveError(
    commandType: "thread/archive" | "thread/unarchive",
    message: string,
  ): boolean {
    if (commandType === "thread/archive") {
      return message.includes("no rollout found for thread id");
    }
    return message.includes("no archived rollout found for thread id");
  }

  async function archiveOrUnarchiveThread(
    args: ArchiveOrUnarchiveThreadArgs,
  ): Promise<void> {
    const { commandType, providerId, providerThreadId, threadId } = args;
    const threadConfig = threadRuntimeConfigs.get(threadId);
    const bridgeLaunch = args.bridgeLaunch ?? threadConfig?.bridgeLaunch;
    const processKey =
      threadConfig?.processKey ??
      args.processKey ??
      resolveProviderProcessKey({
        ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
        providerId,
      });
    await providerProcesses.ensureProvider({
      processKey,
      providerId,
      ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
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
    try {
      await sendCommand({
        proc,
        message: cmd,
        resultSchema: ignoredJsonRpcResultSchema,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        isAcceptedThreadArchiveError(commandType, error.message)
      ) {
        // Codex archive/unarchive is not idempotent at the protocol layer;
        // duplicate-state errors mean the requested final state is already
        // reached from bb's perspective.
      } else {
        throw error;
      }
    }
    emitAcceptedCommandEvents({
      command: adapterCommand,
      proc,
      sourceThreadId: threadId,
    });
    if (commandType === "thread/archive") {
      // An archived thread is no longer live in the runtime; the next turn
      // must resume it (after unarchive) instead of reusing stale state.
      forgetThreadRuntimeStateForProviderState(proc.identity, threadId);
    }
    await releaseIdleProviderProcess(proc);
  }

  async function reconfigureThreadIfNeeded(
    args: ReconfigureThreadIfNeededArgs,
  ): Promise<void> {
    const currentConfig = threadRuntimeConfigs.get(args.threadId);
    if (!currentConfig) {
      return;
    }

    const nextOptions = args.options;

    // Instructions are frozen for the life of a provider session: drifted
    // instructions (memory catalog, AGENTS.md edits, plugin dynamic
    // instructions) must never force a thread/resume, because a resume can
    // replace the live CLI session and kill its running background tasks.
    // Fresh instructions apply when the next session is constructed.
    const proc = providerProcesses.requireProviderProcess({
      processKey: currentConfig.processKey,
      providerId: currentConfig.providerId,
    });
    const settingsChange = proc.adapter.classifyExecutionSettingsChange({
      current: currentConfig.options,
      next: nextOptions,
    });
    if (settingsChange !== "session") {
      // Live settings ride on the next turn command; record them without
      // replacing the session (which would kill its background tasks).
      setThreadRuntimeConfig(args.threadId, {
        ...currentConfig,
        options: nextOptions,
      });
      return;
    }

    const providerSkillRoots = currentConfig.skillRoots;
    const envVars = buildThreadShellEnvironment({
      baseShellEnv: options.shellEnv,
      environmentId: currentConfig.environmentId,
      projectId: currentConfig.projectId,
      threadStoragePath: resolveThreadStoragePath({
        options,
        threadId: args.threadId,
      }),
      threadId: args.threadId,
    });

    const adapterCommand: AdapterCommand = {
      type: "thread/resume",
      threadId: args.threadId,
      cwd: currentConfig.workspacePath,
      providerThreadId: requireProviderThreadId(args.threadId),
      options: toProviderExecutionContext({
        envVars,
        execOpts: nextOptions,
        instructions: currentConfig.instructions,
        skillRoots: providerSkillRoots,
      }),
      dynamicTools: currentConfig.dynamicTools,
      disallowedTools: currentConfig.disallowedTools,
      instructionMode: currentConfig.instructionMode,
    };
    const plan = proc.adapter.buildCommandPlan(adapterCommand);
    // The replacement session reports its own restore support. An updated
    // agent can drop loadSession, and a stale `true` would let the idle sweep
    // release a session that can no longer resume.
    let sessionRestorable = currentConfig.sessionRestorable;
    if (plan.kind === "request") {
      const result = await sendCommand({
        proc,
        message: plan,
        resultSchema: threadIdentityResultSchema,
        recovery: {
          providerId: currentConfig.providerId,
          providerThreadId: adapterCommand.providerThreadId,
          threadId: args.threadId,
        },
      });
      const providerThreadId = resolveThreadIdentityResult({
        result,
        threadId: args.threadId,
      });
      if (providerThreadId) {
        recordProviderThreadIdentity(proc, args.threadId, providerThreadId);
      }
      if (result.sessionRestorable !== undefined) {
        sessionRestorable = result.sessionRestorable;
      }
      emitAcceptedCommandEvents({
        command: adapterCommand,
        proc,
        ...(providerThreadId !== undefined ? { providerThreadId } : {}),
        sourceThreadId: args.threadId,
      });
    }

    setThreadRuntimeConfig(args.threadId, {
      ...currentConfig,
      options: nextOptions,
      sessionRestorable,
    });
  }

  function emitTranslatedEvents(args: EmitTranslatedEventsArgs): void {
    for (const event of args.events) {
      if (event.type !== "thread/identity" || !event.providerThreadId) {
        continue;
      }

      if (args.proc.identity.threadIds.has(event.threadId)) {
        recordProviderThreadIdentity(
          args.proc,
          event.threadId,
          event.providerThreadId,
        );
        continue;
      }

      const bbThreadId =
        threadIdentityRegistry.resolvePendingProviderThreadIdentity(
          args.proc.identity,
        );
      if (bbThreadId) {
        recordProviderThreadIdentity(
          args.proc,
          bbThreadId,
          event.providerThreadId,
        );
      }
    }

    for (const event of args.events) {
      const resolvedBbThreadId =
        threadIdentityRegistry.resolveProviderEventThreadId({
          eventThreadId: event.threadId,
          providerState: args.proc.identity,
          sourceThreadId: args.sourceThreadId,
        });

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
      turnState.observe(normalizedEvent);
      backgroundWorkState.observe(normalizedEvent);
      observeProviderSessionIdleState(normalizedEvent);
      options.onEvent(normalizedEvent);
      threadGoalState.observe(normalizedEvent);
    }
  }

  function emitAcceptedCommandEvents(
    args: EmitAcceptedCommandEventsArgs,
  ): void {
    const events = args.proc.adapter.translateAcceptedCommand({
      command: args.command,
      ...(args.providerThreadId !== undefined
        ? { providerThreadId: args.providerThreadId }
        : {}),
    });
    if (events.length === 0) {
      return;
    }
    emitTranslatedEvents({
      events,
      proc: args.proc,
      sourceThreadId: args.sourceThreadId,
    });
  }

  function handleProviderNotification(args: RuntimeParsedMessageArgs): void {
    const sourceThreadId = getJsonRpcStringParam(args.parsed, "threadId");
    if (
      sourceThreadId !== undefined &&
      suppressedThreadEventIds.has(sourceThreadId)
    ) {
      return;
    }
    // A typed recovery hint is a runtime signal, not timeline traffic: act on
    // it, forward it, and let the translator see nothing of it.
    const recoveryHint = args.proc.adapter.decodeRecoveryHint?.(args.parsed);
    if (recoveryHint !== null && recoveryHint !== undefined) {
      handleRecoveryHint({
        hint: { providerId: args.proc.providerId, ...recoveryHint },
        proc: args.proc,
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
        getActiveTurnId: (threadId) => turnState.getActiveTurnId(threadId),
        getThreadExecutionOptions: (threadId) =>
          threadRuntimeConfigs.get(threadId)?.options,
        onInteractiveRequest: options.onInteractiveRequest,
        onToolCall: options.onToolCall,
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

    // The runtime does NOT interpret notification content — it delegates
    // entirely to the adapter's translateEvent. Every provider now speaks the
    // canonical bridge protocol, so this is always a bb/* envelope the generic
    // adapter unwraps; the branch stays provider-agnostic regardless.
    handleProviderNotification({
      parsed: parsedLine.parsed,
      proc,
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

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
    async ensureProvider({ providerId, acpLaunchSpec, bridgeLaunch }) {
      await providerProcesses.ensureProvider({
        processKey: resolveProviderProcessKey({
          ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
          ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
          providerId,
        }),
        providerId,
        ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
        ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
      });
    },

    async startThread({
      environmentId,
      threadId,
      projectId,
      providerId,
      acpLaunchSpec,
      bridgeLaunch,
      clientRequestId,
      input,
      inputGroups,
      options: execOpts,
      instructions,
      dynamicTools,
      disallowedTools,
      instructionMode = "append",
      fork,
    }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const processKey = resolveProviderProcessKey({
            ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
            ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
            providerId,
          });
          await runtime.ensureProvider({
            providerId,
            ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
            ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
          });

          const proc = providerProcesses.requireProviderProcess({
            processKey,
            providerId,
          });
          const providerSkillRoots = skillRootsForProvider(providerId);
          assertProviderSupportsExecutionOptions({
            adapter: proc.adapter,
            options: execOpts,
            providerId,
          });
          threadIdentityRegistry.registerThreadProvider({
            providerId,
            providerState: proc.identity,
            shouldWaitForProviderIdentity: true,
            threadId,
          });
          setThreadRuntimeConfig(threadId, {
            ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
            dynamicTools,
            disallowedTools,
            environmentId,
            instructionMode,
            instructions,
            options: execOpts,
            processKey,
            projectId,
            providerId,
            sessionRestorable: isSessionRestorableProvider(providerId),
            skillRoots: providerSkillRoots,
            workspacePath: options.workspacePath,
          });

          const envVars = buildThreadShellEnvironment({
            baseShellEnv: options.shellEnv,
            environmentId,
            projectId,
            threadStoragePath: resolveThreadStoragePath({
              options,
              threadId,
            }),
            threadId,
          });

          const providerExecutionContext = toProviderExecutionContext({
            envVars,
            execOpts,
            instructions,
            skillRoots: providerSkillRoots,
          });
          const adapterCommand: AdapterCommand = fork
            ? {
                type: "thread/fork",
                threadId,
                cwd: options.workspacePath,
                sourceProviderThreadId: fork.sourceProviderThreadId,
                options: providerExecutionContext,
                dynamicTools,
                disallowedTools,
                instructionMode,
              }
            : {
                type: "thread/start",
                threadId,
                cwd: options.workspacePath,
                options: providerExecutionContext,
                dynamicTools,
                disallowedTools,
                instructionMode,
              };
          let resolved: string;
          try {
            // Inside the try: building the plan can itself reject the command
            // (a fork the bridge's handshake says it cannot perform), and that
            // is a failed session construction like any other.
            const cmd = requireProviderRequestPlan({
              commandType: adapterCommand.type,
              plan: proc.adapter.buildCommandPlan(adapterCommand),
              providerId,
            });
            const result = await sendCommand({
              proc,
              message: cmd,
              resultSchema: threadIdentityResultSchema,
              timeoutMs: THREAD_CREATION_REQUEST_TIMEOUT_MS,
              // A fork reads the source session, so an archived source fails
              // the same way a resume does. A plain start has no session to
              // unarchive.
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
            const providerThreadId = resolveThreadIdentityResult({
              result,
              threadId,
            });
            updateSessionRestoreCapability(threadId, result.sessionRestorable);
            if (providerThreadId) {
              recordProviderThreadIdentity(proc, threadId, providerThreadId);
            }
            emitAcceptedCommandEvents({
              command: adapterCommand,
              proc,
              ...(providerThreadId !== undefined ? { providerThreadId } : {}),
              sourceThreadId: threadId,
            });

            const identity = await waitForProviderThreadIdentity(
              proc,
              threadId,
              5000,
            );
            if (!identity) {
              throw new Error(
                `Provider "${providerId}" did not return a providerThreadId for thread "${threadId}" within 5 seconds`,
              );
            }
            resolved = identity;
          } catch (startError) {
            // A failed session construction has no session to keep: drop the
            // thread's runtime state and stop a thread-scoped process so the
            // failure cannot leak an idle provider under the daemon. A failed
            // FIRST TURN (below) deliberately keeps both — the constructed
            // session stays live for a retry.
            forgetThreadRuntimeStateForProviderState(proc.identity, threadId);
            try {
              await releaseIdleProviderProcess(proc);
            } catch (shutdownError) {
              options.onStderr?.(
                `Failed to stop the provider after thread "${threadId}" session construction failed: ${shutdownError instanceof Error ? shutdownError.message : String(shutdownError)}`,
              );
            }
            throw startError;
          }

          if (input && input.length > 0) {
            if (clientRequestId === undefined) {
              throw new Error(
                `Thread start with input requires a client request id for ${threadId}`,
              );
            }
            await runtime.runTurn({
              threadId,
              input,
              ...(inputGroups !== undefined ? { inputGroups } : {}),
              clientRequestId,
              options: execOpts,
              instructions,
            });
          }

          markHostedProviderSessionIdle(threadId);
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
      sourceProviderThreadId,
      retainThroughProviderCheckpoint,
      acpLaunchSpec,
      bridgeLaunch,
      options: execOpts,
      instructions,
      dynamicTools,
      disallowedTools,
      instructionMode = "append",
    }) {
      const existing = stagedThreadRewinds.get(leaseId);
      if (existing !== undefined) {
        // The server mints a fresh lease per attempt, so a duplicate can only
        // be a replay of this exact request; return the same staged fork.
        return existing.state === "preparing"
          ? existing.promise
          : { providerThreadId: existing.providerThreadId };
      }

      const preparation = runThreadOperation({
        threadId,
        work: async () => {
          const processKey = resolveProviderProcessKey({
            ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
            ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
            providerId,
          });
          await runtime.ensureProvider({
            providerId,
            ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
            ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
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
          const providerSkillRoots = skillRootsForProvider(providerId);
          assertProviderSupportsExecutionOptions({
            adapter: proc.adapter,
            options: execOpts,
            providerId,
          });

          // The lease id is a server-minted UUID, so it is safe inside
          // identities that provider adapters may turn into filesystem keys.
          const stagingThreadId = `${threadId}:rewind:${leaseId}`;
          suppressedThreadEventIds.add(stagingThreadId);
          threadIdentityRegistry.registerThreadProvider({
            providerId,
            providerState: proc.identity,
            shouldWaitForProviderIdentity: true,
            threadId: stagingThreadId,
          });
          let retainedForDiscard = false;
          let providerThreadIdForCleanup: string | undefined;
          try {
            const envVars = buildThreadShellEnvironment({
              baseShellEnv: options.shellEnv,
              environmentId,
              projectId,
              threadStoragePath: resolveThreadStoragePath({
                options,
                threadId,
              }),
              threadId,
            });
            const adapterCommand: AdapterCommand = {
              type: "thread/fork",
              threadId: stagingThreadId,
              cwd: options.workspacePath,
              sourceProviderThreadId,
              sourceProviderCheckpointId: retainThroughProviderCheckpoint,
              options: toProviderExecutionContext({
                envVars,
                execOpts,
                instructions,
                skillRoots: providerSkillRoots,
              }),
              dynamicTools,
              disallowedTools,
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
              timeoutMs: THREAD_CREATION_REQUEST_TIMEOUT_MS,
              // The staging fork reads the source session, so an archived
              // source is recovered the way a plain fork's is: the hint
              // rides this request's own rejection, and the staging thread's
              // suppressed event stream plays no part in it.
              recovery: {
                ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
                processKey,
                providerId,
                providerThreadId: sourceProviderThreadId,
                threadId: stagingThreadId,
              },
            });
            // An ambiguous threadId is not sufficient to adopt a provider
            // thread, but it is safe to use for best-effort cleanup because
            // the BB staging id is unique to this rewind operation.
            providerThreadIdForCleanup =
              result.providerThreadId ??
              result.thread?.id ??
              result.threadId ??
              undefined;
            const providerThreadId = resolveThreadIdentityResult({
              result,
              threadId: stagingThreadId,
            });
            if (!providerThreadId) {
              throw new Error(
                `${providerId} did not return a provider thread for rewind lease ${leaseId}`,
              );
            }
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
      acpLaunchSpec,
      bridgeLaunch,
      options: execOpts,
      instructions,
      dynamicTools,
      disallowedTools,
      instructionMode = "append",
    }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const processKey = resolveProviderProcessKey({
            ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
            ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
            providerId,
          });
          await runtime.ensureProvider({
            providerId,
            ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
            ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
          });

          const proc = providerProcesses.requireProviderProcess({
            processKey,
            providerId,
          });
          const providerSkillRoots = skillRootsForProvider(providerId);
          assertProviderSupportsExecutionOptions({
            adapter: proc.adapter,
            options: execOpts,
            providerId,
          });
          threadIdentityRegistry.registerThreadProvider({
            providerId,
            providerState: proc.identity,
            shouldWaitForProviderIdentity: providerThreadId === undefined,
            threadId,
          });
          setThreadRuntimeConfig(threadId, {
            ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
            dynamicTools,
            disallowedTools,
            environmentId,
            instructionMode,
            instructions,
            options: execOpts,
            processKey,
            projectId,
            providerId,
            sessionRestorable: isSessionRestorableProvider(providerId),
            skillRoots: providerSkillRoots,
            workspacePath: options.workspacePath,
          });

          if (providerThreadId) {
            recordProviderThreadIdentity(proc, threadId, providerThreadId);
          }

          const envVars = buildThreadShellEnvironment({
            baseShellEnv: options.shellEnv,
            environmentId,
            projectId,
            threadStoragePath: resolveThreadStoragePath({
              options,
              threadId,
            }),
            threadId,
          });

          const adapterCommand: AdapterCommand = {
            type: "thread/resume",
            threadId,
            cwd: options.workspacePath,
            providerThreadId:
              providerThreadId ?? requireProviderThreadId(threadId),
            options: toProviderExecutionContext({
              envVars,
              execOpts,
              instructions,
              skillRoots: providerSkillRoots,
            }),
            dynamicTools,
            disallowedTools,
            instructionMode,
          };
          const plan = proc.adapter.buildCommandPlan(adapterCommand);
          if (plan.kind === "noop") {
            const currentProviderThreadId =
              providerThreadId ??
              threadIdentityRegistry.getProviderThreadId(threadId);
            if (!currentProviderThreadId) {
              throw new Error(
                `No provider thread id available for ${threadId}`,
              );
            }
            return { providerThreadId: currentProviderThreadId };
          }

          const result = await sendCommand({
            proc,
            message: plan,
            resultSchema: threadIdentityResultSchema,
            recovery: {
              providerId,
              providerThreadId: adapterCommand.providerThreadId,
              threadId,
            },
          });
          const resolvedId =
            resolveThreadIdentityResult({ result, threadId }) ??
            providerThreadId ??
            threadIdentityRegistry.getProviderThreadId(threadId);
          if (!resolvedId) {
            throw new Error(
              `Provider resume did not return a thread id for ${threadId}`,
            );
          }
          recordProviderThreadIdentity(proc, threadId, resolvedId);
          updateSessionRestoreCapability(threadId, result.sessionRestorable);
          emitAcceptedCommandEvents({
            command: adapterCommand,
            proc,
            providerThreadId: resolvedId,
            sourceThreadId: threadId,
          });

          markHostedProviderSessionIdle(threadId);
          return { providerThreadId: resolvedId };
        },
      });
    },

    async runTurn({
      threadId,
      input,
      inputGroups,
      clientRequestId,
      options: execOpts,
      instructions,
    }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const pid = threadIdentityRegistry.resolveProviderForThread(threadId);
          requireProviderProcessForThread(threadId);
          await restartThreadBridgeIfRecommended({
            threadId,
            options: execOpts,
            instructions,
          });
          // A restart replaces the thread's provider process, so resolve the
          // process again before constructing the turn command.
          const proc = requireProviderProcessForThread(threadId);
          assertProviderSupportsExecutionOptions({
            adapter: proc.adapter,
            options: execOpts,
            providerId: pid,
          });
          await reconfigureThreadIfNeeded({
            threadId,
            options: execOpts,
          });

          const adapterCommand: AdapterCommand = {
            type: "turn/start",
            threadId,
            providerThreadId: requireProviderThreadId(threadId),
            input,
            ...(inputGroups !== undefined ? { inputGroups } : {}),
            clientRequestId,
            options: toProviderExecutionContext({
              envVars: {},
              execOpts,
              instructions,
            }),
          };
          const cmd = requireProviderRequestPlan({
            commandType: adapterCommand.type,
            plan: proc.adapter.buildCommandPlan(adapterCommand),
            providerId: pid,
          });
          pendingTurnStarts.set(threadId, {
            sinceMs: Date.now(),
            watchdogFired: false,
          });
          markProviderSessionNotIdle(threadId);
          try {
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
          } catch (error) {
            pendingTurnStarts.delete(threadId);
            markHostedProviderSessionIdle(threadId);
            throw error;
          }
          emitAcceptedCommandEvents({
            command: adapterCommand,
            proc,
            sourceThreadId: threadId,
          });
        },
      });
    },

    async steerTurn({
      threadId,
      expectedTurnId,
      input,
      inputGroups,
      clientRequestId,
      options: execOpts,
      instructions,
    }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const pid = threadIdentityRegistry.resolveProviderForThread(threadId);
          const currentProc = requireProviderProcessForThread(threadId);
          assertProviderSupportsExecutionOptions({
            adapter: currentProc.adapter,
            options: execOpts,
            providerId: pid,
          });

          const activeTurnId = turnState.getActiveTurnId(threadId);
          if (activeTurnId !== expectedTurnId) {
            options.onStderr?.(
              `Ignoring stale steer for thread "${threadId}" on turn "${expectedTurnId}"; active turn is ${activeTurnId ?? "none"}.`,
            );
            return {
              status: "stale",
              activeTurnId,
            };
          }

          await restartThreadBridgeIfRecommended({
            threadId,
            options: execOpts,
            instructions,
          });
          // A restart replaces the thread's provider process, so resolve the
          // process again before constructing the steer command.
          const proc = requireProviderProcessForThread(threadId);
          await reconfigureThreadIfNeeded({
            threadId,
            options: execOpts,
          });

          const adapterCommand: AdapterCommand = {
            type: "turn/steer",
            threadId,
            providerThreadId: requireProviderThreadId(threadId),
            expectedTurnId,
            input,
            ...(inputGroups !== undefined ? { inputGroups } : {}),
            clientRequestId,
            options: toProviderExecutionContext({
              envVars: {},
              execOpts,
              instructions,
            }),
          };
          const cmd = requireProviderRequestPlan({
            commandType: adapterCommand.type,
            plan: proc.adapter.buildCommandPlan(adapterCommand),
            providerId: pid,
          });
          try {
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
          } catch (error) {
            // `staleTurn`: the turn this steer targeted is gone. sendCommand
            // rethrows the rejection with its hint for the steer to read.
            if (
              error instanceof JsonRpcResponseError &&
              error.recovery?.kind === "staleTurn"
            ) {
              options.onStderr?.(
                `Dropping stale steer for thread "${threadId}": ${error.recovery.message}`,
                threadId,
              );
              turnState.clearThread(threadId);
              return { status: "stale", activeTurnId: null };
            }
            throw error;
          }
          emitAcceptedCommandEvents({
            command: adapterCommand,
            proc,
            sourceThreadId: threadId,
          });
          return { status: "steered" };
        },
      });
    },

    async stopThread({ threadId }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const pid = threadIdentityRegistry.resolveProviderForThread(threadId);
          const proc = requireProviderProcessForThread(threadId);
          const providerThreadId = requireProviderThreadId(threadId);
          const activeTurnId = turnState.getActiveTurnId(threadId);
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

          const result = await sendCommand({
            proc,
            message: cmd,
            resultSchema: providerThreadStopResultSchema,
          });
          emitAcceptedCommandEvents({
            command: adapterCommand,
            proc,
            sourceThreadId: threadId,
          });
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
          emitAcceptedCommandEvents({
            command: adapterCommand,
            proc,
            sourceThreadId: threadId,
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
            ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
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
            ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
            commandType: "thread/unarchive",
            providerId,
            providerThreadId,
            threadId,
          });
        },
      });
    },

    async listModels({ providerId, acpLaunchSpec, bridgeLaunch, cwd }) {
      await runtime.ensureProvider({
        providerId,
        ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
        ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
      });
      const proc = providerProcesses.requireProviderProcess({
        processKey: resolveProviderProcessKey({
          ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
          ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
          providerId,
        }),
        providerId,
      });
      const command = requireProviderRequestPlan({
        commandType: "model/list",
        plan: proc.adapter.buildCommandPlan({
          type: "model/list",
          ...(cwd !== undefined ? { cwd } : {}),
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

    async providerHealth({ providerId, acpLaunchSpec, bridgeLaunch, cwd }) {
      await runtime.ensureProvider({
        providerId,
        ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
        ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
      });
      const proc = providerProcesses.requireProviderProcess({
        processKey: resolveProviderProcessKey({
          ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
          ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
          providerId,
        }),
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
        resultSchema: experimental_providerHealthResultSchema,
      });
    },

    async providerUsage({ providerId, acpLaunchSpec, bridgeLaunch, cwd }) {
      await runtime.ensureProvider({
        providerId,
        ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
        ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
      });
      const proc = providerProcesses.requireProviderProcess({
        processKey: resolveProviderProcessKey({
          ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
          ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
          providerId,
        }),
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
        resultSchema: experimental_providerUsageResultSchema,
      });
    },

    async providerInstallationStatus({
      providerId,
      acpLaunchSpec,
      bridgeLaunch,
      cwd,
      requirement,
    }) {
      await runtime.ensureProvider({
        providerId,
        ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
        ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
      });
      const proc = providerProcesses.requireProviderProcess({
        processKey: resolveProviderProcessKey({
          ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
          ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
          providerId,
        }),
        providerId,
      });
      const plan = requireProviderRequestPlan({
        commandType: "provider/installation/status",
        plan: proc.adapter.buildCommandPlan({
          type: "provider/installation/status",
          ...(cwd !== undefined ? { cwd } : {}),
          ...(requirement !== undefined ? { requirement } : {}),
        }),
        providerId,
      });
      return await sendCommand({
        proc,
        message: plan,
        resultSchema: experimental_providerInstallationStatusSchema,
      });
    },

    async providerInstallationRun({
      providerId,
      acpLaunchSpec,
      bridgeLaunch,
      cwd,
      action,
    }) {
      await runtime.ensureProvider({
        providerId,
        ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
        ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
      });
      const proc = providerProcesses.requireProviderProcess({
        processKey: resolveProviderProcessKey({
          ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
          ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
          providerId,
        }),
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
        resultSchema: experimental_providerInstallationRunResultSchema,
      });
    },

    listRunningProviders() {
      return providerProcesses.listRunningProviders();
    },

    getActiveTurnId(threadId) {
      return turnState.getActiveTurnId(threadId);
    },

    waitForActiveTurn(threadId, args) {
      return turnState.waitForActiveTurn({
        threadId,
        timeoutMs: args.timeoutMs,
      });
    },

    getProviderSession(threadId) {
      return threadIdentityRegistry.getProviderSession(threadId);
    },

    async reapIdleProviderSessions({
      idleForMs,
      nowMs,
      providerSessionReapingEnabled,
      runThreadExclusive,
    }) {
      const reapedSessions: ReapedIdleProviderSession[] = [];
      for (const threadId of [...threadRuntimeConfigs.keys()]) {
        const release = async (): Promise<ReapedIdleProviderSession | null> => {
          const candidate = findReapableIdleProviderSession({
            idleForMs,
            nowMs,
            providerSessionReapingEnabled,
            threadId,
          });
          if (!candidate) {
            return null;
          }

          try {
            // A session whose process is gone has nothing to release.
            providerProcesses.requireProviderProcess({
              processKey: candidate.runtimeConfig.processKey,
              providerId: candidate.runtimeConfig.providerId,
            });
          } catch {
            return null;
          }
          // Open background tasks and open delegations (a codex native
          // sub-agent still running, or still owed a followup turn) are
          // live provider work; reaping the session would destroy it.
          if (backgroundWorkState.hasOpenThreadWork(candidate.threadId)) {
            return null;
          }

          try {
            await runtime.stopThread({ threadId: candidate.threadId });
          } catch (error) {
            // One damaged session must not block every later candidate, so
            // report the failure and let the next pass retry this thread.
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
          ...turnState.getActiveThreadIds(),
          ...pendingTurnStarts.keys(),
        ]),
      ];
    },

    hasOpenBackgroundWork() {
      return backgroundWorkState.hasOpenWork();
    },

    async shutdown() {
      clearInterval(turnStartWatchdogTimer);
      await Promise.all(
        [...stagedThreadRewinds.keys()].map((leaseId) =>
          discardStagedThreadRewind(leaseId),
        ),
      );
      idleProviderSessionSinceMsByThreadId.clear();
      pendingTurnStarts.clear();
      threadOperationCounts.clear();
      threadGoalState.clear();
      turnState.clear();
      backgroundWorkState.clear();
      threadEventGrammar.clear();
      await providerProcesses.shutdown();
    },
  };

  return runtime;
}
