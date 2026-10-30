import { getThread, listEvents, updateThread } from "@bb/db";
import { turnScope } from "@bb/domain";
import { retryTurnRequestSchema } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPeriodicSweeps } from "../../src/services/system/periodic-sweeps.js";
import { TURN_START_DEADLINE_MS } from "../../src/services/threads/thread-lifecycle.js";
import { acceptThreadSendRequest } from "../../src/services/threads/thread-send-request.js";
import { retryFailedTurn } from "../../src/services/threads/turn-retry.js";
import {
  listQueuedThreadCommands,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedEvent,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

afterEach(() => {
  vi.useRealTimers();
});

function seedIdleThread(harness: TestAppHarness, value: number) {
  const { host, session } = seedHostSession(harness.deps, {
    id: `host-turn-start-deadline-${value}`,
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: `/tmp/turn-start-deadline-${value}`,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: `/tmp/turn-start-deadline-${value}`,
    status: "ready",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "idle",
  });
  const providerThreadId = `provider-turn-start-deadline-${value}`;
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId,
    threadId: thread.id,
  });
  return { environment, providerThreadId, sessionId: session.id, thread };
}

async function sendTurnThatNeverStarts(
  harness: TestAppHarness,
  fixture: ReturnType<typeof seedIdleThread>,
  text: string,
): Promise<void> {
  await acceptThreadSendRequest(harness.deps, {
    thread: fixture.thread,
    payload: { input: textInput(text), mode: "auto" },
  });
  const submit = await waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "turn.submit" && command.threadId === fixture.thread.id,
  );
  await reportQueuedCommandSuccess(harness, submit, { trace: { spans: [] } });
  expect(getThread(harness.db, fixture.thread.id)?.status).toBe("active");
}

async function sweepAt(harness: TestAppHarness, now: number): Promise<void> {
  vi.setSystemTime(now);
  await runPeriodicSweeps({
    ...harness.deps,
    pluginSchedules: harness.pluginService,
    plugins: harness.pluginService,
  });
}

async function settleDeadlineStop(
  harness: TestAppHarness,
  threadId: string,
): Promise<void> {
  expect(getThread(harness.db, threadId)?.status).toBe("stopping");
  const stop = await waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "thread.stop" && command.threadId === threadId,
  );
  await reportQueuedCommandSuccess(harness, stop, {
    providerCheckpointId: null,
  });
}

function deadlineErrorCount(harness: TestAppHarness, threadId: string): number {
  return listEvents(harness.db, { threadId }).filter(
    (event) =>
      event.type === "system/error" &&
      JSON.parse(event.data).code === "provider_turn_start_deadline",
  ).length;
}

function isTurnSubmitFor(threadId: string, text: string) {
  return ({ command }: { command: { type: string } & object }) =>
    command.type === "turn.submit" &&
    "threadId" in command &&
    command.threadId === threadId &&
    JSON.stringify(command).includes(text);
}

describe("turn start deadline", () => {
  it("fails a run whose requested turn never started, and Retry sends it again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withTestHarness(async (harness) => {
      const fixture = seedIdleThread(harness, 1);
      const requestedAt = Date.now();
      await sendTurnThatNeverStarts(harness, fixture, "never starts");

      await sweepAt(harness, requestedAt + TURN_START_DEADLINE_MS - 1_000);
      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("active");
      expect(
        listQueuedThreadCommands(harness, "thread.stop", fixture.thread.id),
      ).toEqual([]);

      await sweepAt(harness, requestedAt + TURN_START_DEADLINE_MS + 1_000);
      await settleDeadlineStop(harness, fixture.thread.id);

      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("error");
      expect(deadlineErrorCount(harness, fixture.thread.id)).toBe(1);

      await retryFailedTurn(harness.deps, {
        thread: getThread(harness.db, fixture.thread.id)!,
        request: retryTurnRequestSchema.parse({}),
      });
      await waitForQueuedCommand(
        harness,
        isTurnSubmitFor(fixture.thread.id, "never starts"),
      );
    });
  });

  it("sends a new message after failing a run whose turn never started", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withTestHarness(async (harness) => {
      const fixture = seedIdleThread(harness, 2);
      const requestedAt = Date.now();
      await sendTurnThatNeverStarts(harness, fixture, "never starts");

      await sweepAt(harness, requestedAt + TURN_START_DEADLINE_MS + 1_000);
      await settleDeadlineStop(harness, fixture.thread.id);
      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("error");

      await acceptThreadSendRequest(harness.deps, {
        thread: getThread(harness.db, fixture.thread.id)!,
        payload: { input: textInput("try again"), mode: "auto" },
      });
      await waitForQueuedCommand(
        harness,
        isTurnSubmitFor(fixture.thread.id, "try again"),
      );
    });
  });

  it("keeps the deadline when only the thread's metadata changes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withTestHarness(async (harness) => {
      const fixture = seedIdleThread(harness, 3);
      const requestedAt = Date.now();
      await sendTurnThatNeverStarts(harness, fixture, "never starts");

      vi.setSystemTime(requestedAt + TURN_START_DEADLINE_MS - 60_000);
      updateThread(harness.db, harness.deps.hub, fixture.thread.id, {
        title: "Renamed while waiting",
        lastReadAt: Date.now(),
      });

      await sweepAt(harness, requestedAt + TURN_START_DEADLINE_MS + 60_000);

      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("stopping");
      expect(deadlineErrorCount(harness, fixture.thread.id)).toBe(1);
    });
  });

  it("leaves a run alone once its turn has started", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withTestHarness(async (harness) => {
      const fixture = seedIdleThread(harness, 4);
      const requestedAt = Date.now();
      await sendTurnThatNeverStarts(harness, fixture, "starts");
      seedTurnStarted(harness.deps, {
        environmentId: fixture.environment.id,
        providerThreadId: fixture.providerThreadId,
        threadId: fixture.thread.id,
        turnId: "turn-long",
      });

      await sweepAt(harness, requestedAt + TURN_START_DEADLINE_MS * 10);

      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("active");
      expect(deadlineErrorCount(harness, fixture.thread.id)).toBe(0);
      expect(
        listQueuedThreadCommands(harness, "thread.stop", fixture.thread.id),
      ).toEqual([]);
    });
  });

  it("leaves a long run alone between a completed turn and its next start", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withTestHarness(async (harness) => {
      const fixture = seedIdleThread(harness, 5);
      const requestedAt = Date.now();
      await sendTurnThatNeverStarts(harness, fixture, "long run");
      vi.setSystemTime(requestedAt + TURN_START_DEADLINE_MS * 3);
      seedTurnStarted(harness.deps, {
        environmentId: fixture.environment.id,
        providerThreadId: fixture.providerThreadId,
        threadId: fixture.thread.id,
        turnId: "turn-finished",
      });
      seedEvent(harness.deps, {
        threadId: fixture.thread.id,
        environmentId: fixture.environment.id,
        providerThreadId: fixture.providerThreadId,
        sequence: 100,
        type: "turn/completed",
        scope: turnScope("turn-finished"),
        data: {
          providerThreadId: fixture.providerThreadId,
          status: "completed",
        },
      });

      await sweepAt(harness, Date.now() + 60_000);

      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("active");
      expect(deadlineErrorCount(harness, fixture.thread.id)).toBe(0);
    });
  });

  it("skips a thread whose host daemon is offline", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withTestHarness(async (harness) => {
      const fixture = seedIdleThread(harness, 6);
      const requestedAt = Date.now();
      await sendTurnThatNeverStarts(harness, fixture, "offline");
      harness.hub.unregisterDaemon(fixture.sessionId);

      await sweepAt(harness, requestedAt + TURN_START_DEADLINE_MS * 2);

      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("active");
      expect(deadlineErrorCount(harness, fixture.thread.id)).toBe(0);
      expect(
        listEvents(harness.db, { threadId: fixture.thread.id }).filter(
          (event) => event.type === "system/thread/interrupted",
        ),
      ).toEqual([]);
    });
  });
});
