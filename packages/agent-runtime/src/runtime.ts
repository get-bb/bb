import path from "node:path";
import { z } from "zod";
import {
  isAcpProviderId,
  isSessionRestorableProvider,
} from "./provider-catalog.js";
import {
  normalizeProviderThreadNameEvent,
  toProviderExternalThreadName,
} from "@bb/domain";
import type {
  DynamicTool,
  InstructionMode,
  ProviderErrorCategory,
  ThreadEvent,
} from "@bb/domain";
import type { HostDaemonAcpLaunchSpec } from "@bb/host-daemon-contract";
import type {
  AdapterCommand,
  ProviderAdapter,
  ProviderAdapterFactory,
} from "./provider-adapter.js";
import {
  BRIDGE_JSON_RPC_ERRORS,
  experimental_providerHealthResultSchema,
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

interface RestartCodexThreadForNextTurnArgs {
  instructions: string | undefined;
  options: AgentRuntimeExecutionOptions;
  threadId: string;
}

interface RunThreadOperationArgs<TResult> {
  threadId: string;
  work: () => Promise<TResult>;
}

function normalizeExecutionOptions(args: {
  adapter: ProviderAdapter;
  options: AgentRuntimeExecutionOptions;
}): AgentRuntimeExecutionOptions {
  return args.adapter.normalizeExecutionOptions?.(args.options) ?? args.options;
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
  threadId?: string;
}

interface RequireProviderProcessArgs {
  processKey: string;
  providerId: string;
}

interface ArchiveOrUnarchiveThreadArgs {
  bridgeLaunch?: AgentRuntimeBridgeLaunch;
  commandType: "thread/archive" | "thread/unarchive";
  providerId: string;
  providerThreadId: string;
  threadId: string;
}

interface CodexArchivedSessionRecoveryArgs {
  providerId: string;
  providerThreadId: string;
  threadId: string;
}

interface AgentRuntimeInternalOptions extends AgentRuntimeOptions {
  adapterFactory?: ProviderAdapterFactory;
}

interface ResolveProviderRequestThreadIdArgs extends ResolveRuntimeProviderRequestThreadIdArgs {
  proc: ProviderProcess;
}

interface ResolveThreadStoragePathArgs {
  options: AgentRuntimeInternalOptions;
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
   * runtime-internal re-resume (the codex account restart) can rebuild the
   * same process key and adapter for a plugin-delivered bridge, which cannot
   * be resolved from the provider id alone.
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

interface RuntimeJsonRpcResponseArgs extends RuntimeParsedMessageArgs {
  parsedId: string | number;
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
 * Codex-shaped recovery signals. These survive graduation deliberately: the
 * codex bridge passes provider error text and `errorInfo.category` through
 * verbatim precisely so these runtime tolerances keep matching (see the
 * comments beside SESSION_NOT_RESTORABLE and the rename path in
 * codex/bridge/bridge.ts). Do not delete them as "legacy adapter" residue.
 */
const CODEX_PROVIDER_ID = "codex";
const CODEX_THREAD_PROCESS_KEY_PREFIX = `${CODEX_PROVIDER_ID}\0thread:`;
const THREAD_CREATION_REQUEST_TIMEOUT_MS = 2 * 60_000;
const CODEX_ACCOUNT_RESTART_PROVIDER_ERROR_CATEGORIES =
  new Set<ProviderErrorCategory>(["rate-limit", "unauthorized"]);
const CODEX_ACCOUNT_RESTART_PROVIDER_ERROR_TEXT_PATTERN =
  /\b(?:40[19]|429|auth(?:entication|orization)?|credits?|quota|rate[-\s]?limit(?:ed)?|unauthori[sz]ed|usage limit)\b/i;
const CODEX_ARCHIVED_SESSION_ERROR_PATTERN =
  /\b(?:session|thread)\s+\S+\s+is archived\b/i;
const CODEX_EMPTY_ROLLOUT_RENAME_ERROR_PATTERN = /\brollout at .+ is empty\b/i;
const CODEX_RENAME_RETRY_DELAYS_MS = [50, 200] as const;

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface SendRenameWithRolloutRetriesArgs {
  onStderr: AgentRuntimeOptions["onStderr"];
  providerId: string;
  send: () => Promise<void>;
  threadId: string;
}

/**
 * A brand-new Codex rollout file can exist before its first record is written,
 * and a rename landing in that window fails until Codex flushes. Retry only
 * that error, backing off after each attempt, then make one final attempt
 * whose failure propagates. Every other error fails immediately.
 */
async function sendRenameWithRolloutRetries(
  args: SendRenameWithRolloutRetriesArgs,
): Promise<void> {
  for (const retryDelayMs of CODEX_RENAME_RETRY_DELAYS_MS) {
    try {
      await args.send();
      return;
    } catch (error) {
      if (
        args.providerId !== CODEX_PROVIDER_ID ||
        !(error instanceof Error) ||
        !CODEX_EMPTY_ROLLOUT_RENAME_ERROR_PATTERN.test(error.message)
      ) {
        throw error;
      }
      args.onStderr?.(
        `Codex session rollout is not ready; retrying rename for thread "${args.threadId}" in ${retryDelayMs}ms.`,
      );
      await delay(retryDelayMs);
    }
  }
  await args.send();
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
  return createAgentRuntimeInternal(options);
}

export function createAgentRuntimeWithAdapters(
  options: AgentRuntimeInternalOptions,
): AgentRuntime {
  return createAgentRuntimeInternal(options);
}

function createAgentRuntimeInternal(
  options: AgentRuntimeInternalOptions,
): AgentRuntime {
  const additionalWorkspaceWriteRoots =
    options.additionalWorkspaceWriteRoots ?? [];
  const skillRoots = normalizeSkillRoots({
    skillRoots: options.skillRoots,
  });
  let nextRequestId = 1;
  const threadIdentityRegistry = new RuntimeThreadIdentityRegistry();
  const threadRuntimeConfigs = new Map<string, ThreadRuntimeConfig>();
  const codexThreadsRequiringAccountRestart = new Set<string>();
  const idleProviderSessionSinceMsByThreadId = new Map<string, number>();
  // Accepted turn dispatches awaiting the provider's turn/started. The
  // watchdog makes a stalled entry visible instead of silently hung (#1156's
  // unimplemented third suggestion; grammar rule 4 in
  // docs/provider-bridge-protocol.md).
  const pendingTurnStarts = new Map<
    string,
    { sinceMs: number; watchdogFired: boolean }
  >();
  const pendingTurnStartThreadIds = {
    has: (threadId: string) => pendingTurnStarts.has(threadId),
    delete: (threadId: string) => pendingTurnStarts.delete(threadId),
    add: (threadId: string) =>
      pendingTurnStarts.set(threadId, {
        sinceMs: Date.now(),
        watchdogFired: false,
      }),
  };
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
  const bridgeNodeEnv = options.bridgeNodeEnv ?? defaultBridgeNodeEnv();

  const providerProcesses = new RuntimeProviderProcessManager({
    additionalWorkspaceWriteRoots,
    adapterFactory: options.adapterFactory,
    bridgeBundleDir: options.bridgeBundleDir,
    ...(bridgeNodeEnv !== undefined ? { bridgeNodeEnv } : {}),
    bridgeNodeExecutablePath:
      options.bridgeNodeExecutablePath ?? process.execPath,
    captureThreadExitState: (threadId) => ({
      activeTurnId: turnState.getActiveTurnId(threadId),
      pendingTurnStart: pendingTurnStartThreadIds.has(threadId),
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
    onProviderThreadDetached: (threadId, providerProcess) => {
      // Reconcile adapter state that dies with the provider process (open
      // background tasks) before the thread's identity mappings are cleared —
      // the synthesized events still need provider-thread stamping.
      const detachEvents =
        providerProcess.adapter.buildThreadDetachedEvents?.({ threadId }) ?? [];
      if (detachEvents.length > 0) {
        emitTranslatedEvents({
          events: detachEvents,
          proc: providerProcess,
          sourceThreadId: threadId,
        });
      }
      threadIdentityRegistry.clearThread(threadId);
      clearThreadRuntimeConfig(threadId);
      turnState.clearThread(threadId);
      backgroundWorkState.clearThread(threadId);
      threadEventGrammar.clearThread(threadId);
    },
    onStderr: options.onStderr,
    skillRoots,
    ...(options.textDeltaFlushMs !== undefined
      ? { textDeltaFlushMs: options.textDeltaFlushMs }
      : {}),
    workspacePath: options.workspacePath,
  });

  /**
   * Codex runs one provider process per thread. The codex bridge now owns a
   * per-thread `codex app-server` child internally, so this outer scoping is
   * redundant for isolation — but it is still load-bearing: the account
   * restart below and the pre-experiment idle reap both key off
   * `isThreadScopedCodexProcess`. Collapsing it means routing those through
   * `thread/stop {release}` + resume, which is a refactor, not a deletion.
   */
  function resolveProviderProcessKey(
    args: ResolveProviderProcessKeyArgs,
  ): string {
    const baseKey =
      args.providerId !== CODEX_PROVIDER_ID || args.threadId === undefined
        ? args.providerId
        : `${CODEX_THREAD_PROCESS_KEY_PREFIX}${args.threadId}`;
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

  function requireProviderProcess(
    args: RequireProviderProcessArgs,
  ): ProviderProcess {
    return providerProcesses.requireProviderProcess(args);
  }

  function requireProviderProcessForThread(threadId: string): ProviderProcess {
    const providerId = resolveProviderForThread(threadId);
    const processKey =
      threadRuntimeConfigs.get(threadId)?.processKey ??
      resolveProviderProcessKey({ providerId });
    return requireProviderProcess({ processKey, providerId });
  }

  function isThreadScopedCodexProcess(proc: ProviderProcess): boolean {
    return (
      proc.providerId === CODEX_PROVIDER_ID &&
      proc.processKey.startsWith(CODEX_THREAD_PROCESS_KEY_PREFIX)
    );
  }

  /**
   * Releasing a thread is the moment a process can become retirable: a
   * thread-scoped codex process has nothing left to serve, and a bridge
   * process superseded by a plugin update was only being kept alive by the
   * threads still running on it.
   */
  async function releaseIdleProviderProcess(
    proc: ProviderProcess,
  ): Promise<void> {
    if (
      isThreadScopedCodexProcess(proc) &&
      proc.identity.threadIds.size === 0
    ) {
      await providerProcesses.shutdownProvider({
        processKey: proc.processKey,
        providerId: proc.providerId,
      });
      return;
    }
    await providerProcesses.retireSupersededBridgeProcessIfIdle(proc);
  }

  async function sendCommand<TResult>(args: {
    proc: ProviderProcess;
    message: SendJsonRpcRequestArgs<TResult>["message"];
    resultSchema: SendJsonRpcRequestArgs<TResult>["resultSchema"];
    timeoutMs?: number;
    recovery?: CodexArchivedSessionRecoveryArgs;
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
      if (
        !recovery ||
        !isCodexArchivedSessionError(recovery.providerId, error)
      ) {
        throw error;
      }

      options.onStderr?.(
        `Codex session "${recovery.providerThreadId}" is archived; unarchiving before retrying thread "${recovery.threadId}".`,
      );
      let retryProc: ProviderProcess;
      try {
        await archiveOrUnarchiveThread({
          commandType: "thread/unarchive",
          ...recovery,
        });
        // Unarchiving can replace an exited provider process, so resolve the
        // process again instead of writing to the captured child's stdin.
        retryProc = requireProviderProcess({
          processKey: args.proc.processKey,
          providerId: args.proc.providerId,
        });
      } catch (recoveryError) {
        // The archived-session error names the session and the CLI command
        // that fixes it, so keep it as the reported failure whenever the
        // recovery itself could not run.
        throw new Error(error.message, { cause: recoveryError });
      }

      return sendJsonRpcRequest({
        ...request,
        child: retryProc.child,
        pending: retryProc.pending,
      });
    }
  }

  function resolveProviderForThread(threadId: string): string {
    return threadIdentityRegistry.resolveProviderForThread(threadId);
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
    codexThreadsRequiringAccountRestart.delete(threadId);
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
    codexThreadsRequiringAccountRestart.delete(threadId);
    idleProviderSessionSinceMsByThreadId.delete(threadId);
    pendingTurnStartThreadIds.delete(threadId);
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
  function forgetThreadRuntimeState(
    proc: ProviderProcess,
    threadId: string,
  ): void {
    forgetThreadRuntimeStateForProviderState(proc.identity, threadId);
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
      pendingTurnStartThreadIds.has(threadId)
    ) {
      return;
    }
    if (!idleProviderSessionSinceMsByThreadId.has(threadId)) {
      idleProviderSessionSinceMsByThreadId.set(threadId, Date.now());
    }
  }

  function observeProviderSessionIdleState(event: ThreadEvent): void {
    if (event.type === "turn/started") {
      pendingTurnStartThreadIds.delete(event.threadId);
      markProviderSessionNotIdle(event.threadId);
      return;
    }

    if (event.type === "turn/completed") {
      pendingTurnStartThreadIds.delete(event.threadId);
      markHostedProviderSessionIdle(event.threadId);
      return;
    }

    if (event.type === "provider/error" && event.willRetry !== true) {
      pendingTurnStartThreadIds.delete(event.threadId);
      markHostedProviderSessionIdle(event.threadId);
    }
  }

  function findReapableIdleProviderSession(
    args: FindReapableIdleProviderSessionArgs,
  ): ReapIdleProviderSessionCandidate | null {
    if (
      threadHasInFlightOperation(args.threadId) ||
      pendingTurnStartThreadIds.has(args.threadId) ||
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

  function shouldRestartCodexThreadAfterEvent(
    event: ThreadEvent,
    proc: ProviderProcess,
  ): boolean {
    if (
      proc.providerId !== CODEX_PROVIDER_ID ||
      event.type !== "provider/error" ||
      event.willRetry === true
    ) {
      return false;
    }

    if (
      event.errorInfo !== undefined &&
      CODEX_ACCOUNT_RESTART_PROVIDER_ERROR_CATEGORIES.has(
        event.errorInfo.category,
      )
    ) {
      return true;
    }

    const errorText = [event.message, event.detail]
      .filter((part) => part !== undefined)
      .join("\n");
    return CODEX_ACCOUNT_RESTART_PROVIDER_ERROR_TEXT_PATTERN.test(errorText);
  }

  async function restartCodexThreadForNextTurnIfNeeded(
    args: RestartCodexThreadForNextTurnArgs,
  ): Promise<void> {
    if (!codexThreadsRequiringAccountRestart.has(args.threadId)) {
      return;
    }

    const currentConfig = threadRuntimeConfigs.get(args.threadId);
    if (!currentConfig || currentConfig.providerId !== CODEX_PROVIDER_ID) {
      codexThreadsRequiringAccountRestart.delete(args.threadId);
      return;
    }

    if (turnState.getActiveTurnId(args.threadId) !== null) {
      return;
    }

    const providerThreadId = requireProviderThreadId(args.threadId);
    const proc = requireProviderProcess({
      processKey: currentConfig.processKey,
      providerId: currentConfig.providerId,
    });
    if (!isThreadScopedCodexProcess(proc)) {
      codexThreadsRequiringAccountRestart.delete(args.threadId);
      return;
    }

    codexThreadsRequiringAccountRestart.delete(args.threadId);
    await providerProcesses.shutdownProvider({
      processKey: proc.processKey,
      providerId: proc.providerId,
    });

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
      providerThreadId,
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
      resolveProviderProcessKey({
        ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
        providerId,
        threadId,
      });
    await providerProcesses.ensureProvider({
      processKey,
      providerId,
      ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
    });
    const proc = requireProviderProcess({ processKey, providerId });
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
      forgetThreadRuntimeState(proc, threadId);
    }
    await releaseIdleProviderProcess(proc);
  }

  function isCodexArchivedSessionError(
    providerId: string,
    error: unknown,
  ): error is Error {
    return (
      providerId === CODEX_PROVIDER_ID &&
      error instanceof Error &&
      CODEX_ARCHIVED_SESSION_ERROR_PATTERN.test(error.message)
    );
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
    const proc = requireProviderProcess({
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

  function handleJsonRpcResponse(args: RuntimeJsonRpcResponseArgs): void {
    settleJsonRpcResponse({
      id: args.parsedId,
      pending: args.proc.pending,
      response: args.parsed,
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

      const targetThreadIds = resolvedBbThreadId ? [resolvedBbThreadId] : [];

      if (targetThreadIds.length === 0) {
        options.onStderr?.(
          `Dropping unscoped provider event ${event.type}; no bb thread could be resolved`,
        );
        continue;
      }

      for (const targetThreadId of targetThreadIds) {
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
        if (shouldRestartCodexThreadAfterEvent(normalizedEvent, args.proc)) {
          codexThreadsRequiringAccountRestart.add(normalizedEvent.threadId);
        }
        options.onEvent(normalizedEvent);
        threadGoalState.observe(normalizedEvent);
      }
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
    emitTranslatedEvents({
      events: args.proc.adapter.translateEvent(args.parsed, {
        threadId: sourceThreadId,
      }),
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
      handleJsonRpcResponse({
        parsed: parsedLine.parsed,
        parsedId: parsedLine.parsedId,
        proc,
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
        proc = requireProviderProcess({
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

      forgetThreadRuntimeState(proc, prepared.stagingThreadId);
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
      forThreadId,
      acpLaunchSpec,
      bridgeLaunch,
    }) {
      await providerProcesses.ensureProvider({
        processKey: resolveProviderProcessKey({
          ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
          ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
          providerId,
          ...(forThreadId !== undefined ? { threadId: forThreadId } : {}),
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
      outputSchema,
      fork,
    }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const processKey = resolveProviderProcessKey({
            ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
            ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
            providerId,
            threadId,
          });
          await runtime.ensureProvider({
            providerId,
            forThreadId: threadId,
            ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
            ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
          });

          const proc = requireProviderProcess({ processKey, providerId });
          const effectiveExecOpts = normalizeExecutionOptions({
            adapter: proc.adapter,
            options: execOpts,
          });
          const providerSkillRoots = skillRootsForProvider(providerId);
          assertProviderSupportsExecutionOptions({
            adapter: proc.adapter,
            options: effectiveExecOpts,
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
            options: effectiveExecOpts,
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
            execOpts: effectiveExecOpts,
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
                ...(outputSchema !== undefined ? { outputSchema } : {}),
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
            forgetThreadRuntimeState(proc, threadId);
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
              options: effectiveExecOpts,
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
            threadId,
          });
          await runtime.ensureProvider({
            providerId,
            forThreadId: threadId,
            ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
            ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
          });
          const proc = requireProviderProcess({ processKey, providerId });
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
            threadId,
          });
          await runtime.ensureProvider({
            providerId,
            forThreadId: threadId,
            ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
            ...(bridgeLaunch !== undefined ? { bridgeLaunch } : {}),
          });

          const proc = requireProviderProcess({ processKey, providerId });
          const effectiveExecOpts = normalizeExecutionOptions({
            adapter: proc.adapter,
            options: execOpts,
          });
          const providerSkillRoots = skillRootsForProvider(providerId);
          assertProviderSupportsExecutionOptions({
            adapter: proc.adapter,
            options: effectiveExecOpts,
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
            options: effectiveExecOpts,
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
              execOpts: effectiveExecOpts,
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
          const cmd = plan;

          const result = await sendCommand({
            proc,
            message: cmd,
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
          const pid = resolveProviderForThread(threadId);
          const currentProc = requireProviderProcessForThread(threadId);
          const effectiveExecOpts = normalizeExecutionOptions({
            adapter: currentProc.adapter,
            options: execOpts,
          });
          await restartCodexThreadForNextTurnIfNeeded({
            threadId,
            options: effectiveExecOpts,
            instructions,
          });
          // An account restart replaces a thread-scoped Codex process, so
          // resolve the process again before constructing the turn command.
          const proc = requireProviderProcessForThread(threadId);
          assertProviderSupportsExecutionOptions({
            adapter: proc.adapter,
            options: effectiveExecOpts,
            providerId: pid,
          });
          await reconfigureThreadIfNeeded({
            threadId,
            options: effectiveExecOpts,
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
              execOpts: effectiveExecOpts,
              instructions,
            }),
          };
          const cmd = requireProviderRequestPlan({
            commandType: adapterCommand.type,
            plan: proc.adapter.buildCommandPlan(adapterCommand),
            providerId: pid,
          });
          const preparedTurnStart =
            proc.adapter.prepareTurnStart(adapterCommand);
          pendingTurnStartThreadIds.add(threadId);
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
            pendingTurnStartThreadIds.delete(threadId);
            markHostedProviderSessionIdle(threadId);
            preparedTurnStart?.rollback();
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
          const pid = resolveProviderForThread(threadId);
          const currentProc = requireProviderProcessForThread(threadId);
          const effectiveExecOpts = normalizeExecutionOptions({
            adapter: currentProc.adapter,
            options: execOpts,
          });
          assertProviderSupportsExecutionOptions({
            adapter: currentProc.adapter,
            options: effectiveExecOpts,
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

          await restartCodexThreadForNextTurnIfNeeded({
            threadId,
            options: effectiveExecOpts,
            instructions,
          });
          // An account restart replaces a thread-scoped Codex process, so
          // resolve the process again before constructing the steer command.
          const proc = requireProviderProcessForThread(threadId);
          await reconfigureThreadIfNeeded({
            threadId,
            options: effectiveExecOpts,
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
              execOpts: effectiveExecOpts,
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
            if (
              error instanceof JsonRpcResponseError &&
              isAcpProviderId(pid) &&
              error.code === BRIDGE_JSON_RPC_ERRORS.NO_ACTIVE_TURN
            ) {
              turnState.clearThread(threadId);
              proc.adapter.clearActiveTurnState?.(threadId);
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
          const pid = resolveProviderForThread(threadId);
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
            forgetThreadRuntimeState(proc, threadId);
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
          forgetThreadRuntimeState(proc, threadId);
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
          const pid = resolveProviderForThread(threadId);
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
          const pid = resolveProviderForThread(threadId);
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
          await sendRenameWithRolloutRetries({
            onStderr: options.onStderr,
            providerId: pid,
            send: async () => {
              await sendCommand({
                proc,
                message: cmd,
                resultSchema: ignoredJsonRpcResultSchema,
              });
            },
            threadId,
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
      const proc = requireProviderProcess({
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
      const proc = requireProviderProcess({
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
      const proc = requireProviderProcess({
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

          let proc: ProviderProcess;
          try {
            proc = requireProviderProcess({
              processKey: candidate.runtimeConfig.processKey,
              providerId: candidate.runtimeConfig.providerId,
            });
          } catch {
            return null;
          }
          if (
            providerSessionReapingEnabled
              ? backgroundWorkState.hasOpenThreadWork(candidate.threadId) ||
                (proc.adapter.hasOpenThreadWork?.({
                  providerThreadId: candidate.providerThreadId,
                  threadId: candidate.threadId,
                }) ??
                  false)
              : !isThreadScopedCodexProcess(proc)
          ) {
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
