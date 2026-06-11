import { describe, expect, it } from "vitest";
import { createConnection, type DbConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import { ProducerEventPayloadMismatchError } from "../../src/data/workflow-run-events.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import {
  appendWorkflowRunEventsInTransaction,
  hasWorkflowRunEventsSince,
  listWorkflowRunEvents,
  type AppendWorkflowRunEventInput,
  type AppendWorkflowRunEventsResult,
} from "../../src/data/workflow-run-events.js";
import {
  createWorkflowRun,
  type CreateWorkflowRunInput,
} from "../../src/data/workflow-runs.js";

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
    sourceTier: "user",
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
  const input = buildCreateInput({ hostId: host.id, projectId: project.id });
  const run = createWorkflowRun(db, input);
  const otherRun = createWorkflowRun(db, input);
  return { db, otherRun, run };
}

let producerEventCounter = 0;
function nextProducerEventId(): string {
  producerEventCounter += 1;
  return `hdevt_${String(producerEventCounter).padStart(20, "2")}`;
}

function buildInput(args: {
  agentIndex?: number | null;
  producerEventId?: string;
  runId: string;
  type?: AppendWorkflowRunEventInput["type"];
}): AppendWorkflowRunEventInput {
  const type = args.type ?? "log";
  return {
    agentIndex: args.agentIndex ?? null,
    payload: JSON.stringify({ type, message: "x" }),
    producerEventId: args.producerEventId ?? nextProducerEventId(),
    producerEventPayloadHash: `hash-${args.producerEventId ?? producerEventCounter}`,
    runId: args.runId,
    type,
  };
}

function append(
  db: DbConnection,
  inputs: readonly AppendWorkflowRunEventInput[],
): AppendWorkflowRunEventsResult {
  return db.transaction(
    (tx) => appendWorkflowRunEventsInTransaction(tx, inputs),
    { behavior: "immediate" },
  );
}

describe("workflow run events", () => {
  it("assigns independent monotonic sequences per run", () => {
    const { db, otherRun, run } = setup();

    const first = append(db, [
      buildInput({ runId: run.id, type: "run/started" }),
      buildInput({ runId: otherRun.id, type: "run/started" }),
      buildInput({ runId: run.id }),
    ]);
    expect(first.acceptedEvents.map((event) => event.sequence)).toEqual([
      1, 1, 2,
    ]);
    expect(first.insertedInputIndexes).toEqual([0, 1, 2]);

    const second = append(db, [buildInput({ runId: run.id })]);
    expect(second.acceptedEvents).toEqual([
      expect.objectContaining({ runId: run.id, sequence: 3 }),
    ]);

    expect(
      listWorkflowRunEvents(db, { runId: run.id }).map(
        (row) => row.sequence,
      ),
    ).toEqual([1, 2, 3]);
    expect(listWorkflowRunEvents(db, { runId: otherRun.id })).toHaveLength(1);
  });

  it("re-acks redelivered producer events with their original sequence without inserting", () => {
    const { db, run } = setup();
    const input = buildInput({ runId: run.id, type: "agent/started" });

    const first = append(db, [input]);
    expect(first.insertedInputIndexes).toEqual([0]);
    const originalSequence = first.acceptedEvents[0].sequence;

    // Redelivery batch: one duplicate, one new event.
    const second = append(db, [input, buildInput({ runId: run.id })]);
    expect(second.acceptedEvents[0]).toEqual({
      producerEventId: input.producerEventId,
      runId: run.id,
      sequence: originalSequence,
    });
    expect(second.insertedInputIndexes).toEqual([1]);
    expect(listWorkflowRunEvents(db, { runId: run.id })).toHaveLength(2);
  });

  it("deduplicates a producer event repeated within one batch", () => {
    const { db, run } = setup();
    const input = buildInput({ runId: run.id });

    const result = append(db, [input, input]);
    expect(result.insertedInputIndexes).toEqual([0]);
    expect(result.acceptedEvents[0].sequence).toBe(
      result.acceptedEvents[1].sequence,
    );
    expect(listWorkflowRunEvents(db, { runId: run.id })).toHaveLength(1);
  });

  it("rejects a reused producer event id with a different payload hash", () => {
    const { db, run } = setup();
    const input = buildInput({ runId: run.id });
    append(db, [input]);

    expect(() =>
      append(db, [{ ...input, producerEventPayloadHash: "tampered" }]),
    ).toThrow(ProducerEventPayloadMismatchError);
    expect(listWorkflowRunEvents(db, { runId: run.id })).toHaveLength(1);
  });

  it("filters by cursor and event types (the journal read)", () => {
    const { db, run } = setup();
    append(db, [
      buildInput({ runId: run.id, type: "run/started" }),
      buildInput({ runId: run.id, type: "agent/completed", agentIndex: 1 }),
      buildInput({ runId: run.id, type: "agent/failed", agentIndex: 2 }),
      buildInput({ runId: run.id, type: "run/completed" }),
    ]);

    expect(
      listWorkflowRunEvents(db, { runId: run.id, afterSequence: 2 }).map(
        (row) => row.sequence,
      ),
    ).toEqual([3, 4]);

    const journalRows = listWorkflowRunEvents(db, {
      runId: run.id,
      types: ["agent/completed", "agent/failed"],
    });
    expect(journalRows.map((row) => [row.type, row.agentIndex])).toEqual([
      ["agent/completed", 1],
      ["agent/failed", 2],
    ]);
  });

  it("detects whether any events landed at or after a timestamp (command-expiry inspection)", () => {
    const { db, run } = setup();
    expect(hasWorkflowRunEventsSince(db, { runId: run.id, since: 0 })).toBe(
      false,
    );

    const before = Date.now();
    append(db, [buildInput({ runId: run.id, type: "run/started" })]);
    const insertedAt = listWorkflowRunEvents(db, { runId: run.id })[0]
      ?.createdAt;
    if (insertedAt === undefined) {
      throw new Error("expected one inserted event row");
    }
    expect(insertedAt).toBeGreaterThanOrEqual(before);

    expect(hasWorkflowRunEventsSince(db, { runId: run.id, since: 0 })).toBe(
      true,
    );
    // Inclusive boundary: an event created in the SAME millisecond the
    // command was queued counts as "demonstrably started" — a strict `>`
    // would mis-settle same-ms queue→spawn→flush sequences as never-started.
    expect(
      hasWorkflowRunEventsSince(db, { runId: run.id, since: insertedAt }),
    ).toBe(true);
    expect(
      hasWorkflowRunEventsSince(db, { runId: run.id, since: insertedAt + 1 }),
    ).toBe(false);
  });
});
