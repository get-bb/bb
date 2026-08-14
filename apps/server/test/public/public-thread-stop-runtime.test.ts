import { getThread, listEvents } from "@bb/db";
import { describe, expect, it } from "vitest";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { seedThreadFixture } from "../helpers/seed.js";
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
});
