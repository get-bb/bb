import { turnScope } from "@bb/domain";
import { getThread, events, threads } from "@bb/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedEvent,
  seedQueuedMessage,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import { handleUpdateEnvironmentDirectoryToolCall } from "../../src/services/threads/thread-environment-directory.js";
import { withThreadSendGuard } from "../../src/services/threads/thread-context-mutation-guard.js";
import {
  waitForQueuedCommand,
  reportQueuedCommandSuccess,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";

function fixture(harness: TestAppHarness, status: "idle" | "active" = "idle") {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const current = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: "/tmp/current",
  });
  const target = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: "/tmp/target",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: current.id,
    status,
  });
  return { current, target, thread };
}

function change(harness: TestAppHarness, threadId: string, path: string) {
  return harness.app.request(`/api/v1/threads/${threadId}/directory`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      path,
      expectedEnvironmentId: getThread(harness.db, threadId)?.environmentId,
    }),
  });
}

describe("manual thread directory change", () => {
  it("keeps history and project, reuses the host environment, and records a thread operation", async () => {
    await withTestHarness(async (harness) => {
      const { target, thread } = fixture(harness);
      const response = await change(harness, thread.id, "/tmp/target/");
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await readJson(response)).toMatchObject({
        id: thread.id,
        environmentId: target.id,
        projectId: thread.projectId,
      });
      expect(getThread(harness.db, thread.id)?.environmentId).toBe(target.id);
      const operations = harness.db
        .select()
        .from(events)
        .where(eq(events.threadId, thread.id))
        .all();
      expect(operations).toHaveLength(1);
      expect(operations[0]).toMatchObject({
        scopeKind: "thread",
        turnId: null,
        type: "system/operation",
      });
      expect(JSON.parse(operations[0]!.data)).toMatchObject({
        operation: "environment_directory_update",
        metadata: { nextPath: target.path },
      });
    });
  });

  it.each(["relative/path", "/", "/tmp/with\0nul"])(
    "rejects invalid path %s",
    async (path) => {
      await withTestHarness(async (harness) => {
        const { current, thread } = fixture(harness);
        const response = await change(harness, thread.id, path);
        expect(response.status).toBe(400);
        expect(getThread(harness.db, thread.id)?.environmentId).toBe(
          current.id,
        );
      });
    },
  );

  it("rejects a stale expected environment without moving the thread", async () => {
    await withTestHarness(async (harness) => {
      const { current, thread } = fixture(harness);
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/directory`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            path: "/tmp/target",
            expectedEnvironmentId: "env_stale",
          }),
        },
      );
      expect(response.status).toBe(409);
      expect(getThread(harness.db, thread.id)?.environmentId).toBe(current.id);
    });
  });

  it("rejects a thread with queued work", async () => {
    await withTestHarness(async (harness) => {
      const { current, target, thread } = fixture(harness);
      seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: [{ type: "text", text: "pending", mentions: [] }],
      });
      expect((await change(harness, thread.id, target.path!)).status).toBe(409);
      expect(getThread(harness.db, thread.id)?.environmentId).toBe(current.id);
    });
  });

  it("refuses active and archived threads", async () => {
    await withTestHarness(async (harness) => {
      const { current, target, thread } = fixture(harness, "active");
      expect((await change(harness, thread.id, target.path!)).status).toBe(409);
      harness.db
        .update(threads)
        .set({ status: "idle", archivedAt: Date.now() })
        .where(eq(threads.id, thread.id))
        .run();
      expect((await change(harness, thread.id, target.path!)).status).toBe(409);
      expect(getThread(harness.db, thread.id)?.environmentId).toBe(current.id);
    });
  });
});

describe.each(["manual", "agent"] as const)(
  "directory admission via %s",
  (surface) => {
    it.each([
      "/tmp/target/",
      "relative/path",
      "/",
      "/tmp/managed-other-project",
    ])("applies the same path policy for %s", async (path) => {
      await withTestHarness(async (harness) => {
        const { current, target, thread } = fixture(harness);
        const { project: owner } = seedProjectWithSource(harness.deps, {
          hostId: current.hostId,
          path: "/tmp/owner",
        });
        seedEnvironment(harness.deps, {
          hostId: current.hostId,
          projectId: owner.id,
          path: "/tmp/managed-other-project",
          environmentProviderId: "git-worktree",
          providerOwnsPath: true,
        });
        const success = path === "/tmp/target/";
        if (surface === "manual") {
          const response = await change(harness, thread.id, path);
          expect(response.ok).toBe(success);
        } else {
          seedEvent(harness.deps, {
            threadId: thread.id,
            environmentId: current.id,
            providerThreadId: "provider-directory",
            sequence: 1,
            type: "turn/started",
            scope: turnScope("turn-directory-test"),
            data: { providerThreadId: "provider-directory" },
          });
          expect(
            await handleUpdateEnvironmentDirectoryToolCall(harness.deps, {
              currentEnvironment: current,
              input: { path },
              thread,
              turnId: "turn-directory-test",
            }),
          ).toMatchObject({ success });
        }
        expect(getThread(harness.db, thread.id)?.environmentId).toBe(
          success ? target.id : current.id,
        );
      });
    });
  },
);

describe("manual directory provisioning", () => {
  it.each([
    "complete",
    "environment-changed",
    "thread-started",
    "deleted",
  ] as const)(
    "checks for concurrent changes at attachment: %s",
    async (outcome) => {
      await withTestHarness(async (harness) => {
        const { current, target, thread } = fixture(harness);
        const responsePromise = change(
          harness,
          thread.id,
          "/tmp/new-directory",
        );
        const queued = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "environment.attach" &&
            command.path === "/tmp/new-directory",
        );
        expect(queued.command).toMatchObject({ type: "environment.attach" });
        await expect(
          withThreadSendGuard(thread.id, async () => undefined),
        ).rejects.toMatchObject({ status: 409 });
        if (outcome === "environment-changed")
          harness.db
            .update(threads)
            .set({ environmentId: target.id })
            .where(eq(threads.id, thread.id))
            .run();
        if (outcome === "thread-started")
          harness.db
            .update(threads)
            .set({ status: "active" })
            .where(eq(threads.id, thread.id))
            .run();
        if (outcome === "deleted")
          harness.db
            .update(threads)
            .set({ deletedAt: Date.now() })
            .where(eq(threads.id, thread.id))
            .run();
        await reportQueuedCommandSuccess(harness, queued, {
          path: "/tmp/new-directory",
          isGitRepo: true,
          isWorktree: false,
          branchName: "main",
          defaultBranch: "main",
          transcript: [],
        });
        const response = await responsePromise;
        expect(response.status, await response.clone().text()).toBe(
          outcome === "complete" ? 200 : 409,
        );
        expect(
          getThread(harness.db, thread.id)?.environmentId === current.id,
        ).toBe(outcome === "thread-started" || outcome === "deleted");
        await expect(
          withThreadSendGuard(thread.id, async () => "released"),
        ).resolves.toBe("released");
      });
    },
  );
});
