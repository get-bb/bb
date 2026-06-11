import { setTimeout as sleep } from "node:timers/promises";
import { getThread } from "@bb/db";
import type { Environment, Thread } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { runStopRequestedThreadSweep } from "../../src/services/system/periodic-sweeps.js";
import {
  hasLiveThreadStopInFlight,
  requestThreadStopForCurrentState,
} from "../../src/services/threads/thread-lifecycle.js";
import {
  listQueuedThreadCommands,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
} from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
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

describe("thread stop retry", () => {
  it("redelivers persisted stop intent after a live stop failure", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedActiveThreadStopFixture({
        harness,
        value: 1,
      });

      requestThreadStopForCurrentState(harness.deps, thread, environment);

      const firstStopCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      expect(hasLiveThreadStopInFlight(thread.id)).toBe(true);

      await reportQueuedCommandError(harness, firstStopCommand, {
        errorCode: "test_thread_stop_failure",
        errorMessage: "Test live stop failure",
      });
      await waitForStopRpcIdle({ threadId: thread.id });
      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "active",
        stopRequestedAt: expect.any(Number),
      });

      await runStopRequestedThreadSweep(harness.deps);

      const retryStopCommand = await waitForQueuedCommandAfter(
        harness,
        firstStopCommand.row.cursor,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      expect(retryStopCommand.command).toMatchObject({
        type: "thread.stop",
        environmentId: environment.id,
        threadId: thread.id,
      });

      await reportQueuedCommandSuccess(harness, retryStopCommand, {});
      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "idle",
        stopRequestedAt: null,
      });
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

      await runStopRequestedThreadSweep(harness.deps);

      expect(
        listQueuedThreadCommands(harness, "thread.stop", thread.id),
      ).toHaveLength(1);

      await reportQueuedCommandSuccess(harness, firstStopCommand, {});
      await waitForStopRpcIdle({ threadId: thread.id });
    });
  });
});
