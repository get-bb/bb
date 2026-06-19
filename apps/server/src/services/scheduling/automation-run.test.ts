import {
  closeAutomationRun,
  createAutomation,
  createConnection,
  createEnvironment,
  createManualRun,
  createProject,
  createThread,
  getAutomationRun,
  migrate,
  noopNotifier,
  threads,
  upsertHost,
  type AutomationRow,
  type DbConnection,
} from "@bb/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";

const createThreadFromRequest = vi.fn();
const sendThreadMessage = vi.fn();

vi.mock(import("../threads/thread-create.js"), async (orig) => ({
  ...(await orig()),
  createThreadFromRequest: (...args: unknown[]) =>
    createThreadFromRequest(...args),
}));
vi.mock(import("../threads/thread-send.js"), async (orig) => ({
  ...(await orig()),
  sendThreadMessage: (...args: unknown[]) => sendThreadMessage(...args),
}));
// Avoid a real environment lookup in the reuse path; resolve to a stub.
const requireThreadCommandEnvironment = vi.fn();
vi.mock(import("../threads/thread-command-environment.js"), async (orig) => ({
  ...(await orig()),
  requireThreadCommandEnvironment: (...args: unknown[]) =>
    requireThreadCommandEnvironment(...args),
}));

// Capture the daemon command without spawning a real process.
const runLiveHostCommand = vi.fn();
vi.mock(import("../hosts/live-command.js"), async (orig) => ({
  ...(await orig()),
  runLiveHostCommand: (...args: unknown[]) => runLiveHostCommand(...args),
}));
// Skip on-disk script resolution; the env injection is what we assert.
vi.mock(import("./automation-scripts.js"), async (orig) => ({
  ...(await orig()),
  resolveAutomationScriptPath: async () => "/tmp/scripts/auto/run.sh",
}));

const { executeAgentRun, executeScriptRun } = await import(
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
let hostId: string;

function buildDeps(): LoggedPendingInteractionWorkSessionDeps {
  return {
    config: {
      dataDir: "/tmp/bb-run-test",
      automationsAllowScriptRuns: true,
      serverPort: 38886,
      hostDaemonPort: 38887,
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
  mode: "agent" as const,
  prompt: "do the thing",
  providerId: "codex",
  model: "gpt-5",
  permissionMode: "readonly" as const,
};
const ENVIRONMENT = {
  type: "host" as const,
  workspace: { type: "personal" as const },
};

function makeThread(
  status: "idle" | "active" = "idle",
): ReturnType<typeof createThread> {
  return createThread(db, noopNotifier, {
    projectId,
    environmentId: null,
    providerId: "codex",
    status,
    title: "Standing thread",
    titleFallback: "Standing thread",
    parentThreadId: null,
  });
}

function seedAutomation(targetThreadId: string | null): AutomationRow {
  return createAutomation(db, noopNotifier, {
    projectId,
    name: "Reuse test",
    enabled: true,
    triggerType: "schedule",
    triggerConfig: JSON.stringify({ cron: "0 9 * * *", timezone: "UTC" }),
    runMode: "agent",
    execution: JSON.stringify(AGENT_EXECUTION),
    environment: JSON.stringify(ENVIRONMENT),
    autoArchive: false,
    origin: "agent",
    createdByThreadId: null,
    targetThreadId,
    nextRunAt: Date.now(),
  });
}

beforeEach(() => {
  db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "host",
    type: "persistent",
  });
  hostId = host.id;
  projectId = createProject(db, noopNotifier, {
    name: "Project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/x" },
  }).project.id;
  createThreadFromRequest.mockReset();
  sendThreadMessage.mockReset();
  runLiveHostCommand.mockReset();
  requireThreadCommandEnvironment.mockReset();
  requireThreadCommandEnvironment.mockResolvedValue({
    id: "env_stub",
    hostId: "host_stub",
    status: "ready",
    path: "/tmp/stub",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("executeAgentRun target-thread reuse", () => {
  it("submits a turn into the configured target thread instead of spawning", async () => {
    const thread = makeThread();
    const automation = seedAutomation(thread.id);
    const { run } = createManualRun(db, {
      automationId: automation.id,
      runMode: "agent",
      now: Date.now(),
    });
    sendThreadMessage.mockResolvedValue(undefined);
    const onFailure = vi.fn();

    await executeAgentRun(buildDeps(), {
      automation,
      run,
      execution: AGENT_EXECUTION,
      environment: ENVIRONMENT,
      onFailure,
    });

    expect(sendThreadMessage).toHaveBeenCalledTimes(1);
    expect(createThreadFromRequest).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
    // The run is linked to the reused thread so the turn-complete hook closes it.
    expect(getAutomationRun(db, run.id)?.threadId).toBe(thread.id);

    // The submitted prompt is wrapped in the automation-due template.
    const sentArgs = sendThreadMessage.mock.calls[0]?.[1] as {
      thread: { id: string };
      payload: { input: { text: string }[] };
    };
    expect(sentArgs.thread.id).toBe(thread.id);
    expect(sentArgs.payload.input[0]?.text).toContain(
      `[bb automation due:${automation.id}]`,
    );
    expect(sentArgs.payload.input[0]?.text).toContain("do the thing");
  });

  it("fails the run (no new thread) when the target thread is missing", async () => {
    // Target an existing thread (FK requires it), then soft-delete it so the
    // reuse path treats it as unavailable.
    const thread = makeThread();
    const automation = seedAutomation(thread.id);
    db.update(threads)
      .set({ deletedAt: Date.now() })
      .where(eq(threads.id, thread.id))
      .run();
    const { run } = createManualRun(db, {
      automationId: automation.id,
      runMode: "agent",
      now: Date.now(),
    });
    // The route/sweep onFailure settles the run; mirror the run-now behavior.
    const onFailure = (error: unknown): void => {
      closeAutomationRun(db, {
        runId: run.id,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        now: Date.now(),
      });
    };

    await executeAgentRun(buildDeps(), {
      automation,
      run,
      execution: AGENT_EXECUTION,
      environment: ENVIRONMENT,
      onFailure,
    });

    expect(createThreadFromRequest).not.toHaveBeenCalled();
    expect(sendThreadMessage).not.toHaveBeenCalled();
    const settled = getAutomationRun(db, run.id);
    expect(settled?.status).toBe("failed");
    expect(settled?.error).toContain("unavailable");
  });

  it("spawns a new thread when no target thread is configured", async () => {
    const automation = seedAutomation(null);
    const { run } = createManualRun(db, {
      automationId: automation.id,
      runMode: "agent",
      now: Date.now(),
    });
    // The spawned thread must exist for the run→thread FK link to hold.
    const spawned = makeThread();
    createThreadFromRequest.mockResolvedValue({ id: spawned.id });
    const onFailure = vi.fn();

    await executeAgentRun(buildDeps(), {
      automation,
      run,
      execution: AGENT_EXECUTION,
      environment: ENVIRONMENT,
      onFailure,
    });

    expect(createThreadFromRequest).toHaveBeenCalledTimes(1);
    expect(sendThreadMessage).not.toHaveBeenCalled();
    expect(getAutomationRun(db, run.id)?.threadId).toBe(spawned.id);
  });
});

const SCRIPT_EXECUTION = {
  mode: "script" as const,
  scriptFile: "run.sh",
  interpreter: "bash" as const,
  timeoutMs: 30_000,
};

function seedScriptAutomation(): AutomationRow {
  return createAutomation(db, noopNotifier, {
    projectId,
    name: "Script test",
    enabled: true,
    triggerType: "schedule",
    triggerConfig: JSON.stringify({ cron: "0 9 * * *", timezone: "UTC" }),
    runMode: "script",
    execution: JSON.stringify(SCRIPT_EXECUTION),
    environment: JSON.stringify({
      type: "host",
      hostId,
      workspace: { type: "unmanaged", path: "/tmp/workspace" },
    }),
    autoArchive: false,
    origin: "agent",
    createdByThreadId: null,
    targetThreadId: null,
    nextRunAt: Date.now(),
  });
}

describe("executeScriptRun environment injection", () => {
  it("passes the bb environment vars in the host.run_script command env", async () => {
    const environmentRow = createEnvironment(db, noopNotifier, {
      projectId,
      hostId,
      path: "/tmp/workspace",
      workspaceProvisionType: "unmanaged",
      status: "ready",
    });
    const automation = seedScriptAutomation();
    const { run } = createManualRun(db, {
      automationId: automation.id,
      runMode: "script",
      now: Date.now(),
    });
    runLiveHostCommand.mockResolvedValue({
      exitCode: 0,
      output: "",
      durationMs: 1,
      timedOut: false,
    });
    const environment = {
      type: "host" as const,
      hostId,
      workspace: { type: "unmanaged" as const, path: "/tmp/workspace" },
    };

    await executeScriptRun(buildDeps(), {
      automation,
      run,
      execution: SCRIPT_EXECUTION,
      environment,
      onFailure: vi.fn(),
      now: Date.now(),
    });

    expect(runLiveHostCommand).toHaveBeenCalledTimes(1);
    const call = runLiveHostCommand.mock.calls[0]?.[1] as {
      command: { env: Record<string, string> };
    };
    expect(call.command.env).toMatchObject({
      BB_SERVER_URL: "http://127.0.0.1:38886",
      BB_HOST_DAEMON_PORT: "38887",
      BB_PROJECT_ID: projectId,
      BB_ENVIRONMENT_ID: environmentRow.id,
      BB_AUTOMATION_ID: automation.id,
      BB_AUTOMATION_RUN_ID: run.id,
    });
  });
});
