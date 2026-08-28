import {
  archiveThread,
  getThread,
  getThreadRetentionSchedule,
  scheduleArchivedThreadRetention,
  setThreadSettings,
} from "@bb/db";
import { describe, expect, it } from "vitest";
import { ARCHIVED_CONVERSATION_RETENTION_MS } from "../../src/constants.js";
import { archiveThreadAndHiddenSourceForks } from "../../src/services/threads/thread-archive.js";
import {
  runArchivedConversationRetentionSweep,
  unarchiveThreadAndCancelRetention,
} from "../../src/services/threads/thread-retention.js";
import { seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("archived conversation retention", () => {
  it("does not backfill existing archived threads", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      archiveThread(harness.db, harness.hub, thread.id);

      await runArchivedConversationRetentionSweep(harness.deps, {
        now: Number.MAX_SAFE_INTEGER,
      });

      expect(getThread(harness.db, thread.id)?.archivedAt).not.toBeNull();
      expect(getThreadRetentionSchedule(harness.db, thread.id)).toBeNull();
    });
  });

  it("snapshots policy at archive, cancels on unarchive, and starts fresh on rearchive", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
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
      expect(getThreadRetentionSchedule(harness.db, thread.id)).toBeNull();
    });
  });

  it("hard-deletes only due archived conversations", async () => {
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
      if (!schedule) {
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
      expect(getThreadRetentionSchedule(harness.db, thread.id)).toBeNull();
    });
  });

  it("does not hard-delete an unarchived thread with stale due intent", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      const now = Date.now();
      scheduleArchivedThreadRetention(harness.db, {
        archivedAt: now - 1,
        conversationDeleteDueAt: now,
        threadId: thread.id,
      });

      await runArchivedConversationRetentionSweep(harness.deps, { now });

      expect(getThread(harness.db, thread.id)).not.toBeNull();
      expect(getThreadRetentionSchedule(harness.db, thread.id)).toBeNull();
    });
  });
});
