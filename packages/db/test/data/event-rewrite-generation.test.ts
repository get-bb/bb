import { describe, expect, it } from "vitest";
import { threadScope, turnScope } from "@bb/domain";
import type { DbConnection } from "../../src/connection.js";
import { getThreadEventRewriteGeneration } from "../../src/data/event-rewrite-generation.js";
import {
  appendDaemonEventsInTransaction,
  deleteThreadEventSuffixInTransaction,
  insertEvents,
  pruneBackgroundTaskProgressEvents,
  pruneResolvedItemDeltas,
  pruneThreadEventsBeforeSequence,
  pruneTokenUsageEventsBeforeSequence,
  type InsertEventInput,
} from "../../src/data/events.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import { migrateNextCompletedEventItemOutput } from "../../src/data/sweeps.js";
import { createThread } from "../../src/data/threads.js";
import { noopNotifier } from "../../src/notifier.js";
import { COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS } from "../../src/retained-event-output.js";
import { events } from "../../src/schema.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";

interface RewriteCase {
  between?: (threadId: string) => InsertEventInput[];
  name: string;
  noop: (db: DbConnection, threadId: string) => number;
  rewrite: (db: DbConnection, threadId: string) => number;
  seed: (threadId: string) => InsertEventInput[];
}

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "rewrite-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "rewrite-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/rewrite" },
  });
  const createCodexThread = () =>
    createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    }).id;
  return {
    db,
    otherThreadId: createCodexThread(),
    threadId: createCodexThread(),
  };
}

function expectGenerationBump(
  threadId: string,
  bumped: boolean,
  mutate: () => void,
): void {
  const before = getThreadEventRewriteGeneration(threadId);
  mutate();
  expect(getThreadEventRewriteGeneration(threadId) !== before).toBe(bumped);
}

function row(
  threadId: string,
  sequence: number,
  type: InsertEventInput["type"],
  data: Record<string, unknown>,
  overrides: Partial<InsertEventInput> = {},
): InsertEventInput {
  return {
    data: JSON.stringify(data),
    itemId: null,
    itemKind: null,
    parentToolCallId: null,
    scope: turnScope("turn-1"),
    sequence,
    threadId,
    type,
    ...overrides,
  };
}

function message(threadId: string, sequence: number): InsertEventInput {
  return row(
    threadId,
    sequence,
    "system/manager/user_message",
    { text: `message ${sequence}` },
    { scope: threadScope() },
  );
}

function tokenUsage(threadId: string, sequence: number): InsertEventInput {
  return row(threadId, sequence, "thread/tokenUsage/updated", {
    tokenUsage: {
      modelContextWindow: sequence === 1 ? 200_000 : null,
      total: { totalTokens: sequence * 10 },
    },
  });
}

function taskProgress(threadId: string, sequence: number): InsertEventInput {
  return row(
    threadId,
    sequence,
    "item/backgroundTask/progress",
    {
      item: {
        description: "fixture workflow",
        id: "task:wf-1",
        skipTranscript: false,
        status: "pending",
        taskStatus: "running",
        taskType: "local_workflow",
        type: "backgroundTask",
      },
    },
    { itemId: "task:wf-1", itemKind: "backgroundTask", scope: threadScope() },
  );
}

function deleteSuffix(
  db: DbConnection,
  threadId: string,
  cutoffSequence: number,
): number {
  return db.transaction(
    (tx) =>
      deleteThreadEventSuffixInTransaction(tx, {
        cutoffSequence,
        oldMaxSequence: cutoffSequence + 2,
        threadId,
      }).deletedEventCount,
  );
}

function insertCommandOutput(
  db: DbConnection,
  threadId: string,
  output: string,
) {
  db.insert(events)
    .values({
      createdAt: 1_799_999_940_000,
      data: JSON.stringify({
        item: {
          aggregatedOutput: output,
          id: "cmd-1",
          type: "commandExecution",
        },
      }),
      id: "evt_command_output",
      itemId: "cmd-1",
      itemKind: "commandExecution",
      parentToolCallId: null,
      providerThreadId: null,
      scopeKind: "turn",
      sequence: 1,
      threadId,
      turnId: "turn-1",
      type: "item/completed",
    })
    .run();
  return migrateNextCompletedEventItemOutput(db, {
    itemKind: "commandExecution",
    limit: 10,
    migratedAt: 1_800_000_000_000,
    outputPath: "aggregatedOutput",
  }).action;
}

describe("thread event rewrite generation", () => {
  it.each<RewriteCase>([
    {
      name: "a suffix delete",
      seed: (threadId) =>
        [1, 2, 3].map((sequence) => message(threadId, sequence)),
      noop: (db, threadId) => deleteSuffix(db, threadId, 10),
      rewrite: (db, threadId) => deleteSuffix(db, threadId, 2),
    },
    {
      name: "a typed prune",
      seed: (threadId) =>
        [1, 2, 3].map((sequence) => tokenUsage(threadId, sequence)),
      noop: (db, threadId) =>
        pruneThreadEventsBeforeSequence(db, {
          sequenceCutoff: 3,
          threadId,
          types: ["thread/contextWindowUsage/updated"],
        }),
      rewrite: (db, threadId) =>
        pruneThreadEventsBeforeSequence(db, {
          sequenceCutoff: 2,
          threadId,
          types: ["thread/tokenUsage/updated"],
        }),
    },
    {
      name: "a usage prune",
      seed: (threadId) =>
        [1, 2, 3, 4].map((sequence) => tokenUsage(threadId, sequence)),
      noop: (db, threadId) =>
        pruneTokenUsageEventsBeforeSequence(db, {
          sequenceCutoff: 1,
          threadId,
        }),
      rewrite: (db, threadId) =>
        pruneTokenUsageEventsBeforeSequence(db, {
          sequenceCutoff: 4,
          threadId,
        }),
    },
    {
      name: "a resolved delta prune",
      seed: (threadId) =>
        [1, 2, 3].map((sequence) =>
          row(
            threadId,
            sequence,
            "item/agentMessage/delta",
            { delta: `chunk ${sequence}`, itemId: "msg-1" },
            { itemId: "msg-1" },
          ),
        ),
      noop: (db, threadId) => pruneResolvedItemDeltas(db, { threadId }),
      between: (threadId) => [
        row(
          threadId,
          4,
          "item/completed",
          {
            item: {
              id: "msg-1",
              text: "chunk 1chunk 2chunk 3",
              type: "agentMessage",
            },
          },
          { itemId: "msg-1", itemKind: "agentMessage" },
        ),
      ],
      rewrite: (db, threadId) => pruneResolvedItemDeltas(db, { threadId }),
    },
    {
      name: "a background task progress prune",
      seed: (threadId) => [taskProgress(threadId, 1)],
      noop: (db, threadId) =>
        pruneBackgroundTaskProgressEvents(db, { threadId }),
      between: (threadId) => [taskProgress(threadId, 2)],
      rewrite: (db, threadId) =>
        pruneBackgroundTaskProgressEvents(db, { threadId }),
    },
  ])("changes only when $name removes rows", (testCase) => {
    const { db, otherThreadId, threadId } = setup();
    insertEvents(db, noopNotifier, [
      ...testCase.seed(threadId),
      message(otherThreadId, 1),
    ]);

    expectGenerationBump(threadId, false, () => {
      expect(testCase.noop(db, threadId)).toBe(0);
    });
    insertEvents(db, noopNotifier, testCase.between?.(threadId) ?? []);
    const otherBefore = getThreadEventRewriteGeneration(otherThreadId);
    expectGenerationBump(threadId, true, () => {
      expect(testCase.rewrite(db, threadId)).toBeGreaterThan(0);
    });
    expect(getThreadEventRewriteGeneration(otherThreadId)).toBe(otherBefore);
  });

  it("changes when a completed output is migrated and not when the scanned output fits", () => {
    const fits = setup();
    expectGenerationBump(fits.threadId, false, () => {
      expect(insertCommandOutput(fits.db, fits.threadId, "small")).toBe(
        "scanned",
      );
    });

    const oversized = setup();
    expectGenerationBump(oversized.threadId, true, () => {
      expect(
        insertCommandOutput(
          oversized.db,
          oversized.threadId,
          "x".repeat(COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS + 1),
        ),
      ).toBe("migrated");
    });
  });

  it("does not change for daemon appends, increasing inserts or ignored duplicates", () => {
    const { db, threadId } = setup();
    expectGenerationBump(threadId, false, () => {
      insertEvents(db, noopNotifier, [
        message(threadId, 1),
        message(threadId, 2),
      ]);
      insertEvents(db, noopNotifier, [message(threadId, 5)]);
      expect(
        insertEvents(db, noopNotifier, [message(threadId, 5)]).insertedCount,
      ).toBe(0);
      db.transaction((tx) => {
        expect(
          appendDaemonEventsInTransaction(tx, [
            {
              data: JSON.stringify({ text: "daemon" }),
              environmentId: null,
              itemId: null,
              itemKind: null,
              parentToolCallId: null,
              providerThreadId: null,
              scope: threadScope(),
              threadId,
              type: "system/manager/user_message",
            },
          ]).acceptedEvents,
        ).toEqual([{ sequence: 6, threadId }]);
      });
    });
  });

  it("changes only for the thread whose insert backfills at or below its high-water mark", () => {
    const { db, otherThreadId, threadId } = setup();
    insertEvents(db, noopNotifier, [
      message(threadId, 2),
      message(threadId, 4),
    ]);
    const otherBefore = getThreadEventRewriteGeneration(otherThreadId);

    expectGenerationBump(threadId, true, () => {
      expect(
        insertEvents(db, noopNotifier, [
          message(otherThreadId, 1),
          message(threadId, 3),
        ]).insertedCount,
      ).toBe(2);
    });
    expect(getThreadEventRewriteGeneration(otherThreadId)).toBe(otherBefore);
  });
});
