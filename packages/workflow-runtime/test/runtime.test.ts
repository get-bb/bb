import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { JsonValue } from "@bb/domain";
import type { AgentResult, AgentSpec, RunDefaults } from "../src/dsl-types.js";
import { FakeWorker } from "../src/fake-worker.js";
import { InMemoryJournalStore } from "../src/journal.js";
import type { JournalStore } from "../src/journal.js";
import { determinismLint } from "../src/keys.js";
import { WorkflowSyntaxError } from "../src/meta-parser.js";
import {
  MAX_WORKFLOW_RESULT_BYTES,
  runWorkflowRunner,
} from "../src/runner-entry.js";
import type { WorkflowRunOutcome } from "../src/runner-entry.js";
import { MAX_WORKFLOW_LOG_MESSAGE_LENGTH } from "../src/runtime.js";
import type { WorkflowRunEvent } from "../src/runtime.js";
import { AgentError } from "../src/worker-contract.js";
import type { Worker, WorkerContext } from "../src/worker-contract.js";

interface RecordedWorkerContext {
  agentIndex: number;
  attempt: number;
}

const META = `export const meta = { name: "fixture", description: "test fixture" }\n`;

function makeDefaults(overrides: Partial<RunDefaults> = {}): RunDefaults {
  return {
    provider: "codex",
    effort: "medium",
    sandbox: "read-only",
    cwd: "/tmp/wf-fixture",
    concurrency: 4,
    maxAgents: 50,
    maxFanout: 10,
    budgetOutputTokens: null,
    ...overrides,
  };
}

/** Records every spec it forwards, so tests can assert which agents actually ran. */
class CountingWorker implements Worker {
  readonly specs: AgentSpec[] = [];
  constructor(private readonly inner: Worker = new FakeWorker()) {}

  runAgent(spec: AgentSpec, ctx: WorkerContext): Promise<AgentResult> {
    this.specs.push(spec);
    return this.inner.runAgent(spec, ctx);
  }
}

/** Usage the FailOnMarkerWorker bills on every marker failure (failed turns still bill). */
const MARKER_FAILURE_USAGE = { inputTokens: 3, outputTokens: 5 } as const;

/** Terminal-fails any agent whose prompt contains the marker; delegates the rest. */
class FailOnMarkerWorker implements Worker {
  constructor(
    private readonly marker: string,
    private readonly inner: Worker = new FakeWorker(),
  ) {}

  runAgent(spec: AgentSpec, ctx: WorkerContext): Promise<AgentResult> {
    if (spec.prompt.includes(this.marker)) {
      throw new AgentError({
        provider: spec.provider,
        code: "boom",
        message: `marker failure: ${this.marker}`,
        usage: { ...MARKER_FAILURE_USAGE },
      });
    }
    return this.inner.runAgent(spec, ctx);
  }
}

interface RunFixtureArgs {
  source: string;
  args?: JsonValue;
  seed?: number;
  baseTimeMs?: number;
  defaults?: Partial<RunDefaults>;
  journal?: JournalStore;
  worker?: Worker;
  signal?: AbortSignal;
}

interface RunFixtureOutput {
  outcome: WorkflowRunOutcome;
  events: WorkflowRunEvent[];
  journal: JournalStore;
  heartbeatFilePath: string;
}

async function runFixture(opts: RunFixtureArgs): Promise<RunFixtureOutput> {
  const journal = opts.journal ?? new InMemoryJournalStore();
  const events: WorkflowRunEvent[] = [];
  const heartbeatFilePath = join(
    mkdtempSync(join(tmpdir(), "wfrt-test-")),
    ".heartbeat",
  );
  const outcome = await runWorkflowRunner({
    runId: "wfr_test",
    source: opts.source,
    filename: "fixture.workflow.js",
    args: opts.args,
    seed: opts.seed ?? 42,
    baseTimeMs: opts.baseTimeMs ?? 1_000_000,
    defaults: makeDefaults(opts.defaults),
    worker: opts.worker ?? new FakeWorker(),
    journal,
    onRunEvent: (event) => events.push(event),
    heartbeatFilePath,
    signal: opts.signal ?? new AbortController().signal,
  });
  return { outcome, events, journal, heartbeatFilePath };
}

/** Zero out the only wall-clock-derived field so streams can be compared exactly. */
function normalizeEvents(events: WorkflowRunEvent[]): WorkflowRunEvent[] {
  return events.map((event) => {
    if (event.type === "agent/completed" || event.type === "agent/failed") {
      return { ...event, entry: { ...event.entry, durationMs: 0 } };
    }
    return event;
  });
}

function agentCompletedEvents(events: WorkflowRunEvent[]) {
  return events.filter((event) => event.type === "agent/completed");
}

describe("deterministic replay", () => {
  const SRC =
    META +
    `
phase("Scope")
log("r0=" + random())
const out = await parallel([
  () => agent("alpha " + random().toFixed(6)),
  () => agent("beta " + random().toFixed(6)),
  () => agent("gamma"),
])
phase("Join")
const final = await agent("join: " + out.join(" | "))
return { final, t: [now(), now()] }
`;

  it("emits an identical event stream across two fresh runs with one seed", async () => {
    const a = await runFixture({ source: SRC, seed: 7 });
    const b = await runFixture({ source: SRC, seed: 7 });
    expect(a.outcome.status).toBe("completed");
    expect(normalizeEvents(b.events)).toEqual(normalizeEvents(a.events));
    expect(b.outcome.result).toEqual(a.outcome.result);
  });

  it("draws different random() substreams from a different seed", async () => {
    const a = await runFixture({ source: SRC, seed: 1 });
    const b = await runFixture({ source: SRC, seed: 2 });
    const logOf = (events: WorkflowRunEvent[]) =>
      events.find((e) => e.type === "log" && e.message.startsWith("r0="));
    expect(logOf(a.events)).toBeDefined();
    expect(logOf(a.events)).not.toEqual(logOf(b.events));
  });

  it("seeds now() from baseTimeMs with a per-branch counter", async () => {
    const { outcome } = await runFixture({
      source: META + `return [now(), now(), now()]\n`,
      baseTimeMs: 5_000,
    });
    expect(outcome.result).toEqual([5_000, 5_001, 5_002]);
  });
});

describe("journal replay (resume)", () => {
  const FAN =
    META +
    `
phase("Fan")
const out = await parallel([
  () => agent("a1"),
  () => agent("a2"),
  () => agent("a3"),
  () => agent("a4"),
  () => agent("a5"),
  () => agent("a6"),
])
return out
`;

  it("keys are concurrency-invariant: a journal written at concurrency 1 fully replays at concurrency 6", async () => {
    const first = await runFixture({
      source: FAN,
      defaults: { concurrency: 1 },
    });
    expect(first.outcome.status).toBe("completed");
    expect(first.journal.list()).toHaveLength(6);

    const counting = new CountingWorker();
    const second = await runFixture({
      source: FAN,
      defaults: { concurrency: 6 },
      journal: first.journal,
      worker: counting,
    });
    expect(second.outcome.status).toBe("completed");
    expect(counting.specs).toHaveLength(0);
    const completed = agentCompletedEvents(second.events);
    expect(completed).toHaveLength(6);
    expect(completed.every((e) => e.cached)).toBe(true);
    expect(second.outcome.result).toEqual(first.outcome.result);
    // Nothing is re-appended for replayed agents.
    expect(second.journal.list()).toHaveLength(6);
  });

  it("replays only the completed prefix and re-runs the failed suffix", async () => {
    const TWO =
      META +
      `const a = await agent("first")\nreturn [a, await agent("second-MARKER")]\n`;
    const first = await runFixture({
      source: TWO,
      worker: new FailOnMarkerWorker("MARKER"),
    });
    expect(first.outcome.status).toBe("failed");
    expect(first.outcome.error).toContain("marker failure");
    const journaled = first.journal.list();
    expect(journaled.map((e) => e.status)).toEqual(["completed", "failed"]);
    const failedIndex = journaled[1]?.agentIndex;

    const counting = new CountingWorker();
    const second = await runFixture({
      source: TWO,
      journal: first.journal,
      worker: counting,
    });
    expect(second.outcome.status).toBe("completed");
    // Only the previously-failed agent re-ran.
    expect(counting.specs.map((s) => s.prompt)).toEqual(["second-MARKER"]);
    const completed = agentCompletedEvents(second.events);
    expect(completed.map((e) => e.cached)).toEqual([true, false]);
    // The re-run keeps its journaled display index across attempts.
    expect(completed[1]?.entry.agentIndex).toBe(failedIndex);
  });

  it("replays structured results for schema'd calls", async () => {
    const SRC =
      META +
      `return await agent("structured", { schema: { type: "object", required: ["n"], properties: { n: { type: "number", minimum: 3 } } } })\n`;
    const first = await runFixture({ source: SRC });
    expect(first.outcome.status).toBe("completed");
    expect(first.outcome.result).toEqual({ n: 3 });

    const counting = new CountingWorker();
    const second = await runFixture({
      source: SRC,
      journal: first.journal,
      worker: counting,
    });
    expect(counting.specs).toHaveLength(0);
    expect(second.outcome.result).toEqual({ n: 3 });
  });

  it("an explicit key pins the cached result across prompt edits", async () => {
    const first = await runFixture({
      source: META + `return await agent("original prompt", { key: "pin" })\n`,
    });
    expect(first.outcome.status).toBe("completed");

    const counting = new CountingWorker();
    const second = await runFixture({
      source: META + `return await agent("changed prompt", { key: "pin" })\n`,
      journal: first.journal,
      worker: counting,
    });
    expect(counting.specs).toHaveLength(0);
    expect(second.outcome.result).toBe(first.outcome.result);
  });

  it("duplicate explicit keys abort the run", async () => {
    const { outcome } = await runFixture({
      source:
        META +
        `await agent("one", { key: "dup" })\nawait agent("two", { key: "dup" })\n`,
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain('duplicate explicit agent key "dup"');
  });

  it("the journal rebuilds from run events alone — failures keep their index and billed usage", async () => {
    const TWO =
      META +
      `const a = await agent("first")\nreturn [a, await agent("second-MARKER")]\n`;
    const first = await runFixture({
      source: TWO,
      worker: new FailOnMarkerWorker("MARKER"),
    });
    expect(first.outcome.status).toBe("failed");

    // The daemon's resume path: the server journal is rebuilt purely from the
    // run-event stream (agent/completed + agent/failed entries), never from
    // runner-local state — so failure entries must ride the events too.
    const rebuilt = new InMemoryJournalStore();
    for (const event of first.events) {
      if (event.type === "agent/completed" && !event.cached) {
        rebuilt.append(event.entry);
      } else if (event.type === "agent/failed") {
        rebuilt.append(event.entry);
      }
    }
    expect(rebuilt.list()).toEqual(first.journal.list());
    const failedEntry = first.journal.list()[1];
    expect(failedEntry?.status).toBe("failed");
    expect(failedEntry?.usage).toEqual(MARKER_FAILURE_USAGE);

    const counting = new CountingWorker();
    const second = await runFixture({
      source: TWO,
      journal: rebuilt,
      worker: counting,
    });
    expect(second.outcome.status).toBe("completed");
    // Only the failed agent re-ran, and it kept its journaled display index.
    expect(counting.specs.map((s) => s.prompt)).toEqual(["second-MARKER"]);
    const completed = agentCompletedEvents(second.events);
    expect(completed.map((e) => e.cached)).toEqual([true, false]);
    expect(completed[1]?.entry.agentIndex).toBe(failedEntry?.agentIndex);
  });

  it("an explicit-key replay reports the journaled provider, not the edited spec", async () => {
    const first = await runFixture({
      source: META + `return await agent("pinned", { key: "pin" })\n`,
    });
    expect(first.outcome.status).toBe("completed");

    const counting = new CountingWorker();
    const second = await runFixture({
      source:
        META +
        `return await agent("pinned", { key: "pin", provider: "claude-code" })\n`,
      journal: first.journal,
      worker: counting,
    });
    expect(counting.specs).toHaveLength(0);
    const [replayed] = agentCompletedEvents(second.events);
    // The first run resolved the default provider (codex); the replayed agent
    // never ran on the edited spec, so the event meta and its entry must both
    // report what it actually ran on.
    expect(replayed?.cached).toBe(true);
    expect(replayed?.provider).toBe("codex");
    expect(replayed?.entry.provider).toBe("codex");
  });
});

// Runtime-level (not simulator) key-stability properties: these run the real
// Runtime/parallel()/agent() machinery, so a regression in its KeyContext
// lineage (e.g. dropping the per-branch fanoutIndex counter, or computing keys
// after an await) fails here even though keys.test.ts's simulator agrees with
// itself.
describe("chained-key stability (runtime level)", () => {
  it("two sequential identical fan-outs journal distinct keys and replay round-by-round", async () => {
    const ROUNDS =
      META +
      `
const round1 = await parallel([() => agent("check the area"), () => agent("check the area")])
const round2 = await parallel([() => agent("check the area"), () => agent("check the area")])
return [round1, round2]
`;
    /** Returns a distinct payload per invocation, so journal-slot collisions are observable. */
    class SequenceWorker implements Worker {
      private calls = 0;
      async runAgent(spec: AgentSpec): Promise<AgentResult> {
        this.calls += 1;
        return {
          text: `result-${this.calls}`,
          status: "completed",
          usage: { inputTokens: spec.prompt.length, outputTokens: 1 },
        };
      }
    }
    const first = await runFixture({
      source: ROUNDS,
      worker: new SequenceWorker(),
    });
    expect(first.outcome.status).toBe("completed");
    // 4 agents, 4 DISTINCT keys: identical rounds must not share journal slots.
    const keys = first.journal.list().map((entry) => entry.key);
    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(4);
    expect(first.outcome.result).toEqual([
      ["result-1", "result-2"],
      ["result-3", "result-4"],
    ]);

    class RefusingWorker implements Worker {
      runAgent(): Promise<AgentResult> {
        throw new Error("no agent should re-run on a full replay");
      }
    }
    const second = await runFixture({
      source: ROUNDS,
      journal: first.journal,
      worker: new RefusingWorker(),
    });
    expect(second.outcome.status).toBe("completed");
    // Each round replays ITS OWN results — a key collision would hand round 1
    // the last-written (round 2) entries.
    expect(second.outcome.result).toEqual(first.outcome.result);
    const completed = agentCompletedEvents(second.events);
    expect(completed).toHaveLength(4);
    expect(completed.every((event) => event.cached)).toBe(true);
  });

  it("journal keys are identical when worker latency reverses completion order", async () => {
    const SRC =
      META +
      `
await parallel([
  async () => { await agent("a1"); await agent("a2"); },
  async () => { await agent("b1"); await agent("b2"); },
])
return "ok"
`;
    /** Delays prompts matching the prefix so the other branch races ahead. */
    class SlowPrefixWorker implements Worker {
      constructor(
        private readonly slowPrefix: string,
        private readonly inner: Worker = new FakeWorker(),
      ) {}
      async runAgent(spec: AgentSpec, ctx: WorkerContext): Promise<AgentResult> {
        if (spec.prompt.startsWith(this.slowPrefix)) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return this.inner.runAgent(spec, ctx);
      }
    }
    const slowA = await runFixture({
      source: SRC,
      worker: new SlowPrefixWorker("a"),
    });
    const slowB = await runFixture({
      source: SRC,
      worker: new SlowPrefixWorker("b"),
    });
    expect(slowA.outcome.status).toBe("completed");
    expect(slowB.outcome.status).toBe("completed");
    const keysOf = (store: JournalStore) =>
      store
        .list()
        .map((entry) => entry.key)
        .sort();
    // Keys depend only on call-tree position — never on which branch's agents
    // happened to settle first.
    expect(new Set(keysOf(slowA.journal)).size).toBe(4);
    expect(keysOf(slowA.journal)).toEqual(keysOf(slowB.journal));
  });
});

describe("worktree outcomes", () => {
  it("threads the worker-reported preserved branch into the journal entry and event", async () => {
    class WorktreePreservingWorker implements Worker {
      constructor(private readonly inner: Worker = new FakeWorker()) {}
      async runAgent(spec: AgentSpec, ctx: WorkerContext): Promise<AgentResult> {
        const result = await this.inner.runAgent(spec, ctx);
        return spec.worktree
          ? { ...result, worktreeBranch: "wf/wfr_test-1" }
          : result;
      }
    }
    const { events, journal } = await runFixture({
      source:
        META +
        `return [await agent("isolated", { worktree: true }), await agent("plain")]\n`,
      worker: new WorktreePreservingWorker(),
    });
    const [isolated, plain] = journal.list();
    expect(isolated?.worktreeBranch).toBe("wf/wfr_test-1");
    expect(plain?.worktreeBranch).toBeUndefined();
    const completed = agentCompletedEvents(events);
    expect(completed[0]?.entry.worktreeBranch).toBe("wf/wfr_test-1");
  });
});

describe("caps and budget admission", () => {
  it("exceeding maxAgents fails the run", async () => {
    const { outcome } = await runFixture({
      source: META + `await agent("1")\nawait agent("2")\nawait agent("3")\n`,
      defaults: { maxAgents: 2 },
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("agent() call cap reached (2)");
  });

  it("a parallel() wider than maxFanout fails the run", async () => {
    const { outcome } = await runFixture({
      source:
        META +
        `await parallel([() => agent("a"), () => agent("b"), () => agent("c")])\n`,
      defaults: { maxFanout: 2 },
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("exceeds the 2 fan-out cap");
  });

  it("budget exhaustion stops new agents inside the admission slot", async () => {
    const counting = new CountingWorker();
    const { outcome } = await runFixture({
      source: META + `await agent("one")\nawait agent("two")\n`,
      defaults: { budgetOutputTokens: 10 },
      worker: counting,
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("token budget exceeded");
    // The second agent was never handed to the worker.
    expect(counting.specs.map((s) => s.prompt)).toEqual(["one"]);
  });

  it("exposes the budget to the workflow body", async () => {
    const { outcome } = await runFixture({
      source:
        META + `return [budget.total, budget.spent(), budget.remaining()]\n`,
      defaults: { budgetOutputTokens: 100 },
    });
    expect(outcome.result).toEqual([100, 0, 100]);
  });
});

describe("fan-out failure semantics", () => {
  it("a single agent failure degrades to null; siblings and the run complete", async () => {
    const { outcome, events } = await runFixture({
      source:
        META +
        `return await parallel([() => agent("good1"), () => agent("bad-MARKER"), () => agent("good2")])\n`,
      worker: new FailOnMarkerWorker("MARKER"),
    });
    expect(outcome.status).toBe("completed");
    const result = outcome.result;
    if (!Array.isArray(result)) throw new Error("expected array result");
    expect(result).toHaveLength(3);
    expect(typeof result[0]).toBe("string");
    expect(result[1]).toBeNull();
    expect(typeof result[2]).toBe("string");
    expect(
      events.some(
        (e) => e.type === "log" && e.message.startsWith("parallel[1] failed:"),
      ),
    ).toBe(true);
    expect(events.filter((e) => e.type === "agent/failed")).toHaveLength(1);
  });

  it("rejects an out-of-enum sandbox from the untyped workflow body", async () => {
    const { outcome } = await runFixture({
      source: META + `await agent("x", { sandbox: "readonly" })\n`,
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain('invalid sandbox "readonly"');
  });
});

describe("agent() option validation", () => {
  it("rejects omegacode's maxTurns at the call site before queueing", async () => {
    const counting = new CountingWorker();
    const { outcome, events } = await runFixture({
      source: META + `await agent("x", { maxTurns: 3 })\n`,
      worker: counting,
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("maxTurns is not supported");
    // Fail fast and free: nothing was queued and no run slot was consumed.
    expect(counting.specs).toHaveLength(0);
    expect(events.some((e) => e.type === "agent/queued")).toBe(false);
  });

  it("rejects a string worktree branch name", async () => {
    const counting = new CountingWorker();
    const { outcome, events } = await runFixture({
      source: META + `await agent("x", { worktree: "custom-branch" })\n`,
      worker: counting,
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("worktree must be a boolean");
    expect(counting.specs).toHaveLength(0);
    expect(events.some((e) => e.type === "agent/queued")).toBe(false);
  });

  it("rejects unknown agent() options so typos never silently no-op", async () => {
    const { outcome } = await runFixture({
      source: META + `await agent("x", { sandboxx: "read-only" })\n`,
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain('unknown agent() option "sandboxx"');
  });
});

describe("untrusted payload bounds", () => {
  it("truncates oversized log() messages at the producer", async () => {
    const { outcome, events } = await runFixture({
      source:
        META +
        `log("x".repeat(${MAX_WORKFLOW_LOG_MESSAGE_LENGTH + 5_000}))\nreturn 1\n`,
    });
    expect(outcome.status).toBe("completed");
    const logEvent = events.find((event) => event.type === "log");
    if (!logEvent || logEvent.type !== "log") {
      throw new Error("expected a log event");
    }
    expect(logEvent.message.endsWith("… [truncated]")).toBe(true);
    expect(logEvent.message.length).toBeLessThanOrEqual(
      MAX_WORKFLOW_LOG_MESSAGE_LENGTH + "… [truncated]".length,
    );
  });

  it("fails a run whose serialized result exceeds the byte cap", async () => {
    const { outcome, events } = await runFixture({
      source:
        META + `return "y".repeat(${MAX_WORKFLOW_RESULT_BYTES + 1_024})\n`,
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("workflow result exceeds");
    expect(events.at(-1)?.type).toBe("run/failed");
  });
});

describe("worker attempt threading", () => {
  it("passes the journal-stable agentIndex with incrementing attempts across withRetry", async () => {
    class FlakyOnceWorker implements Worker {
      readonly contexts: RecordedWorkerContext[] = [];
      private failedOnce = false;
      constructor(private readonly inner: Worker = new FakeWorker()) {}

      runAgent(spec: AgentSpec, ctx: WorkerContext): Promise<AgentResult> {
        this.contexts.push({ agentIndex: ctx.agentIndex, attempt: ctx.attempt });
        if (!this.failedOnce) {
          this.failedOnce = true;
          throw new AgentError({
            provider: spec.provider,
            code: "overloaded",
            message: "try again",
            retryable: true,
          });
        }
        return this.inner.runAgent(spec, ctx);
      }
    }
    const worker = new FlakyOnceWorker();
    const { outcome, events } = await runFixture({
      source: META + `return await agent("flaky")\n`,
      worker,
    });
    expect(outcome.status).toBe("completed");
    // One logical agent: both attempts share the runtime's display index (what
    // agent/completed carries), with the attempt counter telling them apart.
    expect(worker.contexts).toEqual([
      { agentIndex: 1, attempt: 0 },
      { agentIndex: 1, attempt: 1 },
    ]);
    const [completed] = agentCompletedEvents(events);
    expect(completed?.agentIndex).toBe(1);
  });
});

describe("structured output", () => {
  it("retries once with corrective instructions on a schema miss", async () => {
    class WrongThenRightWorker implements Worker {
      readonly specs: AgentSpec[] = [];
      readonly contexts: RecordedWorkerContext[] = [];
      async runAgent(spec: AgentSpec, ctx: WorkerContext): Promise<AgentResult> {
        this.specs.push(spec);
        this.contexts.push({ agentIndex: ctx.agentIndex, attempt: ctx.attempt });
        const structured: JsonValue =
          this.specs.length === 1 ? { wrong: true } : { n: 7 };
        return {
          text: JSON.stringify(structured),
          structured,
          status: "completed",
          usage: { inputTokens: 1, outputTokens: 2 },
        };
      }
    }
    const worker = new WrongThenRightWorker();
    const { outcome, events } = await runFixture({
      source:
        META +
        `return await agent("structured", { schema: { type: "object", required: ["n"], properties: { n: { type: "number" } } } })\n`,
      worker,
    });
    expect(outcome.status).toBe("completed");
    expect(outcome.result).toEqual({ n: 7 });
    expect(worker.specs).toHaveLength(2);
    expect(worker.specs[1]?.instructions).toContain(
      "did not match the required JSON schema",
    );
    // The corrective re-prompt is the same logical agent's next attempt.
    expect(worker.contexts).toEqual([
      { agentIndex: 1, attempt: 0 },
      { agentIndex: 1, attempt: 1 },
    ]);
    expect(
      events.some(
        (e) =>
          e.type === "log" && e.message.includes("structured output retry"),
      ),
    ).toBe(true);
    // Usage accumulates across both attempts.
    const completed = agentCompletedEvents(events);
    expect(completed[0]?.entry.usage).toEqual({
      inputTokens: 2,
      outputTokens: 4,
    });
  });
});

describe("run lifecycle", () => {
  it("aborting the signal cancels the run", async () => {
    const ac = new AbortController();
    const pending = runFixture({
      source: META + `return await agent("slow")\n`,
      worker: new FakeWorker({ delayMs: 60_000 }),
      signal: ac.signal,
    });
    ac.abort();
    const { outcome, events } = await pending;
    expect(outcome.status).toBe("cancelled");
    expect(events.at(-1)).toEqual({
      type: "run/cancelled",
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  });

  it("settles fire-and-forget agents before declaring the run complete", async () => {
    const { outcome, events } = await runFixture({
      source: META + `agent("detached")\nreturn "done"\n`,
    });
    expect(outcome.status).toBe("completed");
    expect(outcome.result).toBe("done");
    expect(agentCompletedEvents(events)).toHaveLength(1);
  });

  it("emits run/started first and exactly one terminal event", async () => {
    const { events } = await runFixture({
      source: META + `return await agent("x")\n`,
    });
    expect(events[0]).toEqual({ type: "run/started", runId: "wfr_test" });
    const terminals = events.filter(
      (e) =>
        e.type === "run/completed" ||
        e.type === "run/failed" ||
        e.type === "run/cancelled",
    );
    expect(terminals).toHaveLength(1);
    expect(events.at(-1)?.type).toBe("run/completed");
  });

  it("touches the heartbeat file while running", async () => {
    const { heartbeatFilePath } = await runFixture({
      source: META + `return 1\n`,
    });
    expect(existsSync(heartbeatFilePath)).toBe(true);
    const stamp = Number(readFileSync(heartbeatFilePath, "utf8"));
    expect(Number.isFinite(stamp)).toBe(true);
  });

  it("normalizes the return value per JSON.stringify semantics (nested non-JSON drops)", async () => {
    const { outcome } = await runFixture({
      source:
        META +
        `return { keep: 1, fn: () => 1, missing: undefined, arr: [undefined] }\n`,
    });
    expect(outcome.status).toBe("completed");
    expect(outcome.result).toEqual({ keep: 1, arr: [null] });
  });

  it("a cyclic return value fails the run with a run/failed terminal event", async () => {
    const { outcome, events } = await runFixture({
      source: META + `const a = {}\na.self = a\nreturn a\n`,
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toMatch(/circular/i);
    expect(events.at(-1)?.type).toBe("run/failed");
  });

  it("rejects invalid run defaults before any event or heartbeat side effect", async () => {
    // An invalid concurrency would build a Semaphore that never admits anyone:
    // every agent() queues forever while the heartbeat keeps beating, so the
    // deadman never flags it. It must throw before run/started is emitted.
    const events: WorkflowRunEvent[] = [];
    const heartbeatFilePath = join(
      mkdtempSync(join(tmpdir(), "wfrt-test-")),
      ".heartbeat",
    );
    await expect(
      runWorkflowRunner({
        runId: "wfr_test",
        source: META + `return 1\n`,
        filename: "fixture.workflow.js",
        args: undefined,
        seed: 1,
        baseTimeMs: 0,
        defaults: makeDefaults({ concurrency: 0 }),
        worker: new FakeWorker(),
        journal: new InMemoryJournalStore(),
        onRunEvent: (event) => events.push(event),
        heartbeatFilePath,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/positive integer/);
    expect(events).toEqual([]);
    expect(existsSync(heartbeatFilePath)).toBe(false);
  });

  it("throws WorkflowSyntaxError for a script without a leading meta, before any event", async () => {
    const events: WorkflowRunEvent[] = [];
    await expect(
      runWorkflowRunner({
        runId: "wfr_test",
        source: `const x = 1\n`,
        filename: "fixture.workflow.js",
        args: undefined,
        seed: 1,
        baseTimeMs: 0,
        defaults: makeDefaults(),
        worker: new FakeWorker(),
        journal: new InMemoryJournalStore(),
        onRunEvent: (event) => events.push(event),
        heartbeatFilePath: join(
          mkdtempSync(join(tmpdir(), "wfrt-test-")),
          ".heartbeat",
        ),
        signal: new AbortController().signal,
      }),
    ).rejects.toThrowError(WorkflowSyntaxError);
    expect(events).toEqual([]);
  });
});

describe("determinism lint over fixtures", () => {
  it("flags an injected Date.now()", () => {
    const findings = determinismLint(META + `const t = Date.now()\n`);
    expect(findings).toEqual([{ token: "Date.now()", use: "now()" }]);
  });

  it("is clean on the deterministic fixture", () => {
    expect(determinismLint(META + `log("at " + now())\n`)).toEqual([]);
  });
});
