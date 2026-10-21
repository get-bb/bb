import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import {
  createAutomation,
  createManualRun,
  getAutomationRun,
  getRunningAutomationRun,
  migrations,
  setAutomationRunThread,
  type Db,
} from "./data.js";
import {
  closeAutomationRunForSettledThread,
  reconcileRunningAutomationRuns,
} from "./run.js";
import {
  checkpointManagedRun,
  attachManagedCoordinator,
  controlManagedRun,
  createManagedSupervisor,
  initializeManagedRun,
  managedRun,
  workflow,
  type ManagedApi,
} from "./managed.js";

const databases: Db[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.restoreAllMocks();
});
function fixture() {
  const db = new Database(":memory:");
  databases.push(db);
  for (const migration of migrations) db.exec(migration);
  const automation = createAutomation(db, {
    id: "daily",
    projectId: "project",
    name: "Daily factory",
    enabled: true,
    trigger: {
      triggerType: "schedule",
      cron: "0 0 * * *",
      timezone: "Africa/Johannesburg",
    },
    runMode: "agent",
    execution: {
      mode: "agent",
      workflow: "managed",
      prompt: "Coordinate {{runId}}",
      providerId: "codex",
      model: "gpt-6-luna",
      reasoningLevel: "max",
      permissionMode: "auto",
      environment: { type: "reuse", environmentId: "environment" },
    },
    origin: "human",
    createdByThreadId: null,
    nextRunAt: Date.now(),
  });
  const { run } = createManualRun(db, {
    automationId: automation.id,
    runMode: "agent",
    now: Date.now(),
  });
  initializeManagedRun(db, run.id);
  setAutomationRunThread(db, { runId: run.id, threadId: "parent" });
  const parent = makeThreadResponse({
    id: "parent",
    projectId: "project",
    status: "active",
  });
  const child = makeThreadResponse({
    id: "child",
    projectId: "project",
    parentThreadId: "parent",
    status: "active",
  });
  let sends = 0;
  let rejectSend = false;
  const bb: ManagedApi = {
    realtime: { publish: () => undefined },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    sdk: {
      threads: {
        get: async ({ threadId }) => (threadId === "parent" ? parent : child),
        send: async () => {
          sends++;
          if (rejectSend) throw new Error("lost acknowledgement");
          parent.status = "active";
          return {};
        },
        interactions: { list: async () => [] },
      },
    },
  };
  const checkpoint = (
    state: "running" | "paused" | "blocked" | "succeeded",
    waitFor: string | null = null,
    wakeAt: number | null = null,
  ) =>
    checkpointManagedRun(bb, db, {
      projectId: "project",
      runId: run.id,
      threadId: "parent",
      revision: workflow(getAutomationRun(db, run.id)!)!.revision,
      state,
      waitFor,
      wakeAt,
      summary: state,
    });
  return {
    db,
    bb,
    parent,
    child,
    run,
    checkpoint,
    sends: () => sends,
    loseAck: () => {
      rejectSend = true;
    },
  };
}

describe("managed daily run lifecycle", () => {
  it("attaches a lost initial acknowledgement only with exact run metadata and never replaces an owner", async () => {
    const f = fixture();
    f.db
      .prepare("UPDATE automation_runs SET thread_id = NULL WHERE id = ?")
      .run(f.run.id);
    let managedRunId = "unrelated-run";
    const bb = {
      ...f.bb,
      sdk: {
        threads: {
          ...f.bb.sdk.threads,
          getPluginMetadata: async () => ({ managedRunId }),
        },
      },
    };
    const input = { projectId: "project", runId: f.run.id, threadId: "parent" };
    await expect(attachManagedCoordinator(bb, f.db, input)).rejects.toThrow(
      "exact managed run",
    );
    expect(getAutomationRun(f.db, f.run.id)!.threadId).toBeNull();
    managedRunId = f.run.id;
    await attachManagedCoordinator(bb, f.db, input);
    expect(getAutomationRun(f.db, f.run.id)!.threadId).toBe("parent");
    await expect(attachManagedCoordinator(bb, f.db, input)).rejects.toThrow(
      "unacknowledged",
    );
    expect(f.sends()).toBe(0);
  });
  it("keeps a parent's idle turn open until its child settles, then resumes that parent once", async () => {
    const f = fixture();
    await f.checkpoint("running", "child");
    f.parent.status = "idle";
    closeAutomationRunForSettledThread(f.bb, f.db, {
      threadId: "parent",
      status: "idle",
    });
    const supervisor = createManagedSupervisor(f.bb, f.db);
    await supervisor.sweep();
    expect(getAutomationRun(f.db, f.run.id)!.finishedAt).toBeNull();
    expect(f.sends()).toBe(0);
    f.child.status = "idle";
    await Promise.all([supervisor.threadSettled("child"), supervisor.sweep()]);
    expect(f.sends()).toBe(1);
    expect(getAutomationRun(f.db, f.run.id)!.threadId).toBe("parent");
    await supervisor.sweep();
    expect(f.sends()).toBe(1);
    await f.checkpoint("succeeded");
    expect(getAutomationRun(f.db, f.run.id)!.status).toBe("succeeded");
  });
  it("keeps paused ownership across restart and resumes the same run without a new scheduled row", async () => {
    const f = fixture();
    await f.checkpoint("running", "child");
    controlManagedRun(f.bb, f.db, "daily", "pause");
    await expect(f.checkpoint("paused")).rejects.toThrow("quiescent");
    f.child.status = "idle";
    await f.checkpoint("paused");
    f.parent.status = "idle";
    const supervisor = createManagedSupervisor(f.bb, f.db);
    await supervisor.sweep();
    expect(getRunningAutomationRun(f.db, "daily")!.id).toBe(f.run.id);
    expect(
      createManualRun(f.db, {
        automationId: "daily",
        runMode: "agent",
        now: Date.now(),
      }).deduped,
    ).toBe(true);
    expect(f.sends()).toBe(0);
    controlManagedRun(f.bb, f.db, "daily", "resume");
    await supervisor.sweep();
    expect(f.sends()).toBe(1);
    expect(getAutomationRun(f.db, f.run.id)!.threadId).toBe("parent");
  });
  it("rejects stale checkpoints and waits on children belonging to another coordinator", async () => {
    const f = fixture();
    f.child.parentThreadId = "another-parent";
    await expect(f.checkpoint("running", "child")).rejects.toThrow(
      "direct child",
    );
    const revision = workflow(getAutomationRun(f.db, f.run.id)!)!.revision;
    controlManagedRun(f.bb, f.db, "daily", "pause");
    await expect(
      checkpointManagedRun(f.bb, f.db, {
        projectId: "project",
        runId: f.run.id,
        threadId: "parent",
        revision,
        state: "running",
        summary: "stale",
        waitFor: null,
        wakeAt: 0,
      }),
    ).rejects.toThrow("changed");
    expect(() =>
      managedRun(f.db, { projectId: "other", runId: f.run.id }),
    ).toThrow("not found");
  });
  it("does not compete with a queued native provider retry", async () => {
    const f = fixture();
    await f.checkpoint("running", "child");
    f.parent.status = "idle";
    f.child.status = "error";
    f.child.queuedMessageCount = 1;
    await createManagedSupervisor(f.bb, f.db).sweep();
    expect(f.sends()).toBe(0);
    expect(getAutomationRun(f.db, f.run.id)!.status).toBe("running");
    f.child.queuedMessageCount = 0;
    f.child.status = "idle";
    await createManagedSupervisor(f.bb, f.db).sweep();
    expect(f.sends()).toBe(1);
  });
  it("preserves an ambiguous continuation instead of sending it again after restart or resume", async () => {
    const f = fixture();
    await f.checkpoint("running", null, 0);
    f.parent.status = "idle";
    f.loseAck();
    await createManagedSupervisor(f.bb, f.db).sweep();
    expect(getAutomationRun(f.db, f.run.id)!.status).toBe("blocked");
    await createManagedSupervisor(f.bb, f.db).sweep();
    expect(f.sends()).toBe(1);
    expect(() => controlManagedRun(f.bb, f.db, "daily", "resume")).toThrow(
      "uncertain",
    );
  });
  it("startup and idle reconciliation leave managed status under its explicit lifecycle", async () => {
    const f = fixture();
    await f.checkpoint("running", null, Date.now() + 60_000);
    f.parent.status = "idle";
    await reconcileRunningAutomationRuns(
      {
        ...f.bb,
        sdk: { threads: { ...f.bb.sdk.threads, spawn: async () => f.parent } },
      },
      f.db,
    );
    closeAutomationRunForSettledThread(f.bb, f.db, {
      threadId: "parent",
      status: "failed",
      error: "temporary",
    });
    expect(getAutomationRun(f.db, f.run.id)!.status).toBe("running");
    expect(getAutomationRun(f.db, f.run.id)!.finishedAt).toBeNull();
  });
});
