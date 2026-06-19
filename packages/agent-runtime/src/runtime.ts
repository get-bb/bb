import path from "node:path";
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
import type {
  AdapterCommand,
  ProviderAdapterFactory,
  ProviderCommandPlan,
  ProviderRequestCommandPlan,
} from "./provider-adapter.js";
import {
  assertProviderSupportsExecutionOptions,
  sameExecutionSettings,
  toProviderExecutionContext,
} from "./execution-options.js";
import {
  getJsonRpcStringParam,
  ignoredJsonRpcResultSchema,
  type JsonRpcObject,
  parseJsonRpcLine,
  type SendJsonRpcRequestArgs,
  sendJsonRpcError,
  sendJsonRpcRequest,
  settleJsonRpcResponse,
} from "./runtime-json-rpc.js";
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
import { RuntimeTurnReplayFilter } from "./runtime-turn-replay-filter.js";
import { RuntimeTurnState } from "./runtime-turn-state.js";
import type {
  AgentRuntime,
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

interface ReconfigureThreadIfNeededArgs {
  instructions: string | undefined;
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
  providerId: string;
  threadId?: string;
}

interface RequireProviderProcessArgs {
  processKey: string;
  providerId: string;
}

interface ArchiveOrUnarchiveThreadArgs {
  commandType: "thread/archive" | "thread/unarchive";
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

interface ThreadRuntimeConfig {
  dynamicTools?: DynamicTool[];
  disallowedTools?: readonly string[];
  environmentId: string;
  instructionMode: InstructionMode;
  instructions?: string;
  options: AgentRuntimeExecutionOptions;
  processKey: string;
  projectId?: string;
  providerId: string;
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

const CODEX_PROVIDER_ID = "codex";
const CODEX_THREAD_PROCESS_KEY_PREFIX = `${CODEX_PROVIDER_ID}\0thread:`;
const CODEX_ACCOUNT_RESTART_PROVIDER_ERROR_CATEGORIES =
  new Set<ProviderErrorCategory>(["rate-limit", "unauthorized"]);
const CODEX_ACCOUNT_RESTART_PROVIDER_ERROR_TEXT_PATTERN =
  /\b(?:40[19]|429|auth(?:entication|orization)?|credits?|quota|rate[-\s]?limit(?:ed)?|unauthori[sz]ed|usage limit)\b/i;

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
  const pendingTurnStartThreadIds = new Set<string>();
  const threadOperationCounts = new Map<string, number>();
  const turnState = new RuntimeTurnState();
  const turnReplayFilter = new RuntimeTurnReplayFilter();
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
      turnReplayFilter.clearThread(threadId);
    },
    onStderr: options.onStderr,
    skillRoots,
    workspacePath: options.workspacePath,
  });

  function resolveProviderProcessKey(
    args: ResolveProviderProcessKeyArgs,
  ): string {
    if (args.providerId !== CODEX_PROVIDER_ID || args.threadId === undefined) {
      return args.providerId;
    }
    return `${CODEX_THREAD_PROCESS_KEY_PREFIX}${args.threadId}`;
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

  async function shutdownThreadScopedCodexProcessIfIdle(
    proc: ProviderProcess,
  ): Promise<void> {
    if (!isThreadScopedCodexProcess(proc) || proc.identity.threadIds.size > 0) {
      return;
    }
    await providerProcesses.shutdownProvider({
      processKey: proc.processKey,
      providerId: proc.providerId,
    });
  }

  function sendCommand<TResult>(args: {
    proc: ProviderProcess;
    message: SendJsonRpcRequestArgs<TResult>["message"];
    resultSchema: SendJsonRpcRequestArgs<TResult>["resultSchema"];
  }): Promise<TResult> {
    return sendJsonRpcRequest({
      child: args.proc.child,
      getNextId: () => nextRequestId++,
      message: args.message,
      pending: args.proc.pending,
      resultSchema: args.resultSchema,
    });
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

  function clearThreadRuntimeConfig(threadId: string): void {
    codexThreadsRequiringAccountRestart.delete(threadId);
    idleProviderSessionSinceMsByThreadId.delete(threadId);
    pendingTurnStartThreadIds.delete(threadId);
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
    threadIdentityRegistry.forgetThread({
      providerState: proc.identity,
      threadId,
    });
    clearThreadRuntimeConfig(threadId);
    turnState.clearThread(threadId);
    turnReplayFilter.clearThread(threadId);
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
    if (runtimeConfig?.providerId !== CODEX_PROVIDER_ID) {
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
    const processKey =
      threadRuntimeConfigs.get(threadId)?.processKey ??
      resolveProviderProcessKey({ providerId, threadId });
    await providerProcesses.ensureProvider({ processKey, providerId });
    const proc = requireProviderProcess({ processKey, providerId });
    if (!proc.adapter.capabilities.supportsArchive) {
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
    await shutdownThreadScopedCodexProcessIfIdle(proc);
  }

  async function reconfigureThreadIfNeeded(
    args: ReconfigureThreadIfNeededArgs,
  ): Promise<void> {
    const currentConfig = threadRuntimeConfigs.get(args.threadId);
    if (!currentConfig) {
      return;
    }

    const nextOptions = args.options;
    const nextInstructions = args.instructions ?? currentConfig.instructions;

    if (
      sameExecutionSettings({
        left: currentConfig.options,
        right: nextOptions,
      }) &&
      currentConfig.instructions === nextInstructions
    ) {
      return;
    }

    const proc = requireProviderProcess({
      processKey: currentConfig.processKey,
      providerId: currentConfig.providerId,
    });
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
        instructions: nextInstructions,
        skillRoots: providerSkillRoots,
      }),
      dynamicTools: currentConfig.dynamicTools,
      disallowedTools: currentConfig.disallowedTools,
      instructionMode: currentConfig.instructionMode,
    };
    const plan = proc.adapter.buildCommandPlan(adapterCommand);
    if (plan.kind === "request") {
      const result = await sendCommand({
        proc,
        message: plan,
        resultSchema: threadIdentityResultSchema,
      });
      const providerThreadId = resolveThreadIdentityResult({
        result,
        threadId: args.threadId,
      });
      if (providerThreadId) {
        recordProviderThreadIdentity(proc, args.threadId, providerThreadId);
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
      instructions: nextInstructions,
      options: nextOptions,
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

      if (!resolvedBbThreadId) {
        options.onStderr?.(
          `Dropping unscoped provider event ${event.type}; no bb thread could be resolved`,
        );
        continue;
      }

      const stampedEvent = stampThreadEventScope({
        event,
        providerThreadId:
          threadIdentityRegistry.getProviderThreadId(resolvedBbThreadId),
        threadId: resolvedBbThreadId,
      });

      const replayResult = turnReplayFilter.observe(stampedEvent);
      if (replayResult.kind === "drop-replayed-turn-start") {
        options.onStderr?.(
          `Dropping replayed turn/started on already completed turn "${replayResult.turnId}" in thread "${replayResult.threadId}".`,
        );
        continue;
      }

      const normalizedEvent = normalizeProviderThreadNameEvent(
        replayResult.event,
      );
      turnState.observe(normalizedEvent);
      observeProviderSessionIdleState(normalizedEvent);
      if (shouldRestartCodexThreadAfterEvent(normalizedEvent, args.proc)) {
        codexThreadsRequiringAccountRestart.add(normalizedEvent.threadId);
      }
      options.onEvent(normalizedEvent);
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
    // entirely to the adapter's translateEvent. Each adapter knows its
    // own wire format (codex sends direct notifications, bridges wrap
    // SDK messages in sdk/message envelopes, etc.).
    handleProviderNotification({
      parsed: parsedLine.parsed,
      proc,
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  const runtime: AgentRuntime = {
    async ensureProvider({ providerId, forThreadId }) {
      await providerProcesses.ensureProvider({
        processKey: resolveProviderProcessKey({
          providerId,
          ...(forThreadId !== undefined ? { threadId: forThreadId } : {}),
        }),
        providerId,
      });
    },

    async startThread({
      environmentId,
      threadId,
      projectId,
      providerId,
      clientRequestId,
      input,
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
            providerId,
            threadId,
          });
          await runtime.ensureProvider({ providerId, forThreadId: threadId });

          const proc = requireProviderProcess({ processKey, providerId });
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
            dynamicTools,
            disallowedTools,
            environmentId,
            instructionMode,
            instructions,
            options: execOpts,
            processKey,
            projectId,
            providerId,
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
                ...(outputSchema !== undefined ? { outputSchema } : {}),
              };
          const cmd = requireProviderRequestPlan({
            commandType: adapterCommand.type,
            plan: proc.adapter.buildCommandPlan(adapterCommand),
            providerId,
          });

          const result = await sendCommand({
            proc,
            message: cmd,
            resultSchema: threadIdentityResultSchema,
          });
          const providerThreadId = resolveThreadIdentityResult({
            result,
            threadId,
          });
          if (providerThreadId) {
            recordProviderThreadIdentity(proc, threadId, providerThreadId);
          }
          emitAcceptedCommandEvents({
            command: adapterCommand,
            proc,
            ...(providerThreadId !== undefined ? { providerThreadId } : {}),
            sourceThreadId: threadId,
          });

          const resolved = await waitForProviderThreadIdentity(
            proc,
            threadId,
            5000,
          );
          if (!resolved) {
            throw new Error(
              `Provider "${providerId}" did not return a providerThreadId for thread "${threadId}" within 5 seconds`,
            );
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

    async resumeThread({
      environmentId,
      threadId,
      projectId,
      providerThreadId,
      providerId,
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
            providerId,
            threadId,
          });
          await runtime.ensureProvider({ providerId, forThreadId: threadId });

          const proc = requireProviderProcess({ processKey, providerId });
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
            dynamicTools,
            disallowedTools,
            environmentId,
            instructionMode,
            instructions,
            options: execOpts,
            processKey,
            projectId,
            providerId,
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
          const cmd = plan;

          const result = await sendCommand({
            proc,
            message: cmd,
            resultSchema: threadIdentityResultSchema,
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
      clientRequestId,
      options: execOpts,
      instructions,
    }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          await restartCodexThreadForNextTurnIfNeeded({
            threadId,
            options: execOpts,
            instructions,
          });
          const pid = resolveProviderForThread(threadId);
          const proc = requireProviderProcessForThread(threadId);
          assertProviderSupportsExecutionOptions({
            adapter: proc.adapter,
            options: execOpts,
            providerId: pid,
          });
          await reconfigureThreadIfNeeded({
            threadId,
            options: execOpts,
            instructions,
          });

          const adapterCommand: AdapterCommand = {
            type: "turn/start",
            threadId,
            providerThreadId: requireProviderThreadId(threadId),
            input,
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
          const preparedTurnStart =
            proc.adapter.prepareTurnStart(adapterCommand);
          pendingTurnStartThreadIds.add(threadId);
          markProviderSessionNotIdle(threadId);
          try {
            await sendCommand({
              proc,
              message: cmd,
              resultSchema: ignoredJsonRpcResultSchema,
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
      clientRequestId,
      options: execOpts,
      instructions,
    }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const pid = resolveProviderForThread(threadId);
          const proc = requireProviderProcessForThread(threadId);
          assertProviderSupportsExecutionOptions({
            adapter: proc.adapter,
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

          await restartCodexThreadForNextTurnIfNeeded({
            threadId,
            options: execOpts,
            instructions,
          });
          await reconfigureThreadIfNeeded({
            threadId,
            options: execOpts,
            instructions,
          });

          const adapterCommand: AdapterCommand = {
            type: "turn/steer",
            threadId,
            providerThreadId: requireProviderThreadId(threadId),
            expectedTurnId,
            input,
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
          await sendCommand({
            proc,
            message: cmd,
            resultSchema: ignoredJsonRpcResultSchema,
          });
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
            await shutdownThreadScopedCodexProcessIfIdle(proc);
            return;
          }

          await sendCommand({
            proc,
            message: cmd,
            resultSchema: ignoredJsonRpcResultSchema,
          });
          emitAcceptedCommandEvents({
            command: adapterCommand,
            proc,
            sourceThreadId: threadId,
          });
          forgetThreadRuntimeState(proc, threadId);
          await shutdownThreadScopedCodexProcessIfIdle(proc);
        },
      });
    },

    async renameThread({ threadId, title }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          const pid = resolveProviderForThread(threadId);
          const proc = requireProviderProcessForThread(threadId);
          if (!proc.adapter.capabilities.supportsRename) {
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
          });
          emitAcceptedCommandEvents({
            command: adapterCommand,
            proc,
            sourceThreadId: threadId,
          });
        },
      });
    },

    async archiveThread({ threadId, providerId, providerThreadId }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          await archiveOrUnarchiveThread({
            commandType: "thread/archive",
            providerId,
            providerThreadId,
            threadId,
          });
        },
      });
    },

    async unarchiveThread({ threadId, providerId, providerThreadId }) {
      return runThreadOperation({
        threadId,
        work: async () => {
          await archiveOrUnarchiveThread({
            commandType: "thread/unarchive",
            providerId,
            providerThreadId,
            threadId,
          });
        },
      });
    },

    async listModels({ providerId }) {
      await runtime.ensureProvider({ providerId });
      const proc = requireProviderProcess({
        processKey: resolveProviderProcessKey({ providerId }),
        providerId,
      });
      const command = requireProviderRequestPlan({
        commandType: "model/list",
        plan: proc.adapter.buildCommandPlan({ type: "model/list" }),
        providerId,
      });
      const result = await sendCommand({
        proc,
        message: command,
        resultSchema: ignoredJsonRpcResultSchema,
      });
      return proc.adapter.parseModelListResult(result);
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

    async reapIdleProviderSessions({ idleForMs, nowMs }) {
      const reapedSessions: ReapedIdleProviderSession[] = [];
      for (const threadId of [...threadRuntimeConfigs.keys()]) {
        const candidate = findReapableIdleProviderSession({
          idleForMs,
          nowMs,
          threadId,
        });
        if (!candidate) {
          continue;
        }

        let proc: ProviderProcess;
        try {
          proc = requireProviderProcess({
            processKey: candidate.runtimeConfig.processKey,
            providerId: candidate.runtimeConfig.providerId,
          });
        } catch {
          continue;
        }
        if (!isThreadScopedCodexProcess(proc)) {
          continue;
        }

        forgetThreadRuntimeState(proc, candidate.threadId);
        await shutdownThreadScopedCodexProcessIfIdle(proc);
        reapedSessions.push({
          idleForMs: Math.max(0, nowMs - candidate.idleSinceMs),
          providerId: candidate.runtimeConfig.providerId,
          providerThreadId: candidate.providerThreadId,
          threadId: candidate.threadId,
        });
      }

      return { reapedSessions };
    },

    hasThread(threadId) {
      return threadIdentityRegistry.getProviderSession(threadId) !== null;
    },

    getActiveThreadIds() {
      return turnState.getActiveThreadIds();
    },

    async shutdown() {
      idleProviderSessionSinceMsByThreadId.clear();
      pendingTurnStartThreadIds.clear();
      threadOperationCounts.clear();
      turnState.clear();
      turnReplayFilter.clear();
      await providerProcesses.shutdown();
    },
  };

  return runtime;
}
