import { expect, it } from "vitest";
import { threadScope, turnScope } from "@bb/domain";
import {
  countTimelineTurnEventsOutsideWindow,
  insertEvents,
  listStoredItemStartSequencesBefore,
  listStoredTimelineItemEventRows,
  listStoredTimelineTurnContextRows,
  listTimelineTurnFirstSequences,
} from "../../src/data/events.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import {
  getTimelineTurnPlanWatermark,
  listThreadTurnTimelinePlanRecords,
  upsertThreadTurnTimelinePlanRecord,
} from "../../src/data/thread-turn-timeline-plans.js";
import { createThread } from "../../src/data/threads.js";
import { noopNotifier } from "../../src/notifier.js";
import { createMigratedConnection } from "../../src/testing.js";

const LARGE_ID_COUNT = 40_000;

function manyIds(prefix: string, first: string, last: string): string[] {
  return [
    first,
    ...Array.from({ length: LARGE_ID_COUNT }, (_, index) => `${prefix}-${index}`),
    last,
  ];
}

it("reads turn windows, item starts and turn plans for id lists above the SQLite variable limit", () => {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "batch-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "batch-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/batch" },
  });
  const threadId = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  }).id;
  const event = (
    sequence: number,
    type: "turn/started" | "item/started" | "item/completed",
    turnId: string | null,
    itemId: string | null,
    parentToolCallId: string | null = null,
  ) => ({
    threadId,
    sequence,
    type,
    scope: turnId === null ? threadScope() : turnScope(turnId),
    providerThreadId: "provider",
    itemId,
    itemKind: itemId === null ? null : ("commandExecution" as const),
    parentToolCallId,
    data:
      itemId === null
        ? "{}"
        : JSON.stringify({
            item: {
              type: "commandExecution",
              id: itemId,
              command: "echo",
              cwd: "/tmp/batch",
              status: "completed",
              aggregatedOutput: "x".repeat(2_000),
            },
          }),
  });
  insertEvents(db, noopNotifier, [
    event(1, "turn/started", "first-turn", null),
    event(2, "item/started", "first-turn", "first-item"),
    event(3, "item/completed", "first-turn", "first-item", "first-parent"),
    event(4, "turn/started", "last-turn", null),
    event(5, "item/started", "last-turn", "last-item"),
    event(6, "item/completed", "last-turn", "last-item", "last-parent"),
    event(7, "item/started", "first-turn", "first-tail-item"),
  ]);
  const turnIds = manyIds("turn", "first-turn", "last-turn");
  const itemIds = [
    ...manyIds("item", "first-item", "first-tail-item"),
    "last-item",
  ];
  const windowArgs = {
    beforeSequence: 8,
    maxInlineOutputChars: 1_000,
    sequenceStart: 0,
    threadId,
  };

  expect(
    listStoredTimelineTurnContextRows(db, { ...windowArgs, turnIds }).map(
      (row) => row.sequence,
    ),
  ).toEqual([1, 4]);
  expect(
    listStoredTimelineItemEventRows(db, {
      ...windowArgs,
      items: itemIds.map((itemId) => ({
        itemId,
        scopeKind: "turn" as const,
        turnId: itemId === "last-item" ? "last-turn" : "first-turn",
      })),
    }).map((row) => row.sequence),
  ).toEqual([2, 3, 5, 6, 7]);
  expect(
    listTimelineTurnFirstSequences(db, {
      epochSequenceStart: 0,
      maxSeq: 7,
      threadId,
      turnIds,
    }),
  ).toEqual(
    new Map([
      ["first-turn", 1],
      ["last-turn", 4],
    ]),
  );
  expect(
    countTimelineTurnEventsOutsideWindow(db, {
      beforeSequence: 6,
      epochSequenceStart: 0,
      maxSeq: 7,
      sequenceStart: 2,
      threadId,
      turnIds,
    }),
  ).toEqual(
    new Map([
      ["first-turn", 2],
      ["last-turn", 1],
    ]),
  );
  expect(
    listStoredItemStartSequencesBefore(db, {
      beforeSequence: 8,
      itemIds,
      threadId,
    })
      .map((start) => start.sequence)
      .sort((left, right) => left - right),
  ).toEqual([2, 5, 7]);

  for (const turnId of ["first-turn", "last-turn"]) {
    upsertThreadTurnTimelinePlanRecord(db, {
      planJson: "{}",
      projectionKey: "key",
      threadId,
      turnId,
      watermark: 1,
    });
  }
  expect(
    listThreadTurnTimelinePlanRecords(db, { threadId, turnIds })
      .map((record) => record.turnId)
      .sort(),
  ).toEqual(["first-turn", "last-turn"]);
  expect(
    getTimelineTurnPlanWatermark(db, {
      delegatingItemIds: manyIds("parent", "first-parent", "last-parent"),
      maxSeq: 6,
      openItemIds: itemIds,
      threadId,
      turnId: "first-turn",
    }),
  ).toBe(6);
});
