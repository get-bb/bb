import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runSettlementError } from "./run-settlement.js";
import { experimental_buildBridgeToolCallContent as buildBridgeToolCallContent } from "@get-bb/plugin-sdk/provider-bridge";
import type { ImageContent } from "@earendil-works/pi-ai";
import {
  NO_REQUEST_TIMEOUT,
  PiRpcChild,
  PiRpcChildExitedError,
  buildPiChildEnv,
  type PiRpcChildExitInfo,
} from "./rpc-child.js";

export interface PiRpcSessionOptions {
  cwd: string;
  model?: { provider: string; id: string };
  thinkingLevel?: string;
  additionalSkillPaths?: readonly string[];
  shellEnvOverrides?: Record<string, string>;
  dynamicTools?: readonly DynamicToolDefinition[];
  sessionFilePath: string;
  sessionDir: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  scratchDir: string;
  extensionPath: string;
  recordThreadId: string;
  noSession?: boolean;
  onExtensionUiRequest?: (request: Record<string, unknown>) => void;
}

export interface DynamicToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}

export type ToolCallForwarder = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<
  Parameters<typeof buildBridgeToolCallContent>[0] & { isError?: boolean }
>;

export type PiRpcEvent = Record<string, unknown> & { type: string };
type PiSessionEventHandler = (event: PiRpcEvent) => void;
type PiSessionDoneHandler = (error?: unknown) => void;

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

export interface PiPromptRunOutcome {
  boundaryDelivered?: boolean;
  error?: unknown;
}

export interface PiInputDispatch {
  consumed: Promise<void>;
  settled: Promise<PiPromptRunOutcome | null>;
}

interface PendingRunSettlement {
  resolve: (outcome: PiPromptRunOutcome) => void;
}

interface SettlementReport {
  runId: number;
  leafId: string | null;
  event: Record<string, unknown>;
}

interface StartReport {
  runId: number;
  previousSettlement: SettlementReport | null;
}

function parseSettlementReport(value: unknown): SettlementReport | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("runId" in value) ||
    typeof value.runId !== "number" ||
    !Number.isSafeInteger(value.runId) ||
    value.runId < 1 ||
    !("leafId" in value) ||
    (value.leafId !== null && typeof value.leafId !== "string") ||
    !("event" in value) ||
    !value.event ||
    typeof value.event !== "object" ||
    Array.isArray(value.event) ||
    "error" in value
  )
    return null;
  return {
    runId: value.runId,
    leafId: value.leafId,
    event: { ...value.event },
  };
}

interface ChannelReply {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

const PI_TRANSIENT_AUTH_RETRY_DELAY_MS = 250;
const PI_TRANSIENT_AUTH_MAX_RETRIES = 8;
function readinessTimeoutMs(): number {
  const configured = Number(process.env.BB_PI_BRIDGE_READINESS_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 60_000;
}
const CHANNEL_REQUEST_TIMEOUT_MS = 30_000;
const AGENT_END_LEAF_TIMEOUT_MS = 5_000;

type PiSessionConstructionOutcome = { ok: true } | { ok: false; error: Error };

function waitForPiTransientAuthRetry(): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, PI_TRANSIENT_AUTH_RETRY_DELAY_MS),
  );
}

export async function runPiTransientAuthConstruction(args: {
  attempt: () => Promise<PiSessionConstructionOutcome>;
  discardFailedAttempt: () => void;
  isClosed: () => boolean;
  waitBeforeRetry: () => Promise<void>;
}): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    const outcome = await args.attempt();
    if (outcome.ok) {
      return;
    }
    if (attempt >= PI_TRANSIENT_AUTH_MAX_RETRIES || args.isClosed()) {
      throw outcome.error;
    }
    args.discardFailedAttempt();
    await args.waitBeforeRetry();
  }
}

export interface PiRpcSessionState {
  model?: { provider?: string; id?: string; contextWindow?: number };
  thinkingLevel?: string;
  isStreaming: boolean;
  isCompacting: boolean;
  sessionFile?: string;
}

export class PiRpcSession {
  private child: PiRpcChild | undefined;
  private isProcessing = false;
  private supportsSettlement = false;
  private agentRunsStarted = 0;
  private agentRunsSettled = 0;
  private readonly runs = new Map<
    number,
    { end?: PiRpcEvent; leafId?: string | null; recoveryError?: string }
  >();
  private deliveredRunActive = false;
  private isCompacting = false;
  private manualCompactionCompletionCount = 0;
  private lastCompactionEndDelivery: Promise<void> = Promise.resolve();
  private deliveryChain: Promise<void> = Promise.resolve();
  private readonly pendingInputConsumptions: PendingInputConsumption[] = [];
  private lastObservedQueues: Record<PiInputQueue, string[]> = {
    followUp: [],
    steering: [],
  };
  private autoRetryInProgress = false;
  private terminalSteerSettlement: Promise<void> | null = null;
  private readonly pendingRunSettlements: PendingRunSettlement[] = [];
  private readonly channelReplies = new Map<string, ChannelReply>();
  private nextChannelRequestId = 0;
  private lastKnownLeafId: string | null = null;
  private readonly agentEndLeafReports: (string | null)[] = [];
  private agentEndLeafWaiter: ((leafId: string | null) => void) | null = null;
  private readonly agentSettledLeafReports: (SettlementReport | null)[] = [];
  private agentSettledLeafWaiter:
    | ((report: SettlementReport | null) => void)
    | null = null;
  private readonly agentStartReports: (StartReport | null)[] = [];
  private agentStartWaiter: ((report: StartReport | null) => void) | null =
    null;
  private ready: {
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
  } = createDeferred();
  private lastContextUsage: {
    tokens: number | null;
    contextWindow: number;
  } | null = null;
  private liveModel: PiRpcSessionState["model"] | undefined;
  private closed = false;

  constructor(
    private readonly options: PiRpcSessionOptions,
    private readonly forwardToolCall: ToolCallForwarder,
    private readonly onEvent: PiSessionEventHandler,
    private readonly onDone: PiSessionDoneHandler,
  ) {}

  getIsCompacting(): boolean {
    return this.isCompacting;
  }

  respondToExtensionUi(
    id: string | number,
    fields: Record<string, unknown>,
  ): void {
    this.child?.respondToExtensionUi(id, fields);
  }

  getLiveModel(): PiRpcSessionState["model"] | undefined {
    return this.liveModel;
  }

  getContextUsage(): { tokens: number | null; contextWindow: number } | null {
    return this.lastContextUsage;
  }

  async start(): Promise<void> {
    await runPiTransientAuthConstruction({
      attempt: () => this.spawnAndVerify(),
      discardFailedAttempt: () => {
        const failed = this.child;
        this.child = undefined;
        failed?.kill();
      },
      isClosed: () => this.closed,
      waitBeforeRetry: waitForPiTransientAuthRetry,
    });
  }

  private async spawnAndVerify(): Promise<PiSessionConstructionOutcome> {
    const toolsFilePath = join(
      this.options.scratchDir,
      `pi-tools-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
    );
    mkdirSync(dirname(toolsFilePath), { recursive: true });
    writeFileSync(
      toolsFilePath,
      JSON.stringify(this.options.dynamicTools ?? []),
      "utf8",
    );
    const promptFiles = this.writePromptFiles();
    const scratchFiles = [toolsFilePath, ...promptFiles.paths];

    const args: string[] = ["--mode", "rpc"];
    if (this.options.noSession) {
      args.push("--no-session");
    } else {
      mkdirSync(dirname(this.options.sessionFilePath), { recursive: true });
      args.push("--session", this.options.sessionFilePath);
    }
    args.push(
      "--session-dir",
      this.options.sessionDir,
      "--extension",
      this.options.extensionPath,
      ...promptFiles.args,
    );
    for (const skillPath of this.options.additionalSkillPaths ?? []) {
      args.push("--skill", skillPath);
    }
    if (this.options.model) {
      args.push(
        "--provider",
        this.options.model.provider,
        "--model",
        this.options.model.id,
      );
    }
    if (this.options.thinkingLevel) {
      args.push("--thinking", this.options.thinkingLevel);
    }

    this.ready = createDeferred();
    const onExtensionUiRequest = this.options.onExtensionUiRequest;
    const child = new PiRpcChild({
      cwd: this.options.cwd,
      env: buildPiChildEnv({
        ...(this.options.shellEnvOverrides ?? {}),
        PI_BB_TOOLS_FILE: toolsFilePath,
      }),
      args,
      onEvent: (event) => {
        if (child === this.child) this.handleEvent(event);
      },
      onChannelMessage: (message) => {
        if (child === this.child) this.handleChannelMessage(message);
      },
      onExit: (info) => {
        for (const file of scratchFiles) rmSync(file, { force: true });
        if (child === this.child) this.handleExit(info);
      },
      recordThreadId: this.options.recordThreadId,
      onExtensionUiRequest: onExtensionUiRequest
        ? (request) => {
            if (child === this.child) onExtensionUiRequest(request);
          }
        : undefined,
    });
    this.child = child;

    const state = await this.getState(CHANNEL_REQUEST_TIMEOUT_MS);
    await this.awaitReady(readinessTimeoutMs(), child);
    if (state.model?.provider === "unknown") {
      return {
        ok: false,
        error: new Error("Pi has no authenticated model provider available."),
      };
    }
    const wanted = this.options.model;
    if (
      wanted &&
      (state.model?.provider !== wanted.provider ||
        state.model?.id !== wanted.id)
    ) {
      return {
        ok: false,
        error: new Error(
          `Pi did not start with model "${wanted.provider}/${wanted.id}"` +
            (state.model?.id
              ? ` (it chose "${String(state.model.provider)}/${String(state.model.id)}")`
              : "") +
            ". Check that the provider is authenticated.",
        ),
      };
    }
    return { ok: true };
  }

  private awaitReady(timeoutMs: number, child: PiRpcChild): Promise<void> {
    if (child.exited) {
      return Promise.reject(
        new Error("pi exited before its extension reported ready"),
      );
    }
    const ready = this.ready;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("pi extension did not report ready in time"));
      }, timeoutMs);
      timer.unref?.();
      ready.promise.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (error: Error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  async getState(timeoutMs?: number): Promise<PiRpcSessionState> {
    const data = await this.requireChild().requestOk(
      { type: "get_state" },
      timeoutMs,
    );
    const state = (data ?? {}) as PiRpcSessionState;
    this.liveModel = state.model;
    return state;
  }

  prompt(text: string, images?: ImageContent[]): PiInputDispatch {
    const child = this.child;
    if (this.closed || !child || child.exited) {
      const consumed = Promise.reject(new Error("No active Pi session"));
      void consumed.catch(() => undefined);
      return { consumed, settled: Promise.resolve(null) };
    }
    this.isProcessing = true;
    const tracked = this.trackPendingInputConsumption("followUp");
    const settlement = new Promise<PiPromptRunOutcome>((resolve) => {
      this.pendingRunSettlements.push({ resolve });
    });
    const settled = this.dispatchWithTransientAuthRetry(
      child,
      {
        type: "prompt",
        message: text,
        ...(images && images.length > 0 ? { images } : {}),
        streamingBehavior: "followUp",
      },
      NO_REQUEST_TIMEOUT,
    ).then(
      async (): Promise<PiPromptRunOutcome | null> => {
        if (tracked.pending.queuedText !== null) {
          this.dropRunSettlement();
          return null;
        }
        this.resolvePendingInputConsumption(tracked.pending);
        const outcome = await settlement;
        return outcome;
      },
      (error: unknown): PiPromptRunOutcome | null => {
        this.isProcessing = false;
        this.dropRunSettlement();
        const queued = tracked.pending.queuedText !== null;
        this.rejectPendingInputConsumption(tracked.pending, asError(error));
        this.rejectPendingInputConsumptions(
          "Pi prompt failed before input was consumed",
        );
        this.onDone(error);
        return queued ? null : { error };
      },
    );
    return { consumed: tracked.promise, settled };
  }

  async steer(text: string, images?: ImageContent[]): Promise<void> {
    const child = this.requireChild();
    const tracked = this.trackPendingInputConsumption("steering");
    try {
      await this.dispatchWithTransientAuthRetry(child, {
        type: "prompt",
        message: text,
        ...(images && images.length > 0 ? { images } : {}),
        streamingBehavior: "steer",
      });
    } catch (error) {
      this.rejectPendingInputConsumption(tracked.pending, asError(error));
      this.onDone(error);
      throw error;
    }
    if (tracked.pending.queuedText === null) {
      this.resolvePendingInputConsumption(tracked.pending);
      return;
    }
    void tracked.promise.catch((error) => {
      this.onDone(error);
    });
  }

  async compact(): Promise<void> {
    const child = this.requireChild();
    if (this.isProcessing) {
      throw new Error("Cannot compact context while Pi is processing a turn");
    }
    if ((await this.getState()).isStreaming) {
      throw new Error("Cannot compact context while Pi is processing a turn");
    }
    const completionCount = this.manualCompactionCompletionCount;
    this.isProcessing = true;
    this.isCompacting = true;
    try {
      await child.requestOk({ type: "compact" }, 10 * 60_000);
    } catch (error) {
      if (this.manualCompactionCompletionCount === completionCount) {
        throw error;
      }
    } finally {
      this.isProcessing = false;
      this.isCompacting = false;
    }
    await this.lastCompactionEndDelivery;
  }

  async closeGracefully(timeoutMs: number): Promise<string | undefined> {
    const child = this.child;
    this.rejectPendingInputConsumptions(
      "Pi session closed before input was consumed",
    );
    this.closed = true;
    if (!child || child.exited) {
      return this.lastKnownLeafId ?? undefined;
    }
    const deadline = Date.now() + timeoutMs;
    await child
      .request({ type: "abort" }, Math.max(1, Math.floor(timeoutMs / 2)))
      .catch(() => undefined);
    await this.refreshLeafId(Math.max(1, deadline - Date.now())).catch(
      () => undefined,
    );
    child.closeGracefully();
    this.isProcessing = false;
    this.isCompacting = false;
    return this.lastKnownLeafId ?? undefined;
  }

  kill(): void {
    this.closed = true;
    this.child?.kill();
  }

  static async forkSessionFile(args: {
    sourceFile: string;
    targetFile: string;
    cwd: string;
    sessionDir: string;
    checkpointId?: string;
    extensionPath: string;
    scratchDir: string;
    recordThreadId: string;
  }): Promise<void> {
    const session = new PiRpcSession(
      {
        cwd: args.cwd,
        sessionFilePath: args.sourceFile,
        sessionDir: args.sessionDir,
        scratchDir: args.scratchDir,
        extensionPath: args.extensionPath,
        recordThreadId: args.recordThreadId,
        noSession: true,
      },
      () =>
        Promise.resolve({ content: "fork helper has no tools", isError: true }),
      () => undefined,
      () => undefined,
    );
    try {
      await session.start();
      await session.channelRequest({
        method: "fork",
        sourceFile: args.sourceFile,
        targetFile: args.targetFile,
        cwd: args.cwd,
        sessionDir: args.sessionDir,
        ...(args.checkpointId === undefined
          ? {}
          : { checkpointId: args.checkpointId }),
      });
    } finally {
      session.kill();
    }
  }

  private requireChild(): PiRpcChild {
    if (!this.child || this.child.exited) {
      throw new Error("No active Pi session");
    }
    return this.child;
  }

  private writePromptFiles(): { args: string[]; paths: string[] } {
    const args: string[] = [];
    const paths: string[] = [];
    const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    if (this.options.systemPrompt !== undefined) {
      const file = join(this.options.scratchDir, `pi-system-${stamp}.md`);
      writeFileSync(file, this.options.systemPrompt, "utf8");
      args.push("--system-prompt", file);
      paths.push(file);
    }
    if (this.options.appendSystemPrompt !== undefined) {
      const file = join(this.options.scratchDir, `pi-append-${stamp}.md`);
      writeFileSync(file, this.options.appendSystemPrompt, "utf8");
      args.push("--append-system-prompt", file);
      paths.push(file);
    }
    return { args, paths };
  }

  private async dispatchWithTransientAuthRetry(
    child: PiRpcChild,
    command: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await child.requestOk(command, timeoutMs);
        return;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error instanceof PiRpcChildExitedError ||
          !error.message.startsWith("No API key found for ") ||
          attempt >= PI_TRANSIENT_AUTH_MAX_RETRIES
        ) {
          throw error;
        }
        await waitForPiTransientAuthRetry();
      }
    }
  }

  private handleEvent(raw: Record<string, unknown>): void {
    if (typeof raw.type !== "string") {
      return;
    }
    const event = raw as PiRpcEvent;
    if (event.type === "agent_settled" && this.supportsSettlement) {
      this.deliverInOrder(async () => {
        this.deliverSettlement(await this.takeAgentSettledLeaf());
      });
      return;
    }
    this.trackProcessingState(event);
    this.observeInputConsumption(event);
    this.observeTerminalSteerSettlement(event);
    if (event.type === "agent_start" && this.supportsSettlement) {
      const runId = this.agentRunsStarted;
      this.deliverInOrder(async () => {
        const report = await this.takeAgentStart();
        if (!report || report.runId !== runId) {
          this.failSettlementProtocol();
          return;
        }
        if (report.previousSettlement)
          this.deliverSettlement(report.previousSettlement);
        if (this.closed) return;
        if (!this.deliveredRunActive) this.onEvent(event);
        this.deliveredRunActive = true;
      });
      return;
    }
    if (event.type === "agent_end") {
      const runId = this.agentRunsStarted;
      const observedRun = this.runs.get(runId);
      if (observedRun) observedRun.end = event;
      this.deliverInOrder(async () => {
        const leafId = await this.takeAgentEndLeaf();
        if (leafId !== null) this.lastKnownLeafId = leafId;
        const run = this.runs.get(runId) ?? {};
        run.end = event;
        run.leafId = leafId;
        this.runs.set(runId, run);
        this.onEvent({
          ...event,
          ...(this.supportsSettlement ? { deferSettlement: true } : {}),
          ...(leafId === null ? {} : { providerCheckpointId: leafId }),
        });
        if (!this.supportsSettlement) {
          this.settleRun(event);
          if (event.willRetry !== true) this.retireRunsThrough(runId);
        }
      });
      return;
    }
    const run = this.runs.get(this.agentRunsStarted);
    const messages = run?.end?.messages;
    const assistant = Array.isArray(messages)
      ? [...messages]
          .reverse()
          .find(
            (message: unknown): message is Record<string, unknown> =>
              typeof message === "object" &&
              message !== null &&
              "role" in message &&
              message.role === "assistant",
          )
      : undefined;
    if (
      run &&
      event.type === "compaction_end" &&
      event.reason === "overflow" &&
      event.willRetry === false &&
      (assistant?.stopReason === "length" ||
        assistant?.stopReason === "error" ||
        assistant?.stopReason === "aborted")
    ) {
      if (event.aborted === true) {
        run.recoveryError = "Automatic context compaction was interrupted";
      } else if (typeof event.errorMessage === "string") {
        run.recoveryError =
          event.errorMessage.trim() || "Automatic context compaction failed";
      }
    }
    if (event.type === "turn_end" || event.type === "compaction_end") {
      const delivery = this.deliverInOrder(async () => {
        await this.refreshContextUsage().catch(() => undefined);
        this.onEvent(event);
      });
      if (event.type === "compaction_end" && event.reason === "manual") {
        this.manualCompactionCompletionCount += 1;
        this.lastCompactionEndDelivery = delivery;
      }
      return;
    }
    this.deliverInOrder(() => {
      this.onEvent(event);
    });
  }

  private deliverInOrder(deliver: () => void | Promise<void>): Promise<void> {
    const next = this.deliveryChain.then(deliver, deliver);
    this.deliveryChain = next.catch(() => undefined);
    return this.deliveryChain;
  }

  private failSettlementProtocol(): void {
    if (this.closed) return;
    this.closed = true;
    this.isProcessing = false;
    const error = new Error(
      "Pi extension settlement identity is missing or invalid",
    );
    this.onDone(error);
    for (const pending of this.pendingRunSettlements.splice(0)) {
      pending.resolve({ boundaryDelivered: true, error });
    }
    this.rejectPendingInputConsumptions(error.message);
    this.child?.kill();
  }

  private deliverSettlement(report: SettlementReport | null): void {
    if (this.closed) return;
    if (!report) {
      this.failSettlementProtocol();
      return;
    }
    const { runId, leafId, event } = report;
    if (runId <= this.agentRunsSettled) return;
    const run = this.runs.get(runId);
    if (!run?.end) {
      this.failSettlementProtocol();
      return;
    }
    const messages = run.end.messages ?? [];
    const error = run.recoveryError ?? runSettlementError(event, messages);
    const checkpoint = leafId ?? run.leafId;
    const finalEvent: PiRpcEvent = {
      type: "agent_end",
      messages,
      settlementOnly: true,
      ...(error ? { settlementError: error } : {}),
      ...(checkpoint ? { providerCheckpointId: checkpoint } : {}),
    };
    if (this.agentRunsStarted === runId) this.isProcessing = false;
    this.agentRunsSettled = runId;
    this.deliveredRunActive = false;
    this.retireRunsThrough(runId);
    this.onEvent(finalEvent);
    this.onEvent({ ...event, type: "agent_settled" });
    this.settleRun(finalEvent);
    if (this.agentRunsStarted === runId) this.scheduleTerminalSteerSettlement();
  }

  private retireRunsThrough(runId: number): void {
    for (const id of this.runs.keys()) {
      if (id <= runId) this.runs.delete(id);
    }
  }

  private settleRun(event: PiRpcEvent): void {
    if (event.willRetry === true) {
      return;
    }
    const pending = this.pendingRunSettlements.shift();
    if (!pending) {
      return;
    }
    const error =
      typeof event.settlementError === "string"
        ? event.settlementError
        : runSettlementError(event, event.messages);
    pending.resolve({
      boundaryDelivered: true,
      ...(error ? { error: new Error(error) } : {}),
    });
  }

  private dropRunSettlement(): void {
    this.pendingRunSettlements.pop();
  }

  private async refreshLeafId(
    timeoutMs = CHANNEL_REQUEST_TIMEOUT_MS,
  ): Promise<void> {
    const child = this.child;
    if (!child || child.exited) {
      return;
    }
    const data = (await this.channelRequest({ method: "leaf" }, timeoutMs)) as
      | { leafId?: string | null }
      | undefined;
    if (data && typeof data.leafId === "string") {
      this.lastKnownLeafId = data.leafId;
    }
  }

  private takeAgentEndLeaf(): Promise<string | null> {
    const queued = this.agentEndLeafReports.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    return new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        if (this.agentEndLeafWaiter === settle) {
          this.agentEndLeafWaiter = null;
        }
        resolve(null);
      }, AGENT_END_LEAF_TIMEOUT_MS);
      timer.unref?.();
      const settle = (leafId: string | null) => {
        clearTimeout(timer);
        resolve(leafId);
      };
      this.agentEndLeafWaiter = settle;
    });
  }

  private takeAgentStart(): Promise<StartReport | null> {
    const queued = this.agentStartReports.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.agentStartWaiter === settle) this.agentStartWaiter = null;
        resolve(null);
      }, AGENT_END_LEAF_TIMEOUT_MS);
      timer.unref?.();
      const settle = (report: StartReport | null) => {
        clearTimeout(timer);
        resolve(report);
      };
      this.agentStartWaiter = settle;
    });
  }

  private takeAgentSettledLeaf(): Promise<SettlementReport | null> {
    const queued = this.agentSettledLeafReports.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise<SettlementReport | null>((resolve) => {
      const timer = setTimeout(() => {
        if (this.agentSettledLeafWaiter === settle)
          this.agentSettledLeafWaiter = null;
        resolve(null);
      }, AGENT_END_LEAF_TIMEOUT_MS);
      timer.unref?.();
      const settle = (report: SettlementReport | null) => {
        clearTimeout(timer);
        resolve(report);
      };
      this.agentSettledLeafWaiter = settle;
    });
  }

  private async refreshContextUsage(): Promise<void> {
    const child = this.child;
    if (!child || child.exited) {
      return;
    }
    const data = (await child.requestOk({ type: "get_session_stats" })) as
      | {
          contextUsage?: { tokens?: number | null; contextWindow?: number };
        }
      | undefined;
    const usage = data?.contextUsage;
    if (usage && typeof usage.contextWindow === "number") {
      this.lastContextUsage = {
        tokens: typeof usage.tokens === "number" ? usage.tokens : null,
        contextWindow: usage.contextWindow,
      };
    }
  }

  private handleChannelMessage(message: Record<string, unknown>): void {
    const child = this.child;
    if (message.kind === "ready") {
      this.supportsSettlement = message.agentSettled === true;
      this.ready.resolve();
      return;
    }
    if (message.kind === "agent-start") {
      if (!this.supportsSettlement) return;
      const previousSettlement = parseSettlementReport(
        message.previousSettlement,
      );
      const report =
        typeof message.runId === "number" &&
        Number.isSafeInteger(message.runId) &&
        message.runId > 0 &&
        (message.previousSettlement === null ||
          (previousSettlement && previousSettlement.runId < message.runId))
          ? { runId: message.runId, previousSettlement }
          : null;
      const waiter = this.agentStartWaiter;
      if (waiter) {
        this.agentStartWaiter = null;
        waiter(report);
      } else {
        this.agentStartReports.push(report);
      }
      return;
    }
    if (message.kind === "agent-settled-leaf") {
      const report = parseSettlementReport(message);
      const waiter = this.agentSettledLeafWaiter;
      if (waiter) {
        this.agentSettledLeafWaiter = null;
        waiter(report);
      } else {
        this.agentSettledLeafReports.push(report);
      }
      return;
    }
    if (message.kind === "agent-end-leaf") {
      const leafId = typeof message.leafId === "string" ? message.leafId : null;
      const waiter = this.agentEndLeafWaiter;
      if (waiter) {
        this.agentEndLeafWaiter = null;
        waiter(leafId);
      } else {
        this.agentEndLeafReports.push(leafId);
      }
      return;
    }
    if (message.kind === "tool-call" && child) {
      const id = String(message.id);
      const toolName = String(message.toolName);
      const toolArgs =
        typeof message.arguments === "object" && message.arguments !== null
          ? (message.arguments as Record<string, unknown>)
          : {};
      void this.forwardToolCall(toolName, toolArgs).then(
        (result) => {
          child.sendChannel({
            kind: "tool-result",
            id,
            content: buildBridgeToolCallContent(result),
            isError: result.isError === true,
          });
        },
        (error: unknown) => {
          child.sendChannel({
            kind: "tool-result",
            id,
            content: [
              {
                type: "text",
                text: error instanceof Error ? error.message : String(error),
              },
            ],
            isError: true,
          });
        },
      );
      return;
    }
    if (message.kind === "reply") {
      const reply = this.channelReplies.get(String(message.id));
      if (!reply) {
        return;
      }
      this.channelReplies.delete(String(message.id));
      if (typeof message.error === "string") {
        reply.reject(new Error(message.error));
      } else {
        reply.resolve(message.result);
      }
    }
  }

  private channelRequest(
    request: Record<string, unknown>,
    timeoutMs = CHANNEL_REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    const child = this.requireChild();
    this.nextChannelRequestId += 1;
    const id = `cr-${this.nextChannelRequestId}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.channelReplies.delete(id);
        reject(
          new Error(`pi extension did not answer ${String(request.method)}`),
        );
      }, timeoutMs);
      timer.unref?.();
      this.channelReplies.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.sendChannel({ kind: "request", id, ...request });
    });
  }

  private handleExit(info: PiRpcChildExitInfo): void {
    const wasClosed = this.closed;
    this.closed = true;
    this.ready.reject(new PiRpcChildExitedError(info));
    for (const [, reply] of this.channelReplies) {
      reply.reject(new PiRpcChildExitedError(info));
    }
    this.channelReplies.clear();
    const leafWaiter = this.agentEndLeafWaiter;
    if (leafWaiter) {
      this.agentEndLeafWaiter = null;
      leafWaiter(null);
    }
    const startWaiter = this.agentStartWaiter;
    if (startWaiter) {
      this.agentStartWaiter = null;
      startWaiter(null);
    }
    const settledLeafWaiter = this.agentSettledLeafWaiter;
    if (settledLeafWaiter) {
      this.agentSettledLeafWaiter = null;
      settledLeafWaiter(null);
    }
    this.rejectPendingInputConsumptions("Pi exited before input was consumed");
    for (const pending of this.pendingRunSettlements.splice(0)) {
      pending.resolve({ error: new PiRpcChildExitedError(info) });
    }
    this.isProcessing = false;
    this.isCompacting = false;
    if (!wasClosed) {
      this.onDone(new PiRpcChildExitedError(info));
    }
  }

  private trackProcessingState(event: PiRpcEvent): void {
    if (
      event.type === "agent_start" ||
      (event.type === "compaction_start" && event.reason === "manual")
    ) {
      this.isProcessing = true;
    }
    if (event.type === "agent_start") {
      this.agentRunsStarted += 1;
      this.runs.set(this.agentRunsStarted, {});
    }
    if (
      !this.supportsSettlement &&
      event.type === "agent_end" &&
      event.willRetry !== true
    ) {
      this.isProcessing = false;
    }
    if (event.type === "compaction_end" && event.reason === "manual") {
      this.isProcessing = false;
    }
  }

  private trackPendingInputConsumption(
    queue: PiInputQueue,
  ): TrackedInputConsumption {
    let resolvePromise: () => void = () => undefined;
    let rejectPromise: (error: Error) => void = () => undefined;
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
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

  private observeInputConsumption(event: PiRpcEvent): void {
    if (event.type !== "queue_update") {
      return;
    }
    this.observeQueue("steering", toStringArray(event.steering));
    this.observeQueue("followUp", toStringArray(event.followUp));
  }

  private observeQueue(
    queue: PiInputQueue,
    queuedTexts: readonly string[],
  ): void {
    const lastObserved = this.lastObservedQueues[queue];
    const added = listMultisetDifference(queuedTexts, lastObserved);
    const removed = listMultisetDifference(lastObserved, queuedTexts);
    this.lastObservedQueues[queue] = [...queuedTexts];
    for (const queuedText of added) {
      const pending = this.pendingInputConsumptions.find(
        (entry) => entry.queue === queue && entry.queuedText === null,
      );
      if (!pending) {
        break;
      }
      pending.queuedText = queuedText;
    }
    for (const queuedText of removed) {
      const pending = this.pendingInputConsumptions.find(
        (entry) => entry.queue === queue && entry.queuedText === queuedText,
      );
      if (pending) {
        this.resolvePendingInputConsumption(pending);
      }
    }
  }

  private observeTerminalSteerSettlement(event: PiRpcEvent): void {
    if (this.supportsSettlement) return;
    if (event.type === "agent_end") {
      if (event.willRetry !== true) {
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
      if (event.success !== true) {
        this.rejectPendingInputConsumptions(
          "Pi auto retry ended before steer was consumed",
          "steering",
        );
      }
    }
  }

  private scheduleTerminalSteerSettlement(): void {
    if (
      !this.pendingInputConsumptions.some(
        (entry) => entry.queue === "steering",
      ) ||
      this.terminalSteerSettlement !== null
    ) {
      return;
    }
    const child = this.child;
    if (!child || child.exited) {
      return;
    }
    const settlement = child
      .request({ type: "get_state" })
      .then((response) => {
        const state = (response.data ?? {}) as Partial<PiRpcSessionState>;
        return state.isStreaming === true;
      })
      .catch(() => false)
      .then((streaming) => {
        if (this.terminalSteerSettlement !== settlement) {
          return;
        }
        this.terminalSteerSettlement = null;
        if (this.autoRetryInProgress || streaming) {
          return;
        }
        this.rejectPendingInputConsumptions(
          "Pi turn ended before steer was consumed",
          "steering",
        );
      });
    this.terminalSteerSettlement = settlement;
  }

  private clearTerminalSteerSettlement(): void {
    this.terminalSteerSettlement = null;
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

  private rejectPendingInputConsumption(
    pending: PendingInputConsumption,
    error: Error,
  ): void {
    const index = this.pendingInputConsumptions.indexOf(pending);
    if (index === -1) {
      return;
    }
    this.pendingInputConsumptions.splice(index, 1);
    pending.reject(error);
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
}

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
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
