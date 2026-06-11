// The DSL primitives, bound to a Runtime — ported from omegacode
// src/runtime/primitives.ts with bb's injected seams: a single Worker (the
// daemon executor in production, FakeWorker in tests) replaces the per-provider
// WorkerFactory, a JournalStore replaces the journal.jsonl file, and a typed
// onRunEvent callback replaces the events.jsonl EventSink. Worktree
// provisioning moved into the Worker (the resolved spec carries the request);
// per-agent transcripts are gone (the daemon logs provider events itself).
//
// agent() resolves a spec, computes its chained resume key, replays a
// completed journal entry if present, else runs the worker; parallel()/
// pipeline() fan out under the concurrency cap. now()/random() are
// journal-seeded for deterministic replay.
//
// Keys are per-branch deterministic (see keys.ts): each parallel() thunk and
// each pipeline() (item, stage) runs inside a child KeyContext whose lineage
// descends from its parent branch, the fan-out CALL's position within that
// branch (a per-branch call counter — two sequential identical fan-outs must
// not collide), and the thunk/item/stage index. An agent()'s journal key
// therefore depends only on WHERE it sits in the call tree, never on the
// wall-clock order sibling branches finish in. now()/random() also draw from
// per-branch substreams.

import { AsyncLocalStorage } from "node:async_hooks";
import { agentProviderIdSchema } from "@bb/agent-providers";
import type { AgentProviderId } from "@bb/agent-providers";
import { reasoningLevelValues } from "@bb/domain";
import type { JsonValue } from "@bb/domain";
import { addUsage, emptyUsage, workflowSandboxValues } from "./dsl-types.js";
import type {
  AgentOpts,
  AgentResult,
  AgentSpec,
  AgentUsage,
  PipelineStage,
  RunDefaults,
  WorkflowGlobals,
} from "./dsl-types.js";
import { withRetry } from "./errors.js";
import type { JournalStore, WorkflowJournalEntry } from "./journal.js";
import {
  branchKey,
  chainKey,
  explicitKey,
  keyedSpec,
  ROOT_KEY,
} from "./keys.js";
import { stripNullOptionals, validate } from "./schema.js";
import { Semaphore } from "./semaphore.js";
import { AgentError, AgentInterrupted } from "./worker-contract.js";
import type {
  Worker,
  WorkerContext,
  WorkerProgress,
} from "./worker-contract.js";

export class WorkflowError extends Error {}

/**
 * Ceiling on a single log() message. Log payloads are untrusted workflow JS
 * output that rides the runner→daemon pipe as one ndjson line, so they are
 * bounded at the producer (the daemon's line reader enforces its own cap as
 * the backstop).
 */
export const MAX_WORKFLOW_LOG_MESSAGE_LENGTH = 10_000;

/**
 * A single agent's failure (worker error wrap, persistent schema miss, …).
 * parallel()/pipeline() degrade it to a null item — unlike run-level
 * WorkflowErrors (budget/caps/duplicate keys), which abort the whole fan-out
 * (see isControlFlow).
 */
export class AgentFailedError extends WorkflowError {}

/** Display metadata shared by every agent-scoped run event. */
export interface AgentEventMeta {
  agentIndex: number;
  label: string;
  provider: AgentProviderId;
  model?: string;
  phaseIndex?: number;
  phaseTitle?: string;
}

/**
 * The run-event stream a workflow run emits (names per the plan's domain event
 * union). `agent/completed` and `agent/failed` each carry the full journal
 * entry — together they ARE the resume journal server-side (failure entries
 * never replay, but they pin the agent's display index and billed usage, so a
 * journal rebuilt from events alone must include them). Replayed entries are
 * re-emitted with `cached: true` and are not re-appended to the JournalStore.
 * Run-terminal events are emitted by the runner entry, not the Runtime.
 */
export type WorkflowRunEvent =
  | { type: "run/started"; runId: string }
  | { type: "phase/started"; phaseIndex: number; title: string }
  | ({ type: "agent/queued"; promptPreview: string } & AgentEventMeta)
  | ({ type: "agent/started" } & AgentEventMeta)
  | ({
      type: "agent/progress";
      lastToolName?: string;
      inputTokens?: number;
      outputTokens?: number;
    } & AgentEventMeta)
  | ({
      type: "agent/completed";
      cached: boolean;
      entry: WorkflowJournalEntry;
    } & AgentEventMeta)
  | ({
      type: "agent/failed";
      error: string;
      /** The journaled failure record (status failed/interrupted, billed usage). */
      entry: WorkflowJournalEntry;
    } & AgentEventMeta)
  | { type: "log"; message: string }
  | { type: "run/completed"; result: JsonValue; usage: AgentUsage }
  | { type: "run/failed"; error: string; usage: AgentUsage }
  | { type: "run/cancelled"; usage: AgentUsage };

export type RunEventSink = (event: WorkflowRunEvent) => void;

export interface RuntimeOptions {
  runId: string;
  defaults: RunDefaults;
  worker: Worker;
  journal: JournalStore;
  onRunEvent: RunEventSink;
  /** The launch-time args; undefined when the run was launched without args. */
  args: JsonValue | undefined;
  seed: number;
  /** Journal-seeded base for now() — the run's original creation time. */
  baseTimeMs: number;
  signal: AbortSignal;
}

/**
 * Per-branch deterministic state. Each branch (root body, a parallel() thunk,
 * a pipeline() item or stage) carries its own lineage key, a per-branch agent
 * counter, a per-branch fan-out call counter (so keys are concurrency-invariant
 * AND repeated identical fan-outs stay distinct) and per-branch now()/random()
 * substreams seeded from the branch key.
 */
interface KeyContext {
  branchKey: string;
  agentIndex: number;
  /** Position of the next parallel()/pipeline() CALL within this branch. */
  fanoutIndex: number;
  nowCounter: number;
  rngState: number;
}

/**
 * The branch substream is seeded from (run seed, branch key): stable on resume
 * (the seed is journaled server-side), distinct per branch
 * (concurrency-invariant), different across fresh runs.
 */
function newKeyContext(key: string, runSeed: number): KeyContext {
  return {
    branchKey: key,
    agentIndex: 0,
    fanoutIndex: 0,
    nowCounter: 0,
    rngState: seedFromKey(key, runSeed),
  };
}

/** Derive a non-zero 32-bit rng seed from a branch key hash mixed with the run seed. */
function seedFromKey(key: string, runSeed: number): number {
  let h = runSeed | 0;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  }
  return h >>> 0 || 1;
}

/**
 * Reject an out-of-enum spec field. Workflow bodies are untyped JS, so
 * `agent("x", { sandbox: "readonly" })` arrives here unchecked — passed
 * through, it would fall off the executor's policy switches and silently void
 * the sandbox guarantee. Validates the RESOLVED values so both per-call opts
 * and run defaults are covered.
 */
function checkSpecEnum(
  field: string,
  value: string,
  allowed: readonly string[],
): void {
  if (!allowed.includes(value)) {
    throw new WorkflowError(
      `invalid ${field} "${value}" — must be one of ${allowed.join(", ")}`,
    );
  }
}

/** Every agent() option the runtime understands (see AgentOpts). */
const AGENT_OPT_KEYS: ReadonlySet<string> = new Set([
  "provider",
  "label",
  "phase",
  "model",
  "effort",
  "cwd",
  "sandbox",
  "instructions",
  "schema",
  "worktree",
  "key",
]);

/**
 * Reject unknown or unsupported agent() options at the call site. Workflow
 * bodies are untyped JS, so a typo'd key — or an omegacode option bb does not
 * support (`maxTurns`, string worktree branch names) — would otherwise be
 * silently ignored or fail terminally inside the worker mid-fan-out, after the
 * agent already consumed a run slot. Failing here fails fast and free.
 */
function checkAgentOpts(opts: AgentOpts): void {
  for (const key of Object.keys(opts)) {
    if (!AGENT_OPT_KEYS.has(key)) {
      throw new WorkflowError(
        key === "maxTurns"
          ? "agent() option maxTurns is not supported by bb workflows — omit it"
          : `unknown agent() option "${key}"`,
      );
    }
  }
  if (opts.worktree !== undefined && typeof opts.worktree !== "boolean") {
    throw new WorkflowError(
      "agent() worktree must be a boolean — custom branch names are not supported (the branch is wf/<runId>-<agentIndex>)",
    );
  }
}

function truncateLogMessage(message: string): string {
  return message.length > MAX_WORKFLOW_LOG_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_WORKFLOW_LOG_MESSAGE_LENGTH)}… [truncated]`
    : message;
}

export class Runtime {
  private displayIndex = 0;
  private agentCalls = 0;
  private phaseIndex = 0;
  private currentPhase: { index: number; title: string } | undefined;
  private readonly phaseByTitle = new Map<string, number>();
  private readonly sem: Semaphore;
  private readonly explicitKeys = new Set<string>();
  private readonly ctxStore = new AsyncLocalStorage<KeyContext>();
  private readonly rootCtx: KeyContext;
  /** key -> journaled entry (last one wins). Only `completed` entries replay. */
  private readonly journaled = new Map<string, WorkflowJournalEntry>();
  /** key -> display index, so resumed agents keep their identity across attempts. */
  private readonly indexByKey = new Map<string, number>();
  // In-flight agent() promises so the run loop can await settlement and a
  // fire-and-forget agent() (launched without `await`) can't turn into an
  // unhandledRejection crash after "completed".
  private readonly inFlight = new Set<Promise<JsonValue>>();
  totalUsage = emptyUsage();

  constructor(private readonly o: RuntimeOptions) {
    this.sem = new Semaphore(o.defaults.concurrency);
    this.rootCtx = newKeyContext(ROOT_KEY, o.seed);
    for (const entry of o.journal.list()) {
      this.journaled.set(entry.key, entry);
      this.indexByKey.set(entry.key, entry.agentIndex);
    }
    // Fresh display indices start past anything a prior attempt journaled, so
    // an agent whose key is NOT in the journal can never collide with a
    // journaled agent's index.
    this.displayIndex = Math.max(0, ...this.indexByKey.values());
  }

  globals(): WorkflowGlobals {
    const total = this.o.defaults.budgetOutputTokens;
    const budget = Object.freeze({
      total,
      spent: () => this.totalUsage.outputTokens,
      remaining: () =>
        total == null
          ? Infinity
          : Math.max(0, total - this.totalUsage.outputTokens),
    });
    return {
      agent: this.agent.bind(this),
      parallel: this.parallel.bind(this),
      pipeline: this.pipeline.bind(this),
      phase: this.phase.bind(this),
      log: this.log.bind(this),
      now: this.now.bind(this),
      random: this.random.bind(this),
      budget,
      args: this.o.args,
    };
  }

  /** The active branch context (root body if none is on the stack). */
  private ctx(): KeyContext {
    return this.ctxStore.getStore() ?? this.rootCtx;
  }

  private now(): number {
    return this.o.baseTimeMs + this.ctx().nowCounter++;
  }

  private random(): number {
    // mulberry32 over the per-branch rng substream.
    const ctx = this.ctx();
    let t = (ctx.rngState = (ctx.rngState + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private ensurePhase(title: string): number {
    let index = this.phaseByTitle.get(title);
    if (index === undefined) {
      index = ++this.phaseIndex;
      this.phaseByTitle.set(title, index);
      this.o.onRunEvent({ type: "phase/started", phaseIndex: index, title });
    }
    return index;
  }

  private phase(title: string): void {
    const t = String(title);
    this.currentPhase = { index: this.ensurePhase(t), title: t };
  }

  private log(msg: string): void {
    this.o.onRunEvent({ type: "log", message: truncateLogMessage(String(msg)) });
  }

  private resolveSpec(prompt: string, opts: AgentOpts | undefined): AgentSpec {
    if (opts !== undefined) checkAgentOpts(opts);
    const d = this.o.defaults;
    const spec: AgentSpec = {
      prompt,
      provider: opts?.provider ?? d.provider,
      model: opts?.model ?? d.model,
      effort: opts?.effort ?? d.effort,
      cwd: opts?.cwd ?? d.cwd,
      sandbox: opts?.sandbox ?? d.sandbox,
      instructions: opts?.instructions,
      schema: opts?.schema,
      worktree: opts?.worktree,
    };
    checkSpecEnum("provider", spec.provider, agentProviderIdSchema.options);
    checkSpecEnum("sandbox", spec.sandbox, workflowSandboxValues);
    checkSpecEnum("effort", spec.effort, reasoningLevelValues);
    return spec;
  }

  private agent(prompt: string, opts?: AgentOpts): Promise<JsonValue> {
    // Track every agent() promise so the run loop can await settlement (an
    // agent() launched without `await` would otherwise reject after the body
    // "completed" → unhandledRejection crash).
    const p = this.agentImpl(prompt, opts);
    this.inFlight.add(p);
    const done = () => this.inFlight.delete(p);
    p.then(done, done);
    return p;
  }

  /** Wait for every in-flight agent() to settle. Rejections are already surfaced via events/journal. */
  async settle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled(Array.from(this.inFlight));
    }
  }

  private async agentImpl(
    prompt: string,
    opts?: AgentOpts,
  ): Promise<JsonValue> {
    // Synchronous prefix: chain the key off THIS branch's lineage + local
    // index (concurrency-invariant), then assign the display index
    // (journal-stable, see below).
    const ctx = this.ctx();
    const localIndex = ctx.agentIndex++;
    const promptStr = String(prompt);
    const spec = this.resolveSpec(promptStr, opts);
    // Key off the RESOLVED spec (not raw opts) so defaults/launch overrides invalidate the cache.
    const key = opts?.key
      ? explicitKey(opts.key)
      : chainKey(
          ctx.branchKey,
          localIndex,
          promptStr,
          keyedSpec(spec, opts?.worktree),
        );
    if (opts?.key) {
      // Explicit keys must be unique within a run, or two calls collide on the
      // same journal slot and the earlier call replays the later call's result
      // on resume (last-write-wins). Fail fast.
      if (this.explicitKeys.has(key)) {
        throw new WorkflowError(
          `duplicate explicit agent key "${opts.key}" — keys must be unique within a run`,
        );
      }
      this.explicitKeys.add(key);
    }
    if (++this.agentCalls > this.o.defaults.maxAgents) {
      throw new WorkflowError(
        `agent() call cap reached (${this.o.defaults.maxAgents}) — likely a runaway loop`,
      );
    }
    // Display index: stable per JOURNAL KEY across resume attempts. Reusing
    // the journaled index means events keep pointing at the same logical agent
    // on resume; keys not in the journal allocate fresh indices past the
    // journaled maximum (no collision).
    const agentIndex = this.indexByKey.get(key) ?? ++this.displayIndex;
    const label = opts?.label ?? firstLine(spec.prompt);
    // opts.phase overrides the ambient phase() group for this call.
    const phaseRef =
      opts?.phase != null
        ? {
            index: this.ensurePhase(String(opts.phase)),
            title: String(opts.phase),
          }
        : this.currentPhase;
    const meta: AgentEventMeta = {
      agentIndex,
      label,
      provider: spec.provider,
      model: spec.model,
      phaseIndex: phaseRef?.index,
      phaseTitle: phaseRef?.title,
    };

    // Resume replay: a COMPLETED journal entry short-circuits the worker. A
    // journaled failure must NOT replay as success — re-run it (it may be a
    // transient that now succeeds). Replayed entries are not re-appended.
    const cached = this.journaled.get(key);
    if (cached && cached.status === "completed") {
      this.o.onRunEvent({
        type: "agent/completed",
        ...meta,
        // The journaled provider/model, not the re-resolved spec's: an
        // explicit opts.key deliberately survives spec edits, so the replayed
        // event must report what the agent actually ran on.
        provider: cached.provider,
        model: cached.model,
        cached: true,
        entry: cached,
      });
      this.totalUsage = addUsage(this.totalUsage, cached.usage);
      return journalValue(cached);
    }

    this.o.onRunEvent({
      type: "agent/queued",
      ...meta,
      promptPreview: preview(spec.prompt),
    });

    return await this.sem.run(async () => {
      if (this.o.signal.aborted) throw new AgentInterrupted();
      // Budget is re-checked INSIDE the slot: queued agents all passed the
      // pre-admission check at usage≈0, so without this they would overrun the
      // ceiling on a fan-out.
      const budgetTotal = this.o.defaults.budgetOutputTokens;
      if (budgetTotal != null && this.totalUsage.outputTokens >= budgetTotal) {
        throw new WorkflowError(
          `token budget exceeded (${this.totalUsage.outputTokens} / ${budgetTotal} output tokens)`,
        );
      }
      const startedAt = Date.now();
      this.o.onRunEvent({ type: "agent/started", ...meta });

      // Usage accumulates across the corrective-retry attempt(s) — do not lose the first attempt's.
      let attemptUsage = emptyUsage();
      // Every runAgent call for this logical agent (withRetry re-invocations
      // and the corrective re-prompt below) shares the journal-stable
      // agentIndex and counts attempts up, so the worker can key one log /
      // thread-id family per agent and suffix attempt-scoped resources.
      let attempt = 0;
      const runWorkerAttempt = (
        attemptSpec: AgentSpec,
      ): Promise<AgentResult> => {
        const workerCtx: WorkerContext = {
          agentIndex,
          attempt: attempt++,
          signal: this.o.signal,
          onProgress: (progress) => this.handleProgress(meta, progress),
        };
        return this.o.worker.runAgent(attemptSpec, workerCtx);
      };
      try {
        // Wrap the worker call in withRetry so a retryable AgentError
        // (429/overload) backs off instead of killing the agent and usually
        // the whole run.
        let result = await withRetry(() => runWorkerAttempt(spec), {
          signal: this.o.signal,
        });
        attemptUsage = result.usage;
        let value: JsonValue;
        try {
          value = this.finalizeResult(spec, result);
        } catch (err) {
          // One corrective retry on a schema-validation miss.
          if (
            spec.schema &&
            err instanceof WorkflowError &&
            err.message.startsWith("structured output failed schema")
          ) {
            this.o.onRunEvent({
              type: "log",
              message: `[${label}] structured output retry: ${err.message}`,
            });
            const corrective: AgentSpec = {
              ...spec,
              instructions:
                `${spec.instructions ?? ""}\n\nYour previous response did not match the required JSON schema (${err.message}). Respond again with ONLY a JSON value that exactly matches the schema.`.trim(),
            };
            result = await withRetry(() => runWorkerAttempt(corrective), {
              signal: this.o.signal,
            });
            attemptUsage = addUsage(attemptUsage, result.usage);
            value = this.finalizeResult(spec, result);
          } else {
            throw err;
          }
        }
        const durationMs = Date.now() - startedAt;
        this.totalUsage = addUsage(this.totalUsage, attemptUsage);
        const entry: WorkflowJournalEntry = {
          key,
          agentIndex,
          branchKey: ctx.branchKey,
          status: result.status,
          resultText: result.text,
          usage: attemptUsage,
          provider: spec.provider,
          model: spec.model,
          durationMs,
        };
        if (spec.schema !== undefined) entry.structured = value;
        if (result.worktreeBranch !== undefined) {
          entry.worktreeBranch = result.worktreeBranch;
        }
        this.o.journal.append(entry);
        this.o.onRunEvent({
          type: "agent/completed",
          ...meta,
          cached: false,
          entry,
        });
        return value;
      } catch (err) {
        const durationMs = Date.now() - startedAt;
        const message = errorMessage(err);
        // Failed turns still bill: fold the provider-reported usage of the
        // failing attempt into the run totals and the journal, so budget
        // ceilings see the spend end-to-end. attemptUsage already holds any
        // completed-but-rejected attempts (e.g. a persistent schema miss).
        if (err instanceof AgentError && err.usage) {
          attemptUsage = addUsage(attemptUsage, err.usage);
        }
        this.totalUsage = addUsage(this.totalUsage, attemptUsage);
        const entry: WorkflowJournalEntry = {
          key,
          agentIndex,
          branchKey: ctx.branchKey,
          status: err instanceof AgentInterrupted ? "interrupted" : "failed",
          resultText: "",
          usage: attemptUsage,
          provider: spec.provider,
          model: spec.model,
          durationMs,
        };
        this.o.journal.append(entry);
        this.o.onRunEvent({
          type: "agent/failed",
          ...meta,
          error: message,
          entry,
        });
        throw err instanceof AgentError || err instanceof AgentInterrupted
          ? err
          : new AgentFailedError(`agent failed: ${message}`);
      }
    });
  }

  private handleProgress(meta: AgentEventMeta, progress: WorkerProgress): void {
    switch (progress.kind) {
      case "tool":
        this.o.onRunEvent({
          type: "agent/progress",
          ...meta,
          lastToolName: progress.name,
        });
        break;
      case "usage":
        this.o.onRunEvent({
          type: "agent/progress",
          ...meta,
          inputTokens: progress.usage.inputTokens,
          outputTokens: progress.usage.outputTokens,
        });
        break;
      default:
        // text/reasoning/tool-result feed the per-agent provider-event logs
        // (daemon-side), not the coarse run-event stream.
        break;
    }
  }

  private finalizeResult(spec: AgentSpec, result: AgentResult): JsonValue {
    if (!spec.schema) return result.text;
    if (result.structured !== undefined) {
      const normalized = stripNullOptionals(result.structured, spec.schema);
      const check = validate(spec.schema, normalized);
      if (!check.ok) {
        throw new WorkflowError(
          `structured output failed schema: ${check.errors}`,
        );
      }
      return normalized;
    }
    throw new WorkflowError("agent({schema}) returned no structured output");
  }

  private async parallel<T>(
    thunks: ReadonlyArray<() => Promise<T>>,
  ): Promise<Array<T | null>> {
    if (!Array.isArray(thunks)) {
      throw new WorkflowError("parallel() expects an array of functions");
    }
    if (thunks.length > this.o.defaults.maxFanout) {
      throw new WorkflowError(
        `parallel(): ${thunks.length} items exceeds the ${this.o.defaults.maxFanout} fan-out cap`,
      );
    }
    // Each fan-out CALL is its own lineage node, keyed by this branch's call
    // counter: two sequential identical parallel() calls in one branch must
    // derive distinct child lineages, or their agents collide on the same
    // journal slots → wrong-result replay on resume.
    const ctx = this.ctx();
    const callKey = branchKey(ctx.branchKey, "parallel", ctx.fanoutIndex++);
    return await Promise.all(
      thunks.map(async (fn, i): Promise<T | null> => {
        if (typeof fn !== "function") {
          throw new WorkflowError(
            "parallel() expects an array of functions, not promises. Wrap each call: () => agent(...)",
          );
        }
        const child = newKeyContext(
          branchKey(callKey, "branch", i),
          this.o.seed,
        );
        try {
          return await this.ctxStore.run(child, fn);
        } catch (err) {
          // Control-flow errors (cancel, budget/fan-out caps, runaway-loop)
          // must propagate — turning them into null silently poisons results
          // and lets a doomed body keep running/spinning.
          if (isControlFlow(err)) throw err;
          this.log(`parallel[${i}] failed: ${errorMessage(err)}`);
          return null;
        }
      }),
    );
  }

  private async pipeline(
    items: unknown[],
    ...stages: PipelineStage[]
  ): Promise<unknown[]> {
    if (!Array.isArray(items)) {
      throw new WorkflowError(
        "pipeline() expects an array as the first argument",
      );
    }
    if (items.length > this.o.defaults.maxFanout) {
      throw new WorkflowError(
        `pipeline(): ${items.length} items exceeds the ${this.o.defaults.maxFanout} fan-out cap`,
      );
    }
    // Same call-counter lineage as parallel(): repeated identical pipeline() calls stay distinct.
    const ctx = this.ctx();
    const callKey = branchKey(ctx.branchKey, "pipeline", ctx.fanoutIndex++);
    return await Promise.all(
      items.map(async (item, index) => {
        // Each item is its own branch; each stage descends one more level.
        // Keys depend on the (call, item, stage) position, never on which item
        // finishes first.
        const itemCtx = newKeyContext(
          branchKey(callKey, "item", index),
          this.o.seed,
        );
        let prev: unknown = item;
        try {
          for (let s = 0; s < stages.length; s++) {
            if (prev === null) break;
            const stage = stages[s];
            // A non-function stage (possible from untyped workflow JS) fails
            // this item like any other per-item error — caught below.
            if (typeof stage !== "function") {
              throw new TypeError("stage is not a function");
            }
            const stageCtx = newKeyContext(
              branchKey(itemCtx.branchKey, "stage", s),
              this.o.seed,
            );
            const value = prev;
            prev = await this.ctxStore.run(stageCtx, () =>
              stage(value, item, index),
            );
          }
          return prev;
        } catch (err) {
          if (isControlFlow(err)) throw err;
          this.log(`pipeline[${index}] failed: ${errorMessage(err)}`);
          return null;
        }
      }),
    );
  }
}

/** A replayed entry's value: the validated structured value for schema'd calls, else the text. */
function journalValue(entry: WorkflowJournalEntry): JsonValue {
  return entry.structured !== undefined ? entry.structured : entry.resultText;
}

/**
 * Errors that must abort the whole fan-out rather than degrade to a null
 * result: interruption (cancel) and the runtime's own invariants (budget/agent
 * caps, duplicate explicit keys). A single agent's failure — AgentError from
 * the worker, or its AgentFailedError wrap (e.g. a persistent schema miss) —
 * nulls only its own item, matching the baseline per-item semantics.
 */
function isControlFlow(err: unknown): boolean {
  return (
    err instanceof AgentInterrupted ||
    (err instanceof WorkflowError && !(err instanceof AgentFailedError))
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function firstLine(s: string): string {
  const line = s.split("\n").find((l) => l.trim().length > 0) ?? s;
  return line.length > 60 ? line.slice(0, 59) + "…" : line;
}

function preview(s: string): string {
  return s.length > 400 ? s.slice(0, 399) + "…" : s;
}
