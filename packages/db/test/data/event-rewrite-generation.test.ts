import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { threadScope, turnScope } from "@bb/domain";
import { createConnection, type DbConnection } from "../../src/connection.js";
import {
  getDatabaseDataVersion,
  getThreadEventRewriteGeneration,
} from "../../src/data/event-rewrite-generation.js";
import {
  appendDaemonEventsInTransaction,
  deleteThreadEventSuffixInTransaction,
  insertEvents,
  pruneBackgroundTaskProgressEvents,
  pruneContextWindowUsageEventsBeforeSequence,
  pruneResolvedItemDeltas,
  pruneThreadEventsBeforeSequence,
  pruneTokenUsageEventsBeforeSequence,
  type InsertEventInput,
} from "../../src/data/events.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import {
  migrateNextCompletedEventItemOutput,
  migrateNextLegacyImageGenerationOutput,
} from "../../src/data/sweeps.js";
import { COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS } from "../../src/retained-event-output.js";
import { createThread } from "../../src/data/threads.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import { events } from "../../src/schema.js";

interface TestDb {
  db: DbConnection;
  otherThreadId: string;
  threadId: string;
}

interface RecordGenerationChangeArgs {
  mutate: () => void;
  threadId: string;
}

interface GenerationChange {
  after: number;
  before: number;
}

function setup(): TestDb {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, { name: "rewrite-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "rewrite-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/rewrite" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  const otherThread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  return { db, otherThreadId: otherThread.id, threadId: thread.id };
}

function recordGenerationChange(
  args: RecordGenerationChangeArgs,
): GenerationChange {
  const before = getThreadEventRewriteGeneration(args.threadId);
  args.mutate();
  return { after: getThreadEventRewriteGeneration(args.threadId), before };
}

function threadMessage(threadId: string, sequence: number): InsertEventInput {
  return {
    data: JSON.stringify({ text: `message ${sequence}` }),
    itemId: null,
    itemKind: null,
    parentToolCallId: null,
    scope: threadScope(),
    sequence,
    threadId,
    type: "system/manager/user_message",
  };
}

function tokenUsage(threadId: string, sequence: number): InsertEventInput {
  return {
    data: JSON.stringify({
      tokenUsage: {
        modelContextWindow: sequence === 1 ? 200_000 : null,
        total: { totalTokens: sequence * 10 },
      },
    }),
    itemId: null,
    itemKind: null,
    parentToolCallId: null,
    scope: turnScope("turn-usage"),
    sequence,
    threadId,
    type: "thread/tokenUsage/updated",
  };
}

function contextWindowUsage(
  threadId: string,
  sequence: number,
): InsertEventInput {
  return {
    data: JSON.stringify({
      contextWindowUsage: {
        modelContextWindow: sequence === 1 ? 200_000 : null,
        usedTokens: sequence * 10,
      },
    }),
    itemId: null,
    itemKind: null,
    parentToolCallId: null,
    scope: turnScope("turn-usage"),
    sequence,
    threadId,
    type: "thread/contextWindowUsage/updated",
  };
}

function agentMessageDelta(
  threadId: string,
  sequence: number,
): InsertEventInput {
  return {
    data: JSON.stringify({ delta: `chunk ${sequence}`, itemId: "msg-1" }),
    itemId: "msg-1",
    itemKind: null,
    parentToolCallId: null,
    scope: turnScope("turn-1"),
    sequence,
    threadId,
    type: "item/agentMessage/delta",
  };
}

function backgroundTaskProgress(
  threadId: string,
  sequence: number,
): InsertEventInput {
  return {
    data: JSON.stringify({
      item: {
        description: "fixture workflow",
        id: "task:wf-1",
        skipTranscript: false,
        status: "pending",
        taskStatus: "running",
        taskType: "local_workflow",
        type: "backgroundTask",
      },
    }),
    itemId: "task:wf-1",
    itemKind: "backgroundTask",
    parentToolCallId: null,
    scope: threadScope(),
    sequence,
    threadId,
    type: "item/backgroundTask/progress",
  };
}

interface InsertLegacyCommandOutputArgs {
  db: DbConnection;
  eventId: string;
  output: string;
  sequence: number;
  threadId: string;
}

function insertLegacyCommandOutput(args: InsertLegacyCommandOutputArgs): void {
  args.db
    .insert(events)
    .values({
      createdAt: 1_799_999_940_000,
      data: JSON.stringify({
        item: {
          aggregatedOutput: args.output,
          id: `${args.eventId}-item`,
          type: "commandExecution",
        },
      }),
      id: args.eventId,
      itemId: `${args.eventId}-item`,
      itemKind: "commandExecution",
      parentToolCallId: null,
      providerThreadId: null,
      scopeKind: "turn",
      sequence: args.sequence,
      threadId: args.threadId,
      turnId: "turn-legacy",
      type: "item/completed",
    })
    .run();
}

describe("thread event rewrite generation", () => {
  it("changes when a suffix delete removes events and not when it removes none", () => {
    const { db, otherThreadId, threadId } = setup();
    try {
      insertEvents(db, noopNotifier, [
        threadMessage(threadId, 1),
        threadMessage(threadId, 2),
        threadMessage(threadId, 3),
        threadMessage(otherThreadId, 1),
      ]);

      const missed = recordGenerationChange({
        threadId,
        mutate: () =>
          db.transaction((tx) => {
            expect(
              deleteThreadEventSuffixInTransaction(tx, {
                cutoffSequence: 10,
                oldMaxSequence: 12,
                threadId,
              }).deletedEventCount,
            ).toBe(0);
          }),
      });
      expect(missed.after).toBe(missed.before);

      const otherBefore = getThreadEventRewriteGeneration(otherThreadId);
      const deleted = recordGenerationChange({
        threadId,
        mutate: () =>
          db.transaction((tx) => {
            expect(
              deleteThreadEventSuffixInTransaction(tx, {
                cutoffSequence: 2,
                oldMaxSequence: 3,
                threadId,
              }).deletedEventCount,
            ).toBe(2);
          }),
      });
      expect(deleted.after).toBeGreaterThan(deleted.before);
      expect(getThreadEventRewriteGeneration(otherThreadId)).toBe(otherBefore);
    } finally {
      db.$client.close();
    }
  });

  it("changes when typed events before a cutoff are pruned and not when none match", () => {
    const { db, threadId } = setup();
    try {
      insertEvents(db, noopNotifier, [
        tokenUsage(threadId, 1),
        tokenUsage(threadId, 2),
        tokenUsage(threadId, 3),
      ]);

      const missed = recordGenerationChange({
        threadId,
        mutate: () => {
          expect(
            pruneThreadEventsBeforeSequence(db, {
              sequenceCutoff: 3,
              threadId,
              types: ["thread/contextWindowUsage/updated"],
            }),
          ).toBe(0);
        },
      });
      expect(missed.after).toBe(missed.before);

      const pruned = recordGenerationChange({
        threadId,
        mutate: () => {
          expect(
            pruneThreadEventsBeforeSequence(db, {
              sequenceCutoff: 2,
              threadId,
              types: ["thread/tokenUsage/updated"],
            }),
          ).toBe(2);
        },
      });
      expect(pruned.after).toBeGreaterThan(pruned.before);
    } finally {
      db.$client.close();
    }
  });

  it.each([
    {
      name: "token usage",
      prune: pruneTokenUsageEventsBeforeSequence,
      row: tokenUsage,
    },
    {
      name: "context window usage",
      prune: pruneContextWindowUsageEventsBeforeSequence,
      row: contextWindowUsage,
    },
  ])(
    "changes when $name rows are pruned and not when only kept rows are eligible",
    ({ prune, row }) => {
      const { db, threadId } = setup();
      try {
        insertEvents(db, noopNotifier, [
          row(threadId, 1),
          row(threadId, 2),
          row(threadId, 3),
          row(threadId, 4),
        ]);

        const missed = recordGenerationChange({
          threadId,
          mutate: () => {
            expect(prune(db, { sequenceCutoff: 1, threadId })).toBe(0);
          },
        });
        expect(missed.after).toBe(missed.before);

        const pruned = recordGenerationChange({
          threadId,
          mutate: () => {
            expect(prune(db, { sequenceCutoff: 4, threadId })).toBe(2);
          },
        });
        expect(pruned.after).toBeGreaterThan(pruned.before);
      } finally {
        db.$client.close();
      }
    },
  );

  it("changes when resolved item deltas are pruned and not while the item is open", () => {
    const { db, threadId } = setup();
    try {
      insertEvents(db, noopNotifier, [
        agentMessageDelta(threadId, 1),
        agentMessageDelta(threadId, 2),
        agentMessageDelta(threadId, 3),
      ]);

      const missed = recordGenerationChange({
        threadId,
        mutate: () => {
          expect(pruneResolvedItemDeltas(db, { threadId })).toBe(0);
        },
      });
      expect(missed.after).toBe(missed.before);

      insertEvents(db, noopNotifier, [
        {
          data: JSON.stringify({
            item: {
              id: "msg-1",
              text: "chunk 1chunk 2chunk 3",
              type: "agentMessage",
            },
          }),
          itemId: "msg-1",
          itemKind: "agentMessage",
          parentToolCallId: null,
          scope: turnScope("turn-1"),
          sequence: 4,
          threadId,
          type: "item/completed",
        },
      ]);
      const pruned = recordGenerationChange({
        threadId,
        mutate: () => {
          expect(pruneResolvedItemDeltas(db, { threadId })).toBe(2);
        },
      });
      expect(pruned.after).toBeGreaterThan(pruned.before);
    } finally {
      db.$client.close();
    }
  });

  it("changes when superseded background task progress is pruned and not when only the latest row exists", () => {
    const { db, threadId } = setup();
    try {
      insertEvents(db, noopNotifier, [backgroundTaskProgress(threadId, 1)]);

      const missed = recordGenerationChange({
        threadId,
        mutate: () => {
          expect(pruneBackgroundTaskProgressEvents(db, { threadId })).toBe(0);
        },
      });
      expect(missed.after).toBe(missed.before);

      insertEvents(db, noopNotifier, [backgroundTaskProgress(threadId, 2)]);
      const pruned = recordGenerationChange({
        threadId,
        mutate: () => {
          expect(pruneBackgroundTaskProgressEvents(db, { threadId })).toBe(1);
        },
      });
      expect(pruned.after).toBeGreaterThan(pruned.before);
    } finally {
      db.$client.close();
    }
  });

  it("changes when a completed output is migrated and not when the scanned output fits", () => {
    const migratedAt = 1_800_000_000_000;
    const fits = setup();
    const oversized = setup();
    try {
      insertLegacyCommandOutput({
        db: fits.db,
        eventId: "evt_small_output",
        output: "small",
        sequence: 1,
        threadId: fits.threadId,
      });
      const missed = recordGenerationChange({
        threadId: fits.threadId,
        mutate: () => {
          expect(
            migrateNextCompletedEventItemOutput(fits.db, {
              itemKind: "commandExecution",
              limit: 10,
              migratedAt,
              outputPath: "aggregatedOutput",
            }).action,
          ).toBe("scanned");
        },
      });
      expect(missed.after).toBe(missed.before);

      insertLegacyCommandOutput({
        db: oversized.db,
        eventId: "evt_large_output",
        output: "x".repeat(
          COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS + 1,
        ),
        sequence: 1,
        threadId: oversized.threadId,
      });
      const migrated = recordGenerationChange({
        threadId: oversized.threadId,
        mutate: () => {
          expect(
            migrateNextCompletedEventItemOutput(oversized.db, {
              itemKind: "commandExecution",
              limit: 10,
              migratedAt,
              outputPath: "aggregatedOutput",
            }),
          ).toMatchObject({
            action: "migrated",
            eventId: "evt_large_output",
            threadId: oversized.threadId,
          });
        },
      });
      expect(migrated.after).toBeGreaterThan(migrated.before);
    } finally {
      fits.db.$client.close();
      oversized.db.$client.close();
    }
  });

  it("changes when a legacy image generation output is migrated", () => {
    const migratedAt = 1_800_000_000_000;
    const { db, threadId } = setup();
    try {
      db.insert(events)
        .values({
          createdAt: migratedAt - 60_000,
          data: JSON.stringify({
            providerId: "codex",
            rawEvent: {
              jsonrpc: "2.0",
              method: "item/completed",
              params: {
                item: {
                  failure: null,
                  id: "image-item",
                  result: "i".repeat(
                    COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS + 1,
                  ),
                  revisedPrompt: "Draw a compact test image",
                  savedPath: "/tmp/generated.png",
                  status: "completed",
                  transparentBackground: false,
                  type: "imageGeneration",
                },
                threadId: "codex-thread",
                turnId: "turn-image",
              },
            },
            rawType: "item/completed",
          }),
          id: "evt_legacy_image",
          itemId: null,
          itemKind: null,
          parentToolCallId: null,
          providerThreadId: "codex-thread",
          scopeKind: "turn",
          sequence: 1,
          threadId,
          turnId: "turn-image",
          type: "provider/unhandled",
        })
        .run();

      const migrated = recordGenerationChange({
        threadId,
        mutate: () => {
          expect(
            migrateNextLegacyImageGenerationOutput(db, {
              limit: 10,
              migratedAt,
            }),
          ).toMatchObject({ action: "migrated", eventId: "evt_legacy_image" });
        },
      });
      expect(migrated.after).toBeGreaterThan(migrated.before);
    } finally {
      db.$client.close();
    }
  });

  it("does not change for daemon appends or increasing inserts", () => {
    const { db, threadId } = setup();
    try {
      const appended = recordGenerationChange({
        threadId,
        mutate: () => {
          insertEvents(db, noopNotifier, [
            threadMessage(threadId, 1),
            threadMessage(threadId, 2),
          ]);
          insertEvents(db, noopNotifier, [threadMessage(threadId, 5)]);
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
        },
      });
      expect(appended.after).toBe(appended.before);
    } finally {
      db.$client.close();
    }
  });

  it("changes when an insert backfills a sequence at or below the thread's high-water mark", () => {
    const { db, otherThreadId, threadId } = setup();
    try {
      insertEvents(db, noopNotifier, [
        threadMessage(threadId, 2),
        threadMessage(threadId, 4),
      ]);

      const ignoredDuplicate = recordGenerationChange({
        threadId,
        mutate: () => {
          expect(
            insertEvents(db, noopNotifier, [threadMessage(threadId, 4)])
              .insertedCount,
          ).toBe(0);
        },
      });
      expect(ignoredDuplicate.after).toBe(ignoredDuplicate.before);

      const otherBefore = getThreadEventRewriteGeneration(otherThreadId);
      const backfilled = recordGenerationChange({
        threadId,
        mutate: () => {
          expect(
            insertEvents(db, noopNotifier, [
              threadMessage(otherThreadId, 1),
              threadMessage(threadId, 3),
            ]).insertedCount,
          ).toBe(2);
        },
      });
      expect(backfilled.after).toBeGreaterThan(backfilled.before);
      expect(getThreadEventRewriteGeneration(otherThreadId)).toBe(otherBefore);
    } finally {
      db.$client.close();
    }
  });
});

describe("database data version", () => {
  it("changes only when another connection commits", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-data-version-"));
    const filePath = path.join(dir, "bb.db");
    const reader = createConnection(filePath);
    let writer: DbConnection | null = null;
    try {
      migrate(reader);
      writer = createConnection(filePath);
      const host = upsertHost(reader, noopNotifier, { name: "version-host" });
      const { project } = createProject(reader, noopNotifier, {
        name: "version-project",
        source: { type: "local_path", hostId: host.id, path: "/tmp/version" },
      });
      const thread = createThread(reader, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });

      const initial = getDatabaseDataVersion(reader);
      insertEvents(reader, noopNotifier, [threadMessage(thread.id, 1)]);
      expect(getDatabaseDataVersion(reader)).toBe(initial);

      insertEvents(writer, noopNotifier, [threadMessage(thread.id, 2)]);
      expect(getDatabaseDataVersion(reader)).not.toBe(initial);
    } finally {
      writer?.$client.close();
      reader.$client.close();
      fs.rmSync(dir, { force: true, recursive: true });
    }
  });
});
