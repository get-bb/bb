import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier, type DbNotifier } from "../../src/notifier.js";
import { createProject } from "../../src/data/projects.js";
import { upsertHost } from "../../src/data/hosts.js";
import { automationRuns, threads } from "../../src/schema.js";
import {
  claimAutomationScheduledRun,
  closeAutomationRun,
  createAutomation,
  createManualRun,
  deleteAutomation,
  disableAutomationsForDeletedThread,
  getAutomation,
  getAutomationForProject,
  getRunningAutomationRunByThread,
  isAutomationSpawnedThread,
  listAutomationRuns,
  listDueAutomations,
  restoreAutomationAfterFailedRun,
  setAutomationEnabled,
  setAutomationRunThread,
  updateAutomation,
  type CreateAutomationInput,
} from "../../src/data/automations.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "auto-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "auto-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/auto" },
  });
  return { db, projectId: project.id };
}

function recordingNotifier() {
  const notes: { projectId: string; changes: string[] }[] = [];
  const notifier: DbNotifier = {
    ...noopNotifier,
    notifyProject(projectId, changes) {
      notes.push({ projectId, changes: [...changes] });
    },
  };
  return { notifier, notes };
}

function insertThread(db: ReturnType<typeof createConnection>, projectId: string, id: string) {
  const now = Date.now();
  db.insert(threads)
    .values({
      id,
      projectId,
      providerId: "codex",
      latestAttentionAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

function makeInput(
  projectId: string,
  overrides: Partial<CreateAutomationInput> = {},
): CreateAutomationInput {
  return {
    projectId,
    name: "Daily digest",
    enabled: true,
    triggerType: "schedule",
    triggerConfig: JSON.stringify({ cron: "0 9 * * 1-5", timezone: "America/New_York" }),
    runMode: "agent",
    execution: JSON.stringify({ mode: "agent", prompt: "go", providerId: "codex", model: "gpt-5", permissionMode: "readonly" }),
    environment: JSON.stringify({ type: "host", workspace: { type: "personal" } }),
    autoArchive: false,
    origin: "agent",
    createdByThreadId: null,
    targetThreadId: null,
    nextRunAt: 1_000,
    ...overrides,
  };
}

function makeOnceInput(
  projectId: string,
  overrides: Partial<CreateAutomationInput> = {},
): CreateAutomationInput {
  return makeInput(projectId, {
    triggerType: "once",
    triggerConfig: JSON.stringify({ runAt: 1_000 }),
    nextRunAt: 1_000,
    ...overrides,
  });
}

describe("automations data", () => {
  it("creates, scopes by project, lists, and notifies", () => {
    const { db, projectId } = setup();
    const { notifier, notes } = recordingNotifier();
    const created = createAutomation(db, notifier, makeInput(projectId));

    expect(created.id).toMatch(/^auto_/u);
    expect(created.runCount).toBe(0);
    expect(getAutomationForProject(db, { projectId, automationId: created.id })?.id).toBe(created.id);
    expect(getAutomationForProject(db, { projectId: "proj_other", automationId: created.id })).toBeNull();
    expect(notes).toEqual([{ projectId, changes: ["automations-changed"] }]);
  });

  it("updates config and toggles enabled (pause/resume)", () => {
    const { db, projectId } = setup();
    const created = createAutomation(db, noopNotifier, makeInput(projectId));

    const updated = updateAutomation(db, noopNotifier, {
      projectId,
      automationId: created.id,
      patch: { name: "Renamed", nextRunAt: 5_000 },
    });
    expect(updated?.name).toBe("Renamed");
    expect(updated?.nextRunAt).toBe(5_000);

    const paused = setAutomationEnabled(db, noopNotifier, {
      projectId,
      automationId: created.id,
      enabled: false,
      nextRunAt: null,
    });
    expect(paused?.enabled).toBe(false);
    expect(paused?.nextRunAt).toBeNull();

    const resumed = setAutomationEnabled(db, noopNotifier, {
      projectId,
      automationId: created.id,
      enabled: true,
      nextRunAt: 9_000,
    });
    expect(resumed?.enabled).toBe(true);
    expect(resumed?.nextRunAt).toBe(9_000);
  });

  it("deletes and cascades run history", () => {
    const { db, projectId } = setup();
    const created = createAutomation(db, noopNotifier, makeInput(projectId));
    createManualRun(db, { automationId: created.id, runMode: "agent", now: 1 });

    expect(deleteAutomation(db, noopNotifier, { projectId, automationId: created.id })).toBe(true);
    expect(getAutomation(db, created.id)).toBeNull();
    expect(
      db.select().from(automationRuns).where(eq(automationRuns.automationId, created.id)).all(),
    ).toHaveLength(0);
    expect(deleteAutomation(db, noopNotifier, { projectId, automationId: created.id })).toBe(false);
  });

  it("lists only due, enabled scheduled and one-shot automations", () => {
    const { db, projectId } = setup();
    const due = createAutomation(db, noopNotifier, makeInput(projectId, { nextRunAt: 1_000 }));
    const onceDue = createAutomation(
      db,
      noopNotifier,
      makeOnceInput(projectId, {
        triggerConfig: JSON.stringify({ runAt: 1_500 }),
        nextRunAt: 1_500,
      }),
    );
    createAutomation(db, noopNotifier, makeInput(projectId, { nextRunAt: 50_000 })); // future
    createAutomation(db, noopNotifier, makeInput(projectId, { enabled: false, nextRunAt: 1_000 })); // disabled
    createAutomation(db, noopNotifier, makeInput(projectId, { nextRunAt: null })); // paused

    const result = listDueAutomations(db, { now: 2_000, limit: 100 });
    expect(result.map((r) => r.id)).toEqual([due.id, onceDue.id]);
  });

  it("claims at-most-once (CAS): a second claim of the same expected value no-ops", () => {
    const { db, projectId } = setup();
    const a = createAutomation(db, noopNotifier, makeInput(projectId, { nextRunAt: 1_000 }));

    const first = claimAutomationScheduledRun(db, {
      automationId: a.id,
      expectedNextRunAt: 1_000,
      newNextRunAt: 2_000,
      now: 1_500,
    });
    const second = claimAutomationScheduledRun(db, {
      automationId: a.id,
      expectedNextRunAt: 1_000,
      newNextRunAt: 2_000,
      now: 1_600,
    });

    expect(first.advanced).toBe(true);
    expect(second.advanced).toBe(false);
    const row = getAutomation(db, a.id);
    expect(row?.nextRunAt).toBe(2_000);
    expect(row?.runCount).toBe(1);
    if (first.advanced) {
      expect(first.run.status).toBe("running");
      expect(first.run.trigger).toBe("schedule");
      expect(first.run.scheduledFor).toBe(1_000);
    }
  });

  it("claims a one-shot by disabling it and clearing nextRunAt", () => {
    const { db, projectId } = setup();
    const a = createAutomation(db, noopNotifier, makeOnceInput(projectId));

    const claim = claimAutomationScheduledRun(db, {
      automationId: a.id,
      expectedNextRunAt: 1_000,
      newNextRunAt: null,
      now: 1_500,
    });

    expect(claim.advanced).toBe(true);
    const row = getAutomation(db, a.id);
    expect(row?.enabled).toBe(false);
    expect(row?.nextRunAt).toBeNull();
    expect(row?.runCount).toBe(1);
  });

  it("records a skipped run while still advancing", () => {
    const { db, projectId } = setup();
    const a = createAutomation(db, noopNotifier, makeInput(projectId, { nextRunAt: 1_000 }));
    const claim = claimAutomationScheduledRun(db, {
      automationId: a.id,
      expectedNextRunAt: 1_000,
      newNextRunAt: 2_000,
      now: 1_500,
      skipReason: "open-thread",
    });
    expect(claim.advanced).toBe(true);
    if (claim.advanced) {
      expect(claim.run.status).toBe("skipped");
      expect(claim.run.skipReason).toBe("open-thread");
      expect(claim.run.finishedAt).toBe(1_500);
    }
    expect(getAutomation(db, a.id)?.nextRunAt).toBe(2_000);
  });

  it("restores after a failed spawn (rollback CAS) and marks the run failed", () => {
    const { db, projectId } = setup();
    const a = createAutomation(db, noopNotifier, makeInput(projectId, { nextRunAt: 1_000 }));
    const claim = claimAutomationScheduledRun(db, {
      automationId: a.id,
      expectedNextRunAt: 1_000,
      newNextRunAt: 2_000,
      now: 1_500,
    });
    if (!claim.advanced) throw new Error("expected claim");

    restoreAutomationAfterFailedRun(db, {
      automationId: a.id,
      runId: claim.run.id,
      advancedNextRunAt: 2_000,
      restoredNextRunAt: 1_000,
      expectedRunCount: 1,
      error: "spawn failed",
      now: 1_700,
    });

    const row = getAutomation(db, a.id);
    expect(row?.enabled).toBe(true);
    expect(row?.nextRunAt).toBe(1_000);
    expect(row?.runCount).toBe(0);
    expect(row?.lastError).toBe("spawn failed");
    const run = db.select().from(automationRuns).where(eq(automationRuns.id, claim.run.id)).get();
    expect(run?.status).toBe("failed");
  });

  it("closes a run and denormalizes the summary", () => {
    const { db, projectId } = setup();
    const a = createAutomation(db, noopNotifier, makeInput(projectId, { nextRunAt: 1_000 }));
    const claim = claimAutomationScheduledRun(db, {
      automationId: a.id,
      expectedNextRunAt: 1_000,
      newNextRunAt: 2_000,
      now: 1_500,
    });
    if (!claim.advanced) throw new Error("expected claim");

    const closed = closeAutomationRun(db, {
      runId: claim.run.id,
      status: "succeeded",
      output: "Disk at 92%",
      exitCode: 0,
      now: 1_900,
    });
    expect(closed?.run.status).toBe("succeeded");
    expect(closed?.run.output).toBe("Disk at 92%");
    expect(getAutomation(db, a.id)?.lastRunStatus).toBe("succeeded");
  });

  it("dedupes manual runs by idempotency key", () => {
    const { db, projectId } = setup();
    const a = createAutomation(db, noopNotifier, makeInput(projectId));
    const first = createManualRun(db, { automationId: a.id, runMode: "script", idempotencyKey: "k1", now: 1 });
    const second = createManualRun(db, { automationId: a.id, runMode: "script", idempotencyKey: "k1", now: 2 });
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.run.id).toBe(first.run.id);
    expect(listAutomationRuns(db, { automationId: a.id, limit: 10 })).toHaveLength(1);
  });

  it("lists runs newest-first", () => {
    const { db, projectId } = setup();
    const a = createAutomation(db, noopNotifier, makeInput(projectId));
    createManualRun(db, { automationId: a.id, runMode: "agent", now: 100 });
    createManualRun(db, { automationId: a.id, runMode: "agent", now: 200 });
    const runs = listAutomationRuns(db, { automationId: a.id, limit: 10 });
    expect(runs.map((r) => r.startedAt)).toEqual([200, 100]);
  });

  it("disables (not deletes) automations whose target thread is deleted", () => {
    const { db, projectId } = setup();
    const threadId = insertThread(db, projectId, "thr_target");
    const a = createAutomation(db, noopNotifier, makeInput(projectId, { targetThreadId: threadId }));

    const disabled = disableAutomationsForDeletedThread(db, { threadId, now: 5_000 });
    expect(disabled.map((r) => r.id)).toEqual([a.id]);
    const row = getAutomation(db, a.id);
    expect(row?.enabled).toBe(false);
    expect(row?.nextRunAt).toBeNull();
    expect(row?.lastError).toBe("target thread deleted");
    // the automation survives (disabled, not removed)
    expect(getAutomation(db, a.id)).not.toBeNull();
  });

  it("nulls target_thread_id when the thread row is hard-deleted (FK backstop)", () => {
    const { db, projectId } = setup();
    const threadId = insertThread(db, projectId, "thr_fk");
    const a = createAutomation(db, noopNotifier, makeInput(projectId, { targetThreadId: threadId }));
    db.delete(threads).where(eq(threads.id, threadId)).run();
    expect(getAutomation(db, a.id)?.targetThreadId).toBeNull();
  });

  it("links a spawned thread to a running run and finds it by thread", () => {
    const { db, projectId } = setup();
    const threadId = insertThread(db, projectId, "thr_agent");
    const automation = createAutomation(db, noopNotifier, makeInput(projectId));
    const claim = claimAutomationScheduledRun(db, {
      automationId: automation.id,
      expectedNextRunAt: 1_000,
      newNextRunAt: 2_000,
      now: 1_500,
    });
    expect(claim.advanced).toBe(true);
    if (!claim.advanced) {
      throw new Error("expected claim to advance");
    }

    // No link yet => not found by thread.
    expect(getRunningAutomationRunByThread(db, threadId)).toBeNull();

    setAutomationRunThread(db, { runId: claim.run.id, threadId });
    const linked = getRunningAutomationRunByThread(db, threadId);
    expect(linked?.id).toBe(claim.run.id);
    expect(linked?.status).toBe("running");

    // Once closed, it is no longer returned as running.
    closeAutomationRun(db, {
      runId: claim.run.id,
      status: "succeeded",
      threadId,
      now: 3_000,
    });
    expect(getRunningAutomationRunByThread(db, threadId)).toBeNull();
  });

  it("createAutomation honors a pre-generated id", () => {
    const { db, projectId } = setup();
    const created = createAutomation(
      db,
      noopNotifier,
      makeInput(projectId, { id: "auto_preset" }),
    );
    expect(created.id).toBe("auto_preset");
    expect(getAutomationForProject(db, { projectId, automationId: "auto_preset" })?.id).toBe(
      "auto_preset",
    );
  });

  it("isAutomationSpawnedThread is true only for threads linked to a run", () => {
    const { db, projectId } = setup();
    const spawnedThreadId = insertThread(db, projectId, "thr_spawned");
    const unrelatedThreadId = insertThread(db, projectId, "thr_unrelated");
    const automation = createAutomation(db, noopNotifier, makeInput(projectId));
    const { run } = createManualRun(db, {
      automationId: automation.id,
      runMode: "agent",
      now: 1_000,
    });

    // No run links to it yet.
    expect(isAutomationSpawnedThread(db, spawnedThreadId)).toBe(false);

    setAutomationRunThread(db, { runId: run.id, threadId: spawnedThreadId });
    expect(isAutomationSpawnedThread(db, spawnedThreadId)).toBe(true);
    // Linkage persists even after the run is closed (history is not erased).
    closeAutomationRun(db, {
      runId: run.id,
      status: "succeeded",
      threadId: spawnedThreadId,
      now: 2_000,
    });
    expect(isAutomationSpawnedThread(db, spawnedThreadId)).toBe(true);
    expect(isAutomationSpawnedThread(db, unrelatedThreadId)).toBe(false);
  });
});
