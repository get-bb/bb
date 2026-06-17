import { setTimeout as sleep } from "node:timers/promises";
import { getThread, listEvents } from "@bb/db";
import type { Environment, Thread } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  finalizeStoppedThread,
  hasLiveThreadStopInFlight,
  requestThreadStopForCurrentState,
} from "../../src/services/threads/thread-lifecycle.js";
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
  seedThread,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

interface ActiveThreadStopFixture {
  environment: Environment;
  thread: Thread;
}

interface SeedActiveThreadStopFixtureArgs {
  harness: TestAppHarness;
  value: number;
}

interface WaitForStopRpcIdleArgs {
  threadId: string;
}

function seedActiveThreadStopFixture(
  args: SeedActiveThreadStopFixtureArgs,
): ActiveThreadStopFixture {
  const { host } = seedHostSession(args.harness.deps, {
    id: `host-thread-stop-retry-${args.value}`,
  });
  const { project } = seedProjectWithSource(args.harness.deps, {
    hostId: host.id,
    path: `/tmp/thread-stop-retry-${args.value}`,
  });
  const environment = seedEnvironment(args.harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: `/tmp/thread-stop-retry-${args.value}`,
    status: "ready",
  });
  const thread = seedThread(args.harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "active",
  });

  return { environment, thread };
}

async function waitForStopRpcIdle(
  args: WaitForStopRpcIdleArgs,
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (!hasLiveThreadStopInFlight(args.threadId)) {
      return;
    }
    await sleep(10);
  }

  throw new Error("Timed out waiting for live thread stop RPC to settle");
}

describe("thread stop dispatch", () => {
  it("does not re-dispatch the stop after a live stop RPC failure", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedActiveThreadStopFixture({
        harness,
        value: 1,
      });

      requestThreadStopForCurrentState(harness.deps, thread, environment);

      const stopCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      expect(hasLiveThreadStopInFlight(thread.id)).toBe(true);
      // The stop is the durable `stopping` status, not a side-field.
      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "stopping",
      });

      // A live stop RPC failure is NOT retried inline. The thread stays
      // `stopping` (the durable record), the in-flight guard releases so a
      // fresh stop can be issued, and no second stop command is queued.
      // Recovery is reconnect reconciliation or the turn settling itself —
      // not a retry loop.
      await reportQueuedCommandError(harness, stopCommand, {
        errorCode: "test_thread_stop_failure",
        errorMessage: "Test live stop failure",
      });
      await waitForStopRpcIdle({ threadId: thread.id });

      expect(hasLiveThreadStopInFlight(thread.id)).toBe(false);
      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "stopping",
      });
      // No follow-up stop command was dispatched (a retry would have queued
      // one); the failed command was consumed and nothing replaced it.
      expect(
        listQueuedThreadCommands(harness, "thread.stop", thread.id),
      ).toHaveLength(0);
    });
  });

  it("treats a second stop completion as a no-op after the stop already settled", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedActiveThreadStopFixture({
        harness,
        value: 3,
      });
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        threadId: thread.id,
        turnId: "turn-stop-settles-twice",
      });

      requestThreadStopForCurrentState(harness.deps, thread, environment);
      const stopCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      await reportQueuedCommandSuccess(harness, stopCommand, {});
      const settled = getThread(harness.db, thread.id);
      expect(settled).toMatchObject({
        status: "idle",
      });

      // Daemon reconnect reconciliation re-finalizes settling threads; a second
      // completion of the same stop must change nothing.
      const finalized = finalizeStoppedThread(harness.deps, {
        threadId: thread.id,
      });

      expect(finalized).toBe(true);
      expect(getThread(harness.db, thread.id)).toEqual(settled);
      const threadEvents = listEvents(harness.db, { threadId: thread.id });
      expect(
        threadEvents.filter((event) => event.type === "turn/completed"),
      ).toHaveLength(1);
      expect(
        threadEvents.filter(
          (event) => event.type === "system/thread/interrupted",
        ),
      ).toHaveLength(1);
    });
  });

  it("does not queue duplicate stop commands while a stop RPC is in flight", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedActiveThreadStopFixture({
        harness,
        value: 2,
      });

      requestThreadStopForCurrentState(harness.deps, thread, environment);

      const firstStopCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      expect(hasLiveThreadStopInFlight(thread.id)).toBe(true);

      // A second stop request while one is in flight is deduped by the
      // process-local RPC guard, not re-queued.
      requestThreadStopForCurrentState(harness.deps, thread, environment);

      expect(
        listQueuedThreadCommands(harness, "thread.stop", thread.id),
      ).toHaveLength(1);

      await reportQueuedCommandSuccess(harness, firstStopCommand, {});
      await waitForStopRpcIdle({ threadId: thread.id });
    });
  });
});
