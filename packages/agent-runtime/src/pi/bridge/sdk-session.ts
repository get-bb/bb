import { dirname } from "node:path";
import {
  createAgentSession,
  createBashToolDefinition,
  defineTool,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  getAgentDir,
  type AgentSession,
  type AgentSessionEvent,
  type BashSpawnHook,
  type ContextUsage,
  type CreateAgentSessionOptions,
  type ModelRuntime,
  type PromptOptions,
  type SessionStats,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";
import { getPiModelRuntime } from "./model-runtime.js";

export interface PiSdkSessionOptions {
  cwd: string;
  model?: string;
  modelRuntime?: ModelRuntime;
  thinkingLevel?: CreateAgentSessionOptions["thinkingLevel"];
  additionalSkillPaths?: readonly string[];
  shellEnvOverrides?: ShellEnvOverrides;
  customTools?: ToolDefinition[];
  sessionFilePath?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
}

export type ShellEnvOverrides = Record<string, string>;

type PiSessionEventHandler = (event: AgentSessionEvent) => void;
type PiSessionDoneHandler = (error?: unknown) => void;
type AppendSystemPromptOverride = (base: string[]) => string[];

interface RunPromptArgs {
  images?: ImageContent[];
  streamingBehavior: PiStreamingBehavior;
  text: string;
}

interface RunPromptResult {
  steerConsumptionPromise: Promise<void> | null;
}

interface PendingSteerConsumption {
  queuedText: string | null;
  reject: (error: Error) => void;
  resolve: () => void;
}

interface TrackedSteerConsumption {
  pending: PendingSteerConsumption;
  promise: Promise<void>;
}

type PiStreamingBehavior = NonNullable<PromptOptions["streamingBehavior"]>;

const PI_TRANSIENT_AUTH_RETRY_DELAY_MS = 250;
// Pi auth storage can briefly miss credentials during concurrent session startup;
// allow roughly two seconds before surfacing a real auth failure.
const PI_TRANSIENT_AUTH_MAX_RETRIES = 8;

interface CreateBashToolWithShellEnvOverlayArgs {
  cwd: string;
  shellEnvOverrides: ShellEnvOverrides;
}

interface BuildSessionCustomToolsArgs {
  customTools?: ToolDefinition[];
  cwd: string;
  shellEnvOverrides?: ShellEnvOverrides;
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
  return defineTool(createBashToolDefinition(args.cwd, { spawnHook }));
}

function buildSessionCustomTools(
  args: BuildSessionCustomToolsArgs,
): ToolDefinition[] {
  const customTools = [...(args.customTools ?? [])];
  if (hasShellEnvOverrides(args.shellEnvOverrides)) {
    customTools.push(
      createBashToolWithShellEnvOverlay({
        cwd: args.cwd,
        shellEnvOverrides: args.shellEnvOverrides,
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
  private readonly pendingSteerConsumptions: PendingSteerConsumption[] = [];
  private lastObservedSteeringQueue: string[] = [];
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
    return this.isProcessing;
  }

  getSessionStats(): SessionStats | undefined {
    return this.session?.getSessionStats();
  }

  getContextUsage(): ContextUsage | undefined {
    return this.session?.getContextUsage();
  }

  async start(): Promise<void> {
    assertExclusivePiPromptOverrides(this.options);

    const modelRuntime =
      this.options.modelRuntime ?? (await getPiModelRuntime());
    const sessionOptions: CreateAgentSessionOptions = {
      cwd: this.options.cwd,
      modelRuntime,
      sessionManager: this.options.sessionFilePath
        ? SessionManager.open(
            this.options.sessionFilePath,
            dirname(this.options.sessionFilePath),
          )
        : SessionManager.inMemory(this.options.cwd),
      settingsManager: SettingsManager.inMemory({
        compaction: { enabled: true },
        retry: { enabled: true, maxRetries: 2 },
      }),
    };

    const appendSystemPrompt = this.options.appendSystemPrompt?.trim();
    const additionalSkillPaths = this.options.additionalSkillPaths ?? [];

    // Pass custom prompt overrides through ResourceLoader. systemPrompt is the
    // replacement path; appendSystemPrompt layers BB instructions on top of Pi's
    // normal discovered APPEND_SYSTEM.md prompt. The two are mutually exclusive
    // in BB's bridge contract and asserted here for direct SDK-session callers.
    if (
      this.options.systemPrompt ||
      appendSystemPrompt ||
      additionalSkillPaths.length > 0
    ) {
      const resourceLoader = new DefaultResourceLoader({
        cwd: this.options.cwd,
        agentDir: getAgentDir(),
        ...(additionalSkillPaths.length > 0
          ? { additionalSkillPaths: [...additionalSkillPaths] }
          : {}),
        ...(this.options.systemPrompt
          ? {
              systemPrompt: this.options.systemPrompt,
              noExtensions: true,
              ...(additionalSkillPaths.length === 0 ? { noSkills: true } : {}),
              noPromptTemplates: true,
              noThemes: true,
            }
          : {}),
        ...(appendSystemPrompt
          ? {
              appendSystemPromptOverride:
                buildAppendSystemPromptOverride(appendSystemPrompt),
            }
          : {}),
      });
      await resourceLoader.reload();
      sessionOptions.resourceLoader = resourceLoader;
    }

    const configuredModel = resolveConfiguredModel(
      modelRuntime,
      this.options.model,
    );
    if (configuredModel) {
      sessionOptions.model = configuredModel;
    }
    if (this.options.thinkingLevel) {
      sessionOptions.thinkingLevel = this.options.thinkingLevel;
    }

    const customTools = buildSessionCustomTools({
      customTools: this.options.customTools,
      cwd: this.options.cwd,
      shellEnvOverrides: this.options.shellEnvOverrides,
    });
    sessionOptions.customTools = customTools;

    const { session } = await createAgentSession(sessionOptions);
    this.session = session;

    this.ensureCustomToolsActive();

    // Subscribe to session events
    this.unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      this.trackProcessingState(event);
      this.observeSteerConsumption(event);
      this.observeTerminalSteerSettlement(event);
      this.onEvent(event);
    });
  }

  async prompt(text: string, images?: ImageContent[]): Promise<void> {
    if (!this.session) return;
    this.isProcessing = true;
    try {
      await this.runPromptWithTransientAuthRetry({
        images,
        streamingBehavior: "followUp",
        text,
      });
    } catch (error) {
      this.isProcessing = false;
      this.rejectPendingSteerConsumptions(
        "Pi SDK prompt failed before steer consumed",
      );
      this.onDone(error);
    }
  }

  async steer(text: string, images?: ImageContent[]): Promise<void> {
    if (!this.session) {
      throw new Error("No active Pi SDK session");
    }
    try {
      const result = await this.runPromptWithTransientAuthRetry({
        images,
        streamingBehavior: "steer",
        text,
      });
      if (result.steerConsumptionPromise) {
        this.monitorSteerConsumption(result.steerConsumptionPromise);
      }
    } catch (error) {
      this.onDone(error);
      throw error;
    }
  }

  detach(): void {
    this.rejectPendingSteerConsumptions(
      "Pi SDK session detached before steer consumed",
    );
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
    this.isProcessing = false;
  }

  stop(): void {
    this.rejectPendingSteerConsumptions(
      "Pi SDK session stopped before steer consumed",
    );
    this.detach();
    if (this.session) {
      this.session.dispose();
      this.session = undefined;
    }
  }

  async closeGracefully(timeoutMs: number): Promise<void> {
    const session = this.session;
    this.rejectPendingSteerConsumptions(
      "Pi SDK session closed before steer consumed",
    );
    this.detach();
    if (!session) {
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
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
      session.dispose();
      if (this.session === session) {
        this.session = undefined;
      }
      this.isProcessing = false;
    }
  }

  private trackProcessingState(event: AgentSessionEvent): void {
    if (event.type === "agent_start") {
      this.isProcessing = true;
    }
    if (event.type === "agent_end" && !event.willRetry) {
      this.isProcessing = false;
      // NOTE: Do NOT call onDone() here. agent_end signals "turn complete,
      // ready for next input" — NOT session termination. The session stays
      // alive across multiple turns. onDone() is only called on fatal errors
      // (prompt() catch) or explicit stop().
    }
  }

  private trackPendingSteerConsumption(): TrackedSteerConsumption {
    let resolvePromise: (() => void) | undefined;
    let rejectPromise: ((error: Error) => void) | undefined;
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    if (!resolvePromise || !rejectPromise) {
      throw new Error("Failed to track Pi steer consumption");
    }

    const pending: PendingSteerConsumption = {
      queuedText: null,
      reject: rejectPromise,
      resolve: resolvePromise,
    };
    this.pendingSteerConsumptions.push(pending);
    void promise.catch(() => undefined);
    return { pending, promise };
  }

  private observeSteerConsumption(event: AgentSessionEvent): void {
    if (event.type !== "queue_update") {
      return;
    }

    const addedQueuedTexts = listMultisetDifference(
      event.steering,
      this.lastObservedSteeringQueue,
    );
    const removedQueuedTexts = listMultisetDifference(
      this.lastObservedSteeringQueue,
      event.steering,
    );
    this.lastObservedSteeringQueue = [...event.steering];

    for (const queuedText of addedQueuedTexts) {
      // Pi queue_update exposes SDK-transformed text, so correlate by FIFO queue
      // additions rather than by the raw BB steer text.
      const pending = this.pendingSteerConsumptions.find(
        (entry) => entry.queuedText === null,
      );
      if (!pending) {
        break;
      }
      pending.queuedText = queuedText;
    }

    for (const queuedText of removedQueuedTexts) {
      const pending = this.pendingSteerConsumptions.find(
        (entry) => entry.queuedText === queuedText,
      );
      if (pending) {
        this.resolvePendingSteerConsumption(pending);
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
        this.rejectPendingSteerConsumptions(
          "Pi auto retry ended before steer was consumed",
        );
      }
    }
  }

  private scheduleTerminalSteerSettlement(): void {
    if (
      this.pendingSteerConsumptions.length === 0 ||
      this.terminalSteerSettlementTimeout !== undefined
    ) {
      return;
    }

    this.terminalSteerSettlementTimeout = setTimeout(() => {
      this.terminalSteerSettlementTimeout = undefined;
      if (this.autoRetryInProgress) {
        return;
      }
      this.rejectPendingSteerConsumptions(
        "Pi turn ended before steer was consumed",
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

  private resolvePendingSteerConsumption(
    pending: PendingSteerConsumption,
  ): void {
    const index = this.pendingSteerConsumptions.indexOf(pending);
    if (index === -1) {
      return;
    }
    this.pendingSteerConsumptions.splice(index, 1);
    pending.resolve();
  }

  private rejectPendingSteerConsumption(
    pending: PendingSteerConsumption,
    error: Error,
  ): void {
    const index = this.pendingSteerConsumptions.indexOf(pending);
    if (index === -1) {
      return;
    }
    this.pendingSteerConsumptions.splice(index, 1);
    pending.reject(error);
  }

  private rejectPendingSteerConsumptions(message: string): void {
    this.clearTerminalSteerSettlement();
    const pendingSteers = this.pendingSteerConsumptions.splice(0);
    for (const pending of pendingSteers) {
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
  ): Promise<RunPromptResult> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.runPromptOnce(args);
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

  private async runPromptOnce(args: RunPromptArgs): Promise<RunPromptResult> {
    if (!this.session) {
      throw new Error("No active Pi SDK session");
    }
    this.ensureCustomToolsActive();
    if (this.session.isStreaming) {
      const steerConsumption =
        args.streamingBehavior === "steer"
          ? this.trackPendingSteerConsumption()
          : null;
      try {
        await this.session.prompt(args.text, {
          streamingBehavior: args.streamingBehavior,
          ...(args.images && args.images.length > 0
            ? { images: args.images }
            : {}),
        });
      } catch (error) {
        if (steerConsumption) {
          this.rejectPendingSteerConsumption(
            steerConsumption.pending,
            error instanceof Error ? error : new Error(String(error)),
          );
        }
        throw error;
      }
      if (steerConsumption && steerConsumption.pending.queuedText === null) {
        this.resolvePendingSteerConsumption(steerConsumption.pending);
      }
      return { steerConsumptionPromise: steerConsumption?.promise ?? null };
    }
    await this.session.prompt(args.text, {
      ...(args.images && args.images.length > 0 ? { images: args.images } : {}),
    });
    return { steerConsumptionPromise: null };
  }
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
 * same id, and nothing in the string says which one was meant, so an ambiguous
 * match is an error rather than a guess.
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
