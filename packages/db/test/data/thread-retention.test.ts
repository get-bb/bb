import { describe, expect, it } from "vitest";
import { noopNotifier } from "../../src/notifier.js";
import {
  cancelThreadRetention,
  clearArchivedConversationDeletion,
  getThreadRetentionSchedule,
  listDueArchivedConversationDeletions,
  scheduleArchivedThreadRetention,
} from "../../src/data/thread-retention.js";
import { archiveThread, createThread } from "../../src/data/threads.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";
import { createProject } from "../../src/data/projects.js";
import { upsertHost } from "../../src/data/hosts.js";

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, {
    name: "retention-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "retention-project",
    source: {
      hostId: host.id,
      path: "/tmp/retention-project",
      type: "local_path",
    },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
    status: "idle",
  });
  return { db, thread };
}

describe("archived conversation retention schedules", () => {
  it("leaves existing archives unscheduled until server policy records intent", () => {
    const { db, thread } = setup();

    archiveThread(db, noopNotifier, thread.id);

    expect(getThreadRetentionSchedule(db, thread.id)).toBeNull();
  });

  it("stores, lists, and clears a conversation deadline", () => {
    const { db, thread } = setup();
    const archivedAt = 1_000;
    const conversationDeleteDueAt = 3_000;

    scheduleArchivedThreadRetention(db, {
      archivedAt,
      conversationDeleteDueAt,
      threadId: thread.id,
    });

    expect(
      listDueArchivedConversationDeletions(db, { limit: 10, now: 2_999 }),
    ).toEqual([]);
    expect(
      listDueArchivedConversationDeletions(db, { limit: 10, now: 3_000 }),
    ).toEqual([
      expect.objectContaining({ conversationDeleteDueAt, threadId: thread.id }),
    ]);

    expect(
      clearArchivedConversationDeletion(db, {
        archivedAt,
        conversationDeleteDueAt,
        threadId: thread.id,
      }),
    ).toBe(true);
    expect(getThreadRetentionSchedule(db, thread.id)).toBeNull();
  });

  it("cancels on unarchive and replaces the deadline on rearchive", () => {
    const { db, thread } = setup();
    scheduleArchivedThreadRetention(db, {
      archivedAt: 1_000,
      conversationDeleteDueAt: 3_000,
      threadId: thread.id,
    });

    expect(cancelThreadRetention(db, thread.id)).toBe(true);
    expect(getThreadRetentionSchedule(db, thread.id)).toBeNull();

    scheduleArchivedThreadRetention(db, {
      archivedAt: 4_000,
      conversationDeleteDueAt: 5_000,
      threadId: thread.id,
    });
    expect(getThreadRetentionSchedule(db, thread.id)).toEqual(
      expect.objectContaining({
        archivedAt: 4_000,
        conversationDeleteDueAt: 5_000,
      }),
    );
  });
});
