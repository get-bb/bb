// The runner child's run loop, ported from omegacode src/runtime/run.ts and
// pared to M1 scope: boot from an explicit config (script source, args, seed,
// resolved defaults), touch a .heartbeat deadman file while alive, run the
// workflow against the injected Worker/JournalStore, and emit typed run events
// to the sink. Everything omegacode resolved process-globally is injected:
// the daemon owns the stdio protocol, process signals, and run-dir layout
// (M2); the server owns lint/validation policy and the source/args/seed
// snapshot (M3).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { JsonValue } from "@bb/domain";
import type { AgentUsage, RunDefaults } from "./dsl-types.js";
import type { JournalStore } from "./journal.js";
import { Runtime } from "./runtime.js";
import type { RunEventSink } from "./runtime.js";
import { parseWorkflow } from "./meta-parser.js";
import { runInSandbox } from "./sandbox.js";
import type { Worker } from "./worker-contract.js";

/** How often a live run refreshes its heartbeat file. */
export const WORKFLOW_HEARTBEAT_INTERVAL_MS = 5_000;
/**
 * How old a heartbeat may be before a reader (the daemon) must treat the run
 * as dead. SIGKILL / power loss / a closed terminal cannot write a terminal
 * event — a "running" run with a heartbeat staler than this is gone.
 */
export const WORKFLOW_HEARTBEAT_STALE_MS = 20_000;

/**
 * Ceiling on the serialized run result (the `run/completed` payload). The
 * result is author-controlled and rides the runner→daemon pipe (and later the
 * durable spool) as one line; past this the run fails with a clear error
 * instead of shipping an unbounded payload.
 */
export const MAX_WORKFLOW_RESULT_BYTES = 1024 * 1024;

export type WorkflowRunStatus = "completed" | "failed" | "cancelled";

export interface WorkflowRunnerConfig {
  runId: string;
  /** The full workflow file source (the server-side snapshot). */
  source: string;
  /** Filename used in workflow stack traces, e.g. "deep-research.workflow.js". */
  filename: string;
  /** The launch-time args; undefined when the run was launched without args. */
  args: JsonValue | undefined;
  /** The run's server-generated seed (stable across resumes). */
  seed: number;
  /** Journal-seeded base for now(): the run's original creation time. */
  baseTimeMs: number;
  /** Fully-resolved run defaults (filled once at the server boundary). */
  defaults: RunDefaults;
  worker: Worker;
  /** Pre-loaded resume journal; empty on a fresh run. */
  journal: JournalStore;
  onRunEvent: RunEventSink;
  /** Touched every WORKFLOW_HEARTBEAT_INTERVAL_MS while the run is alive. */
  heartbeatFilePath: string;
  /** Aborting cancels the run (in-flight agents interrupt; terminal event = run/cancelled). */
  signal: AbortSignal;
  /** Hard ceiling on total workflow execution time. Omitted = unbounded. */
  execTimeoutMs?: number;
}

export interface WorkflowRunOutcome {
  runId: string;
  status: WorkflowRunStatus;
  /** The workflow body's return value, JSON-normalized (null when it returned undefined). */
  result: JsonValue;
  error?: string;
  usage: AgentUsage;
}

/**
 * Run one workflow to settlement. Throws only before any side effect: on a
 * structurally invalid script (WorkflowSyntaxError — the daemon's
 * `script_invalid` path) or on structurally invalid run defaults (the
 * Semaphore rejects a non-positive concurrency that would otherwise admit no
 * agent while the heartbeat keeps beating). In both cases no event has been
 * emitted and no heartbeat written; every other outcome resolves with a
 * status after emitting the matching run-terminal event.
 */
export async function runWorkflowRunner(
  config: WorkflowRunnerConfig,
): Promise<WorkflowRunOutcome> {
  const parsed = parseWorkflow(config.source);

  // Constructing the Runtime validates the defaults (Semaphore throws on an
  // invalid concurrency). Keep it before the heartbeat and run/started emit so
  // a bad config can never strand a run that announced itself but will never
  // emit a terminal event.
  const runtime = new Runtime({
    runId: config.runId,
    defaults: config.defaults,
    worker: config.worker,
    journal: config.journal,
    onRunEvent: config.onRunEvent,
    args: config.args,
    seed: config.seed,
    baseTimeMs: config.baseTimeMs,
    signal: config.signal,
  });

  // Deadman switch: touch a heartbeat file while the run is alive. Crashes and
  // cancellation still emit a terminal event below, but a SIGKILL / power loss
  // cannot — the daemon treats a stale heartbeat as dead instead of a
  // perpetual spinner.
  const beat = (): void => {
    try {
      writeFileSync(config.heartbeatFilePath, String(Date.now()));
    } catch {
      // best effort — never let heartbeat failure break a run
    }
  };
  try {
    mkdirSync(dirname(config.heartbeatFilePath), { recursive: true });
  } catch {
    // best effort — beat() failures are already swallowed
  }
  beat();
  const heartbeat = setInterval(beat, WORKFLOW_HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  config.onRunEvent({ type: "run/started", runId: config.runId });

  let status: WorkflowRunStatus = "completed";
  let result: JsonValue = null;
  let error: string | undefined;
  try {
    // The abort signal MUST reach the sandbox: the vm timeout bounds only
    // synchronous execution, so without it `await new Promise(() => {})` in a
    // workflow body would hang this await forever after a cancel.
    const raw = await runInSandbox({
      body: parsed.body,
      filename: config.filename,
      globals: runtime.globals(),
      signal: config.signal,
      execTimeoutMs: config.execTimeoutMs,
    });
    // Await any agent() the body launched without awaiting, so a late
    // rejection can't surface after we've declared "completed".
    await runtime.settle();
    result = toJsonValue(raw);
  } catch (err) {
    status = config.signal.aborted ? "cancelled" : "failed";
    error = err instanceof Error ? err.message : String(err);
  } finally {
    await runtime.settle();
    clearInterval(heartbeat);
    const usage = runtime.totalUsage;
    if (status === "completed") {
      config.onRunEvent({ type: "run/completed", result, usage });
    } else if (status === "cancelled") {
      config.onRunEvent({ type: "run/cancelled", usage });
    } else {
      config.onRunEvent({
        type: "run/failed",
        error: error ?? "unknown error",
        usage,
      });
    }
  }

  const outcome: WorkflowRunOutcome = {
    runId: config.runId,
    status,
    result,
    usage: runtime.totalUsage,
  };
  if (error !== undefined) outcome.error = error;
  return outcome;
}

/**
 * Normalize the author-defined return value to JSON at the run boundary via a
 * stringify round-trip. Standard JSON.stringify semantics apply: a cyclic
 * value throws (the run fails), while nested function/undefined/symbol values
 * are dropped from objects and become null in arrays. A bare undefined return
 * normalizes to null. Results past MAX_WORKFLOW_RESULT_BYTES fail the run.
 */
function toJsonValue(value: unknown): JsonValue {
  const serialized = JSON.stringify(value ?? null);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > MAX_WORKFLOW_RESULT_BYTES) {
    throw new Error(
      `workflow result exceeds ${MAX_WORKFLOW_RESULT_BYTES} bytes (${bytes}) — return a summary and write large artifacts to disk instead`,
    );
  }
  const out: JsonValue = JSON.parse(serialized);
  return out;
}
