import {
  archiveThread,
  getThread,
  getThreadRetentionSchedule,
  markThreadDeleted,
  scheduleArchivedThreadRetention,
  setThreadSettings,
} from "@bb/db";
import { describe, expect, it } from "vitest";
import {
  ARCHIVED_CONVERSATION_RETENTION_MS,
  THREAD_RESOURCE_RETENTION_MS,
} from "../../src/constants.js";
import { archiveThreadAndHiddenSourceForks } from "../../src/services/threads/thread-archive.js";
import { finalizeStoppedThread } from "../../src/services/threads/thread-lifecycle.js";
import {
  runArchivedConversationRetentionSweep,
  runThreadResourceCleanupSweep,
  unarchiveThreadAndCancelRetention,
} from "../../src/services/threads/thread-retention.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadFixture,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("thread retention", () => {
  it("does not backfill existing archived threads", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      archiveThread(harness.db, harness.hub, thread.id);

      await runArchivedConversationRetentionSweep(harness.deps, {
        now: Number.MAX_SAFE_INTEGER,
      });
      await runThreadResourceCleanupSweep(harness.deps, {
        now: Number.MAX_SAFE_INTEGER,
      });

      expect(getThread(harness.db, thread.id)?.archivedAt).not.toBeNull();
      expect(getThreadRetentionSchedule(harness.db, thread.id)).toBeNull();
    });
  });

  it("snapshots policy at archive, cancels on unarchive, and starts fresh on rearchive", async () => {
    await withTestHarness(async (harness) => {
      const { environment, host, thread } = seedThreadFixture(harness);
      setThreadSettings(harness.db, {
        archivedConversationRetention: "30-days",
      });

      const firstArchive = archiveThreadAndHiddenSourceForks(harness.deps, {
        environment,
        thread,
      });
      if (!firstArchive || firstArchive.archivedAt === null) {
        throw new Error("Expected the first archive to succeed");
      }
      const firstSchedule = getThreadRetentionSchedule(harness.db, thread.id);
      expect(firstSchedule).toEqual(
        expect.objectContaining({
          archivedAt: firstArchive.archivedAt,
          conversationDeleteDueAt:
            firstArchive.archivedAt + ARCHIVED_CONVERSATION_RETENTION_MS,
          hostId: host.id,
          resourceCleanupDueAt:
            firstArchive.archivedAt + THREAD_RESOURCE_RETENTION_MS,
        }),
      );

      setThreadSettings(harness.db, {
        archivedConversationRetention: "forever",
      });
      expect(getThreadRetentionSchedule(harness.db, thread.id)).toEqual(
        firstSchedule,
      );

      const unarchived = unarchiveThreadAndCancelRetention(
        harness.deps,
        thread.id,
      );
      if (!unarchived) {
        throw new Error("Expected unarchive to succeed");
      }
      expect(unarchived.archivedAt).toBeNull();
      expect(getThreadRetentionSchedule(harness.db, thread.id)).toBeNull();

      await new Promise<void>((resolve) => setTimeout(resolve, 2));
      const secondArchive = archiveThreadAndHiddenSourceForks(harness.deps, {
        environment,
        thread: unarchived,
      });
      if (!secondArchive || secondArchive.archivedAt === null) {
        throw new Error("Expected the second archive to succeed");
      }
      expect(secondArchive.archivedAt).toBeGreaterThan(firstArchive.archivedAt);
      expect(getThreadRetentionSchedule(harness.db, thread.id)).toEqual(
        expect.objectContaining({
          archivedAt: secondArchive.archivedAt,
          conversationDeleteDueAt: null,
          hostId: host.id,
          resourceCleanupDueAt:
            secondArchive.archivedAt + THREAD_RESOURCE_RETENTION_MS,
        }),
      );
    });
  });

  it("hard-deletes only due archived conversations and preserves resource retry intent", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      setThreadSettings(harness.db, {
        archivedConversationRetention: "30-days",
      });
      archiveThreadAndHiddenSourceForks(harness.deps, {
        environment,
        thread,
      });
      const schedule = getThreadRetentionSchedule(harness.db, thread.id);
      if (!schedule || schedule.conversationDeleteDueAt === null) {
        throw new Error("Expected a conversation deletion deadline");
      }

      await runArchivedConversationRetentionSweep(harness.deps, {
        now: schedule.conversationDeleteDueAt - 1,
      });
      expect(getThread(harness.db, thread.id)).not.toBeNull();

      await runArchivedConversationRetentionSweep(harness.deps, {
        now: schedule.conversationDeleteDueAt,
      });
      expect(getThread(harness.db, thread.id)).toBeNull();
      expect(getThreadRetentionSchedule(harness.db, thread.id)).toEqual(
        expect.objectContaining({
          conversationDeleteDueAt: null,
          resourceCleanupDueAt: schedule.resourceCleanupDueAt,
        }),
      );
    });
  });

  it("does not hard-delete an unarchived thread with stale due intent", async () => {
    await withTestHarness(async (harness) => {
      const { host, thread } = seedThreadFixture(harness);
      const now = Date.now();
      scheduleArchivedThreadRetention(harness.db, {
        archivedAt: now - 1,
        conversationDeleteDueAt: now,
        hostId: host.id,
        resourceCleanupDueAt: now + THREAD_RESOURCE_RETENTION_MS,
        threadId: thread.id,
      });

      await runArchivedConversationRetentionSweep(harness.deps, { now });

      expect(getThread(harness.db, thread.id)).not.toBeNull();
      expect(getThreadRetentionSchedule(harness.db, thread.id)).toBeNull();
    });
  });

  it("retains only conversation intent when an archived thread has no host", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const thread = seedThread(harness.deps, {
        environmentId: null,
        projectId: project.id,
        status: "idle",
      });
      setThreadSettings(harness.db, {
        archivedConversationRetention: "30-days",
      });

      const archived = archiveThreadAndHiddenSourceForks(harness.deps, {
        environment: null,
        thread,
      });
      if (!archived || archived.archivedAt === null) {
        throw new Error("Expected hostless thread archive to succeed");
      }

      expect(getThreadRetentionSchedule(harness.db, thread.id)).toEqual(
        expect.objectContaining({
          archivedAt: archived.archivedAt,
          conversationDeleteDueAt:
            archived.archivedAt + ARCHIVED_CONVERSATION_RETENTION_MS,
          hostId: null,
          resourceCleanupDueAt: null,
        }),
      );
    });
  });

  it("retries unavailable resource cleanup and settles only after host success", async () => {
    await withTestHarness(async (harness) => {
      const { environment, host, session, thread } = seedThreadFixture(harness);
      archiveThreadAndHiddenSourceForks(harness.deps, {
        environment,
        thread,
      });
      const schedule = getThreadRetentionSchedule(harness.db, thread.id);
      if (!schedule || schedule.resourceCleanupDueAt === null) {
        throw new Error("Expected a resource cleanup deadline");
      }

      harness.hub.unregisterDaemon(session.id);
      await runThreadResourceCleanupSweep(harness.deps, {
        now: schedule.resourceCleanupDueAt,
      });
      expect(getThreadRetentionSchedule(harness.db, thread.id)).toEqual(
        schedule,
      );

      const responder = registerHostRpcResponder(harness, {
        handle(request) {
          if (request.command.type !== "thread.storage.delete") {
            throw new Error(`Unexpected command ${request.command.type}`);
          }
          expect(request.command.threadId).toBe(thread.id);
          return { ok: true, result: {} };
        },
        hostId: host.id,
        sessionId: session.id,
      });
      try {
        await runThreadResourceCleanupSweep(harness.deps, {
          now: schedule.resourceCleanupDueAt,
        });
        expect(responder.requests).toHaveLength(1);
        expect(getThreadRetentionSchedule(harness.db, thread.id)).toBeNull();
      } finally {
        responder.unregister();
      }
    });
  });

  it("records immediate resource cleanup before manual hard deletion", async () => {
    await withTestHarness(async (harness) => {
      const { host, thread } = seedThreadFixture(harness);
      const deleted = markThreadDeleted(harness.db, harness.hub, {
        threadId: thread.id,
      });
      expect(deleted).not.toBeNull();

      const beforeFinalize = Date.now();
      finalizeStoppedThread(harness.deps, { threadId: thread.id });

      expect(getThread(harness.db, thread.id)).toBeNull();
      expect(getThreadRetentionSchedule(harness.db, thread.id)).toEqual(
        expect.objectContaining({
          conversationDeleteDueAt: null,
          hostId: host.id,
          resourceCleanupDueAt: expect.any(Number),
        }),
      );
      expect(
        getThreadRetentionSchedule(harness.db, thread.id)?.resourceCleanupDueAt,
      ).toBeGreaterThanOrEqual(beforeFinalize);
    });
  });
});
