// The daemon-side Worker implementation for bb workflow runs (plan §6):
// `agent()` calls from the workflow runtime become ephemeral provider sessions
// driven through `createAgentRuntime`, deliberately separate from
// RuntimeManager's interactive-thread runtimes so workflow agents never enter
// the thread event spool or identity registry.
//
// Responsibilities:
// - One AgentRuntime per (run, cwd), refcounted: worktree runtimes are
//   single-agent and disposed at agent settle; shared-cwd runtimes are
//   disposed at run end (`shutdown()`), the analogue of omegacode's
//   `factory.shutdownAll()`.
// - Per-agent identity comes from the WorkerContext: `agentIndex` is the
//   runtime's journal-stable display index (the same index `agent/*` run
//   events carry) and `attempt` counts runAgent calls for one logical agent
//   (withRetry / corrective re-prompts). The synthetic runtime threadId is
//   `wfa_<runId>_<agentIndex>` (`_r<attempt>` suffix on retries), started with
//   `sessionKind: "workflowAgent"` and the restricted shell env (no
//   BB_SERVER_URL / BB_HOST_DAEMON_PORT / BB_THREAD_ID, bb shimmed to fail) so
//   nested bb work is structurally impossible.
// - Awaitable turn synthesis over the fire-and-forget `runTurn`: a per-thread
//   waiter resolves on `turn/completed`, accumulating agentMessage text and
//   thread-cumulative token usage along the way. Every normalized ThreadEvent
//   is appended verbatim — with per-agent monotonic sequence meta — to the
//   run-dir log `agents/<agentIndex>.events.jsonl` (ThreadEventRow lines, the
//   same shape interactive threads persist, so drill-in renders through
//   thread-view's `buildThreadTimelineFromEvents`). Retry attempts APPEND to
//   the same log with a continuing sequence, so one logical agent maps to
//   exactly one log addressable by its run-event agentIndex.
// - Failure mappings (each one a fake-provider test): provider process exit →
//   retryable AgentError; stall-watchdog interruption → retryable AgentError;
//   abort → AgentInterrupted; max-turns / context-window → terminal
//   AgentError. The workflow runtime's `withRetry` wraps `runAgent`, so this
//   class never retries internally — it only classifies.
// - Structured output: claude-code rides the session-level `outputSchema`
//   (bridge `outputFormat`); codex runs omegacode's two-turn pattern (free
//   working turn, then a silent extraction turn with the strictified schema on
//   `runTurn.outputSchema`); pi runs a two-turn schema-in-prompt extraction
//   with no adapter support. All three return `AgentResult.structured` parsed
//   from the final message text; the workflow runtime owns ajv revalidation
//   and the single corrective re-prompt.

import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createAgentRuntime,
  ProviderProcessExitedError,
  type AgentRuntime,
  type AgentRuntimeExecutionOptions,
  type AgentRuntimeOptions,
  type AgentRuntimeProcessExitInfo,
  type AgentRuntimeShellEnvironment,
} from "@bb/agent-runtime";
import {
  buildThreadEventRow,
  encodeClientTurnRequestIdNumber,
  isWorkflowSandboxAllowedByCeiling,
  jsonObjectSchema,
  requireThreadEventScopeTurnId,
  threadScope,
  turnScope,
  type JsonObject,
  type JsonValue,
  type PendingInteractionCreate,
  type PendingInteractionResolution,
  type PendingInteractionUserAnswer,
  type ProviderErrorCategory,
  type ThreadEvent,
  type ThreadEventItem,
} from "@bb/domain";
import {
  provisionWorkflowWorktree,
  teardownWorkflowWorktree,
  type WorkflowWorktree,
} from "@bb/host-workspace";
import {
  AgentError,
  AgentInterrupted,
  parseJsonLoose,
  permissionModeForWorkflowSandbox,
  toCodexOutputSchema,
  type AgentResult,
  type AgentSpec,
  type AgentUsage,
  type Worker,
  type WorkerContext,
  type WorkerProgress,
  type WorkflowSandbox,
} from "@bb/workflow-runtime";

type WorkflowAgentProviderId = AgentSpec["provider"];

/** omegacode's default per-turn no-progress watchdog (codex.ts): sized to
 *  exceed the longest expected silent stretch inside a healthy turn (a quiet
 *  build/test emits nothing until output), while still failing a genuinely
 *  hung turn instead of hanging the run forever. */
export const DEFAULT_WORKFLOW_TURN_STALL_TIMEOUT_MS = 30 * 60_000;

/** The silent second-turn prompt that extracts the final structured answer
 *  (omegacode's EXTRACTION_PROMPT, verbatim). */
const EXTRACTION_PROMPT =
  "Now return your final answer as a single JSON value that conforms to the required output schema. Output only the JSON — no prose, no explanation, no code fences.";

/** Provider error categories that warrant a retry (transient provider-side
 *  faults). Everything else — max-turns, context-window-exceeded, policy,
 *  billing, bad-request, … — is terminal for the agent. */
const RETRYABLE_PROVIDER_ERROR_CATEGORIES: ReadonlySet<ProviderErrorCategory> =
  new Set(["connection-failed", "overloaded", "rate-limit", "stream-disconnected"]);

const WORKFLOW_USER_QUESTION_FREE_TEXT =
  "This agent runs autonomously inside a bb workflow; no user is available to answer. Proceed with your best judgment.";

/** A daemon-level token bounding live workflow provider processes. The run
 *  manager owns the actual counter; the executor acquires one token per
 *  worktree runtime (each worktree agent costs a dedicated provider process
 *  because provider cwd is fixed at runtime creation) and releases it when
 *  that runtime is disposed at agent settle.
 *
 *  M2 divergence from plan §6 (recorded there too): the token is acquired
 *  inside runAgent, AFTER the vm-side runtime has already emitted
 *  `agent/started` — an agent waiting on host capacity therefore renders as
 *  started, not queued. Surfacing the capacity wait in run events is deferred
 *  until a worker→runtime progress signal exists (M3/M5). */
export interface WorkflowProviderProcessToken {
  release(): void;
}

export interface WorkflowProviderProcessGate {
  acquire(args: { signal: AbortSignal }): Promise<WorkflowProviderProcessToken>;
}

export interface WorkflowAgentExecutorOptions {
  runId: string;
  /** The run's project, for BB_PROJECT_ID in agent shells and runtime
   *  bookkeeping. M3's workflow.start command must carry it. */
  projectId: string;
  /** The run dir `<dataDir>/workflow-runs/<runId>/`: per-agent event logs
   *  land in `agents/`, worktrees in `worktrees/`, per-agent storage in
   *  `agent-storage/`. */
  runDir: string;
  /** The run's sandbox ceiling (workflow_runs.sandboxCeiling, carried on
   *  workflow.start): every per-call `agent({sandbox})` spec is enforced
   *  against it at spec execution — server-resolved per-project policy,
   *  never trusted to the script (plan §6). */
  sandboxCeiling: WorkflowSandbox;
  /** Restricted base shell env prepared by the daemon
   *  (`prepareWorkflowAgentShellEnv`): no server coordinates, no bb on PATH. */
  workflowAgentShellEnv: AgentRuntimeShellEnvironment;
  /** Bundled provider bridges directory; absent in dev (source fallback). */
  bridgeBundleDir?: string;
  /** Test seam, mirroring RuntimeManagerOptions.createRuntime. */
  createRuntime?: (options: AgentRuntimeOptions) => AgentRuntime;
  providerProcessGate: WorkflowProviderProcessGate;
  /** Timeout for a worktree's `.bb-env-setup.sh` (server-resolved policy). */
  worktreeSetupTimeoutMs: number;
  /** Per-turn no-progress watchdog; pass
   *  DEFAULT_WORKFLOW_TURN_STALL_TIMEOUT_MS outside tests. */
  turnStallTimeoutMs: number;
  onStderr?: (line: string, threadId?: string) => void;
}

interface RuntimeEntry {
  cwd: string;
  runtime: AgentRuntime;
  sessions: Map<string, AgentSession>;
  refCount: number;
  /** Worktree runtimes host exactly one agent and are disposed at settle. */
  singleAgent: boolean;
  disposed: boolean;
}

interface TurnWaiter {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
}

interface AgentSession {
  threadId: string;
  agentIndex: number;
  providerId: WorkflowAgentProviderId;
  context: WorkerContext;
  onAbort: () => void;
  log: WriteStream;
  seq: number;
  /** Thread-cumulative token usage, replaced on every tokenUsage update
   *  (codex `total` semantics: monotonic per thread, so the latest update is
   *  exact across turns — never sum turns). */
  usage: AgentUsage;
  providerThreadId: string | null;
  activeTurnId: string | null;
  waiter: TurnWaiter | null;
  /** Whether to forward this turn's progress to the workflow runtime. The
   *  silent extraction turn sets this false (omegacode parity). */
  forwardProgress: boolean;
  finalMessageText: string | null;
  deltaText: string;
  lastProviderError: { message: string; category?: ProviderErrorCategory } | null;
  stallTimer: ReturnType<typeof setTimeout> | null;
  stalled: boolean;
  /** Set when the session was killed outside a turn waiter (abort, provider
   *  exit, executor shutdown); later runtime-call failures map to it. */
  fatalError: Error | null;
  /** Rejects with the fatal error; raced against non-waiter awaits
   *  (startThread, model list) so a dead session never hangs them. */
  killed: Promise<never>;
  rejectKilled: (error: Error) => void;
}

interface RunTurnAndWaitArgs {
  entry: RuntimeEntry;
  session: AgentSession;
  text: string;
  execOptions: AgentRuntimeExecutionOptions;
  forwardProgress: boolean;
  outputSchema?: JsonObject;
}

/** Workflow sandbox → bb execution options. Workflows are autonomous by
 *  contract: readonly/workspace-write run with structural `deny` escalation
 *  (the sandbox itself defines what is allowed; nothing ever waits on a
 *  human). danger-full-access maps to `full` (escalation does not apply) and
 *  only reaches here when the run's ceiling grants it — `runAgent` rejects
 *  over-ceiling specs first. Worktree agents are forced to workspace-write
 *  scoped to the worktree — worktree isolation is the only hard boundary for
 *  parallel mutators. That forcing is why `runAgent` enforces the ceiling
 *  against the EFFECTIVE sandbox: a worktree spec is workspace-write here no
 *  matter what sandbox it declared. */
function buildWorkflowExecutionOptions(args: {
  spec: AgentSpec;
  model: string;
}): AgentRuntimeExecutionOptions {
  const permissionMode =
    args.spec.worktree === true
      ? "workspace-write"
      : permissionModeForWorkflowSandbox(args.spec.sandbox);
  const base = {
    model: args.model,
    serviceTier: "default" as const,
    reasoningLevel: args.spec.effort,
    // Nested workflow runs are a non-goal; provider-native dynamic workflows
    // stay off inside workflow agent sessions.
    workflowsEnabled: false,
  };
  return permissionMode === "full"
    ? { ...base, permissionMode, permissionEscalation: null }
    : { ...base, permissionMode, permissionEscalation: "deny" };
}

function buildPiExtractionPrompt(schema: JsonObject): string {
  return `${EXTRACTION_PROMPT}\n\nThe required JSON Schema:\n${JSON.stringify(schema, null, 2)}`;
}

/** Best-effort: an unparseable final message yields no structured value (the
 *  workflow runtime then fails the agent — omegacode parity). */
function tryParseStructured(text: string): JsonValue | undefined {
  try {
    return parseJsonLoose(text);
  } catch {
    return undefined;
  }
}

function formatProviderProcessExitMessage(
  info: AgentRuntimeProcessExitInfo,
): string {
  const status =
    info.signal !== null ? `signal ${info.signal}` : `code ${info.code ?? "unknown"}`;
  return `Provider "${info.providerId}" process exited ${
    info.expected ? "during shutdown" : "unexpectedly"
  } (${status})`;
}

function toolProgressName(item: ThreadEventItem): string | null {
  switch (item.type) {
    case "commandExecution":
      return "command";
    case "toolCall":
      return item.tool;
    case "fileChange":
      return "fileChange";
    case "webSearch":
      return "webSearch";
    case "webFetch":
      return "webFetch";
    default:
      return null;
  }
}

export class WorkflowAgentExecutor implements Worker {
  private readonly options: WorkflowAgentExecutorOptions;
  private readonly createRuntime: (options: AgentRuntimeOptions) => AgentRuntime;
  private readonly entries = new Map<string, RuntimeEntry>();
  private readonly inflight = new Set<Promise<void>>();
  private readonly defaultModels = new Map<WorkflowAgentProviderId, string>();
  private readonly agentsLogDir: string;
  private readonly worktreesDir: string;
  private readonly agentStorageRoot: string;
  /** Last written log sequence per agentIndex, so retry attempts appended to
   *  the same `agents/<agentIndex>.events.jsonl` keep one monotonic order. */
  private readonly agentLogSeq = new Map<number, number>();
  private nextTurnRequestNumber = 0;
  private shuttingDown = false;

  constructor(options: WorkflowAgentExecutorOptions) {
    this.options = options;
    this.createRuntime = options.createRuntime ?? createAgentRuntime;
    this.agentsLogDir = join(options.runDir, "agents");
    this.worktreesDir = join(options.runDir, "worktrees");
    this.agentStorageRoot = join(options.runDir, "agent-storage");
  }

  async runAgent(spec: AgentSpec, context: WorkerContext): Promise<AgentResult> {
    if (this.shuttingDown) {
      throw new AgentInterrupted("workflow agent executor is shut down");
    }
    if (context.signal.aborted) throw new AgentInterrupted();
    // The ceiling is enforced against the EFFECTIVE sandbox the spec will
    // execute with, not the declared one: `buildWorkflowExecutionOptions`
    // forces every worktree agent to workspace-write (worktree isolation is
    // the boundary for parallel mutators), so a worktree spec carrying a
    // read-only sandbox would otherwise pass a read-only ceiling and still
    // run with workspace-write — including `wf/<runId>-…` branch creation in
    // the real project repo's refs.
    const effectiveSandbox: WorkflowSandbox =
      spec.worktree === true ? "workspace-write" : spec.sandbox;
    if (
      !isWorkflowSandboxAllowedByCeiling({
        sandbox: effectiveSandbox,
        ceiling: this.options.sandboxCeiling,
      })
    ) {
      // The launch gate rejects an over-ceiling RUN DEFAULT, but a per-call
      // `agent(prompt, {sandbox})` reaches the executor with whatever the
      // script wrote — sandbox policy is enforced at spec execution, never
      // trusted to the script (plan §6). The ceiling is the per-project
      // allowance resolved server-side and snapshotted on the run row
      // (M7; replaces the M6 unconditional danger-full-access reject). Hard
      // terminal reject (no retry: the snapshot never changes mid-run).
      throw new AgentError({
        provider: spec.provider,
        code: "sandbox_not_allowed",
        message: `${
          spec.worktree === true && effectiveSandbox !== spec.sandbox
            ? `worktree agents always run workspace-write, which`
            : `sandbox "${spec.sandbox}"`
        } exceeds this run's sandbox ceiling "${this.options.sandboxCeiling}" — the project's workflow policy must allow it before launch`,
      });
    }

    const run = this.executeAgent({ spec, context });
    const tracked = run.then(
      () => undefined,
      () => undefined,
    );
    this.inflight.add(tracked);
    try {
      return await run;
    } catch (error) {
      throw this.toWorkerError(error, context.signal, spec.provider);
    } finally {
      this.inflight.delete(tracked);
    }
  }

  /** Sum of live provider processes across this run's runtimes — the input to
   *  the run manager's daemon-level process accounting. */
  countRunningProviderProcesses(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      count += entry.runtime.listRunningProviders().length;
    }
    return count;
  }

  /** Run-end disposal (the analogue of omegacode's factory.shutdownAll):
   *  settles any live agents as interrupted, waits for their teardown
   *  (worktree teardown included), then disposes every remaining runtime. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const entry of this.entries.values()) {
      for (const session of entry.sessions.values()) {
        this.settleSession(
          session,
          new AgentInterrupted("workflow agent executor shut down"),
        );
      }
    }
    await Promise.allSettled([...this.inflight]);
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) {
      if (entry.disposed) continue;
      entry.disposed = true;
      await entry.runtime.shutdown();
    }
  }

  // ---------------------------------------------------------------------------
  // Agent execution
  // ---------------------------------------------------------------------------

  private async executeAgent(args: {
    spec: AgentSpec;
    context: WorkerContext;
  }): Promise<AgentResult> {
    const { spec, context } = args;
    const useWorktree = spec.worktree === true;
    // The daemon-level provider-process token gates worktree runtimes only:
    // each one costs a dedicated provider process (fixed cwd per runtime),
    // while shared-cwd agents reuse the run's existing processes.
    const gateToken = useWorktree
      ? await this.options.providerProcessGate.acquire({ signal: context.signal })
      : null;
    try {
      if (context.signal.aborted) throw new AgentInterrupted();
      const worktree = useWorktree
        ? await this.provisionWorktree({
            spec,
            agentIndex: context.agentIndex,
            attempt: context.attempt,
            signal: context.signal,
          })
        : null;
      try {
        const result = await this.runAgentInCwd({
          spec,
          context,
          cwd: worktree?.path ?? spec.cwd,
          singleAgent: useWorktree,
        });
        if (!worktree) return result;
        // The single-agent runtime is already disposed (runAgentInCwd's
        // finally), so no provider process holds the worktree cwd open.
        const teardown = await teardownWorkflowWorktree({
          sourcePath: spec.cwd,
          worktree,
        });
        return teardown.removed
          ? result
          : { ...result, worktreeBranch: teardown.preservedBranch };
      } catch (error) {
        // Failure path: teardown still runs (preserve-on-dirty keeps any
        // work), but the preserved branch has no result to ride on — the
        // journal entry for a failed agent carries no worktreeBranch.
        if (worktree) {
          await teardownWorkflowWorktree({ sourcePath: spec.cwd, worktree });
        }
        throw error;
      }
    } finally {
      gateToken?.release();
    }
  }

  private async provisionWorktree(args: {
    spec: AgentSpec;
    agentIndex: number;
    attempt: number;
    signal: AbortSignal;
  }): Promise<WorkflowWorktree> {
    try {
      // Retries get an attempt-suffixed directory and branch so a prior
      // attempt's preserved branch/dirty directory is never collided with or
      // clobbered.
      const dirName =
        args.attempt === 0
          ? String(args.agentIndex)
          : `${args.agentIndex}-r${args.attempt}`;
      return await provisionWorkflowWorktree({
        sourcePath: args.spec.cwd,
        targetPath: join(this.worktreesDir, dirName),
        runId: this.options.runId,
        agentIndex: args.agentIndex,
        attempt: args.attempt,
        setupTimeoutMs: this.options.worktreeSetupTimeoutMs,
        signal: args.signal,
      });
    } catch (error) {
      if (args.signal.aborted) throw new AgentInterrupted();
      throw new AgentError({
        provider: args.spec.provider,
        code: "worktree_provision_failed",
        message: `failed to provision workflow worktree: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }

  private async runAgentInCwd(args: {
    spec: AgentSpec;
    context: WorkerContext;
    cwd: string;
    singleAgent: boolean;
  }): Promise<AgentResult> {
    const entry = this.acquireRuntimeEntry({
      cwd: args.cwd,
      singleAgent: args.singleAgent,
    });
    try {
      const session = await this.openSession({
        entry,
        spec: args.spec,
        context: args.context,
      });
      try {
        return await this.runTurns({ entry, session, spec: args.spec });
      } finally {
        await this.closeSession(entry, session);
      }
    } finally {
      await this.releaseRuntimeEntry(entry);
    }
  }

  private async runTurns(args: {
    entry: RuntimeEntry;
    session: AgentSession;
    spec: AgentSpec;
  }): Promise<AgentResult> {
    const { entry, session, spec } = args;
    const model =
      spec.model ?? (await this.resolveDefaultModel(entry, session, spec.provider));
    const execOptions = buildWorkflowExecutionOptions({ spec, model });
    const schema = spec.schema;

    try {
      await Promise.race([
        entry.runtime.startThread({
          environmentId: this.options.runId,
          threadId: session.threadId,
          projectId: this.options.projectId,
          providerId: spec.provider,
          sessionKind: "workflowAgent",
          options: execOptions,
          ...(spec.instructions !== undefined
            ? { instructions: spec.instructions }
            : {}),
          // Session-level structured output is claude-code only (SDK
          // outputFormat is fixed at query creation); codex/pi adapters
          // reject it and get their schema per-turn / in-prompt below.
          ...(schema !== undefined && spec.provider === "claude-code"
            ? { outputSchema: schema }
            : {}),
        }),
        session.killed,
      ]);
    } catch (error) {
      throw this.mapRuntimeCallError(error, session);
    }

    const workingText = await this.runTurnAndWait({
      entry,
      session,
      text: spec.prompt,
      execOptions,
      forwardProgress: true,
    });
    if (schema === undefined) {
      return { text: workingText, status: "completed", usage: { ...session.usage } };
    }
    if (spec.provider === "claude-code") {
      const structured = tryParseStructured(workingText);
      return {
        text: workingText,
        ...(structured !== undefined ? { structured } : {}),
        status: "completed",
        usage: { ...session.usage },
      };
    }

    // codex/pi: free working turn above, silent extraction turn here. codex
    // gets the strictified schema enforced by the app-server; pi has no
    // schema concept, so the schema travels in the extraction prompt.
    const extractionText = await this.runTurnAndWait({
      entry,
      session,
      text:
        spec.provider === "codex" ? EXTRACTION_PROMPT : buildPiExtractionPrompt(schema),
      execOptions,
      forwardProgress: false,
      ...(spec.provider === "codex"
        ? { outputSchema: jsonObjectSchema.parse(toCodexOutputSchema(schema)) }
        : {}),
    });
    const structured = tryParseStructured(extractionText);
    return {
      text: extractionText,
      ...(structured !== undefined ? { structured } : {}),
      status: "completed",
      usage: { ...session.usage },
    };
  }

  private async resolveDefaultModel(
    entry: RuntimeEntry,
    session: AgentSession,
    providerId: WorkflowAgentProviderId,
  ): Promise<string> {
    const cached = this.defaultModels.get(providerId);
    if (cached !== undefined) return cached;
    let models: Awaited<ReturnType<AgentRuntime["listModels"]>>;
    try {
      models = await Promise.race([
        entry.runtime.listModels({ providerId }),
        session.killed,
      ]);
    } catch (error) {
      throw this.mapRuntimeCallError(error, session);
    }
    const model =
      models.models.find((candidate) => candidate.isDefault) ?? models.models[0];
    if (!model) {
      throw new AgentError({
        provider: providerId,
        code: "no_default_model",
        message: `provider "${providerId}" reported no available models; set an explicit model on the agent or the run defaults`,
      });
    }
    this.defaultModels.set(providerId, model.model);
    return model.model;
  }

  private async runTurnAndWait(args: RunTurnAndWaitArgs): Promise<string> {
    const { entry, session } = args;
    if (session.fatalError) throw session.fatalError;
    if (session.context.signal.aborted) throw new AgentInterrupted();

    session.forwardProgress = args.forwardProgress;
    session.finalMessageText = null;
    session.deltaText = "";
    session.lastProviderError = null;
    session.stalled = false;
    const turnSettled = new Promise<string>((resolve, reject) => {
      session.waiter = { resolve, reject };
    });
    // The waiter can settle (e.g. via onProcessExit) while the runTurn ack
    // below is still pending; keep that rejection handled either way.
    turnSettled.catch(() => undefined);
    this.armStallTimer(entry, session);

    try {
      await entry.runtime.runTurn({
        threadId: session.threadId,
        input: [{ type: "text", text: args.text, mentions: [] }],
        clientRequestId: this.nextClientRequestId(),
        options: args.execOptions,
        ...(args.outputSchema !== undefined
          ? { outputSchema: args.outputSchema }
          : {}),
      });
    } catch (error) {
      this.clearStallTimer(session);
      session.waiter = null;
      throw this.mapRuntimeCallError(error, session);
    }

    try {
      return await turnSettled;
    } finally {
      this.clearStallTimer(session);
      session.waiter = null;
      session.activeTurnId = null;
    }
  }

  private nextClientRequestId() {
    const value = this.nextTurnRequestNumber;
    this.nextTurnRequestNumber += 1;
    return encodeClientTurnRequestIdNumber({ value });
  }

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  private async openSession(args: {
    entry: RuntimeEntry;
    spec: AgentSpec;
    context: WorkerContext;
  }): Promise<AgentSession> {
    const { agentIndex, attempt } = args.context;
    // One logical agent, one log: every attempt appends to the agentIndex
    // file (flags "a") with a continuing sequence, while the runtime threadId
    // is attempt-unique so a retry never reuses a settled session's identity.
    const threadId =
      attempt === 0
        ? `wfa_${this.options.runId}_${agentIndex}`
        : `wfa_${this.options.runId}_${agentIndex}_r${attempt}`;
    await mkdir(this.agentsLogDir, { recursive: true });
    await mkdir(join(this.agentStorageRoot, threadId), { recursive: true });
    const log = createWriteStream(
      join(this.agentsLogDir, `${agentIndex}.events.jsonl`),
      { flags: "a" },
    );

    let rejectKilled: (error: Error) => void = () => undefined;
    const killed = new Promise<never>((_, reject) => {
      rejectKilled = reject;
    });
    killed.catch(() => undefined);

    const session: AgentSession = {
      threadId,
      agentIndex,
      providerId: args.spec.provider,
      context: args.context,
      onAbort: () => undefined,
      log,
      seq: this.agentLogSeq.get(agentIndex) ?? 0,
      usage: { inputTokens: 0, outputTokens: 0 },
      providerThreadId: null,
      activeTurnId: null,
      waiter: null,
      forwardProgress: true,
      finalMessageText: null,
      deltaText: "",
      lastProviderError: null,
      stallTimer: null,
      stalled: false,
      fatalError: null,
      killed,
      rejectKilled,
    };
    session.onAbort = () => {
      this.settleSession(session, new AgentInterrupted());
      // Run-level abort: every agent on this signal is interrupting, so a
      // codex thread/stop restarting a shared provider process is fine here
      // (sibling waiters have already settled — abort listeners run first).
      void args.entry.runtime
        .stopThread({ threadId: session.threadId })
        .catch(() => undefined);
    };
    args.context.signal.addEventListener("abort", session.onAbort, { once: true });
    args.entry.sessions.set(threadId, session);
    return session;
  }

  private async closeSession(entry: RuntimeEntry, session: AgentSession): Promise<void> {
    entry.sessions.delete(session.threadId);
    session.context.signal.removeEventListener("abort", session.onAbort);
    this.clearStallTimer(session);
    await new Promise<void>((resolve) => {
      session.log.end(() => resolve());
    });
  }

  /** Session-fatal settle (abort, provider exit, executor shutdown): rejects
   *  the active turn waiter if any, and arms `fatalError`/`killed` so awaits
   *  outside a waiter (startThread, model list, the next turn) fail fast. */
  private settleSession(session: AgentSession, error: Error): void {
    if (session.fatalError === null) {
      session.fatalError = error;
      session.rejectKilled(error);
    }
    const waiter = session.waiter;
    if (waiter) {
      session.waiter = null;
      this.clearStallTimer(session);
      waiter.reject(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Runtime entries
  // ---------------------------------------------------------------------------

  private acquireRuntimeEntry(args: {
    cwd: string;
    singleAgent: boolean;
  }): RuntimeEntry {
    if (!args.singleAgent) {
      const existing = this.entries.get(args.cwd);
      if (existing && !existing.disposed) {
        existing.refCount += 1;
        return existing;
      }
    }
    // The runtime callbacks close over the entry through `getEntry`; the
    // entry is assigned synchronously below, before any provider process
    // exists to emit.
    let entry: RuntimeEntry | null = null;
    const runtime = this.createRuntime(
      this.buildRuntimeOptions({ cwd: args.cwd, getEntry: () => entry }),
    );
    entry = {
      cwd: args.cwd,
      runtime,
      sessions: new Map(),
      refCount: 1,
      singleAgent: args.singleAgent,
      disposed: false,
    };
    this.entries.set(args.cwd, entry);
    return entry;
  }

  private buildRuntimeOptions(args: {
    cwd: string;
    getEntry: () => RuntimeEntry | null;
  }): AgentRuntimeOptions {
    const withEntry = (handle: (entry: RuntimeEntry) => void): void => {
      const entry = args.getEntry();
      if (entry) handle(entry);
    };
    return {
      workspacePath: args.cwd,
      additionalWorkspaceWriteRoots: [this.agentStorageRoot],
      // No `shellEnv`: every session in these runtimes is a workflowAgent
      // and gets the restricted base env.
      workflowAgentShellEnv: this.options.workflowAgentShellEnv,
      threadStorageRootPath: this.agentStorageRoot,
      ...(this.options.bridgeBundleDir !== undefined
        ? { bridgeBundleDir: this.options.bridgeBundleDir }
        : {}),
      onEvent: (event) => withEntry((entry) => this.handleRuntimeEvent(entry, event)),
      onToolCall: async () => ({
        contentItems: [
          {
            type: "inputText",
            text: "Dynamic tools are not available in workflow agent sessions.",
          },
        ],
        success: false,
      }),
      onInteractiveRequest: (request) => this.resolveInteractiveRequest(request),
      ...(this.options.onStderr !== undefined
        ? { onStderr: this.options.onStderr }
        : {}),
      onProcessExit: (info) => withEntry((entry) => this.handleProcessExit(entry, info)),
    };
  }

  private async releaseRuntimeEntry(entry: RuntimeEntry): Promise<void> {
    entry.refCount -= 1;
    if (entry.refCount > 0 || !entry.singleAgent) return;
    await this.disposeRuntimeEntry(entry);
  }

  private async disposeRuntimeEntry(entry: RuntimeEntry): Promise<void> {
    if (entry.disposed) return;
    entry.disposed = true;
    this.entries.delete(entry.cwd);
    await entry.runtime.shutdown();
  }

  // ---------------------------------------------------------------------------
  // Event handling
  // ---------------------------------------------------------------------------

  private handleRuntimeEvent(entry: RuntimeEntry, event: ThreadEvent): void {
    const session = entry.sessions.get(event.threadId);
    if (!session) return;
    this.appendEventToLog(session, event);
    if (session.waiter) this.armStallTimer(entry, session);

    switch (event.type) {
      case "thread/identity":
        session.providerThreadId = event.providerThreadId;
        break;
      case "turn/started":
        session.activeTurnId = requireThreadEventScopeTurnId({
          type: event.type,
          scope: event.scope,
        });
        break;
      case "item/agentMessage/delta":
        session.deltaText += event.delta;
        this.emitProgress(session, { kind: "text", text: event.delta });
        break;
      case "item/started": {
        const name = toolProgressName(event.item);
        if (name !== null) {
          this.emitProgress(session, {
            kind: "tool",
            id: event.item.id,
            name,
          });
        }
        break;
      }
      case "item/completed":
        this.handleCompletedItem(session, event.item);
        break;
      case "thread/tokenUsage/updated":
        session.usage = {
          inputTokens: event.tokenUsage.total.inputTokens,
          outputTokens: event.tokenUsage.total.outputTokens,
        };
        this.emitProgress(session, { kind: "usage", usage: { ...session.usage } });
        break;
      case "provider/error":
        session.lastProviderError = {
          message: event.message,
          ...(event.errorInfo !== undefined
            ? { category: event.errorInfo.category }
            : {}),
        };
        break;
      case "turn/completed":
        this.settleTurn(session, event);
        break;
      default:
        break;
    }
  }

  private handleCompletedItem(session: AgentSession, item: ThreadEventItem): void {
    if (item.type === "agentMessage") {
      session.finalMessageText = item.text;
      // Providers that stream deltas already forwarded this text; only emit
      // the full message when no delta arrived (e.g. the fake provider).
      if (session.deltaText.length === 0) {
        this.emitProgress(session, { kind: "text", text: item.text });
      }
      return;
    }
    if (item.type === "reasoning") {
      const text = [...item.summary, ...item.content].join("\n");
      if (text.length > 0) {
        this.emitProgress(session, { kind: "reasoning", text });
      }
      return;
    }
    const name = toolProgressName(item);
    if (name === null) return;
    this.emitProgress(session, {
      kind: "tool-result",
      id: item.id,
      name,
      ...(item.type === "commandExecution" && item.aggregatedOutput !== undefined
        ? { output: item.aggregatedOutput }
        : {}),
      ...("status" in item ? { isError: item.status === "failed" } : {}),
    });
  }

  private emitProgress(session: AgentSession, progress: WorkerProgress): void {
    if (!session.forwardProgress) return;
    session.context.onProgress(progress);
  }

  private settleTurn(
    session: AgentSession,
    event: Extract<ThreadEvent, { type: "turn/completed" }>,
  ): void {
    const waiter = session.waiter;
    if (!waiter) return;
    session.waiter = null;
    this.clearStallTimer(session);
    session.activeTurnId = null;

    if (event.status === "completed") {
      waiter.resolve(session.finalMessageText ?? session.deltaText);
      return;
    }
    if (event.status === "interrupted") {
      // Interruptions we did not cause (abort settles the waiter before the
      // provider reports) map to AgentInterrupted; our own stall-watchdog
      // interrupt is a retryable provider fault instead.
      waiter.reject(
        session.stalled ? this.buildStalledTurnError(session) : new AgentInterrupted(),
      );
      return;
    }
    const category = session.lastProviderError?.category;
    waiter.reject(
      new AgentError({
        provider: session.providerId,
        code: category ?? "turn_failed",
        message:
          event.error?.message ??
          session.lastProviderError?.message ??
          "provider turn failed",
        retryable:
          category !== undefined && RETRYABLE_PROVIDER_ERROR_CATEGORIES.has(category),
        // Failed turns still bill into the run budget.
        usage: { ...session.usage },
      }),
    );
  }

  private handleProcessExit(
    entry: RuntimeEntry,
    info: AgentRuntimeProcessExitInfo,
  ): void {
    const message = formatProviderProcessExitMessage(info);
    for (const threadId of info.threadIds) {
      const session = entry.sessions.get(threadId);
      if (!session) continue;
      if (!info.expected) {
        // Mirror RuntimeManager.buildUnexpectedProviderExitEvents in the
        // per-agent log: the runtime never synthesizes turn/completed on
        // process death, so the timeline needs these rows to stay coherent.
        if (
          session.waiter &&
          session.activeTurnId !== null &&
          session.providerThreadId !== null
        ) {
          this.appendEventToLog(session, {
            type: "turn/completed",
            threadId,
            providerThreadId: session.providerThreadId,
            scope: turnScope(session.activeTurnId),
            status: "failed",
            error: { message },
          });
        }
        this.appendEventToLog(session, {
          type: "system/error",
          threadId,
          scope:
            session.activeTurnId !== null
              ? turnScope(session.activeTurnId)
              : threadScope(),
          code: "provider_process_exited",
          message,
          ...(info.stderr !== null && info.stderr.length > 0
            ? { detail: info.stderr }
            : {}),
        });
      }
      this.settleSession(
        session,
        new AgentError({
          provider: session.providerId,
          code: "provider_process_exited",
          message,
          retryable: true,
          usage: { ...session.usage },
        }),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Stall watchdog
  // ---------------------------------------------------------------------------

  private armStallTimer(entry: RuntimeEntry, session: AgentSession): void {
    this.clearStallTimer(session);
    if (this.options.turnStallTimeoutMs <= 0) return;
    const stallTimer = setTimeout(() => {
      this.onTurnStalled(entry, session);
    }, this.options.turnStallTimeoutMs);
    stallTimer.unref?.();
    session.stallTimer = stallTimer;
  }

  private clearStallTimer(session: AgentSession): void {
    if (session.stallTimer) {
      clearTimeout(session.stallTimer);
      session.stallTimer = null;
    }
  }

  /** No provider events for turnStallTimeoutMs while a turn is live: fail the
   *  turn as retryable instead of hanging the run forever (bb's 15-minute
   *  turn watchdog is server-side; workflow agents bypass the server, so the
   *  executor owns its own). */
  private onTurnStalled(entry: RuntimeEntry, session: AgentSession): void {
    const waiter = session.waiter;
    if (!waiter) return;
    session.stalled = true;
    session.waiter = null;
    this.clearStallTimer(session);
    waiter.reject(this.buildStalledTurnError(session));
    // Best-effort interrupt so a half-alive provider stops burning tokens.
    // Exception: codex thread/stop with an active turn restarts the WHOLE
    // provider process, which would kill sibling agents sharing this
    // runtime — abandon the stalled codex turn instead. Accepted trade-off:
    // the abandoned turn keeps running on the shared process (burning tokens;
    // its events are silently dropped once this session closes) until the
    // run ends and the shared runtime is disposed. Revisit when codex gains
    // per-conversation cwd (plan open question 8) and a stalled turn can be
    // stopped without restarting the shared process.
    if (session.providerId === "codex" && !entry.singleAgent) return;
    void entry.runtime
      .stopThread({ threadId: session.threadId })
      .catch(() => undefined);
  }

  private buildStalledTurnError(session: AgentSession): AgentError {
    return new AgentError({
      provider: session.providerId,
      code: "turn_stalled",
      message: `workflow agent turn received no provider events for ${this.options.turnStallTimeoutMs}ms — failing instead of hanging`,
      retryable: true,
      usage: { ...session.usage },
    });
  }

  // ---------------------------------------------------------------------------
  // Approvals / errors / logging
  // ---------------------------------------------------------------------------

  /** Workflows are autonomous by contract: nothing here ever creates a
   *  pending interaction. readonly/workspace-write sessions run with
   *  permissionEscalation "deny", so approval requests are auto-denied by the
   *  runtime before reaching this handler; an approval arriving here belongs
   *  to a danger-full-access session and is allowed. User questions (claude)
   *  are answered deterministically so the turn never stalls. */
  private resolveInteractiveRequest(
    request: PendingInteractionCreate,
  ): Promise<PendingInteractionResolution> {
    if (request.payload.kind === "user_question") {
      const answers: Record<string, PendingInteractionUserAnswer> = {};
      for (const question of request.payload.questions) {
        const firstOption = question.options?.[0];
        answers[question.id] = question.allowFreeText
          ? { selected: [], freeText: WORKFLOW_USER_QUESTION_FREE_TEXT }
          : { selected: firstOption ? [firstOption.value] : [] };
      }
      return Promise.resolve({ kind: "user_answer", answers });
    }
    return Promise.resolve({ decision: "allow_once", grantedPermissions: null });
  }

  /** Map errors escaping the runtime API (startThread/runTurn/listModels)
   *  onto the Worker error contract. A session killed by a process exit (or
   *  abort) already holds the well-formed error via `settleSession`; a
   *  pending runtime call rejected by the provider process dying races that
   *  path, so the typed ProviderProcessExitedError maps to the same retryable
   *  code. Everything else is terminal by default — config and programming
   *  errors never deserve a retry. */
  private mapRuntimeCallError(error: unknown, session: AgentSession): Error {
    if (error instanceof AgentError || error instanceof AgentInterrupted) {
      return error;
    }
    if (session.fatalError) return session.fatalError;
    if (session.context.signal.aborted) return new AgentInterrupted();
    if (error instanceof ProviderProcessExitedError) {
      return new AgentError({
        provider: session.providerId,
        code: "provider_process_exited",
        message: error.message,
        retryable: true,
        usage: { ...session.usage },
      });
    }
    return new AgentError({
      provider: session.providerId,
      code: "runtime_error",
      message: error instanceof Error ? error.message : String(error),
      usage: { ...session.usage },
    });
  }

  private toWorkerError(
    error: unknown,
    signal: AbortSignal,
    provider: WorkflowAgentProviderId,
  ): Error {
    if (error instanceof AgentError || error instanceof AgentInterrupted) {
      return error;
    }
    if (signal.aborted) return new AgentInterrupted();
    return new AgentError({
      provider,
      code: "executor_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  private appendEventToLog(session: AgentSession, event: ThreadEvent): void {
    session.seq += 1;
    this.agentLogSeq.set(session.agentIndex, session.seq);
    const row = buildThreadEventRow({
      id: `${session.threadId}.${session.seq}`,
      scope: event.scope,
      threadId: event.threadId,
      seq: session.seq,
      createdAt: Date.now(),
      event,
    });
    session.log.write(`${JSON.stringify(row)}\n`);
  }
}
