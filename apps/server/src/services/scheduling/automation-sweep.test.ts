import {
  createAutomation,
  createConnection,
  createProject,
  getAutomation,
  listAutomationRuns,
  migrate,
  noopNotifier,
  upsertHost,
  type DbConnection,
} from "@bb/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";

const executeAgentRun = vi.fn();
const executeScriptRun = vi.fn();

vi.mock(import("./automation-run.js"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    executeAgentRun: (...args: unknown[]) => executeAgentRun(...args),
    executeScriptRun: (...args: unknown[]) => executeScriptRun(...args),
  };
});

// Imported after the mock is registered.
const { sweepDueAutomations } = await import("./automation-sweep.js");
const { mapScriptResultToRun, isWakeAgentSuppressed } = await import(
  "./automation-run.js"
);

const testLogger = {
  debug(): void {},
  error(): void {},
  info(): void {},
  warn(): void {},
};

let db: DbConnection;
let projectId: string;

function buildDeps(
  overrides: { automationsAllowScriptRuns?: boolean } = {},
): LoggedPendingInteractionWorkSessionDeps {
  return {
    config: {
      dataDir: "/tmp/bb-sweep-test",
      automationsAllowScriptRuns: overrides.automationsAllowScriptRuns ?? true,
    },
    db,
    hub: noopNotifier,
    lifecycleDedupers: {},
    logger: testLogger,
    machineAuth: {},
    pendingInteractions: {},
    telemetry: {},
    terminalSessions: {},
  } as unknown as LoggedPendingInteractionWorkSessionDeps;
}

const AGENT_EXECUTION = {
  mode: "agent",
  prompt: "go",
  providerId: "codex",
  model: "gpt-5",
  permissionMode: "readonly",
};
const SCRIPT_EXECUTION = {
  mode: "script",
  scriptFile: "run.sh",
  interpreter: "bash",
  timeoutMs: 120_000,
};
const ENVIRONMENT = { type: "host", workspace: { type: "personal" } };
const TRIGGER = { triggerType: "schedule", cron: "0 9 * * *", timezone: "UTC" };

function seedAutomation(args: {
  execution: unknown;
  nextRunAt: number;
  enabled?: boolean;
}) {
  return createAutomation(db, noopNotifier, {
    projectId,
    name: "Test",
    enabled: args.enabled ?? true,
    triggerType: "schedule",
    triggerConfig: JSON.stringify(TRIGGER),
    runMode: (args.execution as { mode: "agent" | "script" }).mode,
    execution: JSON.stringify(args.execution),
    environment: JSON.stringify(ENVIRONMENT),
    autoArchive: false,
    origin: "agent",
    createdByThreadId: null,
    targetThreadId: null,
    nextRunAt: args.nextRunAt,
  });
}

beforeEach(() => {
  db = createConnection(":memory:");
  migrate(db);
  // Single public host => resolvePrimaryHostId returns it.
  const host = upsertHost(db, noopNotifier, {
    name: "host",
    type: "persistent",
  });
  const created = createProject(db, noopNotifier, {
    name: "Project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/x" },
  });
  projectId = created.project.id;
  executeAgentRun.mockReset();
  executeScriptRun.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sweepDueAutomations", () => {
  it("claims a due agent automation, advances next_run_at, and dispatches the agent run", async () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const automation = seedAutomation({
      execution: AGENT_EXECUTION,
      nextRunAt: now - 1000,
    });

    await sweepDueAutomations(buildDeps(), { now });

    expect(executeAgentRun).toHaveBeenCalledTimes(1);
    expect(executeScriptRun).not.toHaveBeenCalled();

    const after = getAutomation(db, automation.id);
    expect(after?.nextRunAt).toBeGreaterThan(now);
    expect(after?.runCount).toBe(1);
    expect(after?.lastRunStatus).toBe("running");

    const runs = listAutomationRuns(db, {
      automationId: automation.id,
      limit: 10,
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("running");
    expect(runs[0]?.trigger).toBe("schedule");
  });

  it("dispatches the script run for a due script automation", async () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    seedAutomation({ execution: SCRIPT_EXECUTION, nextRunAt: now - 1000 });

    await sweepDueAutomations(buildDeps(), { now });

    expect(executeScriptRun).toHaveBeenCalledTimes(1);
    expect(executeAgentRun).not.toHaveBeenCalled();
  });

  it("skips due script automations (without claiming) when script runs are disabled", async () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const automation = seedAutomation({
      execution: SCRIPT_EXECUTION,
      nextRunAt: now - 1000,
    });

    await sweepDueAutomations(buildDeps({ automationsAllowScriptRuns: false }), {
      now,
    });

    expect(executeScriptRun).not.toHaveBeenCalled();
    // Not claimed: schedule and run count are untouched so it resumes cleanly.
    const after = getAutomation(db, automation.id);
    expect(after?.nextRunAt).toBe(now - 1000);
    expect(after?.runCount).toBe(0);
    expect(
      listAutomationRuns(db, { automationId: automation.id, limit: 10 }),
    ).toHaveLength(0);
  });

  it("rolls back the schedule advance when the run dispatch fails", async () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const automation = seedAutomation({
      execution: AGENT_EXECUTION,
      nextRunAt: now - 1000,
    });
    // Simulate spawn failure invoking the rollback handler.
    executeAgentRun.mockImplementation(async (_deps, args) => {
      (args as { onFailure: (e: unknown) => void }).onFailure(
        new Error("spawn failed"),
      );
    });

    await sweepDueAutomations(buildDeps(), { now });

    const after = getAutomation(db, automation.id);
    expect(after?.nextRunAt).toBe(now - 1000);
    expect(after?.runCount).toBe(0);
    expect(after?.lastRunStatus).toBe("failed");
    expect(after?.lastError).toBe("spawn failed");

    const runs = listAutomationRuns(db, {
      automationId: automation.id,
      limit: 10,
    });
    expect(runs[0]?.status).toBe("failed");
  });

  it("does not dispatch a disabled or not-yet-due automation", async () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    seedAutomation({
      execution: AGENT_EXECUTION,
      nextRunAt: now + 60_000,
    });
    seedAutomation({
      execution: AGENT_EXECUTION,
      nextRunAt: now - 1000,
      enabled: false,
    });

    await sweepDueAutomations(buildDeps(), { now });

    expect(executeAgentRun).not.toHaveBeenCalled();
  });

  it("fires a stale schedule exactly once and jumps past now (no burst)", async () => {
    const now = Date.UTC(2026, 0, 10, 12, 0, 0);
    const automation = seedAutomation({
      execution: AGENT_EXECUTION,
      // Far in the past => stale.
      nextRunAt: Date.UTC(2026, 0, 1, 9, 0, 0),
    });

    await sweepDueAutomations(buildDeps(), { now });
    await sweepDueAutomations(buildDeps(), { now });

    expect(executeAgentRun).toHaveBeenCalledTimes(1);
    const after = getAutomation(db, automation.id);
    expect(after?.nextRunAt).toBeGreaterThan(now);
  });
});

describe("mapScriptResultToRun", () => {
  it("maps non-empty stdout on exit 0 to a surfaced success", () => {
    const mapped = mapScriptResultToRun({
      exitCode: 0,
      output: "Disk at 95%",
      timedOut: false,
    });
    expect(mapped.status).toBe("succeeded");
    expect(mapped.output).toBe("Disk at 95%");
    expect(mapped.exitCode).toBe(0);
  });

  it("silences empty stdout on exit 0", () => {
    const mapped = mapScriptResultToRun({
      exitCode: 0,
      output: "",
      timedOut: false,
    });
    expect(mapped.status).toBe("succeeded");
    expect(mapped.output).toBeNull();
  });

  it("silences a trailing wakeAgent:false gate", () => {
    const mapped = mapScriptResultToRun({
      exitCode: 0,
      output: 'noise\n{"wakeAgent": false}',
      timedOut: false,
    });
    expect(mapped.status).toBe("succeeded");
    expect(mapped.output).toBeNull();
  });

  it("records a non-zero exit as a failure with the exit code", () => {
    const mapped = mapScriptResultToRun({
      exitCode: 2,
      output: "boom",
      timedOut: false,
    });
    expect(mapped.status).toBe("failed");
    expect(mapped.exitCode).toBe(2);
  });

  it("keeps captured stdout+stderr on a failed run so it is explainable", () => {
    // A script may post a visible side effect (e.g. `bb thread tell`) then exit
    // non-zero; the run is failed but its output must be retained for the user.
    const mapped = mapScriptResultToRun({
      exitCode: 1,
      output: "posted update\nerror: callback failed",
      timedOut: false,
    });
    expect(mapped.status).toBe("failed");
    expect(mapped.output).toBe("posted update\nerror: callback failed");
    expect(mapped.error).toContain("code 1");
  });

  it("records a timeout as a failure", () => {
    const mapped = mapScriptResultToRun({
      exitCode: null,
      output: "",
      timedOut: true,
    });
    expect(mapped.status).toBe("failed");
    expect(mapped.error).toBe("Script timed out");
  });
});

describe("isWakeAgentSuppressed", () => {
  it("only suppresses on a literal wakeAgent:false last line", () => {
    expect(isWakeAgentSuppressed('{"wakeAgent": false}')).toBe(true);
    expect(isWakeAgentSuppressed('out\n{"wakeAgent": false}\n')).toBe(true);
    expect(isWakeAgentSuppressed('{"wakeAgent": true}')).toBe(false);
    expect(isWakeAgentSuppressed("just output")).toBe(false);
    expect(isWakeAgentSuppressed('{"wakeAgent": false}\nmore output')).toBe(
      false,
    );
  });
});
