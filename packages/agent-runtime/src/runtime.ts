import path from "node:path";
import { z } from "zod";
import {
  normalizeProviderThreadNameEvent,
  toProviderExternalThreadName,
} from "@bb/domain";
import type {
  DynamicTool,
  InstructionMode,
  ThreadEvent,
} from "@bb/domain";
import type { AdapterCommand } from "./provider-adapter.js";
import {
  BRIDGE_JSON_RPC_ERRORS,
  providerHealthResultSchema,
  providerInstallationRunResultSchema,
  providerInstallationStatusSchema,
  providerUsageResultSchema,
  ThreadEventGrammar,
  threadIdentityResultSchema,
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
  hasChildProcessExited,
  type RuntimeProviderProcess,
} from "./runtime-provider-process.js";
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
} from "./types.js";
import { buildThreadShellEnvironment } from "./thread-shell-environment.js";
import {
  bridgeLaunchProcessKey,
} from "./bridge-launch-process-key.js";

interface RecordThreadExecutionOptionsArgs {
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
  bridgeLaunch: AgentRuntimeBridgeLaunch;
  providerId: string;
}

interface ArchiveOrUnarchiveThreadArgs {
  /**
   * The launch to spawn the bridge with. Absent only for a recovery
   * unarchive on a thread with a runtime config, which supplies it.
   */
  bridgeLaunch?: AgentRuntimeBridgeLaunch;
  commandType: "thread/archive" | "thread/unarchive";
  providerId: string;
  providerThreadId: string;
  threadId: string;
}

/**
 * What a request needs so the runtime can act on the recovery hint a bridge
 * attaches to its rejection: the session to unarchive, the thread to retry.
 * `bridgeLaunch` pins the process for a thread that has no runtime config
 * yet (a rewind staging fork); every other thread's config carries it.
 */
interface RequestRecoveryArgs {
  bridgeLaunch?: AgentRuntimeBridgeLaunch;
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
  bridgeLaunch: AgentRuntimeBridgeLaunch;
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
const DEFAULT_THREAD_CREATION_REQUEST_TIMEOUT_MS = 2 * 60_000;
/** How long a failed construction waits for the bridge to release the thread. */
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

/**
 * Coordinates provider processes for an environment and bridges provider
 * JSON-RPC traffic into bb thread events, dynamic tool calls, and pending
 * interactions.
 */
export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
  const additionalWorkspaceWriteRoots =
    options.additionalWorkspaceWriteRoots ?? [];
  const skillRoots = options.skillRoots ?? [];
  for (const skillRoot of skillRoots) {
    // Every root goes to every provider process in the one generic
    // `skills/configure` shape; it must be addressable from any of them.
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
  /**
   * Threads whose bridge raised `restartRecommended` while a turn was
   * active: the restart runs before the thread's next turn or steer.
   */
  const threadsAwaitingBridgeRestart = new Map<
    string,
    AgentRuntimeProviderRecoveryHint
  >();
  /**
   * Threads whose unsolicited `restartRecommended` hint arrived while an
   * operation was in flight and no turn was open: the restart is retried as
   * soon as the operations drain. A hint carried by a rejected request never
   * joins this set — that restart waits for the thread's next turn by design.
   */
  const threadsRetryingBridgeRestartOnIdle = new Set<string>();
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
    // A plugin-delivered bridge keys process identity by its artifact hash AND
    // by the declaration facts baked into the adapter at spawn (capabilities,
    // static provider options): a plugin can change either one alone, and
    // whichever changed, the running adapter is the superseded one.
    return `${args.providerId}#bridge:${bridgeLaunchProcessKey(args.bridgeLaunch)}`;
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

  /**
   * `thread/stop { release }` for a thread the runtime is about to forget
   * without a settled session (a construction that failed or timed out on
   * the runtime's side). The bridge may have nothing for the thread, may
   * reject, or may not answer in time; none of that changes the outcome, so
   * every failure is logged and swallowed.
   */
  async function releaseThreadOnBridgeBestEffort(args: {
    proc: ProviderProcess;
    threadId: string;
  }): Promise<void> {
    if (hasChildProcessExited(args.proc.child)) {
      // A bridge that has exited holds nothing for the thread and cannot
      // answer: asking would only wait out the request's timeout.
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

  /**
   * A failed session construction (thread/start, thread/resume or a fork)
   * has no session to keep. The bridge may still hold one — the request
   * timed out on the runtime's side, or its result carried no identity — so
   * tell it to release the thread (best effort, bounded) before the runtime
   * forgets the thread; otherwise a child of the shared provider process
   * would run with no owner. The caller rethrows its own error.
   */
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
        ...(args.timeoutMs !== undefined
          ? { timeoutMs: args.timeoutMs }
          : {}),
      },
    });
  }

  /**
   * The recovery a rejected request gets: the `recovery` args are the
   * session the actions that need one (unarchive, retry) act on; a command
   * with no session of its own (model/list, a plain thread/start) passes
   * none. `allowUnarchive` is on for a request's first rejection and off for
   * the retry after an unarchive — the protocol promises one retry, not a
   * loop.
   */
  interface RequestRecoveryPolicy<TResult> {
    allowUnarchive: boolean;
    proc: ProviderProcess;
    recovery: RequestRecoveryArgs | undefined;
    request: SendJsonRpcRequestArgs<TResult>;
  }

  /**
   * Send the request on `proc` and act on the hint its rejection carries. The
   * hint rides the rejection itself (`error.data.recovery`), so it can only
   * ever explain this request; a timeout or a bridge exit has no response and
   * therefore no hint. A command with no session still forwards the hint and
   * types the error, which is the only way an `authRequired` reaches the
   * daemon as a typed `auth_required` now that no regex reads the message.
   */
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

  /**
   * The per-kind action for a rejected request (docs/provider-bridge-protocol.md
   * "Recovery hints"). Every rejection of the request goes through here —
   * the first one, a rate-limit ladder rung, the retry after an unarchive —
   * so a hint means the same thing whichever attempt it arrived on.
   */
  async function actOnRejection<TResult>(
    args: RequestRecoveryPolicy<TResult> & {
      error: unknown;
      hint: AgentRuntimeProviderRecoveryHint;
    },
  ): Promise<TResult> {
    const { error, hint, recovery } = args;
    switch (hint.kind) {
      case "sessionArchived":
        // Retryable with a session to act on: unarchive it and retry once.
        // Otherwise the bridge says the session cannot be unarchived from
        // here (a fork source it cannot reopen, for example), or the retry
        // after an unarchive is archived again.
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
        // The request itself failed and is reported as is; the restart runs
        // once this operation is over (before the thread's next turn).
        handleRecoveryHint({ hint, proc: args.proc, source: "rejection" });
        throw error;
      case "staleTurn":
        // Only a steer can be stale; steerTurn claims this hint itself.
        throw error;
    }
  }

  /**
   * The rejection's hint, stamped with the provider it came from and, for a
   * request with a session, the thread it is about.
   */
  function rejectionHint(
    error: unknown,
    scope: { providerId: string; threadId?: string },
  ): AgentRuntimeProviderRecoveryHint | null {
    if (!(error instanceof JsonRpcResponseError) || error.recovery === null) {
      return null;
    }
    return { ...scope, ...error.recovery };
  }

  /**
   * The typed error an `authRequired` or `rateLimited` rejection becomes.
   * The code is named by the caller's `case`, never derived from the hint:
   * no other kind has a typed error.
   */
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

  /**
   * `sessionArchived`: unarchive the session, then retry the request once.
   * The retry is a request like any other: a hint on its rejection gets its
   * own action (a typed `authRequired`, a rate-limit ladder, a scheduled
   * restart), except that a second `sessionArchived` is reported, not
   * unarchived again.
   */
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

    return sendRequestWithRecovery({
      allowUnarchive: false,
      proc: retryProc,
      recovery,
      request: args.request,
    });
  }

  /**
   * `rateLimited { retryable: true }`: re-send on a short bounded ladder. A
   * rung that is rate limited again climbs to the next; a rung rejected with
   * any other hint ends the ladder and gets that hint's own action, exactly
   * as a first rejection with it would; the failure after the last rung
   * surfaces as the typed `rate_limited` error.
   */
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
          // The bridge rejected for a different, untyped reason: report it.
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
    // Still rate limited after the last rung: forward the hint so the daemon
    // learns the provider is rate limited, not only that this request failed.
    handleRecoveryHint({ hint: lastHint, proc: args.proc, source: "rejection" });
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
    threadsRetryingBridgeRestartOnIdle.delete(threadId);
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
      retryBridgeRestartOnIdle(threadId);
      return;
    }
    threadOperationCounts.set(threadId, current - 1);
  }

  /**
   * A `restartRecommended` hint that reached the thread while one of its
   * operations was in flight was kept, not scheduled. One read can carry the
   * turn/start response, the turn's terminal delta and the hint together: the
   * response settles the turn operation on a microtask that runs only after
   * the whole batch, so the hint still finds the operation in flight and,
   * without this, waits for the thread's next turn. Schedule it now that the
   * thread is idle, exactly as if the hint had arrived one read later. A
   * thread whose turn is still open keeps waiting for that turn.
   */
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
      if (
        threadHasInFlightOperation(threadId) ||
        turnState.getActiveTurnId(threadId) !== null
      ) {
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

  function assertThreadCanStartTurn(threadId: string): void {
    if (
      turnState.getActiveTurnId(threadId) !== null ||
      pendingTurnStarts.has(threadId)
    ) {
      throw new Error(
        `Refusing to start a competing turn for thread "${threadId}" while another turn is active or starting`,
      );
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
    /**
     * A hint carried by a rejected request restarts before the thread's next
     * turn; an unsolicited one restarts as soon as the thread is idle.
     */
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

  /**
   * `restartRecommended`: replace the bridge process the thread runs on and
   * resume the thread on the fresh one. Runs right away when the thread is
   * idle; a thread with an active turn keeps its turn and restarts before
   * the next turn or steer (`restartThreadBridgeIfRecommended`).
   */
  function scheduleBridgeRestart(args: {
    hint: AgentRuntimeProviderRecoveryHint;
    retryOnIdle: boolean;
    threadId: string;
  }): void {
    if (!threadRuntimeConfigs.has(args.threadId)) {
      return;
    }
    threadsAwaitingBridgeRestart.set(args.threadId, args.hint);
    if (turnState.getActiveTurnId(args.threadId) !== null) {
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
   * mid-turn or holds open background work — the hint is a recommendation,
   * never a reason to kill another thread's work — and every hosted thread
   * is resumed on the fresh process. A deferred restart stays marked and is
   * tried again at the hinted thread's next turn or steer.
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
        threadHasInFlightOperation(threadId) ||
        // Open background tasks and delegations are live provider work that
        // dies with the process, exactly as the idle reaper sees them.
        backgroundWorkState.hasOpenThreadWork(threadId),
    );
    if (busyThreadId !== undefined) {
      options.onStderr?.(
        `Deferring the "${currentConfig.providerId}" bridge restart recommended for thread "${args.threadId}": thread "${busyThreadId}" is mid-turn or has open background work on the same process.`,
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
      // The shutdown detached every sibling, and the daemon resumes a
      // detached thread on its next command without waiting for this loop.
      // A sibling that is live again — or on its way: an operation in
      // flight, a turn pending or active — was rebuilt by that path, and a
      // second thread/resume would replace the session it now runs on
      // (codex, pi and the ACP kit close the existing session on resume),
      // killing the turn the daemon just started.
      if (
        threadIdentityRegistry.getProviderSession(hosted.threadId) !== null ||
        threadHasInFlightOperation(hosted.threadId) ||
        pendingTurnStarts.has(hosted.threadId) ||
        turnState.getActiveTurnId(hosted.threadId) !== null
      ) {
        continue;
      }
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
      // The restart can only rebuild the session from the launch the session
      // started with.
      bridgeLaunch: currentConfig.bridgeLaunch,
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
      // An archived thread is no longer live in the runtime; the next turn
      // must resume it (after unarchive) instead of reusing stale state.
      forgetThreadRuntimeStateForProviderState(proc.identity, threadId);
    }
    await releaseIdleProviderProcess(proc);
  }

  function recordThreadExecutionOptions(
    args: RecordThreadExecutionOptionsArgs,
  ): void {
    const currentConfig = threadRuntimeConfigs.get(args.threadId);
    if (!currentConfig) {
      return;
    }
    // Execution settings ride on the next turn command and the bridge
    // reconciles them internally, so record them without replacing the
    // session (which would kill its background tasks). Instructions are
    // frozen for the life of a provider session for the same reason: drifted
    // instructions (memory catalog, AGENTS.md edits, plugin dynamic
    // instructions) never force a thread/resume; fresh instructions apply
    // when the next session is constructed.
    setThreadRuntimeConfig(args.threadId, {
      ...currentConfig,
      options: args.options,
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
      if (
        recoveryHint.threadId !== undefined &&
        !args.proc.identity.threadIds.has(recoveryHint.threadId)
      ) {
        // A process speaks only for the threads it hosts, as on the event
        // path: a session-scoped hint naming any other thread (another
        // provider's, or one that moved to a replacement process) would
        // otherwise restart a bridge the emitter has nothing to do with.
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
    async ensureProvider({ providerId, bridgeLaunch }) {
      await providerProcesses.ensureProvider({
        processKey: resolveProviderProcessKey({ bridgeLaunch, providerId }),
        providerId,
        bridgeLaunch,
      });
    },

    async startThread({
      environmentId,
      threadId,
      projectId,
      providerId,
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
            bridgeLaunch,
            providerId,
          });
          await runtime.ensureProvider({ providerId, bridgeLaunch });

          const proc = providerProcesses.requireProviderProcess({
            processKey,
            providerId,
          });
          assertProviderSupportsExecutionOptions({
            adapter: proc.adapter,
            options: execOpts,
            providerId,
          });
          threadIdentityRegistry.registerThreadProvider({
            providerId,
            providerState: proc.identity,
            expectsIdentityNotification: true,
            threadId,
          });
          setThreadRuntimeConfig(threadId, {
            bridgeLaunch,
            dynamicTools,
            disallowedTools,
            environmentId,
            instructionMode,
            instructions,
            options: execOpts,
            processKey,
            projectId,
            providerId,
            // Seeded false: the bridge reports the real answer on the
            // thread/start (or resume) result, the sole source for every
            // provider.
            sessionRestorable: false,
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
            skillRoots,
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
              timeoutMs: threadCreationRequestTimeoutMs,
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
            // The result is the one carrier of the provider identity: the
            // protocol's result schema requires it, so a bridge that omits
            // it fails the construction here (a thread/identity
            // notification never stands in for it).
            updateSessionRestoreCapability(threadId, result.sessionRestorable);
            recordProviderThreadIdentity(
              proc,
              threadId,
              result.providerThreadId,
            );
            resolved = result.providerThreadId;
          } catch (startError) {
            // A failed FIRST TURN (below) deliberately keeps the session
            // live for a retry; a failed construction keeps nothing.
            await abandonFailedSessionConstruction({ proc, threadId });
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
            bridgeLaunch,
            providerId,
          });
          await runtime.ensureProvider({ providerId, bridgeLaunch });
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

          // The lease id is a server-minted UUID, so it is safe inside
          // identities that provider adapters may turn into filesystem keys.
          const stagingThreadId = `${threadId}:rewind:${leaseId}`;
          suppressedThreadEventIds.add(stagingThreadId);
          threadIdentityRegistry.registerThreadProvider({
            providerId,
            providerState: proc.identity,
            expectsIdentityNotification: true,
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
                skillRoots,
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
              timeoutMs: threadCreationRequestTimeoutMs,
              // The staging fork reads the source session, so an archived
              // source is recovered the way a plain fork's is: the hint
              // rides this request's own rejection, and the staging thread's
              // suppressed event stream plays no part in it.
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
                // The fork produced no session the runtime adopted (it was
                // rejected, timed out, or answered without a
                // providerThreadId), so there is no provider identity to
                // discard by. The bridge may still hold the staging thread
                // under its bb id: tell it to release the thread, exactly as
                // a failed thread/start does.
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
            bridgeLaunch,
            providerId,
          });
          await runtime.ensureProvider({ providerId, bridgeLaunch });

          const proc = providerProcesses.requireProviderProcess({
            processKey,
            providerId,
          });
          assertProviderSupportsExecutionOptions({
            adapter: proc.adapter,
            options: execOpts,
            providerId,
          });
          threadIdentityRegistry.registerThreadProvider({
            providerId,
            providerState: proc.identity,
            expectsIdentityNotification: providerThreadId === undefined,
            threadId,
          });
          setThreadRuntimeConfig(threadId, {
            bridgeLaunch,
            dynamicTools,
            disallowedTools,
            environmentId,
            instructionMode,
            instructions,
            options: execOpts,
            processKey,
            projectId,
            providerId,
            // Seeded false: the bridge reports the real answer on the
            // thread/start (or resume) result, the sole source for every
            // provider.
            sessionRestorable: false,
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
              skillRoots,
            }),
            dynamicTools,
            disallowedTools,
            instructionMode,
          };
          const plan = proc.adapter.buildCommandPlan(adapterCommand);
          if (plan.kind === "noop") {
            // No request, so no result to read: the session keeps the
            // identity the command was built with.
            return { providerThreadId: adapterCommand.providerThreadId };
          }

          let resolved: string;
          try {
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
            // As on thread/start, the result is the one carrier of the
            // provider identity; a bridge that omits it fails the
            // construction here.
            recordProviderThreadIdentity(
              proc,
              threadId,
              result.providerThreadId,
            );
            updateSessionRestoreCapability(threadId, result.sessionRestorable);
            resolved = result.providerThreadId;
          } catch (resumeError) {
            // The thread was registered above under the caller's identity
            // so the release can name the bridge's session; a rejected,
            // timed-out or identity-less resume leaves no live session
            // behind it, so the registration goes too and the next command
            // resumes the thread again.
            await abandonFailedSessionConstruction({ proc, threadId });
            throw resumeError;
          }
          markHostedProviderSessionIdle(threadId);
          return { providerThreadId: resolved };
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
          assertThreadCanStartTurn(threadId);
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
          recordThreadExecutionOptions({
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
          assertThreadCanStartTurn(threadId);
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
          recordThreadExecutionOptions({
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
            // The typed code is the contract: any bridge that answers a
            // steer with NO_ACTIVE_TURN is telling bb the turn it meant is
            // already gone, whoever the provider is.
            if (
              error instanceof JsonRpcResponseError &&
              error.code === BRIDGE_JSON_RPC_ERRORS.NO_ACTIVE_TURN
            ) {
              turnState.clearThread(threadId);
              return { status: "stale", activeTurnId: null };
            }
            throw error;
          }
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

    async listModels({ providerId, bridgeLaunch, cwd }) {
      await runtime.ensureProvider({ providerId, bridgeLaunch });
      const proc = providerProcesses.requireProviderProcess({
        processKey: resolveProviderProcessKey({ bridgeLaunch, providerId }),
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

    async providerInstallationRun({
      providerId,
      bridgeLaunch,
      cwd,
      action,
    }) {
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
