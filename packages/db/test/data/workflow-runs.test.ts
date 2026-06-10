import { describe, expect, it } from "vitest";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import {
  createWorkflowRun,
  getWorkflowRun,
  InvalidWorkflowRunStatusTransitionError,
  listWorkflowRuns,
  listWorkflowRunsByHostAndStatuses,
  markWorkflowRunUserArchived,
  markWorkflowRunUserDeleted,
  settleWorkflowRunInTransaction,
  transitionWorkflowRunStatusInTransaction,
  updateWorkflowRunProgressSnapshotInTransaction,
  type CreateWorkflowRunInput,
  type WorkflowRunRow,
} from "../../src/data/workflow-runs.js";
import type { DbConnection } from "../../src/connection.js";
import type {
  TransitionableWorkflowRunStatus,
  WorkflowRunUsageTotals,
} from "../../src/data/workflow-runs.js";
import type { WorkflowRunTerminalStatus } from "@bb/domain";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  return { db, host, project };
}

function buildCreateInput(args: {
  hostId: string;
  projectId: string;
}): CreateWorkflowRunInput {
  return {
    anchorThreadId: null,
    argsJson: JSON.stringify({ topic: "x" }),
    clientRequestId: null,
    budgetOutputTokens: null,
    concurrency: 4,
    effort: "medium",
    hostId: args.hostId,
    keyVersion: "bb1",
    maxAgents: 40,
    maxFanout: 10,
    model: null,
    projectId: args.projectId,
    providerId: "fake-provider",
    sandbox: "read-only",
    sandboxCeiling: "workspace-write",
    scriptHash: "hash123",
    scriptSource: "export const meta = { name: 'x', description: 'y' };",
    seed: 42,
    sourceTier: "project",
    workflowName: "deep-research",
    workspacePath: "/tmp/test",
  };
}

function transition(
  db: DbConnection,
  args: {
    failureReason?: string | null;
    id: string;
    newStatus: TransitionableWorkflowRunStatus;
  },
): WorkflowRunRow {
  return db.transaction(
    (tx) => transitionWorkflowRunStatusInTransaction(tx, args),
    { behavior: "immediate" },
  );
}

const zeroUsage: WorkflowRunUsageTotals = {
  durationMs: 0,
  inputTokens: 0,
  outputTokens: 0,
  toolUses: 0,
};

function settle(
  db: DbConnection,
  args: {
    failureReason?: string | null;
    id: string;
    resultJson?: string | null;
    settledAt?: number;
    status: WorkflowRunTerminalStatus;
    usage?: WorkflowRunUsageTotals;
  },
): WorkflowRunRow {
  return db.transaction(
    (tx) =>
      settleWorkflowRunInTransaction(tx, {
        id: args.id,
        status: args.status,
        failureReason: args.failureReason ?? null,
        resultJson: args.resultJson ?? null,
        settledAt: args.settledAt,
        usage: args.usage ?? zeroUsage,
      }),
    { behavior: "immediate" },
  );
}

describe("workflow runs", () => {
  it("creates runs with the fixed initial lifecycle state", () => {
    const { db, host, project } = setup();

    const run = createWorkflowRun(
      db,
      buildCreateInput({ hostId: host.id, projectId: project.id }),
    );

    expect(run.id).toMatch(/^wfr_/);
    expect(run).toMatchObject({
      status: "created",
      retention: "live",
      failureReason: null,
      progressSnapshot: null,
      resultJson: null,
      usageInputTokens: 0,
      usageOutputTokens: 0,
      usageToolUses: 0,
      usageDurationMs: 0,
      startedAt: null,
      settledAt: null,
      anchorThreadId: null,
      budgetOutputTokens: null,
      model: null,
    });
    expect(getWorkflowRun(db, run.id)).toEqual(run);
  });

  it("walks created → starting → running and sets startedAt once", () => {
    const { db, host, project } = setup();
    const run = createWorkflowRun(
      db,
      buildCreateInput({ hostId: host.id, projectId: project.id }),
    );

    const starting = transition(db, { id: run.id, newStatus: "starting" });
    expect(starting.status).toBe("starting");
    expect(starting.startedAt).toBeNull();

    const running = transition(db, { id: run.id, newStatus: "running" });
    expect(running.status).toBe("running");
    expect(running.startedAt).not.toBeNull();

    const interrupted = transition(db, {
      id: run.id,
      newStatus: "interrupted",
      failureReason: "host-daemon-restarted",
    });
    expect(interrupted).toMatchObject({
      status: "interrupted",
      failureReason: "host-daemon-restarted",
      startedAt: running.startedAt,
    });

    // Revival clears the failure reason and keeps the original startedAt.
    const revived = transition(db, {
      id: run.id,
      newStatus: "running",
      failureReason: null,
    });
    expect(revived).toMatchObject({
      status: "running",
      failureReason: null,
      startedAt: running.startedAt,
    });
  });

  it("rejects transitions the table forbids", () => {
    const { db, host, project } = setup();
    const run = createWorkflowRun(
      db,
      buildCreateInput({ hostId: host.id, projectId: project.id }),
    );

    expect(() => transition(db, { id: run.id, newStatus: "running" })).toThrow(
      InvalidWorkflowRunStatusTransitionError,
    );
    expect(() =>
      settle(db, { id: run.id, status: "completed" }),
    ).toThrow(InvalidWorkflowRunStatusTransitionError);
    expect(getWorkflowRun(db, run.id)?.status).toBe("created");
  });

  it("settles a running run with result, usage, and settledAt — then never changes again", () => {
    const { db, host, project } = setup();
    const run = createWorkflowRun(
      db,
      buildCreateInput({ hostId: host.id, projectId: project.id }),
    );
    transition(db, { id: run.id, newStatus: "starting" });
    transition(db, { id: run.id, newStatus: "running" });

    const settled = settle(db, {
      id: run.id,
      status: "completed",
      resultJson: JSON.stringify({ summary: "ok" }),
      settledAt: 12345,
      usage: { inputTokens: 100, outputTokens: 20, toolUses: 7, durationMs: 9000 },
    });
    expect(settled).toMatchObject({
      status: "completed",
      resultJson: JSON.stringify({ summary: "ok" }),
      settledAt: 12345,
      usageInputTokens: 100,
      usageOutputTokens: 20,
      usageToolUses: 7,
      usageDurationMs: 9000,
    });

    // Terminal statuses are immutable: no re-settle, no revival, no interrupt.
    expect(() =>
      settle(db, { id: run.id, status: "failed", failureReason: "late" }),
    ).toThrow(InvalidWorkflowRunStatusTransitionError);
    expect(() =>
      transition(db, { id: run.id, newStatus: "running" }),
    ).toThrow(InvalidWorkflowRunStatusTransitionError);
    expect(getWorkflowRun(db, run.id)?.status).toBe("completed");
  });

  it("supports the interrupted lifecycle: resume restart and late real-outcome supersede", () => {
    const { db, host, project } = setup();
    const input = buildCreateInput({ hostId: host.id, projectId: project.id });

    // interrupted → starting (resume).
    const resumable = createWorkflowRun(db, input);
    transition(db, { id: resumable.id, newStatus: "starting" });
    transition(db, { id: resumable.id, newStatus: "running" });
    transition(db, {
      id: resumable.id,
      newStatus: "interrupted",
      failureReason: "host-daemon-restarted",
    });
    expect(
      transition(db, { id: resumable.id, newStatus: "starting" }).status,
    ).toBe("starting");

    // interrupted → failed (late spooled terminal event supersedes).
    const superseded = createWorkflowRun(db, input);
    transition(db, { id: superseded.id, newStatus: "starting" });
    transition(db, { id: superseded.id, newStatus: "running" });
    transition(db, {
      id: superseded.id,
      newStatus: "interrupted",
      failureReason: "host-daemon-restarted",
    });
    expect(
      settle(db, {
        id: superseded.id,
        status: "failed",
        failureReason: "budget exceeded",
      }),
    ).toMatchObject({ status: "failed", failureReason: "budget exceeded" });

    // interrupted → cancelled is the explicit user-cancel edge (M4): the
    // lifecycle module settles an abandoned interrupted run server-side.
    // (Ingestion still keeps late spooled run/cancelled events history-only —
    // that exclusion lives in its guard, not this table.)
    const interrupted = createWorkflowRun(db, input);
    transition(db, { id: interrupted.id, newStatus: "starting" });
    transition(db, { id: interrupted.id, newStatus: "running" });
    transition(db, {
      id: interrupted.id,
      newStatus: "interrupted",
      failureReason: "host-daemon-restarted",
    });
    expect(
      settle(db, { id: interrupted.id, status: "cancelled" }),
    ).toMatchObject({ status: "cancelled" });
  });

  it("folds progress snapshots only while the run is not terminal", () => {
    const { db, host, project } = setup();
    const run = createWorkflowRun(
      db,
      buildCreateInput({ hostId: host.id, projectId: project.id }),
    );
    transition(db, { id: run.id, newStatus: "starting" });
    transition(db, { id: run.id, newStatus: "running" });

    const snapshot = JSON.stringify({ phases: [], agents: [] });
    const updated = db.transaction(
      (tx) =>
        updateWorkflowRunProgressSnapshotInTransaction(tx, {
          id: run.id,
          progressSnapshot: snapshot,
        }),
      { behavior: "immediate" },
    );
    expect(updated?.progressSnapshot).toBe(snapshot);

    settle(db, { id: run.id, status: "cancelled" });
    const afterSettle = db.transaction(
      (tx) =>
        updateWorkflowRunProgressSnapshotInTransaction(tx, {
          id: run.id,
          progressSnapshot: JSON.stringify({ phases: [], agents: [{}] }),
        }),
      { behavior: "immediate" },
    );
    expect(afterSettle).toBeNull();
    expect(getWorkflowRun(db, run.id)?.progressSnapshot).toBe(snapshot);
  });

  it("answers the reconciliation bucket queries in SQL", () => {
    const { db, host, project } = setup();
    const otherHost = upsertHost(db, noopNotifier, {
      name: "other-host",
      type: "persistent",
    });
    const input = buildCreateInput({ hostId: host.id, projectId: project.id });

    const reportedRunning = createWorkflowRun(db, input);
    const unreportedRunning = createWorkflowRun(db, input);
    const reportedInterrupted = createWorkflowRun(db, input);
    const reportedCompleted = createWorkflowRun(db, input);
    const otherHostRunning = createWorkflowRun(db, {
      ...input,
      hostId: otherHost.id,
    });

    for (const id of [
      reportedRunning.id,
      unreportedRunning.id,
      reportedInterrupted.id,
      reportedCompleted.id,
      otherHostRunning.id,
    ]) {
      transition(db, { id, newStatus: "starting" });
      transition(db, { id, newStatus: "running" });
    }
    transition(db, {
      id: reportedInterrupted.id,
      newStatus: "interrupted",
      failureReason: "host-daemon-restarted",
    });
    settle(db, { id: reportedCompleted.id, status: "completed" });

    const reported = [
      reportedRunning.id,
      reportedInterrupted.id,
      reportedCompleted.id,
    ];

    // Bucket (b): running but not reported → interrupt.
    expect(
      listWorkflowRunsByHostAndStatuses(db, {
        hostId: host.id,
        statuses: ["running"],
        excludeRunIds: reported,
      }).map((run) => run.id),
    ).toEqual([unreportedRunning.id]);

    // Bucket (c): interrupted and reported → revive.
    expect(
      listWorkflowRunsByHostAndStatuses(db, {
        hostId: host.id,
        statuses: ["interrupted"],
        runIds: reported,
      }).map((run) => run.id),
    ).toEqual([reportedInterrupted.id]);

    // Bucket (d): terminal and reported → cancel.
    expect(
      listWorkflowRunsByHostAndStatuses(db, {
        hostId: host.id,
        statuses: ["completed", "failed", "cancelled"],
        runIds: reported,
      }).map((run) => run.id),
    ).toEqual([reportedCompleted.id]);

    // Empty reported set: every running run on the host is unreported.
    expect(
      listWorkflowRunsByHostAndStatuses(db, {
        hostId: host.id,
        statuses: ["running"],
        excludeRunIds: [],
      })
        .map((run) => run.id)
        .sort(),
    ).toEqual([reportedRunning.id, unreportedRunning.id].sort());

    // Restricting to an empty reported set matches nothing.
    expect(
      listWorkflowRunsByHostAndStatuses(db, {
        hostId: host.id,
        statuses: ["running"],
        runIds: [],
      }),
    ).toEqual([]);

    expect(
      listWorkflowRunsByHostAndStatuses(db, {
        hostId: host.id,
        statuses: [],
      }),
    ).toEqual([]);
  });

  it("lists project runs newest-first", () => {
    const { db, host, project } = setup();
    const input = buildCreateInput({ hostId: host.id, projectId: project.id });
    const first = createWorkflowRun(db, input);
    const second = createWorkflowRun(db, input);

    const rows = listWorkflowRuns(db, { projectId: project.id });
    expect(rows.map((run) => run.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(rows[0].createdAt).toBeGreaterThanOrEqual(rows[1].createdAt);
    expect(
      listWorkflowRuns(db, { projectId: project.id, limit: 1 }),
    ).toHaveLength(1);
  });

  it("excludes user-archived and user-deleted runs from lists but keeps rows", () => {
    const { db, host, project } = setup();
    const input = buildCreateInput({ hostId: host.id, projectId: project.id });
    const archived = createWorkflowRun(db, input);
    const deleted = createWorkflowRun(db, input);
    const visible = createWorkflowRun(db, input);

    markWorkflowRunUserArchived(db, { id: archived.id });
    markWorkflowRunUserDeleted(db, { id: deleted.id });

    const projectRows = listWorkflowRuns(db, { projectId: project.id });
    expect(projectRows.map((run) => run.id)).toEqual([visible.id]);
    const globalRows = listWorkflowRuns(db, { projectId: null });
    expect(globalRows.map((run) => run.id)).toEqual([visible.id]);

    // Soft flags only: the rows (and their sweep eligibility) survive.
    expect(getWorkflowRun(db, archived.id)?.archivedAt).not.toBeNull();
    expect(getWorkflowRun(db, deleted.id)?.deletedAt).not.toBeNull();
  });

  it("keeps the first archive/delete timestamp on repeat calls", () => {
    const { db, host, project } = setup();
    const input = buildCreateInput({ hostId: host.id, projectId: project.id });
    const run = createWorkflowRun(db, input);

    markWorkflowRunUserArchived(db, { id: run.id });
    const archivedAt = getWorkflowRun(db, run.id)?.archivedAt;
    markWorkflowRunUserArchived(db, { id: run.id });
    expect(getWorkflowRun(db, run.id)?.archivedAt).toBe(archivedAt);

    markWorkflowRunUserDeleted(db, { id: run.id });
    const deletedAt = getWorkflowRun(db, run.id)?.deletedAt;
    markWorkflowRunUserDeleted(db, { id: run.id });
    expect(getWorkflowRun(db, run.id)?.deletedAt).toBe(deletedAt);
  });
});
