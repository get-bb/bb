import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { agentProviderIdSchema } from "@bb/agent-providers";
import { reasoningLevelValues } from "@bb/domain";
import type { JsonValue } from "@bb/domain";
import {
  BUILTIN_WORKFLOW_NAMES,
  listBuiltinWorkflows,
  readBuiltinWorkflow,
} from "../src/builtins.js";
import { workflowSandboxValues } from "../src/dsl-types.js";
import type { RunDefaults } from "../src/dsl-types.js";
import { FakeWorker } from "../src/fake-worker.js";
import { InMemoryJournalStore } from "../src/journal.js";
import type { JournalStore } from "../src/journal.js";
import { determinismLint } from "../src/keys.js";
import { runWorkflowRunner } from "../src/runner-entry.js";
import type { WorkflowRunOutcome } from "../src/runner-entry.js";
import type { WorkflowRunEvent } from "../src/runtime.js";
import { parseWorkflow } from "../src/meta-parser.js";
import type { Worker } from "../src/worker-contract.js";

function defaults(): RunDefaults {
  return {
    provider: "codex",
    effort: "medium",
    sandbox: "read-only",
    cwd: "/tmp/wf-builtins",
    concurrency: 4,
    maxAgents: 100,
    maxFanout: 25,
    budgetOutputTokens: null,
  };
}

interface RunBuiltinArgs {
  source: string;
  args?: JsonValue;
  journal?: JournalStore;
  worker?: Worker;
}

interface RunBuiltinOutput {
  outcome: WorkflowRunOutcome;
  events: WorkflowRunEvent[];
  journal: JournalStore;
}

async function runBuiltin(opts: RunBuiltinArgs): Promise<RunBuiltinOutput> {
  const journal = opts.journal ?? new InMemoryJournalStore();
  const events: WorkflowRunEvent[] = [];
  const outcome = await runWorkflowRunner({
    runId: "wfr_builtin",
    source: opts.source,
    filename: "builtin.workflow.js",
    args: opts.args,
    seed: 7,
    baseTimeMs: 1_000,
    defaults: defaults(),
    worker: opts.worker ?? new FakeWorker(),
    journal,
    onRunEvent: (event) => events.push(event),
    heartbeatFilePath: join(
      mkdtempSync(join(tmpdir(), "wfrt-builtin-")),
      ".heartbeat",
    ),
    signal: new AbortController().signal,
  });
  return { outcome, events, journal };
}

function phaseTitles(events: WorkflowRunEvent[]): string[] {
  return events
    .filter((event) => event.type === "phase/started")
    .map((event) => event.title);
}

function completedEvents(events: WorkflowRunEvent[]) {
  return events.filter((event) => event.type === "agent/completed");
}

describe("builtin catalog", () => {
  it("ships deep-research and code-review", () => {
    expect(listBuiltinWorkflows().map((w) => w.name)).toEqual([
      "deep-research",
      "code-review",
    ]);
  });

  it("every builtin parses, lints clean, and carries no model default", () => {
    for (const name of BUILTIN_WORKFLOW_NAMES) {
      const { source } = readBuiltinWorkflow(name);
      expect(determinismLint(source)).toEqual([]);
      const { meta } = parseWorkflow(source);
      expect(meta.name).toBe(name);
      expect(meta.description.length).toBeGreaterThan(0);
      expect(meta.defaultSandbox).toBe("read-only");
      expect(meta.defaultModel).toBeUndefined();
      expect(meta.defaultProvider).toBeUndefined();
    }
  });

  it("deep-research declares its five phases", () => {
    const { meta } = parseWorkflow(readBuiltinWorkflow("deep-research").source);
    expect(meta.phases?.map((p) => p.title)).toEqual([
      "Scope",
      "Search",
      "Fetch",
      "Verify",
      "Synthesize",
    ]);
  });
});

describe("deep-research offline end-to-end", () => {
  it("completes against the FakeWorker and produces a report", async () => {
    const { source } = readBuiltinWorkflow("deep-research");
    const { outcome, events } = await runBuiltin({
      source,
      args: "What is the airspeed velocity of an unladen swallow?",
    });
    expect(outcome.status).toBe("completed");
    expect(typeof outcome.result).toBe("string");
    expect(outcome.result).toContain("[fake:codex]");
    expect(phaseTitles(events)).toEqual([
      "Scope",
      "Search",
      "Fetch",
      "Verify",
      "Synthesize",
    ]);
    // 1 scope + 5 searchers + 1 fetch (one deduped fake source) + 3 votes + 1 synthesis.
    const completed = completedEvents(events);
    expect(completed).toHaveLength(11);
    expect(completed.every((e) => !e.cached)).toBe(true);
    expect(outcome.usage.outputTokens).toBeGreaterThan(0);
  });

  it("fully replays from its own journal on a re-run", async () => {
    const { source } = readBuiltinWorkflow("deep-research");
    const args = "Why is the sky blue?";
    const first = await runBuiltin({ source, args });
    expect(first.outcome.status).toBe("completed");

    class RefusingWorker implements Worker {
      runAgent(): Promise<never> {
        throw new Error("no agent should re-run on a full replay");
      }
    }
    const second = await runBuiltin({
      source,
      args,
      journal: first.journal,
      worker: new RefusingWorker(),
    });
    expect(second.outcome.status).toBe("completed");
    expect(second.outcome.result).toEqual(first.outcome.result);
    const completed = completedEvents(second.events);
    expect(completed).toHaveLength(11);
    expect(completed.every((e) => e.cached)).toBe(true);
  });

  it("fails fast without a question", async () => {
    const { source } = readBuiltinWorkflow("deep-research");
    const { outcome } = await runBuiltin({ source });
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("deep-research needs a question");
  });
});

describe("code-review offline end-to-end", () => {
  it("completes against the FakeWorker with verified findings and a report", async () => {
    const { source } = readBuiltinWorkflow("code-review");
    const { outcome, events } = await runBuiltin({ source });
    expect(outcome.status).toBe("completed");
    const result = outcome.result;
    if (
      result === null ||
      typeof result !== "object" ||
      Array.isArray(result)
    ) {
      throw new Error("expected an object result");
    }
    const findings = result.findings;
    if (!Array.isArray(findings)) throw new Error("expected findings array");
    // level "high": 4 angles × 1 synthesized finding each, all CONFIRMED.
    expect(findings).toHaveLength(4);
    expect(typeof result.report).toBe("string");
    expect(phaseTitles(events)).toEqual(["Review", "Verify", "Report"]);
    // 4 finders + 4 verifiers + 1 report writer.
    expect(completedEvents(events)).toHaveLength(9);
  });

  it("rejects an unknown level", async () => {
    const { source } = readBuiltinWorkflow("code-review");
    const { outcome } = await runBuiltin({
      source,
      args: { level: "extreme" },
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain('unknown level "extreme"');
  });
});

describe("ambient author typings", () => {
  const ambient = readFileSync(
    new URL("../ambient.d.ts", import.meta.url),
    "utf8",
  );

  it("declares every injected DSL global", () => {
    expect(ambient).toContain("declare global");
    for (const decl of [
      "function agent(",
      "function parallel<",
      "function pipeline(",
      "function phase(",
      "function log(",
      "function now(",
      "function random(",
      "const budget:",
      "const args:",
      "interface WorkflowAgentOpts",
    ]) {
      expect(ambient).toContain(decl);
    }
  });

  it("parses without syntax errors", () => {
    // The file sits outside the tsconfig include on purpose (its globals must
    // not leak into the package compilation), so nothing else ever parses it.
    const fileName = "ambient.d.ts";
    const sourceFile = ts.createSourceFile(
      fileName,
      ambient,
      ts.ScriptTarget.Latest,
      true,
    );
    const host: ts.CompilerHost = {
      fileExists: (file) => file === fileName,
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => "",
      getDefaultLibFileName: () => "lib.d.ts",
      getNewLine: () => "\n",
      getSourceFile: (file) => (file === fileName ? sourceFile : undefined),
      readFile: (file) => (file === fileName ? ambient : undefined),
      useCaseSensitiveFileNames: () => true,
      writeFile: () => {},
    };
    const program = ts.createProgram(
      [fileName],
      { noEmit: true, noResolve: true, noLib: true },
      host,
    );
    const messages = program
      .getSyntacticDiagnostics(sourceFile)
      .map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      );
    expect(messages).toEqual([]);
  });

  it("keeps the inlined unions in sync with the source enums", () => {
    // ambient.d.ts inlines copies of these unions (it cannot import); drift
    // would ship wrong author completions silently.
    const unionMembers = (typeName: string): string[] => {
      const match = new RegExp(`type ${typeName} =([^;]*);`).exec(ambient);
      if (!match) throw new Error(`type ${typeName} not declared in ambient.d.ts`);
      return [...match[1].matchAll(/"([^"]+)"/g)]
        .map(([, member]) => member)
        .sort();
    };
    expect(unionMembers("WorkflowProviderId")).toEqual(
      [...agentProviderIdSchema.options].sort(),
    );
    expect(unionMembers("WorkflowEffort")).toEqual(
      [...reasoningLevelValues].sort(),
    );
    expect(unionMembers("WorkflowSandbox")).toEqual(
      [...workflowSandboxValues].sort(),
    );
  });
});
