import { describe, expect, it } from "vitest";
import {
  turnScope,
  type ThreadEventItemType,
  type ThreadEventType,
} from "@bb/domain";
import {
  type InsertEventInput,
  insertEvents,
  listStoredBufferedTextDeltaRowsByItems,
  listStoredItemLifecycleRowsByItems,
} from "../../src/data/events.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import { createThread } from "../../src/data/threads.js";
import { noopNotifier } from "../../src/notifier.js";
import { createMigratedConnection } from "../../src/testing.js";

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const createIdleThread = () =>
    createThread(db, noopNotifier, {
      status: "idle",
      projectId: project.id,
      providerId: "codex",
    });
  return { db, thread: createIdleThread(), otherThread: createIdleThread() };
}

function itemEvent(
  threadId: string,
  sequence: number,
  type: ThreadEventType,
  turnId: string,
  itemId: string,
  itemKind: ThreadEventItemType,
): InsertEventInput {
  return {
    threadId,
    sequence,
    type,
    scope: turnScope(turnId),
    itemId,
    itemKind,
    parentToolCallId: null,
    data: JSON.stringify({ item: { id: itemId, type: itemKind } }),
  };
}

describe("timeline item backfill reads", () => {
  it("reads lifecycle and buffered deltas only for the requested turn-scoped items", () => {
    const { db, thread, otherThread } = setup();
    insertEvents(db, noopNotifier, [
      itemEvent(thread.id, 1, "item/started", "turn-1", "msg", "agentMessage"),
      itemEvent(thread.id, 2, "item/agentMessage/delta", "turn-1", "msg", "agentMessage"),
      itemEvent(thread.id, 3, "item/agentMessage/delta", "turn-1", "msg", "agentMessage"),
      itemEvent(thread.id, 4, "item/started", "turn-1", "think", "reasoning"),
      itemEvent(thread.id, 5, "item/reasoning/textDelta", "turn-1", "think", "reasoning"),
      itemEvent(thread.id, 6, "item/completed", "turn-1", "msg", "agentMessage"),
      itemEvent(thread.id, 7, "item/started", "turn-2", "msg", "agentMessage"),
      itemEvent(thread.id, 8, "item/agentMessage/delta", "turn-2", "msg", "agentMessage"),
      itemEvent(otherThread.id, 1, "item/started", "turn-1", "msg", "agentMessage"),
      itemEvent(otherThread.id, 2, "item/agentMessage/delta", "turn-1", "msg", "agentMessage"),
    ]);
    const items = [
      { itemId: "msg", scopeKind: "turn" as const, turnId: "turn-1" },
      { itemId: "think", scopeKind: "turn" as const, turnId: "turn-1" },
    ];

    expect(
      listStoredItemLifecycleRowsByItems(db, {
        items,
        maxInlineOutputChars: null,
        threadId: thread.id,
      }).map((row) => [row.sequence, row.type, row.itemId]),
    ).toEqual([
      [1, "item/started", "msg"],
      [4, "item/started", "think"],
      [6, "item/completed", "msg"],
    ]);
    expect(
      listStoredBufferedTextDeltaRowsByItems(db, {
        beforeSequence: 5,
        items,
        threadId: thread.id,
      }).map((row) => [row.sequence, row.itemId]),
    ).toEqual([
      [2, "msg"],
      [3, "msg"],
    ]);

    db.$client.close();
  });
});
