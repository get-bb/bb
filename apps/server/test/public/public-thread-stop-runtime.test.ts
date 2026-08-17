import { getThread, listEvents } from "@bb/db";
import { turnScope } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  listQueuedCommands,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHost,
  seedProjectWithSource,
  seedStoredEvent,
  seedThread,
  seedThreadFixture,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import { stopThreadForCurrentState } from "../../src/services/threads/thread-lifecycle.js";

describe("thread runtime stop", () => {
  it("releases an idle runtime without changing thread state", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: { status: "idle", visibility: "hidden" },
      });
      const responsePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/stop`,
        { method: "POST" },
      );
      const stop = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      // A release tells the daemon the thread is already idle, so it unloads
      // the runtime without waiting for an active turn that cannot arrive.
      expect(stop.command).toMatchObject({ intent: "release" });

      await reportQueuedCommandSuccess(harness, stop, {
        providerCheckpointId: null,
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({ ok: true });
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
      // Nobody interrupted this thread. A release that appended an
      // interruption would put a false event in the user's timeline and would
      // interrupt the thread's pending interactions.
      expect(
        listEvents(harness.db, { threadId: thread.id }).filter(
          (event) => event.type === "system/thread/interrupted",
        ),
      ).toHaveLength(0);
    });
  });

  it("settles background commands terminated by an idle runtime release", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness, {
        thread: { status: "idle", visibility: "hidden" },
      });
      seedStoredEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "item/started",
        scope: turnScope("turn-1"),
        providerThreadId: "provider-thread-1",
        itemId: "task:orphaned-waiter",
        itemKind: "backgroundTask",
        data: {
          providerThreadId: "provider-thread-1",
          item: {
            type: "backgroundTask",
            id: "task:orphaned-waiter",
            taskType: "local_bash",
            description: "Wait for tests",
            status: "pending",
            taskStatus: "running",
            skipTranscript: false,
          },
        },
      });

      const responsePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/stop`,
        { method: "POST" },
      );
      const stop = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      await reportQueuedCommandSuccess(harness, stop, {
        providerCheckpointId: null,
      });

      expect((await responsePromise).status).toBe(200);
      const taskCompletions = listEvents(harness.db, {
        threadId: thread.id,
      }).filter((event) => event.type === "item/backgroundTask/completed");
      expect(taskCompletions).toHaveLength(1);
      expect(JSON.parse(taskCompletions[0]!.data)).toMatchObject({
        item: { status: "interrupted", taskStatus: "stopped" },
      });
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
      expect(
        listEvents(harness.db, { threadId: thread.id }).filter(
          (event) => event.type === "system/thread/interrupted",
        ),
      ).toHaveLength(0);
    });
  });

  it("waits for an active runtime release and settles the thread", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: { status: "active", visibility: "hidden" },
      });
      const responsePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/stop`,
        { method: "POST" },
      );
      const stop = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      expect(stop.command).toMatchObject({ intent: "interrupt" });
      await reportQueuedCommandSuccess(harness, stop, {
        providerCheckpointId: null,
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
      expect(
        listEvents(harness.db, { threadId: thread.id }).filter(
          (event) => event.type === "system/thread/interrupted",
        ),
      ).toHaveLength(1);
    });
  });

  it("still releases the runtime when the turn completes during the stop", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness, {
        thread: { status: "idle", visibility: "hidden" },
      });
      // The caller read the thread while it was active; the turn completed
      // before the stop transaction ran, so `stop.requested` is a no-op on the
      // settled row. The runtime is still loaded and must still be released.
      const stalePromise = stopThreadForCurrentState(
        harness.deps,
        { ...thread, status: "active" },
        environment,
      );
      const stop = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      expect(stop.command).toMatchObject({ intent: "release" });

      await reportQueuedCommandSuccess(harness, stop, {
        providerCheckpointId: null,
      });
      await stalePromise;

      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
      expect(
        listEvents(harness.db, { threadId: thread.id }).filter(
          (event) => event.type === "system/thread/interrupted",
        ),
      ).toHaveLength(0);
    });
  });

  it("makes concurrent stops share one release and one result", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: { status: "idle", visibility: "hidden" },
      });

      const first = harness.app.request(`/api/v1/threads/${thread.id}/stop`, {
        method: "POST",
      });
      const stop = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      const second = Promise.resolve(
        harness.app.request(`/api/v1/threads/${thread.id}/stop`, {
          method: "POST",
        }),
      );

      // The second caller must not report a finished release while the first
      // release is still in flight, and it must not send a duplicate RPC.
      const settledEarly = await Promise.race([
        second.then(() => "settled"),
        new Promise((resolve) => setTimeout(() => resolve("pending"), 50)),
      ]);
      expect(settledEarly).toBe("pending");
      // Only the first release is in flight. A duplicate would queue a second.
      expect(listQueuedCommands(harness, "thread.stop")).toHaveLength(1);

      await reportQueuedCommandSuccess(harness, stop, {
        providerCheckpointId: null,
      });

      expect((await first).status).toBe(200);
      expect((await second).status).toBe(200);
    });
  });

  it("reports a failed release to the caller", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: { status: "idle", visibility: "hidden" },
      });
      const responsePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/stop`,
        { method: "POST" },
      );
      const stop = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );

      await reportQueuedCommandError(harness, stop, {
        errorCode: "test_release_failure",
        errorMessage: "Test release failure",
      });

      // A release keeps no durable record, so a silent success would leave the
      // caller believing a still-loaded runtime is gone.
      expect((await responsePromise).status).toBeGreaterThanOrEqual(500);
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
    });
  });

  it("reports success when the release cannot reach a disconnected host", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { id: "host-release-offline" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "idle",
        visibility: "hidden",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/stop`,
        { method: "POST" },
      );

      // A disconnected host holds no runtime to release, so the release
      // already reached its goal.
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({ ok: true });
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
    });
  });
});
