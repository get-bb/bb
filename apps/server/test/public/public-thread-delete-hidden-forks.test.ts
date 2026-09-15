import { archiveThread, getThread, threads } from "@bb/db";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { reconcileDaemonReportedThreads } from "../../src/services/threads/thread-lifecycle.js";
import { sendNextQueuedMessageIfPresent } from "../../src/services/threads/queued-messages.js";
import {
  listQueuedThreadCommands,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedQueuedMessage,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("direct deletion of hidden fork sources", () => {
  it("keeps ownership links when cleanup throws and completes on retry", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const source = seedThread(harness.deps, { projectId: project.id });
      const fork = seedThread(harness.deps, {
        projectId: project.id,
        sourceThreadId: source.id,
        visibility: "hidden",
      });
      const nested = seedThread(harness.deps, {
        projectId: project.id,
        sourceThreadId: fork.id,
        visibility: "hidden",
      });
      const close = vi
        .spyOn(harness.deps.terminalSessions, "closeArchivedThreadTerminals")
        .mockImplementationOnce(() => {
          throw new Error("Injected cleanup failure");
        });
      try {
        const remove = () =>
          harness.app.request(`/api/v1/threads/${source.id}`, {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ childThreadsConfirmed: true }),
          });
        expect((await remove()).status).toBe(500);
        expect(getThread(harness.db, source.id)?.deletedAt).toBeNull();
        expect(getThread(harness.db, fork.id)?.sourceThreadId).toBe(source.id);
        expect(getThread(harness.db, nested.id)?.sourceThreadId).toBe(fork.id);
        expect((await remove()).status).toBe(200);
        expect(getThread(harness.db, source.id)).toBeNull();
        for (const thread of [fork, nested]) {
          expect(getThread(harness.db, thread.id)?.archivedAt).toEqual(
            expect.any(Number),
          );
        }
      } finally {
        close.mockRestore();
      }
    });
  });

  it.each(["pending", "starting"] as const)(
    "archives a %s fork with queued work and no environment",
    async (status) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps);
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const source = seedThread(harness.deps, { projectId: project.id });
        const fork = seedThread(harness.deps, {
          projectId: project.id,
          sourceThreadId: source.id,
          visibility: "hidden",
          status,
        });
        seedQueuedMessage(harness.deps, {
          threadId: fork.id,
          content: [{ type: "text", text: "Waiting to start", mentions: [] }],
        });
        const response = await harness.app.request(
          `/api/v1/threads/${source.id}`,
          {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ childThreadsConfirmed: true }),
          },
        );
        expect(response.status).toBe(200);
        expect(getThread(harness.db, source.id)).toBeNull();
        expect(getThread(harness.db, fork.id)).toMatchObject({
          archivedAt: expect.any(Number),
          sourceThreadId: null,
        });
        expect(
          await sendNextQueuedMessageIfPresent(harness.deps, {
            threadId: fork.id,
          }),
        ).toBe(false);
        expect(
          listQueuedThreadCommands(harness, "thread.start", fork.id),
        ).toEqual([]);
      });
    },
  );

  it.each([false, true])(
    "archives used fork trees before losing source links (archived intermediary: %s)",
    async (archivedIntermediary) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps);
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
        });
        const source = seedThread(harness.deps, {
          projectId: project.id,
          environmentId: environment.id,
        });
        const sideChat = seedThread(harness.deps, {
          environmentId: environment.id,
          projectId: project.id,
          sourceThreadId: source.id,
          originKind: "fork",
          originPluginId: "side-chat",
          visibility: "hidden",
        });
        seedThreadRuntimeState(harness.deps, {
          environmentId: environment.id,
          inputText: "A used side chat must be cleaned up too",
          providerThreadId: "used-side-chat",
          threadId: sideChat.id,
        });
        const nested = seedThread(harness.deps, {
          projectId: project.id,
          sourceThreadId: sideChat.id,
          visibility: "hidden",
        });
        const descendant = seedThread(harness.deps, {
          projectId: project.id,
          parentThreadId: nested.id,
        });
        const child = seedThread(harness.deps, {
          projectId: project.id,
          parentThreadId: source.id,
        });
        const visibleFork = seedThread(harness.deps, {
          projectId: project.id,
          sourceThreadId: source.id,
        });
        const visibleForkSideChat = seedThread(harness.deps, {
          projectId: project.id,
          sourceThreadId: visibleFork.id,
          visibility: "hidden",
        });
        if (archivedIntermediary)
          archiveThread(harness.db, harness.deps.hub, sideChat.id);

        const response = await harness.app.request(
          `/api/v1/threads/${source.id}`,
          {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ childThreadsConfirmed: true }),
          },
        );

        expect(response.status).toBe(200);
        expect(getThread(harness.db, source.id)?.deletedAt).toEqual(
          expect.any(Number),
        );
        for (const thread of [sideChat, nested, descendant]) {
          expect(getThread(harness.db, thread.id)).toMatchObject({
            archivedAt: expect.any(Number),
            deletedAt: null,
          });
        }
        expect(getThread(harness.db, sideChat.id)?.sourceThreadId).toBe(
          source.id,
        );
        const storageDelete = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "thread.storage.delete" &&
            command.threadId === source.id,
        );
        await reportQueuedCommandError(harness, storageDelete, {
          errorCode: "temporary_failure",
          errorMessage: "Storage deletion failed",
        });
        expect(getThread(harness.db, sideChat.id)).toMatchObject({
          sourceThreadId: source.id,
          archivedAt: expect.any(Number),
        });
        await reconcileDaemonReportedThreads(harness.deps, {
          hostId: host.id,
          activeThreadIds: [],
          sameDaemonInstance: true,
        });
        const retry = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "thread.storage.delete" &&
            command.threadId === source.id,
        );
        await reportQueuedCommandSuccess(harness, retry, {
          providerCheckpointId: null,
        });
        expect(getThread(harness.db, source.id)).toBeNull();
        expect(getThread(harness.db, sideChat.id)?.sourceThreadId).toBeNull();
        for (const thread of [child, visibleFork, visibleForkSideChat]) {
          expect(getThread(harness.db, thread.id)).toMatchObject({
            archivedAt: null,
            deletedAt: null,
          });
        }
        expect(getThread(harness.db, child.id)?.parentThreadId).toBeNull();
      });
    },
  );

  it.each([
    { status: "active", alreadyArchived: false },
    { status: "stopping", alreadyArchived: false },
    { status: "starting", alreadyArchived: false },
    { status: "idle", alreadyArchived: false },
    { status: "error", alreadyArchived: false },
    { status: "active", alreadyArchived: true },
  ] as const)(
    "stops active forks and retries after source deletion (persisted status: $status, already archived: $alreadyArchived)",
    async ({ status, alreadyArchived }) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps);
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
        });
        const source = seedThread(harness.deps, { projectId: project.id });
        const fork = seedThread(harness.deps, {
          projectId: project.id,
          environmentId: environment.id,
          sourceThreadId: source.id,
          visibility: "hidden",
          status: "active",
        });
        seedThreadRuntimeState(harness.deps, {
          environmentId: environment.id,
          providerThreadId: "active-side-chat",
          threadId: fork.id,
        });
        seedQueuedMessage(harness.deps, {
          threadId: fork.id,
          content: [{ type: "text", text: "Queued work", mentions: [] }],
        });
        if (alreadyArchived)
          archiveThread(harness.db, harness.deps.hub, fork.id);
        const response = await harness.app.request(
          `/api/v1/threads/${source.id}`,
          {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ childThreadsConfirmed: true }),
          },
        );
        expect(response.status).toBe(200);
        expect(getThread(harness.db, source.id)).toBeNull();
        expect(getThread(harness.db, fork.id)).toMatchObject({
          archivedAt: expect.any(Number),
          status: "stopping",
          sourceThreadId: null,
        });
        const stop = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "thread.stop" && command.threadId === fork.id,
        );
        await reportQueuedCommandError(harness, stop, {
          errorCode: "temporary_failure",
          errorMessage: "Disconnected",
        });
        harness.db
          .update(threads)
          .set({ status })
          .where(eq(threads.id, fork.id))
          .run();
        await reconcileDaemonReportedThreads(harness.deps, {
          hostId: host.id,
          activeThreadIds: [fork.id],
          sameDaemonInstance: true,
        });
        const retry = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "thread.stop" && command.threadId === fork.id,
        );
        await reportQueuedCommandSuccess(harness, retry, {
          providerCheckpointId: null,
        });
        await sendNextQueuedMessageIfPresent(harness.deps, {
          threadId: fork.id,
        });
        expect(getThread(harness.db, fork.id)).toMatchObject({
          archivedAt: expect.any(Number),
          status: status === "error" ? "error" : "idle",
        });
        expect(
          listQueuedThreadCommands(harness, "turn.submit", fork.id),
        ).toEqual([]);
        expect(
          listQueuedThreadCommands(harness, "thread.start", fork.id),
        ).toEqual([]);
      });
    },
  );
});
