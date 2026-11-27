import { getThread } from "@bb/db";
import { listEvents } from "@bb/db/testing";
import { describe, expect, it, vi } from "vitest";
import {
  listQueuedThreadCommands,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
  type QueuedCommand,
} from "../helpers/commands.js";
import { seedThreadFixture, seedThreadIdentity } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const PROVIDER_REFUSAL = {
  errorCode: "codex_rejected",
  errorMessage: "thread already has an active writer",
};

function seedArchivableCodexThread(harness: TestAppHarness) {
  const { environment, thread } = seedThreadFixture(harness, {
    environment: { path: "/tmp/archive-provider-failure", status: "ready" },
    thread: { status: "idle", providerId: "codex" },
  });
  seedThreadIdentity(harness.deps, {
    environmentId: environment.id,
    threadId: thread.id,
    providerThreadId: "provider-archive-failure",
  });
  return thread;
}

async function archive(
  harness: TestAppHarness,
  threadId: string,
  after?: QueuedCommand,
) {
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/archive-all`,
    { method: "POST" },
  );
  expect(response.status).toBe(200);
  return waitForQueuedCommandAfter(
    harness,
    after?.row.cursor ?? -1,
    ({ command }) =>
      command.type === "thread.archive" && command.threadId === threadId,
  );
}

async function unarchive(harness: TestAppHarness, threadId: string) {
  const archivedAt = getThread(harness.db, threadId)?.archivedAt;
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/unarchive`,
    { method: "POST" },
  );
  expect(response.status).toBe(200);
  await reportQueuedCommandSuccess(
    harness,
    await waitForQueuedCommand(
      harness,
      ({ command }) =>
        command.type === "thread.unarchive" && command.threadId === threadId,
    ),
    {},
  );
  await vi.waitFor(() => expect(Date.now()).toBeGreaterThan(archivedAt ?? 0));
}

function threadErrors(harness: TestAppHarness, threadId: string) {
  return listEvents(harness.db, { threadId })
    .filter((event) => event.type === "system/error")
    .map((event) => JSON.parse(event.data));
}

describe("provider archive failure", () => {
  it("records a rejected provider archive in the thread timeline", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedArchivableCodexThread(harness);

      await reportQueuedCommandError(
        harness,
        await archive(harness, thread.id),
        PROVIDER_REFUSAL,
      );

      await expect
        .poll(() => threadErrors(harness, thread.id))
        .toEqual([
          {
            code: "provider_archive_failed",
            message: expect.stringContaining(
              "Unarchive and archive the thread again",
            ),
            detail: "thread already has an active writer",
          },
        ]);
      expect(getThread(harness.db, thread.id)).toMatchObject({
        archivedAt: expect.any(Number),
        status: "idle",
      });
    });
  });

  it("sends the provider archive again after unarchive and archive", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedArchivableCodexThread(harness);

      await reportQueuedCommandError(
        harness,
        await archive(harness, thread.id),
        PROVIDER_REFUSAL,
      );
      await expect.poll(() => threadErrors(harness, thread.id)).toHaveLength(1);

      await unarchive(harness, thread.id);
      await reportQueuedCommandSuccess(
        harness,
        await archive(harness, thread.id),
        {},
      );

      expect(
        listQueuedThreadCommands(harness, "thread.archive", thread.id),
      ).toEqual([]);
      expect(threadErrors(harness, thread.id)).toHaveLength(1);
    });
  });

  it("ignores a late failure from an archive the user has since undone", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedArchivableCodexThread(harness);
      const warn = vi.spyOn(harness.deps.logger, "warn");

      const firstArchive = await archive(harness, thread.id);
      await unarchive(harness, thread.id);
      const secondArchive = await archive(harness, thread.id, firstArchive);
      await reportQueuedCommandError(harness, firstArchive, PROVIDER_REFUSAL);
      await vi.waitFor(() =>
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({ threadId: thread.id }),
          "Live thread archive command failed",
        ),
      );
      expect(threadErrors(harness, thread.id)).toEqual([]);

      await reportQueuedCommandError(harness, secondArchive, PROVIDER_REFUSAL);
      await expect.poll(() => threadErrors(harness, thread.id)).toHaveLength(1);
    });
  });
});
