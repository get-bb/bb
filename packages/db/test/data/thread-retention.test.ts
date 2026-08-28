import { describe, expect, it } from "vitest";
import { noopNotifier } from "../../src/notifier.js";
import {
  cancelThreadRetention,
  clearArchivedConversationDeletion,
  completeThreadResourceCleanup,
  getThreadRetentionSchedule,
  listDueArchivedConversationDeletions,
  listDueThreadResourceCleanups,
  scheduleArchivedThreadRetention,
  scheduleImmediateThreadResourceCleanup,
} from "../../src/data/thread-retention.js";
import {
  archiveThread,
  createThread,
  deleteThread,
} from "../../src/data/threads.js";
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
  return { db, host, thread };
}

describe("thread retention schedules", () => {
  it("leaves existing archives unscheduled until server policy records intent", () => {
    const { db, thread } = setup();

    archiveThread(db, noopNotifier, thread.id);

    expect(getThreadRetentionSchedule(db, thread.id)).toBeNull();
  });

  it("stores independent resource and conversation deadlines", () => {
    const { db, host, thread } = setup();
    const archivedAt = 1_000;
    const resourceCleanupDueAt = 2_000;
    const conversationDeleteDueAt = 3_000;

    scheduleArchivedThreadRetention(db, {
      archivedAt,
      conversationDeleteDueAt,
      hostId: host.id,
      resourceCleanupDueAt,
      threadId: thread.id,
    });

    expect(
      listDueThreadResourceCleanups(db, { limit: 10, now: 1_999 }),
    ).toEqual([]);
    expect(
      listDueThreadResourceCleanups(db, { limit: 10, now: 2_000 }),
    ).toEqual([
      expect.objectContaining({
        archivedAt,
        hostId: host.id,
        resourceCleanupDueAt,
        threadId: thread.id,
      }),
    ]);
    expect(
      listDueArchivedConversationDeletions(db, { limit: 10, now: 2_999 }),
    ).toEqual([]);
    expect(
      listDueArchivedConversationDeletions(db, { limit: 10, now: 3_000 }),
    ).toEqual([
      expect.objectContaining({ conversationDeleteDueAt, threadId: thread.id }),
    ]);

    expect(
      completeThreadResourceCleanup(db, {
        archivedAt,
        resourceCleanupDueAt,
        threadId: thread.id,
      }),
    ).toBe(true);
    expect(getThreadRetentionSchedule(db, thread.id)).toEqual(
      expect.objectContaining({
        conversationDeleteDueAt,
        resourceCleanupDueAt: null,
      }),
    );
    expect(
      clearArchivedConversationDeletion(db, {
        archivedAt,
        conversationDeleteDueAt,
        threadId: thread.id,
      }),
    ).toBe(true);
    expect(getThreadRetentionSchedule(db, thread.id)).toBeNull();
  });

  it("cancels on unarchive and replaces deadlines on rearchive", () => {
    const { db, host, thread } = setup();
    scheduleArchivedThreadRetention(db, {
      archivedAt: 1_000,
      conversationDeleteDueAt: 3_000,
      hostId: host.id,
      resourceCleanupDueAt: 2_000,
      threadId: thread.id,
    });

    expect(cancelThreadRetention(db, thread.id)).toBe(true);
    expect(getThreadRetentionSchedule(db, thread.id)).toBeNull();

    scheduleArchivedThreadRetention(db, {
      archivedAt: 4_000,
      conversationDeleteDueAt: null,
      hostId: host.id,
      resourceCleanupDueAt: 5_000,
      threadId: thread.id,
    });
    expect(getThreadRetentionSchedule(db, thread.id)).toEqual(
      expect.objectContaining({
        archivedAt: 4_000,
        conversationDeleteDueAt: null,
        resourceCleanupDueAt: 5_000,
      }),
    );
  });

  it("keeps resource cleanup retryable after the thread row is deleted", () => {
    const { db, host, thread } = setup();
    scheduleArchivedThreadRetention(db, {
      archivedAt: 1_000,
      conversationDeleteDueAt: 3_000,
      hostId: host.id,
      resourceCleanupDueAt: 2_000,
      threadId: thread.id,
    });

    scheduleImmediateThreadResourceCleanup(db, {
      hostId: null,
      now: 1_500,
      threadId: thread.id,
    });
    deleteThread(db, noopNotifier, thread.id);

    expect(getThreadRetentionSchedule(db, thread.id)).toEqual(
      expect.objectContaining({
        conversationDeleteDueAt: null,
        hostId: host.id,
        resourceCleanupDueAt: 1_500,
      }),
    );
  });
});
