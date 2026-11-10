import {
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
