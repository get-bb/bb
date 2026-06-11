import { describe, expect, it } from "vitest";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import {
  createWorkflowRun,
  type CreateWorkflowRunInput,
} from "../../src/data/workflow-runs.js";
import {
  cancelWorkflowRunOperationRecord,
  getWorkflowRunOperation,
  getWorkflowRunOperationByCommandId,
  listWorkflowRunOperations,
  markWorkflowRunOperationRecordCompleted,
  markWorkflowRunOperationRecordFailed,
  markWorkflowRunOperationRecordQueued,
  upsertWorkflowRunOperationRecord,
} from "../../src/data/workflow-run-operations.js";

function buildCreateInput(args: {
  hostId: string;
  projectId: string;
}): CreateWorkflowRunInput {
  return {
    anchorThreadId: null,
    argsJson: null,
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
    sourceTier: "builtin",
    workflowName: "deep-research",
    workspacePath: "/tmp/test",
  };
}

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
  const run = createWorkflowRun(
    db,
    buildCreateInput({ hostId: host.id, projectId: project.id }),
  );
  return { db, host, run };
}

describe("workflow run operations", () => {
  it("upserts by run and kind, resetting the existing row in place", () => {
    const { db, run } = setup();

    const first = upsertWorkflowRunOperationRecord(db, {
      runId: run.id,
      kind: "start",
      payload: JSON.stringify({ type: "workflow.start" }),
      requestedAt: 111,
    });
    const second = upsertWorkflowRunOperationRecord(db, {
      runId: run.id,
      kind: "start",
      payload: JSON.stringify({ type: "workflow.start", attempt: 2 }),
      requestedAt: 222,
    });

    expect(first.id).toMatch(/^wfop_/);
    expect(first).toMatchObject({
      runId: run.id,
      kind: "start",
      state: "requested",
      requestedAt: 111,
      commandId: null,
    });
    expect(second).toMatchObject({
      id: first.id,
      payload: JSON.stringify({ type: "workflow.start", attempt: 2 }),
      state: "requested",
    });
    expect(listWorkflowRunOperations(db, { runIds: [run.id] })).toHaveLength(1);
  });

  it("keeps start, cancel, and resume as separate operation rows on one run", () => {
    const { db, run } = setup();

    upsertWorkflowRunOperationRecord(db, {
      runId: run.id,
      kind: "start",
      payload: "{}",
    });
    upsertWorkflowRunOperationRecord(db, {
      runId: run.id,
      kind: "cancel",
      payload: "{}",
    });
    upsertWorkflowRunOperationRecord(db, {
      runId: run.id,
      kind: "resume",
      payload: "{}",
    });

    expect(
      listWorkflowRunOperations(db, { runIds: [run.id] })
        .map((operation) => operation.kind)
        .sort(),
    ).toEqual(["cancel", "resume", "start"]);
    expect(
      listWorkflowRunOperations(db, { runIds: [run.id], kinds: ["resume"] }),
    ).toHaveLength(1);
  });

  it("records queued and completed operations addressable by command id", () => {
    const { db, run } = setup();
    const commandId = "rpc_workflow_op_test";

    upsertWorkflowRunOperationRecord(db, {
      runId: run.id,
      kind: "start",
      payload: "{}",
    });
    const queued = markWorkflowRunOperationRecordQueued(db, {
      runId: run.id,
      kind: "start",
      commandId: commandId,
      queuedAt: 333,
    });
    expect(queued).toMatchObject({
      state: "queued",
      commandId: commandId,
      queuedAt: 333,
    });
    expect(getWorkflowRunOperationByCommandId(db, commandId)?.id).toBe(
      queued?.id,
    );

    const completed = markWorkflowRunOperationRecordCompleted(db, {
      runId: run.id,
      kind: "start",
      completedAt: 444,
    });
    expect(completed).toMatchObject({
      state: "completed",
      completedAt: 444,
      failureReason: null,
    });
  });

  it("marks active operations failed with a reason", () => {
    const { db, run } = setup();

    upsertWorkflowRunOperationRecord(db, {
      runId: run.id,
      kind: "resume",
      payload: "{}",
    });
    const failed = markWorkflowRunOperationRecordFailed(db, {
      runId: run.id,
      kind: "resume",
      failureReason: "journal_fetch_failed",
    });
    expect(failed).toMatchObject({
      state: "failed",
      failureReason: "journal_fetch_failed",
    });
  });

  it("never moves terminal operations back to queued or cancelled", () => {
    const { db, run } = setup();
    const commandId = "rpc_workflow_op_test";

    upsertWorkflowRunOperationRecord(db, {
      runId: run.id,
      kind: "cancel",
      payload: "{}",
    });
    markWorkflowRunOperationRecordCompleted(db, {
      runId: run.id,
      kind: "cancel",
    });

    expect(
      markWorkflowRunOperationRecordQueued(db, {
        runId: run.id,
        kind: "cancel",
        commandId: commandId,
      }),
    ).toBeNull();
    expect(
      cancelWorkflowRunOperationRecord(db, { runId: run.id, kind: "cancel" }),
    ).toBeNull();
    expect(
      getWorkflowRunOperation(db, { runId: run.id, kind: "cancel" }),
    ).toMatchObject({ state: "completed", commandId: null });
  });

  it("filters operation lists by state for the lifecycle sweep", () => {
    const { db, run } = setup();

    upsertWorkflowRunOperationRecord(db, {
      runId: run.id,
      kind: "start",
      payload: "{}",
    });
    upsertWorkflowRunOperationRecord(db, {
      runId: run.id,
      kind: "cancel",
      payload: "{}",
    });
    markWorkflowRunOperationRecordCompleted(db, {
      runId: run.id,
      kind: "cancel",
    });

    expect(
      listWorkflowRunOperations(db, { states: ["requested", "queued"] }).map(
        (operation) => operation.kind,
      ),
    ).toEqual(["start"]);
  });
});
