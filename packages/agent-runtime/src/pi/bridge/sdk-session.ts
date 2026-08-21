import { dirname } from "node:path";
import {
  createAgentSessionFromServices,
  createBashToolDefinition,
  defineTool,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
  type BashSpawnHook,
  type ContextUsage,
  type CreateAgentSessionOptions,
  type ModelRuntime,
  type PromptOptions,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";
import { getBridgeRecorder } from "@bb/provider-bridge-protocol/bridge-kit";
import { createConfiguredPiServices } from "./configured-services.js";

export interface PiSdkSessionOptions {
  cwd: string;
  model?: string;
  thinkingLevel?: CreateAgentSessionOptions["thinkingLevel"];
  additionalSkillPaths?: readonly string[];
  shellEnvOverrides?: ShellEnvOverrides;
  customTools?: ToolDefinition[];
  sessionFilePath?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  /**
   * The bb thread this session serves. Pi runs in-process (no provider
   * pipe), so record mode captures the SDK boundary instead: every
   * `AgentSessionEvent` as `provider→bridge`, every prompt/abort/compact
   * dispatch as `bridge→provider`.
   */
  recordThreadId?: string;
}

type ShellEnvOverrides = Record<string, string>;

type PiSessionEventHandler = (event: AgentSessionEvent) => void;
type PiSessionDoneHandler = (error?: unknown) => void;
type AppendSystemPromptOverride = (base: string[]) => string[];

interface RunPromptArgs {
  images?: ImageContent[];
  pending: PendingInputConsumption;
  streamingBehavior: PiStreamingBehavior;
  text: string;
}

/**
 * Which of pi's two input queues holds a dispatch pi did not run immediately.
 * A steering message interrupts the current assistant turn; a follow-up waits
 * for it. They drain independently, so a dispatch is correlated against the
 * queue it was placed in.
 */
type PiInputQueue = "followUp" | "steering";

interface PendingInputConsumption {
  queue: PiInputQueue;
  queuedText: string | null;
  reject: (error: Error) => void;
  resolve: () => void;
}

interface TrackedInputConsumption {
  pending: PendingInputConsumption;
  promise: Promise<void>;
}

/** The outcome of an agent run pi started for a dispatched input. */
interface PiPromptRunOutcome {
  /** Omitted when the run finished without a fatal error. */
  error?: unknown;
}

/** How pi took a dispatched turn input. */
interface PiInputDispatch {
  /**
   * Resolves once pi consumed the input — it started a run with it, or the
   * queue that held it delivered it. Rejects when pi refused the input or the
   * session ended before delivery.
   */
  consumed: Promise<void>;
  /**
   * The outcome of the run pi started for this input, or `null` when pi queued
   * the input into a run it did not start. That run's own dispatch reports its
   * settlement; a second report would settle whatever turn is open by then.
   */
  settled: Promise<PiPromptRunOutcome | null>;
}

type PiStreamingBehavior = NonNullable<PromptOptions["streamingBehavior"]>;

const PI_TRANSIENT_AUTH_RETRY_DELAY_MS = 250;
// Pi auth storage can briefly miss credentials during concurrent session startup;
// allow roughly two seconds before surfacing a real auth failure.
const PI_TRANSIENT_AUTH_MAX_RETRIES = 8;

interface CreateBashToolWithShellEnvOverlayArgs {
  commandPrefix?: string;
  cwd: string;
  shellEnvOverrides: ShellEnvOverrides;
  shellPath?: string;
}

interface BuildSessionCustomToolsArgs {
  commandPrefix?: string;
  customTools?: ToolDefinition[];
  cwd: string;
  shellEnvOverrides?: ShellEnvOverrides;
  shellPath?: string;
}

function assertExclusivePiPromptOverrides(options: PiSdkSessionOptions): void {
  if (
    options.systemPrompt !== undefined &&
    options.appendSystemPrompt !== undefined
  ) {
    throw new Error(
      "Pi sessions accept either systemPrompt or appendSystemPrompt, not both",
    );
  }
}

function buildAppendSystemPromptOverride(
  appendSystemPrompt: string,
): AppendSystemPromptOverride {
  return (base) => [...base, appendSystemPrompt];
}

function hasShellEnvOverrides(
  shellEnvOverrides: ShellEnvOverrides | undefined,
): shellEnvOverrides is ShellEnvOverrides {
  return (
    shellEnvOverrides !== undefined && Object.keys(shellEnvOverrides).length > 0
  );
}

function createBashToolWithShellEnvOverlay(
  args: CreateBashToolWithShellEnvOverlayArgs,
): ToolDefinition {
  const shellEnvOverrides = args.shellEnvOverrides;
  const spawnHook: BashSpawnHook = (context) => ({
    ...context,
    env: {
      ...context.env,
      ...shellEnvOverrides,
    },
  });

  // Pi exposes shell env customization through bash spawn options today. This is
  // intentionally bash-only; non-bash tools must not depend on per-thread env in
  // this shared bridge process.
  return defineTool(
    createBashToolDefinition(args.cwd, {
      commandPrefix: args.commandPrefix,
      shellPath: args.shellPath,
      spawnHook,
    }),
  );
}

function buildSessionCustomTools(
  args: BuildSessionCustomToolsArgs,
): ToolDefinition[] {
  const customTools = [...(args.customTools ?? [])];
  if (hasShellEnvOverrides(args.shellEnvOverrides)) {
    customTools.push(
      createBashToolWithShellEnvOverlay({
        commandPrefix: args.commandPrefix,
        cwd: args.cwd,
        shellEnvOverrides: args.shellEnvOverrides,
        shellPath: args.shellPath,
      }),
    );
  }
  return customTools;
}

function isTransientPiAuthError(error: Error): boolean {
  return error.message.startsWith("No API key found for ");
}

function listMultisetDifference(
  source: readonly string[],
  subtract: readonly string[],
): string[] {
  const remaining = [...subtract];
  const difference: string[] = [];
  for (const entry of source) {
    const index = remaining.indexOf(entry);
    if (index === -1) {
      difference.push(entry);
      continue;
    }
    remaining.splice(index, 1);
  }
  return difference;
}

async function waitForTransientAuthRetry(): Promise<void> {
  await new Promise((resolve) =>
    setTimeout(resolve, PI_TRANSIENT_AUTH_RETRY_DELAY_MS),
  );
}

/**
 * Wraps the Pi programmatic SDK (`@earendil-works/pi-coding-agent`) in a
 * session object that bridges between the BB JSON-RPC protocol and
 * the Pi agent's event-driven API.
 */
export class PiSdkSession {
  private session: AgentSession | undefined;
  private unsubscribe: (() => void) | undefined;
  private isProcessing = false;
  private isCompacting = false;
  private manualCompactionCompletionCount = 0;
  private readonly pendingInputConsumptions: PendingInputConsumption[] = [];
  private lastObservedQueues: Record<PiInputQueue, string[]> = {
    followUp: [],
    steering: [],
  };
  private autoRetryInProgress = false;
  private terminalSteerSettlementTimeout:
    | ReturnType<typeof setTimeout>
    | undefined;

  constructor(
    private readonly options: PiSdkSessionOptions,
    private readonly onEvent: PiSessionEventHandler,
    private readonly onDone: PiSessionDoneHandler,
  ) {}

  getIsProcessing(): boolean {
    return this.isProcessing || this.session?.isStreaming === true;
  }

  /** Record-mode tee of the in-process SDK boundary; a no-op when off. */
  private recordSdkBoundary(
    direction: "provider→bridge" | "bridge→provider",
    payload: unknown,
  ): void {
    const recorder = getBridgeRecorder();
    if (recorder === null) {
      return;
    }
    let line: string;
    try {
      line = JSON.stringify(payload) ?? "null";
    } catch {
      line = JSON.stringify({ unserializable: String(payload) });
    }
    recorder.record({
      direction,
      line,
      threadId: this.options.recordThreadId ?? null,
    });
  }

  getIsCompacting(): boolean {
    return this.isCompacting;
  }

  getContextUsage(): ContextUsage | undefined {
    return this.session?.getContextUsage();
  }

  getProviderCheckpointId(): string | undefined {
    return this.session?.sessionManager.getLeafId() ?? undefined;
  }

  async start(): Promise<void> {
    assertExclusivePiPromptOverrides(this.options);

    const appendSystemPrompt = this.options.appendSystemPrompt?.trim();
    const additionalSkillPaths = this.options.additionalSkillPaths ?? [];

    // Pi's service factory reads the global and project settings files. It also
    // discovers packages, extensions, skills, prompts, themes, context files,
    // auth, and custom models from the user's normal Pi directories.
    const services = await createConfiguredPiServices({
      cwd: this.options.cwd,
      resourceLoaderOptions: {
        ...(additionalSkillPaths.length > 0
          ? { additionalSkillPaths: [...additionalSkillPaths] }
          : {}),
        ...(this.options.systemPrompt
          ? { systemPrompt: this.options.systemPrompt }
          : {}),
        ...(appendSystemPrompt
          ? {
              appendSystemPromptOverride:
                buildAppendSystemPromptOverride(appendSystemPrompt),
            }
          : {}),
      },
    });

    const configuredModel = resolveConfiguredModel(
      services.modelRuntime,
      this.options.model,
    );

    const customTools = buildSessionCustomTools({
      commandPrefix: services.settingsManager.getShellCommandPrefix(),
      customTools: this.options.customTools,
      cwd: this.options.cwd,
      shellEnvOverrides: this.options.shellEnvOverrides,
      shellPath: services.settingsManager.getShellPath(),
    });

    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager: this.options.sessionFilePath
        ? SessionManager.open(
            this.options.sessionFilePath,
            dirname(this.options.sessionFilePath),
          )
        : SessionManager.inMemory(this.options.cwd),
      ...(configuredModel ? { model: configuredModel } : {}),
      ...(this.options.thinkingLevel
        ? { thinkingLevel: this.options.thinkingLevel }
        : {}),
      customTools,
    });
    this.session = session;

    await session.bindExtensions({
      mode: "rpc",
      abortHandler: () => {
        void session.abort();
      },
      shutdownHandler: () => {
        this.onDone();
      },
      onError: (error) => {
        this.onDone(
          new Error(
            `Pi extension error (${error.extensionPath}, ${error.event}): ${error.error}`,
          ),
        );
      },
    });

    this.ensureCustomToolsActive();

    // Subscribe to session events
    this.unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      this.recordSdkBoundary("provider→bridge", event);
      this.trackProcessingState(event);
      this.observeInputConsumption(event);
      this.observeTerminalSteerSettlement(event);
      this.onEvent(event);
    });
  }

  /**
   * Dispatch turn input. Pi either starts a run with it or, when a run is
   * already live, queues it as a follow-up — so the caller learns consumption
   * and settlement separately instead of treating the dispatch call returning
   * as either one.
   */
  prompt(text: string, images?: ImageContent[]): PiInputDispatch {
    if (!this.session) {
      const consumed = Promise.reject(new Error("No active Pi SDK session"));
      // A caller that only watches settlement must not turn this into an
      // unhandled rejection.
      void consumed.catch(() => undefined);
      return { consumed, settled: Promise.resolve(null) };
    }
    this.isProcessing = true;
    const tracked = this.trackPendingInputConsumption("followUp");
    const settled = this.runPromptWithTransientAuthRetry({
      images,
      pending: tracked.pending,
      streamingBehavior: "followUp",
      text,
    }).then(
      (): PiPromptRunOutcome | null => {
        if (tracked.pending.queuedText !== null) {
          return null;
        }
        // Pi handled the input without queueing it and without a preflight
        // report (an SDK that predates the hook, or a prompt handled before
        // preflight): the returned call is then the only consumption signal.
        this.resolvePendingInputConsumption(tracked.pending);
        return {};
      },
      (error: unknown): PiPromptRunOutcome | null => {
        this.isProcessing = false;
        const queued = tracked.pending.queuedText !== null;
        this.rejectPendingInputConsumption(tracked.pending, asError(error));
        this.rejectPendingInputConsumptions(
          "Pi SDK prompt failed before input was consumed",
        );
        this.onDone(error);
        return queued ? null : { error };
      },
    );
    return { consumed: tracked.promise, settled };
  }

  /**
   * Steer the live run. Resolves once the SDK took the steering message, not
   * once it read it: pi delivers steering between assistant turns, so a steer
   * sent during a long tool call waits for that tool, and the runtime's
   * 30-second command timeout would fail a steer that is still on its way.
   * A steer the run ends without reading is reported through `onDone`.
   */
  async steer(text: string, images?: ImageContent[]): Promise<void> {
    if (!this.session) {
      throw new Error("No active Pi SDK session");
    }
    const tracked = this.trackPendingInputConsumption("steering");
    try {
      await this.runPromptWithTransientAuthRetry({
        images,
        pending: tracked.pending,
        streamingBehavior: "steer",
        text,
      });
    } catch (error) {
      this.rejectPendingInputConsumption(tracked.pending, asError(error));
      this.onDone(error);
      throw error;
    }
    if (tracked.pending.queuedText === null) {
      // Pi handled the steer without queueing it, so no delivery event is
      // coming: the returned call is the consumption signal.
      this.resolvePendingInputConsumption(tracked.pending);
      return;
    }
    this.monitorSteerConsumption(tracked.promise);
  }

  async compact(): Promise<void> {
    if (!this.session) {
      throw new Error("No active Pi SDK session");
    }
    if (this.isProcessing || this.session.isStreaming) {
      throw new Error("Cannot compact context while Pi is processing a turn");
    }
    const completionCount = this.manualCompactionCompletionCount;
    this.isProcessing = true;
    this.isCompacting = true;
    this.recordSdkBoundary("bridge→provider", { method: "compact" });
    try {
      await this.session.compact();
    } catch (error) {
      // Pi emits compaction_end before rejecting for failures that occur after
      // compaction starts. That event is the authoritative terminal outcome;
      // only propagate errors for which the SDK emitted no terminal event.
      if (this.manualCompactionCompletionCount === completionCount) {
        throw error;
      }
    } finally {
      this.isProcessing = false;
      this.isCompacting = false;
    }
  }

  detach(): void {
    this.rejectPendingInputConsumptions(
      "Pi SDK session detached before input was consumed",
    );
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
    this.isProcessing = false;
    this.isCompacting = false;
  }

  stop(): void {
    this.rejectPendingInputConsumptions(
      "Pi SDK session stopped before input was consumed",
    );
    this.detach();
    const session = this.session;
    this.session = undefined;
    if (session) void this.disposeSession(session);
  }

  async closeGracefully(timeoutMs: number): Promise<string | undefined> {
    const session = this.session;
    this.rejectPendingInputConsumptions(
      "Pi SDK session closed before input was consumed",
    );
    this.detach();
    if (!session) {
      return undefined;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let providerCheckpointId: string | undefined;
    this.recordSdkBoundary("bridge→provider", { method: "abort" });
    const abortCompleted = session.abort().catch(() => undefined);
    const timeoutReached = new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, timeoutMs);
    });
    try {
      await Promise.race([abortCompleted, timeoutReached]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      providerCheckpointId = session.sessionManager.getLeafId() ?? undefined;
      await this.disposeSession(session);
      if (this.session === session) {
        this.session = undefined;
      }
      this.isProcessing = false;
      this.isCompacting = false;
    }
    return providerCheckpointId;
  }

  private async disposeSession(session: AgentSession): Promise<void> {
    try {
      if (session.hasExtensionHandlers("session_shutdown")) {
        await session.extensionRunner.emit({
          type: "session_shutdown",
          reason: "quit",
        });
      }
    } finally {
      session.dispose();
    }
  }

  private trackProcessingState(event: AgentSessionEvent): void {
    if (
      event.type === "agent_start" ||
      (event.type === "compaction_start" && event.reason === "manual")
    ) {
      this.isProcessing = true;
    }
    if (event.type === "agent_end" && !event.willRetry) {
      this.isProcessing = false;
      // NOTE: Do NOT call onDone() here. agent_end signals "turn complete,
      // ready for next input" — NOT session termination. The session stays
      // alive across multiple turns. onDone() is only called on fatal errors
      // (prompt() catch) or explicit stop().
    }
    if (event.type === "compaction_end" && event.reason === "manual") {
      this.manualCompactionCompletionCount += 1;
      this.isProcessing = false;
    }
  }

  private trackPendingInputConsumption(
    queue: PiInputQueue,
  ): TrackedInputConsumption {
    let resolvePromise: (() => void) | undefined;
    let rejectPromise: ((error: Error) => void) | undefined;
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    if (!resolvePromise || !rejectPromise) {
      throw new Error("Failed to track Pi input consumption");
    }

    const pending: PendingInputConsumption = {
      queue,
      queuedText: null,
      reject: rejectPromise,
      resolve: resolvePromise,
    };
    this.pendingInputConsumptions.push(pending);
    void promise.catch(() => undefined);
    return { pending, promise };
  }

  private observeInputConsumption(event: AgentSessionEvent): void {
    if (event.type !== "queue_update") {
      return;
    }
    this.observeQueue("steering", event.steering);
    this.observeQueue("followUp", event.followUp);
  }

  private observeQueue(
    queue: PiInputQueue,
    queuedTexts: readonly string[],
  ): void {
    const lastObserved = this.lastObservedQueues[queue];
    const addedQueuedTexts = listMultisetDifference(queuedTexts, lastObserved);
    const removedQueuedTexts = listMultisetDifference(
      lastObserved,
      queuedTexts,
    );
    this.lastObservedQueues[queue] = [...queuedTexts];

    for (const queuedText of addedQueuedTexts) {
      // Pi queue_update exposes SDK-transformed text, so correlate by FIFO queue
      // additions rather than by the raw BB input text.
      const pending = this.pendingInputConsumptions.find(
        (entry) => entry.queue === queue && entry.queuedText === null,
      );
      if (!pending) {
        break;
      }
      pending.queuedText = queuedText;
    }

    for (const queuedText of removedQueuedTexts) {
      // Pi drops a queued message from the queue when it reads it into the
      // conversation, which is the only moment the input is truly consumed.
      const pending = this.pendingInputConsumptions.find(
        (entry) => entry.queue === queue && entry.queuedText === queuedText,
      );
      if (pending) {
        this.resolvePendingInputConsumption(pending);
      }
    }
  }

  private observeTerminalSteerSettlement(event: AgentSessionEvent): void {
    if (event.type === "agent_end") {
      if (!event.willRetry) {
        this.scheduleTerminalSteerSettlement();
      }
      return;
    }

    if (event.type === "auto_retry_start") {
      this.autoRetryInProgress = true;
      this.clearTerminalSteerSettlement();
      return;
    }

    if (event.type === "auto_retry_end") {
      this.autoRetryInProgress = false;
      if (!event.success) {
        this.rejectPendingInputConsumptions(
          "Pi auto retry ended before steer was consumed",
          "steering",
        );
      }
    }
  }

  private scheduleTerminalSteerSettlement(): void {
    // Only steering is terminal at agent_end: pi drains its follow-up queue by
    // continuing the same run after that event, so a queued follow-up is still
    // on its way to being read.
    if (
      !this.pendingInputConsumptions.some(
        (entry) => entry.queue === "steering",
      ) ||
      this.terminalSteerSettlementTimeout !== undefined
    ) {
      return;
    }

    this.terminalSteerSettlementTimeout = setTimeout(() => {
      this.terminalSteerSettlementTimeout = undefined;
      if (this.autoRetryInProgress) {
        return;
      }
      this.rejectPendingInputConsumptions(
        "Pi turn ended before steer was consumed",
        "steering",
      );
    }, 0);
  }

  private clearTerminalSteerSettlement(): void {
    if (this.terminalSteerSettlementTimeout === undefined) {
      return;
    }
    clearTimeout(this.terminalSteerSettlementTimeout);
    this.terminalSteerSettlementTimeout = undefined;
  }

  private resolvePendingInputConsumption(
    pending: PendingInputConsumption,
  ): void {
    const index = this.pendingInputConsumptions.indexOf(pending);
    if (index === -1) {
      return;
    }
    this.pendingInputConsumptions.splice(index, 1);
    pending.resolve();
  }

  /** Reports whether this call was the one that settled the consumption. */
  private rejectPendingInputConsumption(
    pending: PendingInputConsumption,
    error: Error,
  ): boolean {
    const index = this.pendingInputConsumptions.indexOf(pending);
    if (index === -1) {
      return false;
    }
    this.pendingInputConsumptions.splice(index, 1);
    pending.reject(error);
    return true;
  }

  private rejectPendingInputConsumptions(
    message: string,
    queue?: PiInputQueue,
  ): void {
    this.clearTerminalSteerSettlement();
    for (const pending of this.pendingInputConsumptions.splice(0)) {
      if (queue !== undefined && pending.queue !== queue) {
        this.pendingInputConsumptions.push(pending);
        continue;
      }
      pending.reject(new Error(message));
    }
  }

  private monitorSteerConsumption(promise: Promise<void>): void {
    void promise.catch((error) => {
      this.onDone(error);
    });
  }

  private ensureCustomToolsActive(): void {
    if (
      !this.session ||
      !this.options.customTools ||
      this.options.customTools.length === 0
    ) {
      return;
    }

    const activeToolNames = new Set(this.session.getActiveToolNames());
    let missingCustomTool = false;
    for (const tool of this.options.customTools) {
      if (!activeToolNames.has(tool.name)) {
        missingCustomTool = true;
        activeToolNames.add(tool.name);
      }
    }

    if (missingCustomTool) {
      this.session.setActiveToolsByName(Array.from(activeToolNames));
    }
  }

  private async runPromptWithTransientAuthRetry(
    args: RunPromptArgs,
  ): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.runPromptOnce(args);
        return;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !isTransientPiAuthError(error) ||
          attempt >= PI_TRANSIENT_AUTH_MAX_RETRIES
        ) {
          throw error;
        }
        await waitForTransientAuthRetry();
      }
    }
  }

  private async runPromptOnce(args: RunPromptArgs): Promise<void> {
    if (!this.session) {
      throw new Error("No active Pi SDK session");
    }
    this.ensureCustomToolsActive();
    const pending = args.pending;
    this.recordSdkBoundary("bridge→provider", {
      method: "prompt",
      params: {
        text: args.text,
        streamingBehavior: args.streamingBehavior,
        imageCount: args.images?.length ?? 0,
      },
    });
    await this.session.prompt(args.text, {
      ...(this.session.isStreaming
        ? { streamingBehavior: args.streamingBehavior }
        : {}),
      ...(args.images && args.images.length > 0 ? { images: args.images } : {}),
      // Pi reports preflight acceptance after it queued the input and before
      // it starts a run with it. Input pi did not queue is therefore consumed
      // the moment preflight accepts it; queued input waits for its queue to
      // deliver it. Nothing else reports the start of a run pi handles without
      // emitting a single SDK event.
      preflightResult: (accepted: boolean) => {
        if (accepted && pending.queuedText === null) {
          this.resolvePendingInputConsumption(pending);
        }
      },
    });
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

type PiModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;

/**
 * Resolve a model string to a Pi Model object. Returns undefined when no model
 * is configured, and throws when a configured model does not exist.
 *
 * The canonical form is `<provider>/<model id>`, and the model id keeps its own
 * slashes (`openrouter/deepseek/deepseek-v4-flash`), so the provider comes from
 * the first segment only.
 *
 * The named provider is authoritative. A model reaches exactly the vendor the
 * user picked, even when that vendor has no credentials, because substituting
 * another vendor would send workspace content and billing somewhere the user
 * never chose.
 *
 * A bare provider-native model id (`deepseek/deepseek-v4-flash-0731`) resolves
 * only when the first segment names no provider that serves the rest. CLI and
 * SDK callers type that form, and selections stored before bb applied the
 * provider prefix to aggregator models still use it. Two providers can list the
 * same id. When exactly one matching provider has configured credentials, that
 * provider is the only usable match. Otherwise, nothing in the string says
 * which provider was meant, so an ambiguous match is an error rather than a
 * guess.
 */
function resolveConfiguredModel(
  modelRuntime: ModelRuntime,
  modelStr: string | undefined,
): PiModel | undefined {
  if (!modelStr) {
    return undefined;
  }

  const slashIdx = modelStr.indexOf("/");
  if (slashIdx > 0) {
    const prefixed = modelRuntime.getModel(
      modelStr.slice(0, slashIdx),
      modelStr.slice(slashIdx + 1),
    );
    if (prefixed) {
      return prefixed;
    }
  }

  const bare = modelRuntime
    .getModels()
    .filter((candidate) => candidate.id === modelStr);
  if (bare.length > 1) {
    const authenticated = bare.filter((candidate) =>
      modelRuntime.hasConfiguredAuth(candidate.provider),
    );
    if (authenticated.length === 1) {
      return authenticated[0];
    }
    const providers = bare.map((candidate) => candidate.provider).join(", ");
    throw new Error(
      `Ambiguous Pi model "${modelStr}": served by ${providers}. Prefix it with the provider you want.`,
    );
  }
  const model = bare[0];
  if (!model) {
    throw new Error(`Failed to resolve Pi model "${modelStr}"`);
  }
  return model;
}
