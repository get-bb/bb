import path from "node:path";
import {
  normalizeProviderThreadNameEvent,
  toProviderExternalThreadName,
} from "@bb/domain";
import type { DynamicTool, InstructionMode, ThreadEvent } from "@bb/domain";
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
  const turnState = new RuntimeTurnState();
  const turnReplayFilter = new RuntimeTurnReplayFilter();

  const providerProcesses = new RuntimeProviderProcessManager({
    additionalWorkspaceWriteRoots,
    adapterFactory: options.adapterFactory,
    bridgeBundleDir: options.bridgeBundleDir,
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
        providerProcess.adapter.buildThreadDetachedEvents?.({ threadId }) ??
        [];
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
  function requireProviderProcess(providerId: string): ProviderProcess {
    return providerProcesses.requireProviderProcess(providerId);
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
    threadRuntimeConfigs.set(threadId, config);
  }

  function clearThreadRuntimeConfig(threadId: string): void {
    threadRuntimeConfigs.delete(threadId);
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

  function requireProviderThreadId(threadId: string): string {
    const providerThreadId =
      threadIdentityRegistry.getProviderThreadId(threadId);
    if (!providerThreadId) {
      throw new Error(`No provider thread id available for ${threadId}`);
    }
    return providerThreadId;
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
    await runtime.ensureProvider({ providerId });
    const proc = requireProviderProcess(providerId);
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

    const proc = requireProviderProcess(currentConfig.providerId);
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
    async ensureProvider({ providerId }) {
      await providerProcesses.ensureProvider({ providerId });
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
    }) {
      await runtime.ensureProvider({ providerId });

      const proc = requireProviderProcess(providerId);
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

      const adapterCommand: AdapterCommand = {
        type: "thread/start",
        threadId,
        cwd: options.workspacePath,
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

      return { providerThreadId: resolved };
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
      await runtime.ensureProvider({ providerId });

      const proc = requireProviderProcess(providerId);
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
        providerThreadId: providerThreadId ?? requireProviderThreadId(threadId),
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
          throw new Error(`No provider thread id available for ${threadId}`);
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

      return { providerThreadId: resolvedId };
    },

    async runTurn({
      threadId,
      input,
      clientRequestId,
      options: execOpts,
      instructions,
    }) {
      const pid = resolveProviderForThread(threadId);
      const proc = requireProviderProcess(pid);
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
      const preparedTurnStart = proc.adapter.prepareTurnStart(adapterCommand);
      try {
        await sendCommand({
          proc,
          message: cmd,
          resultSchema: ignoredJsonRpcResultSchema,
        });
      } catch (error) {
        preparedTurnStart?.rollback();
        throw error;
      }
      emitAcceptedCommandEvents({
        command: adapterCommand,
        proc,
        sourceThreadId: threadId,
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
      const pid = resolveProviderForThread(threadId);
      const proc = requireProviderProcess(pid);
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

    async stopThread({ threadId }) {
      const pid = resolveProviderForThread(threadId);
      const proc = requireProviderProcess(pid);
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
    },

    async renameThread({ threadId, title }) {
      const pid = resolveProviderForThread(threadId);
      const proc = requireProviderProcess(pid);
      if (!proc.adapter.capabilities.supportsRename) {
        throw new Error(`Provider "${pid}" does not support thread rename.`);
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

    async archiveThread({ threadId, providerId, providerThreadId }) {
      await archiveOrUnarchiveThread({
        commandType: "thread/archive",
        providerId,
        providerThreadId,
        threadId,
      });
    },

    async unarchiveThread({ threadId, providerId, providerThreadId }) {
      await archiveOrUnarchiveThread({
        commandType: "thread/unarchive",
        providerId,
        providerThreadId,
        threadId,
      });
    },

    async listModels({ providerId }) {
      await runtime.ensureProvider({ providerId });
      const proc = requireProviderProcess(providerId);
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

    hasThread(threadId) {
      return threadIdentityRegistry.getProviderSession(threadId) !== null;
    },

    getActiveThreadIds() {
      return turnState.getActiveThreadIds();
    },

    async shutdown() {
      turnState.clear();
      turnReplayFilter.clear();
      await providerProcesses.shutdown();
    },
  };

  return runtime;
}
