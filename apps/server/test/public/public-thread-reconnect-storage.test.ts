import {
  getThread,
  markThreadDeleted,
  markThreadStorageDeleted,
  requestThreadPurge,
} from "@bb/db";
import { expect, it } from "vitest";
import { reconcileDaemonReportedThreads } from "../../src/services/threads/thread-lifecycle.js";
import {
  listQueuedCommands,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

it.each(["idle", "error", "active", "starting", "stopping"] as const)(
  "does not repeat completed storage deletion on reconnect for %s threads",
  async (status) => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const completed = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status,
      });
      const pending = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      for (const thread of [completed, pending]) {
        markThreadDeleted(harness.db, harness.deps.hub, {
          threadId: thread.id,
        });
      }
      markThreadStorageDeleted(harness.db, { threadId: completed.id });
      if (status === "idle" || status === "error") {
        requestThreadPurge(harness.db, {
          now: Date.now(),
          threadId: completed.id,
        });
      }

      await reconcileDaemonReportedThreads(harness.deps, {
        hostId: host.id,
        activeThreadIds: [],
        undeliveredEventThreadIds: [],
        sameDaemonInstance: false,
      });
      const retry = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.storage.delete" &&
          command.threadId === pending.id,
      );
      const commands = listQueuedCommands(harness, "thread.storage.delete");
      await reportQueuedCommandSuccess(harness, retry, {
        providerCheckpointId: null,
      });
      expect(commands).toEqual([
        expect.objectContaining({ threadId: pending.id }),
      ]);
    });
  },
);

it("sends at most four storage deletions to a host at once", async () => {
  await withTestHarness(async (harness) => {
    const { host } = seedHostSession(harness.deps);
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
    });
    const deleted = Array.from({ length: 6 }, () =>
      seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      }),
    );
    for (const thread of deleted) {
      markThreadDeleted(harness.db, harness.deps.hub, { threadId: thread.id });
    }

    await reconcileDaemonReportedThreads(harness.deps, {
      hostId: host.id,
      activeThreadIds: [],
      undeliveredEventThreadIds: [],
      sameDaemonInstance: false,
    });

    for (let remaining = deleted.length; remaining > 0; remaining -= 1) {
      await expect
        .poll(() => listQueuedCommands(harness, "thread.storage.delete").length)
        .toBe(Math.min(4, remaining));
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "thread.storage.delete",
      );
      await reportQueuedCommandSuccess(harness, queued, {
        providerCheckpointId: null,
      });
    }
    await expect
      .poll(() =>
        deleted.map(
          (thread) =>
            getThread(harness.db, thread.id)?.storageDeletedAt ?? null,
        ),
      )
      .not.toContain(null);
  });
});
