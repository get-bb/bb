// Daemon-side supervision of workflow runner child processes (plan §3 / M2).
// One runner child per run, spawned against the run dir
// `<dataDir>/workflow-runs/<runId>/` and driven over the ndjson JSON-RPC
// protocol in @bb/workflow-runtime's runner-protocol:
//
// - `run/start` boots the child's run loop (ack = script parsed; the terminal
//   run event — never the ack — settles the run).
// - The child's `agent/run` requests are dispatched to this run's
//   WorkflowAgentExecutor (the Worker over createAgentRuntime); coarse
//   progress flows back as `agent/progress` notifications.
// - `run/event` notifications feed the in-daemon sink (`onRunEvent` — wired to
//   the durable workflow event spool) and the `journal.jsonl` hot cache.
// - Exit observation: a child that dies without a terminal run event yields a
//   synthetic `run/failed` with a `runner_exited:` reason.
// - Cancel aborts both sides: the daemon-side AbortController interrupts
//   executor work (in-flight agent runs settle as interrupted) while the
//   `run/abort` notification unwinds the vm loop to `run/cancelled`.
//
// The manager also owns the daemon-level workflow provider-process token
// (WorkflowProviderProcessSemaphore — worktree agents acquire one before
// provisioning, bounding live provider processes across every run), records
// runner pids in the run dir, reaps stale runners via heartbeat staleness
// (silently at boot — session-open reconciliation owns foreign dead
// segments — and with a synthetic `run/failed` settle from the periodic
// in-life sweep, so a handle-less runner death can never leave its run
// dangling `running` server-side), and reports active run ids (live child
// handle OR fresh heartbeat) — the M3 session-open `activeWorkflowRunIds`
// input.

import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type {
  AgentRuntime,
  AgentRuntimeOptions,
  AgentRuntimeShellEnvironment,
} from "@bb/agent-runtime";
import type { JsonValue } from "@bb/domain";
import {
  sanitizeInheritedChildProcessEnv,
  spawnPortablePipedProcess,
  type PortablePipedChildProcess,
} from "@bb/process-utils";
import {
  addUsage,
  AgentError,
  AgentInterrupted,
  decodeWorkflowRunnerDaemonInboundLine,
  emptyUsage,
  encodeWorkflowRunnerAbort,
  encodeWorkflowRunnerAgentProgress,
  encodeWorkflowRunnerAgentRunResult,
  encodeWorkflowRunnerError,
  encodeWorkflowRunnerStartRequest,
  resolveWorkflowRunnerProcessArgs,
  WORKFLOW_HEARTBEAT_STALE_MS,
  type AgentSpec,
  type AgentUsage,
  type RunDefaults,
  type Worker,
  type WorkerContext,
  type WorkerProgress,
  type WorkflowJournalEntry,
  type WorkflowRunEvent,
  type WorkflowRunnerAgentProgress,
  type WorkflowRunnerAgentRunParams,
  type WorkflowRunnerAgentRunResult,
  type WorkflowRunnerStartResult,
  type WorkflowRunnerWireId,
  type WorkflowSandbox,
} from "@bb/workflow-runtime";
import type { HostDaemonLogger } from "./logger.js";
import {
  clearWorkflowRunnerPidFile,
  isProcessAlive,
  isWorkflowRunHeartbeatFresh,
  listWorkflowRunIds,
  readWorkflowRunnerPidFile,
  readWorkflowRunTerminalRecord,
  removeWorkflowRunHeartbeat,
  workflowRunDirPath,
  workflowRunHeartbeatPath,
  workflowRunJournalPath,
  workflowRunsRootPath,
  writeWorkflowRunnerPidFile,
  writeWorkflowRunTerminalRecord,
  type WorkflowRunTerminalRecord,
} from "./workflow-run-dir.js";
import {
  WorkflowAgentExecutor,
  type WorkflowAgentExecutorOptions,
  type WorkflowProviderProcessGate,
  type WorkflowProviderProcessToken,
} from "./workflow-agent-executor.js";

// The default for `maxLiveProviderProcesses` lives in @bb/config
// (BB_WORKFLOW_MAX_LIVE_PROVIDER_PROCESSES, default 8): the entrypoint reads
// the env var and threads the explicit value here. The token gate bounds
// WORKTREE runtimes only — shared-cwd runtimes are not counted (recorded M2
// divergence, plan §6).

/** Mirrors the server's thread-provisioning SETUP_TIMEOUT_MS until workflow
 *  worktree policy is server-resolved (M3). */
export const DEFAULT_WORKFLOW_WORKTREE_SETUP_TIMEOUT_MS = 15 * 60 * 1000;

/** Grace between a cancel request and forced runner termination when no
 *  terminal run event arrives (a vm body that ignores abort — or starves its
 *  event loop — can never emit `run/cancelled` on its own). */
export const DEFAULT_WORKFLOW_CANCEL_ESCALATION_GRACE_MS = 10_000;

/** Cadence of the in-life stale-runner sweep (`reapStaleRunners` with
 *  `spoolSyntheticTerminalEvents: true`): how long a handle-less dead segment
 *  can leave its server-side run dangling `running` before the synthetic
 *  `run/failed` converges it. */
export const WORKFLOW_STALE_RUNNER_SWEEP_INTERVAL_MS = 30_000;

/** Script parse + loop boot are fast; a silent child here is a broken spawn. */
const RUNNER_START_ACK_TIMEOUT_MS = 30_000;

/** SIGTERM → abort → run/cancelled; SIGKILL when the child ignores it. */
const RUNNER_TERMINATE_GRACE_MS = 5_000;

const STDERR_TAIL_MAX_LINES = 20;

/**
 * Ceiling on one runner→daemon stdout line. Untrusted workflow JS can write to
 * the runner's stdout (`console` is exposed in the sandbox) and run-event
 * payloads embed author/provider-controlled text; without a cap a single giant
 * line would buffer wholesale in daemon memory (the OS process boundary
 * protects the event loop, not the heap). Sized comfortably above the largest
 * legitimate protocol line (a `run/completed` result is producer-capped at
 * 1MB; journal entries carry full agent result text).
 */
export const MAX_RUNNER_STDOUT_LINE_LENGTH = 8 * 1024 * 1024;

/** Stderr is diagnostics-only; oversized lines are truncated, never fatal. */
const MAX_RUNNER_STDERR_LINE_LENGTH = 16 * 1024;

/**
 * The daemon-level token bounding live workflow provider processes across
 * every run. Worktree agents acquire one token before provisioning (each
 * worktree costs a dedicated provider process — cwd is fixed per runtime);
 * shared-cwd agents never touch the gate. Released tokens hand off to the
 * oldest waiter directly.
 */
export class WorkflowProviderProcessSemaphore
  implements WorkflowProviderProcessGate
{
  private available: number;
  private readonly waiters: Array<{ grant: () => void }> = [];

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(
        `workflow provider process capacity must be a positive integer, got ${capacity}`,
      );
    }
    this.available = capacity;
  }

  acquire(args: { signal: AbortSignal }): Promise<WorkflowProviderProcessToken> {
    if (args.signal.aborted) {
      return Promise.reject(new AgentInterrupted());
    }
    if (this.available > 0) {
      this.available -= 1;
      return Promise.resolve(this.buildToken());
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        grant: () => {
          args.signal.removeEventListener("abort", onAbort);
          resolve(this.buildToken());
        },
      };
      const onAbort = (): void => {
        const index = this.waiters.indexOf(waiter);
        if (index !== -1) this.waiters.splice(index, 1);
        reject(new AgentInterrupted());
      };
      args.signal.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private buildToken(): WorkflowProviderProcessToken {
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        const next = this.waiters.shift();
        if (next) {
          // The token transfers; the live count is unchanged.
          next.grant();
          return;
        }
        this.available += 1;
      },
    };
  }
}

export interface WorkflowRunManagerRunEvent {
  runId: string;
  event: WorkflowRunEvent;
}

/**
 * The per-run worker surface the manager drives — WorkflowAgentExecutor in
 * production, a FakeWorker-backed stub in offline tests.
 */
export interface WorkflowRunWorker extends Worker {
  shutdown(): Promise<void>;
  countRunningProviderProcesses(): number;
}

export interface WorkflowRunManagerOptions {
  dataDir: string;
  logger: HostDaemonLogger;
  /** Restricted base shell env for workflow agent sessions (`prepareWorkflowAgentShellEnv`). */
  workflowAgentShellEnv: AgentRuntimeShellEnvironment;
  /** Bundled child entries (runner + provider bridges); absent in dev (source fallback). */
  bridgeBundleDir?: string;
  /** In-daemon sink for run events — the durable workflow event spool in
   *  production (workflow-event-buffer.ts), recording arrays in tests. */
  onRunEvent: (event: WorkflowRunManagerRunEvent) => void;
  maxLiveProviderProcesses: number;
  worktreeSetupTimeoutMs: number;
  turnStallTimeoutMs: number;
  /** Pass DEFAULT_WORKFLOW_CANCEL_ESCALATION_GRACE_MS outside tests. */
  cancelEscalationGraceMs: number;
  /** Test seam, mirroring RuntimeManagerOptions.createRuntime. */
  createRuntime?: (options: AgentRuntimeOptions) => AgentRuntime;
  /** Test seam: replaces the WorkflowAgentExecutor for provider-free runs. */
  createWorker?: (options: WorkflowAgentExecutorOptions) => WorkflowRunWorker;
}

export interface StartWorkflowRunArgs {
  runId: string;
  /** The run's project (BB_PROJECT_ID in agent shells; M3's workflow.start carries it). */
  projectId: string;
  /** The full workflow file source (the server-side snapshot in M3). */
  source: string;
  /** Filename used in workflow stack traces, e.g. "deep-research.workflow.js". */
  filename: string;
  /** Launch-time args; undefined = launched without args. */
  args: JsonValue | undefined;
  seed: number;
  /** Journal-seeded base for now(): the run's original creation time. */
  baseTimeMs: number;
  /** Fully-resolved run defaults (filled once at the server boundary in M3). */
  defaults: RunDefaults;
  /** The run's sandbox ceiling (workflow_runs.sandboxCeiling): the executor
   *  enforces per-call `agent({sandbox})` specs against it. Not part of
   *  `defaults` — never visible to the script's spec resolution. */
  sandboxCeiling: WorkflowSandbox;
  /** Resume journal preload; empty on a fresh run. */
  journal: readonly WorkflowJournalEntry[];
  /** Wall-clock ceiling on the whole run; null = unbounded. M3's
   *  workflow.start carries the server-resolved policy value. */
  execTimeoutMs: number | null;
}

export type StartWorkflowRunResult =
  | { accepted: true }
  | { accepted: false; code: "script_invalid"; message: string };

interface PendingStartRequest {
  resolve: (result: WorkflowRunnerStartResult) => void;
  reject: (error: Error) => void;
}

interface RunHandle {
  runId: string;
  runDir: string;
  child: PortablePipedChildProcess;
  worker: WorkflowRunWorker;
  abort: AbortController;
  pendingStart: Map<WorkflowRunnerWireId, PendingStartRequest>;
  nextRequestId: number;
  /** A terminal run event was observed (or the start was rejected). */
  settled: boolean;
  /**
   * The terminal run event emitted for this segment (real or synthetic), or
   * null while live — and forever for script-rejected starts, which emit no
   * terminal event. Recorded durably at exit cleanup so a redelivered
   * workflow.start after settle acks without re-running the workflow.
   */
  terminalEventType: WorkflowRunTerminalRecord["eventType"] | null;
  /** Folded agent usage, for the synthetic runner_exited terminal event. */
  usage: AgentUsage;
  stderrTail: string[];
  journalStream: WriteStream | null;
  /** Armed by cancelRun: forces termination if the child never settles. */
  cancelEscalation: ReturnType<typeof setTimeout> | null;
  exited: boolean;
  /** Resolves after exit cleanup (executor shutdown, pid/heartbeat removal). */
  done: Promise<void>;
  finishDone: () => void;
}

export class WorkflowRunManager {
  private readonly options: WorkflowRunManagerOptions;
  private readonly runs = new Map<string, RunHandle>();
  /** In-flight startRun promises, keyed by runId — the synchronous
   *  reservation that makes overlapping start requests share one spawn. */
  private readonly pendingStarts = new Map<
    string,
    Promise<StartWorkflowRunResult>
  >();
  private readonly gate: WorkflowProviderProcessSemaphore;
  private readonly createWorker: (
    options: WorkflowAgentExecutorOptions,
  ) => WorkflowRunWorker;
  private shuttingDown = false;

  constructor(options: WorkflowRunManagerOptions) {
    this.options = options;
    this.gate = new WorkflowProviderProcessSemaphore(
      options.maxLiveProviderProcesses,
    );
    this.createWorker =
      options.createWorker ??
      ((workerOptions) => new WorkflowAgentExecutor(workerOptions));
  }

  /**
   * Spawn a runner child for the run and await its run/start ack. Idempotent
   * per runId: a re-request for an already-active run acks without a second
   * spawn, and an overlapping re-request while the first spawn is still
   * awaiting its ack returns the SAME in-flight promise (the M3
   * command-redelivery contract — durable redelivery can re-request within
   * the 30s ack window, and two children for one run would shadow each other
   * in the runs map). Throws on spawn/protocol failures; script rejection is
   * the typed `script_invalid` result.
   */
  async startRun(args: StartWorkflowRunArgs): Promise<StartWorkflowRunResult> {
    if (this.shuttingDown) {
      throw new Error("workflow run manager is shut down");
    }
    if (this.runs.has(args.runId)) {
      return { accepted: true };
    }
    const pending = this.pendingStarts.get(args.runId);
    if (pending) {
      return pending;
    }
    const start = this.spawnRun(args);
    this.pendingStarts.set(args.runId, start);
    try {
      return await start;
    } finally {
      this.pendingStarts.delete(args.runId);
    }
  }

  private async spawnRun(
    args: StartWorkflowRunArgs,
  ): Promise<StartWorkflowRunResult> {
    const runDir = workflowRunDirPath(this.options.dataDir, args.runId);
    await mkdir(runDir, { recursive: true });

    const worker = this.createWorker(
      this.buildWorkerOptions({
        runId: args.runId,
        projectId: args.projectId,
        runDir,
        sandboxCeiling: args.sandboxCeiling,
      }),
    );
    const child = spawnPortablePipedProcess({
      command: "node",
      args: resolveWorkflowRunnerProcessArgs({
        bundleDir: this.options.bridgeBundleDir,
      }),
      cwd: runDir,
      env: sanitizeInheritedChildProcessEnv({ env: process.env }),
    });
    // Writes are always guarded, but a racing child death can still EPIPE.
    child.stdin.on("error", () => undefined);

    let finishDone: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      finishDone = resolve;
    });
    const handle: RunHandle = {
      runId: args.runId,
      runDir,
      child,
      worker,
      abort: new AbortController(),
      pendingStart: new Map(),
      nextRequestId: 1,
      settled: false,
      terminalEventType: null,
      usage: emptyUsage(),
      stderrTail: [],
      journalStream: null,
      cancelEscalation: null,
      exited: false,
      done,
      finishDone,
    };
    this.runs.set(args.runId, handle);

    attachBoundedLineReader({
      stream: child.stdout,
      maxLineLength: MAX_RUNNER_STDOUT_LINE_LENGTH,
      onLine: (line) => this.handleRunnerLine(handle, line),
      onOverflow: () => this.handleRunnerStdoutOverflow(handle),
    });
    attachBoundedLineReader({
      stream: child.stderr,
      maxLineLength: MAX_RUNNER_STDERR_LINE_LENGTH,
      onLine: (line) => this.handleRunnerStderrLine(handle, line),
      onOverflow: (truncatedPrefix) =>
        this.handleRunnerStderrLine(handle, `${truncatedPrefix}… [truncated]`),
    });
    // "close" (not "exit") so every buffered stdout line — including the
    // terminal run event — is processed before exit handling runs.
    child.once("close", (code, signal) => {
      void this.handleChildDown(handle, { code, signal });
    });
    child.once("error", (error) => {
      void this.handleChildDown(handle, { code: null, signal: null, error });
    });

    if (child.pid !== undefined) {
      await writeWorkflowRunnerPidFile(runDir, child.pid);
    }

    let result: WorkflowRunnerStartResult;
    try {
      result = await this.sendStartRequest(handle, args);
    } catch (error) {
      await this.terminateRun(handle);
      throw error;
    }
    if (!result.accepted) {
      // Pre-side-effect rejection: no events will follow; the child exits on
      // its own — wait for its cleanup so the run dir settles before we return.
      handle.settled = true;
      await this.terminateRun(handle);
    }
    return result;
  }

  /**
   * Request cancellation: aborts the daemon-side executor work (in-flight
   * agent runs settle as interrupted) and tells the child to unwind its vm
   * loop to `run/cancelled`. A vm body that ignores abort — or starves its
   * event loop so the abort line is never read — cannot settle on its own, so
   * an escalation timer terminates the child after the grace (SIGTERM →
   * SIGKILL; exit handling synthesizes the terminal `run/failed`). Returns
   * false for unknown/already-exited runs.
   */
  cancelRun(runId: string): boolean {
    const handle = this.runs.get(runId);
    if (!handle || handle.exited) return false;
    handle.abort.abort();
    this.writeRunnerLine(handle, encodeWorkflowRunnerAbort());
    if (handle.cancelEscalation === null) {
      const cancelEscalation = setTimeout(() => {
        if (!handle.exited) {
          this.options.logger.warn(
            { runId: handle.runId },
            "Workflow runner ignored cancel; terminating",
          );
          void this.terminateRun(handle);
        }
      }, this.options.cancelEscalationGraceMs);
      cancelEscalation.unref?.();
      handle.cancelEscalation = cancelEscalation;
    }
    return true;
  }

  /**
   * Run ids that are demonstrably alive on this host: a live child handle, or
   * a run dir whose heartbeat is fresh (a runner that survived a daemon
   * restart). The M3 session-open payload derives `activeWorkflowRunIds` here.
   */
  async listActiveWorkflowRunIds(): Promise<string[]> {
    const active = new Set<string>();
    for (const [runId, handle] of this.runs) {
      if (!handle.exited) active.add(runId);
    }
    const nowMs = Date.now();
    for (const runId of await listWorkflowRunIds(this.options.dataDir)) {
      if (this.runs.has(runId)) continue;
      const fresh = await isWorkflowRunHeartbeatFresh({
        runDir: workflowRunDirPath(this.options.dataDir, runId),
        staleMs: WORKFLOW_HEARTBEAT_STALE_MS,
        nowMs,
      });
      if (fresh) active.add(runId);
    }
    return [...active].sort();
  }

  /**
   * Delete an archived run's run dir (the server retention sweep's
   * `workflow.prune` RPC): per-agent event logs, worktree checkouts, the
   * journal hot cache, and pid/heartbeat records. Refused while the run is
   * demonstrably alive here — a live child handle, an in-flight start, or a
   * fresh heartbeat (a runner that survived a daemon restart) — so a prune
   * can never yank state from under a live runner; the sweep retries later.
   * Idempotent: pruning a missing dir succeeds. Preserved dirty-worktree
   * BRANCHES survive (they live in the project repo's refs, `wf/<runId>-…`);
   * only the run-dir checkouts are removed — the durable artifact the skill
   * documents is the branch, and `git worktree prune` clears the stale
   * registrations left in the project repo.
   */
  async pruneRunDir(runId: string): Promise<{ pruned: boolean }> {
    const handle = this.runs.get(runId);
    if ((handle && !handle.exited) || this.pendingStarts.has(runId)) {
      return { pruned: false };
    }
    const runDir = workflowRunDirPath(this.options.dataDir, runId);
    // Defense in depth ahead of the recursive rm — the daemon's single most
    // destructive operation. The contract validates the wfr_ id shape, but a
    // path-segment id (`..`) joined under the runs root must be structurally
    // impossible here too, never merely unsent.
    if (
      basename(runDir) !== runId ||
      dirname(runDir) !== workflowRunsRootPath(this.options.dataDir)
    ) {
      throw new Error(
        `workflow.prune refused non-child run id ${JSON.stringify(runId)}`,
      );
    }
    const fresh = await isWorkflowRunHeartbeatFresh({
      runDir,
      staleMs: WORKFLOW_HEARTBEAT_STALE_MS,
      nowMs: Date.now(),
    });
    if (fresh) {
      return { pruned: false };
    }
    await rm(runDir, { recursive: true, force: true });
    return { pruned: true };
  }

  /** Live workflow provider processes across every run (Σ listRunningProviders).
   *  Observability-only in M2: gate admission uses the fixed token semaphore
   *  (worktree runtimes only); M3+ host-level admission may consult this for
   *  the plan's process-cap accounting. */
  countLiveProviderProcesses(): number {
    let count = 0;
    for (const handle of this.runs.values()) {
      count += handle.worker.countRunningProviderProcesses();
    }
    return count;
  }

  /**
   * Reaping of handle-less runners (a recorded pid the runs map does not
   * own): a recorded pid with a stale heartbeat is dead or hung (a beating
   * heartbeat stalls only when the runner's event loop is gone or wedged) —
   * kill it if it is still alive and clear the records. Fresh-heartbeat
   * runners are left untouched and surface via listActiveWorkflowRunIds for
   * M3 reconciliation.
   *
   * Two call modes, distinguished by `spoolSyntheticTerminalEvents`:
   * - Boot (`false`): foreign dead segments need NO terminal event — the
   *   server interrupts every unreported `running` run at session open
   *   (bucket (b)), keeping them resumable. Spooling `run/failed` here would
   *   supersede that interruption and destroy resumability for the
   *   bread-and-butter daemon-restart resume case.
   * - The periodic in-life sweep (`true`): a runner that was fresh-and-alive
   *   at boot (reported active, possibly revived server-side) but died later
   *   has no handle, so no `handleChildDown` will ever observe its exit and
   *   no reconciliation runs while the session stays healthy — without a
   *   synthetic `run/failed(runner_exited)` the run dangles `running` until
   *   the next daemon restart. The terminal record is written alongside so a
   *   redelivered workflow.start acks instead of re-running.
   */
  async reapStaleRunners(args: {
    spoolSyntheticTerminalEvents: boolean;
  }): Promise<void> {
    const nowMs = Date.now();
    for (const runId of await listWorkflowRunIds(this.options.dataDir)) {
      if (this.runs.has(runId)) continue;
      const runDir = workflowRunDirPath(this.options.dataDir, runId);
      const pid = await readWorkflowRunnerPidFile(runDir);
      if (pid === null) continue;
      const alive = isProcessAlive(pid);
      const fresh = await isWorkflowRunHeartbeatFresh({
        runDir,
        staleMs: WORKFLOW_HEARTBEAT_STALE_MS,
        nowMs,
      });
      if (fresh && alive) continue;
      if (alive) {
        try {
          process.kill(pid, "SIGKILL");
          this.options.logger.warn(
            { runId, pid },
            "Reaped stale workflow runner process",
          );
        } catch (error) {
          this.options.logger.warn(
            {
              runId,
              pid,
              reapError: error instanceof Error ? error.message : String(error),
            },
            "Failed to reap stale workflow runner process",
          );
        }
      }
      if (
        args.spoolSyntheticTerminalEvents &&
        (await readWorkflowRunTerminalRecord(runDir)) === null
      ) {
        // Mirror handleChildDown's synthetic settle for a dead segment with
        // no live handle: emit first (the spool is durable), then record the
        // settle so redelivered starts ack. Usage is unknown for an orphaned
        // segment — honest zeros, like a runner that died before reporting.
        this.emitRunEventForRunId(runId, {
          type: "run/failed",
          error:
            "runner_exited: workflow runner died without a terminal event (reaped by the stale-runner sweep)",
          usage: emptyUsage(),
        });
        try {
          await writeWorkflowRunTerminalRecord(runDir, {
            eventType: "run/failed",
            settledAtMs: Date.now(),
          });
        } catch (error) {
          this.options.logger.warn(
            {
              runId,
              terminalRecordError:
                error instanceof Error ? error.message : String(error),
            },
            "Failed to record reaped workflow run terminal settle",
          );
        }
      }
      await clearWorkflowRunnerPidFile(runDir);
      await removeWorkflowRunHeartbeat(runDir);
    }
  }

  /** Terminate every runner child and dispose their executors. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    const handles = [...this.runs.values()];
    await Promise.allSettled(handles.map((handle) => this.terminateRun(handle)));
  }

  // ---------------------------------------------------------------------------
  // Runner protocol
  // ---------------------------------------------------------------------------

  private handleRunnerStderrLine(handle: RunHandle, line: string): void {
    handle.stderrTail.push(line);
    if (handle.stderrTail.length > STDERR_TAIL_MAX_LINES) {
      handle.stderrTail.shift();
    }
    this.options.logger.warn(
      { runId: handle.runId, line },
      "Workflow runner stderr",
    );
  }

  /** An over-cap stdout line is unprocessable (and possibly hostile): fail
   *  the run with a typed reason and terminate the child — its protocol
   *  stream can no longer be trusted to frame correctly. */
  private handleRunnerStdoutOverflow(handle: RunHandle): void {
    if (!handle.settled) {
      handle.settled = true;
      handle.terminalEventType = "run/failed";
      this.emitRunEvent(handle, {
        type: "run/failed",
        error: `runner_output_overflow: workflow runner emitted a stdout line exceeding ${MAX_RUNNER_STDOUT_LINE_LENGTH} characters`,
        usage: handle.usage,
      });
    }
    void this.terminateRun(handle);
  }

  private handleRunnerLine(handle: RunHandle, line: string): void {
    const message = decodeWorkflowRunnerDaemonInboundLine(line);
    switch (message.kind) {
      case "start-result": {
        const pending = handle.pendingStart.get(message.id);
        if (pending) {
          handle.pendingStart.delete(message.id);
          pending.resolve(message.result);
        }
        break;
      }
      case "start-error": {
        const pending = handle.pendingStart.get(message.id);
        if (pending) {
          handle.pendingStart.delete(message.id);
          pending.reject(new Error(message.message));
        }
        break;
      }
      case "agent-run":
        void this.dispatchAgentRun(handle, message.id, message.params);
        break;
      case "run-event":
        this.handleRunEvent(handle, message.event);
        break;
      case "invalid":
        this.options.logger.warn(
          { runId: handle.runId, decodeError: message.error },
          "Undecodable workflow runner message",
        );
        if (message.id !== undefined) {
          this.writeRunnerLine(
            handle,
            encodeWorkflowRunnerError({ id: message.id, message: message.error }),
          );
        }
        break;
    }
  }

  private sendStartRequest(
    handle: RunHandle,
    args: StartWorkflowRunArgs,
  ): Promise<WorkflowRunnerStartResult> {
    const id = handle.nextRequestId;
    handle.nextRequestId += 1;
    return new Promise<WorkflowRunnerStartResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        handle.pendingStart.delete(id);
        reject(
          new Error(
            `workflow runner did not acknowledge run/start within ${RUNNER_START_ACK_TIMEOUT_MS}ms`,
          ),
        );
      }, RUNNER_START_ACK_TIMEOUT_MS);
      handle.pendingStart.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.writeRunnerLine(
        handle,
        encodeWorkflowRunnerStartRequest({
          id,
          params: {
            runId: args.runId,
            source: args.source,
            filename: args.filename,
            ...(args.args !== undefined ? { args: args.args } : {}),
            seed: args.seed,
            baseTimeMs: args.baseTimeMs,
            defaults: args.defaults,
            journal: [...args.journal],
            heartbeatFilePath: workflowRunHeartbeatPath(handle.runDir),
            execTimeoutMs: args.execTimeoutMs,
          },
        }),
      );
    });
  }

  private async dispatchAgentRun(
    handle: RunHandle,
    id: WorkflowRunnerWireId,
    params: WorkflowRunnerAgentRunParams,
  ): Promise<void> {
    const context: WorkerContext = {
      agentIndex: params.agentIndex,
      attempt: params.attempt,
      signal: handle.abort.signal,
      onProgress: (progress) =>
        this.forwardAgentProgress(handle, params.callId, progress),
    };
    let result: WorkflowRunnerAgentRunResult;
    try {
      const agentResult = await handle.worker.runAgent(params.spec, context);
      result = { status: "completed", result: agentResult };
    } catch (error) {
      result = buildAgentRunErrorResult(error, params.spec.provider);
    }
    this.writeRunnerLine(
      handle,
      encodeWorkflowRunnerAgentRunResult({ id, result }),
    );
  }

  private forwardAgentProgress(
    handle: RunHandle,
    callId: string,
    progress: WorkerProgress,
  ): void {
    // Only the coarse kinds the workflow runtime folds into agent/progress run
    // events cross the wire; text/reasoning/tool-result stay daemon-side in
    // the per-agent provider event logs the executor writes.
    let wire: WorkflowRunnerAgentProgress;
    if (progress.kind === "tool") {
      wire = { kind: "tool", name: progress.name };
    } else if (progress.kind === "usage") {
      wire = {
        kind: "usage",
        usage: {
          ...(progress.usage.inputTokens !== undefined
            ? { inputTokens: progress.usage.inputTokens }
            : {}),
          ...(progress.usage.outputTokens !== undefined
            ? { outputTokens: progress.usage.outputTokens }
            : {}),
        },
      };
    } else {
      return;
    }
    this.writeRunnerLine(
      handle,
      encodeWorkflowRunnerAgentProgress({ params: { callId, progress: wire } }),
    );
  }

  private handleRunEvent(handle: RunHandle, event: WorkflowRunEvent): void {
    if (event.type === "agent/completed" || event.type === "agent/failed") {
      handle.usage = addUsage(handle.usage, event.entry.usage);
      // Journal hot cache: settled entries only — replays are already present.
      if (!(event.type === "agent/completed" && event.cached)) {
        this.appendJournalEntry(handle, event.entry);
      }
    }
    if (
      event.type === "run/completed" ||
      event.type === "run/failed" ||
      event.type === "run/cancelled"
    ) {
      handle.settled = true;
      handle.terminalEventType = event.type;
    }
    this.emitRunEvent(handle, event);
  }

  private appendJournalEntry(
    handle: RunHandle,
    entry: WorkflowJournalEntry,
  ): void {
    if (handle.journalStream === null) {
      handle.journalStream = createWriteStream(
        workflowRunJournalPath(handle.runDir),
        { flags: "a" },
      );
    }
    handle.journalStream.write(`${JSON.stringify(entry)}\n`);
  }

  private emitRunEvent(handle: RunHandle, event: WorkflowRunEvent): void {
    this.emitRunEventForRunId(handle.runId, event);
  }

  /** Sink emission for runs without a live handle (the stale-runner sweep). */
  private emitRunEventForRunId(runId: string, event: WorkflowRunEvent): void {
    try {
      this.options.onRunEvent({ runId, event });
    } catch (error) {
      this.options.logger.error(
        {
          runId,
          eventType: event.type,
          sinkError: error instanceof Error ? error.message : String(error),
        },
        "Workflow run event sink failed",
      );
    }
  }

  private writeRunnerLine(handle: RunHandle, line: string): void {
    const stdin = handle.child.stdin;
    if (handle.exited || stdin.destroyed || !stdin.writable) return;
    stdin.write(`${line}\n`);
  }

  // ---------------------------------------------------------------------------
  // Exit handling
  // ---------------------------------------------------------------------------

  private async handleChildDown(
    handle: RunHandle,
    info: { code: number | null; signal: NodeJS.Signals | null; error?: Error },
  ): Promise<void> {
    if (handle.exited) return;
    handle.exited = true;
    if (handle.cancelEscalation !== null) {
      clearTimeout(handle.cancelEscalation);
      handle.cancelEscalation = null;
    }

    const detail =
      info.error !== undefined
        ? info.error.message
        : `code ${info.code ?? "unknown"}${info.signal !== null ? `, signal ${info.signal}` : ""}`;

    for (const pending of handle.pendingStart.values()) {
      pending.reject(
        new Error(`workflow runner exited before responding (${detail})`),
      );
    }
    handle.pendingStart.clear();

    if (!handle.settled) {
      handle.settled = true;
      handle.terminalEventType = "run/failed";
      const stderrSuffix =
        handle.stderrTail.length > 0 ? `\n${handle.stderrTail.join("\n")}` : "";
      this.emitRunEvent(handle, {
        type: "run/failed",
        error: `runner_exited: workflow runner exited unexpectedly (${detail})${stderrSuffix}`,
        usage: handle.usage,
      });
    }

    // Settle any executor work the dead runner left in flight, then dispose
    // every (run,cwd) runtime so no provider process outlives the run.
    handle.abort.abort();
    try {
      await handle.worker.shutdown();
    } catch (error) {
      this.options.logger.error(
        {
          runId: handle.runId,
          shutdownError: error instanceof Error ? error.message : String(error),
        },
        "Workflow agent worker shutdown failed",
      );
    }
    if (handle.journalStream !== null) {
      const stream = handle.journalStream;
      await new Promise<void>((resolve) => stream.end(() => resolve()));
    }
    if (handle.terminalEventType !== null) {
      // Durably mark the segment settled BEFORE the runs-map entry disappears
      // so a redelivered workflow.start always sees either the live handle or
      // the terminal record — never a gap that re-spawns a finished run.
      try {
        await writeWorkflowRunTerminalRecord(handle.runDir, {
          eventType: handle.terminalEventType,
          settledAtMs: Date.now(),
        });
      } catch (error) {
        this.options.logger.warn(
          {
            runId: handle.runId,
            terminalRecordError:
              error instanceof Error ? error.message : String(error),
          },
          "Failed to record workflow run terminal settle",
        );
      }
    }
    await clearWorkflowRunnerPidFile(handle.runDir);
    await removeWorkflowRunHeartbeat(handle.runDir);
    // Delete conditionally: defense in depth against a stale handle's exit
    // removing a newer handle that reused the runId after this run settled.
    if (this.runs.get(handle.runId) === handle) {
      this.runs.delete(handle.runId);
    }
    handle.finishDone();
  }

  /** SIGTERM the child (abort first so the run can settle), SIGKILL after the
   *  grace, and wait for full exit cleanup. Safe on already-exited handles. */
  private async terminateRun(handle: RunHandle): Promise<void> {
    if (!handle.exited) {
      handle.abort.abort();
      this.writeRunnerLine(handle, encodeWorkflowRunnerAbort());
      const killTimer = setTimeout(() => {
        if (!handle.exited) {
          handle.child.kill("SIGKILL");
        }
      }, RUNNER_TERMINATE_GRACE_MS);
      killTimer.unref();
      handle.child.kill("SIGTERM");
      await handle.done;
      clearTimeout(killTimer);
      return;
    }
    await handle.done;
  }

  // ---------------------------------------------------------------------------
  // Worker construction
  // ---------------------------------------------------------------------------

  private buildWorkerOptions(args: {
    runId: string;
    projectId: string;
    runDir: string;
    sandboxCeiling: WorkflowSandbox;
  }): WorkflowAgentExecutorOptions {
    return {
      runId: args.runId,
      projectId: args.projectId,
      runDir: args.runDir,
      sandboxCeiling: args.sandboxCeiling,
      workflowAgentShellEnv: this.options.workflowAgentShellEnv,
      ...(this.options.bridgeBundleDir !== undefined
        ? { bridgeBundleDir: this.options.bridgeBundleDir }
        : {}),
      ...(this.options.createRuntime !== undefined
        ? { createRuntime: this.options.createRuntime }
        : {}),
      providerProcessGate: this.gate,
      worktreeSetupTimeoutMs: this.options.worktreeSetupTimeoutMs,
      turnStallTimeoutMs: this.options.turnStallTimeoutMs,
      onStderr: (line, threadId) => {
        this.options.logger.warn(
          { runId: args.runId, threadId, line },
          "Workflow agent provider stderr",
        );
      },
    };
  }
}

interface BoundedLineReaderArgs {
  stream: NodeJS.ReadableStream;
  maxLineLength: number;
  onLine: (line: string) => void;
  /** Called once per oversized line with its truncated prefix; the remainder
   *  of that line is discarded and reading resumes at the next newline. */
  onOverflow: (truncatedPrefix: string) => void;
}

/**
 * readline without the unbounded-line hazard: splits a stream into
 * newline-terminated lines, handing any line past `maxLineLength` to
 * `onOverflow` (truncated) instead of buffering it wholesale in memory.
 */
function attachBoundedLineReader(args: BoundedLineReaderArgs): void {
  let buffer = "";
  let discardingOversizedLine = false;
  args.stream.setEncoding("utf8");
  args.stream.on("data", (chunk: string | Buffer) => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        if (discardingOversizedLine) {
          buffer = "";
        } else if (buffer.length > args.maxLineLength) {
          discardingOversizedLine = true;
          const truncatedPrefix = buffer.slice(0, args.maxLineLength);
          buffer = "";
          args.onOverflow(truncatedPrefix);
        }
        return;
      }
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (discardingOversizedLine) {
        // The tail of an already-reported oversized line.
        discardingOversizedLine = false;
        continue;
      }
      if (line.length > args.maxLineLength) {
        args.onOverflow(line.slice(0, args.maxLineLength));
        continue;
      }
      args.onLine(line);
    }
  });
}

function buildAgentRunErrorResult(
  error: unknown,
  provider: AgentSpec["provider"],
): WorkflowRunnerAgentRunResult {
  if (error instanceof AgentInterrupted) {
    return { status: "interrupted", message: error.message };
  }
  if (error instanceof AgentError) {
    return {
      status: "error",
      provider: error.provider,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.usage !== undefined ? { usage: error.usage } : {}),
    };
  }
  return {
    status: "error",
    provider,
    code: "executor_error",
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}
