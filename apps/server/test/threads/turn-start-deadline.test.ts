import { getThread, listEvents, updateThread } from "@bb/db";
import {
  turnRequestEventDataSchema,
  turnScope,
  type ThreadParentNotifications,
} from "@bb/domain";
import { retryTurnRequestSchema } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPeriodicSweeps } from "../../src/services/system/periodic-sweeps.js";
import { applyLoggedThreadLifecycleEvent } from "../../src/services/threads/lifecycle-outcome.js";
import {
  TURN_START_DEADLINE_MS,
  TURN_START_DEADLINE_RECONNECT_GRACE_MS,
  turnStartDeadlineSweep,
} from "../../src/services/threads/thread-lifecycle.js";
import { acceptThreadSendRequest } from "../../src/services/threads/thread-send-request.js";
import { retryFailedTurn } from "../../src/services/threads/turn-retry.js";
import {
  listQueuedThreadCommands,
  registerTestHostRpcCapture,
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

function seedIdleThread(
  harness: TestAppHarness,
  value: number,
  parentNotifications?: ThreadParentNotifications,
) {
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
  const parent =
    parentNotifications === undefined
      ? null
      : seedThread(harness.deps, {
          projectId: project.id,
          environmentId: environment.id,
          status: "idle",
          title: "Parent",
        });
  if (parent !== null) {
    seedThreadRuntimeState(harness.deps, {
      environmentId: environment.id,
      providerThreadId: `provider-turn-start-deadline-parent-${value}`,
      threadId: parent.id,
    });
  }
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "idle",
    parentThreadId: parent?.id ?? null,
    ...(parentNotifications !== undefined ? { parentNotifications } : {}),
  });
  const providerThreadId = `provider-turn-start-deadline-${value}`;
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId,
    threadId: thread.id,
  });
  return {
    environment,
    parent,
    providerThreadId,
    sessionId: session.id,
    thread,
  };
}

function parentSystemRequests(harness: TestAppHarness, parentThreadId: string) {
  return listEvents(harness.db, { threadId: parentThreadId })
    .filter((row) => row.type === "client/turn/requested")
    .map((row) => turnRequestEventDataSchema.parse(JSON.parse(row.data)))
    .filter((data) => data.initiator === "system");
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

  it("waits a minute after the host reconnects before stopping a run", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withTestHarness(async (harness) => {
      const fixture = seedIdleThread(harness, 7);
      const requestedAt = Date.now();
      await sendTurnThatNeverStarts(harness, fixture, "reconnects");
      harness.hub.unregisterDaemon(fixture.sessionId);

      const reconnectedAt = requestedAt + TURN_START_DEADLINE_MS * 2;
      vi.setSystemTime(reconnectedAt);
      registerTestHostRpcCapture(harness, {
        hostId: fixture.environment.hostId,
        sessionId: fixture.sessionId,
      });

      await sweepAt(
        harness,
        reconnectedAt + TURN_START_DEADLINE_RECONNECT_GRACE_MS - 1_000,
      );
      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("active");
      expect(deadlineErrorCount(harness, fixture.thread.id)).toBe(0);

      await sweepAt(
        harness,
        reconnectedAt + TURN_START_DEADLINE_RECONNECT_GRACE_MS + 1_000,
      );
      await settleDeadlineStop(harness, fixture.thread.id);
      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("error");
      expect(deadlineErrorCount(harness, fixture.thread.id)).toBe(1);
    });
  });
  it.each([
    { settlesThread: true, status: "idle" },
    { settlesThread: false, status: "active" },
  ])(
    "leaves a long turn alone when it completes after the sweep lists it (thread $status)",
    async ({ settlesThread, status }) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      await withTestHarness(async (harness) => {
        const fixture = seedIdleThread(harness, settlesThread ? 8 : 9);
        const requestedAt = Date.now();
        await sendTurnThatNeverStarts(harness, fixture, "long turn");
        seedTurnStarted(harness.deps, {
          environmentId: fixture.environment.id,
          providerThreadId: fixture.providerThreadId,
          threadId: fixture.thread.id,
          turnId: "turn-long",
        });
        vi.setSystemTime(requestedAt + TURN_START_DEADLINE_MS * 8);

        const connectedAt = harness.hub.getDaemonConnectedAtForHost.bind(
          harness.hub,
        );
        vi.spyOn(harness.hub, "getDaemonConnectedAtForHost").mockImplementation(
          (hostId) => {
            seedEvent(harness.deps, {
              threadId: fixture.thread.id,
              environmentId: fixture.environment.id,
              providerThreadId: fixture.providerThreadId,
              sequence: 100,
              type: "turn/completed",
              scope: turnScope("turn-long"),
              data: {
                providerThreadId: fixture.providerThreadId,
                status: "completed",
              },
            });
            if (settlesThread) {
              applyLoggedThreadLifecycleEvent(harness.deps, {
                event: { type: "run.succeeded" },
                threadId: fixture.thread.id,
              });
            }
            return connectedAt(hostId);
          },
        );
        await turnStartDeadlineSweep(harness.deps, Date.now()).run(
          harness.deps,
          Date.now(),
        );

        expect(harness.hub.getDaemonConnectedAtForHost).toHaveBeenCalledTimes(
          1,
        );
        expect(getThread(harness.db, fixture.thread.id)?.status).toBe(status);
        expect(deadlineErrorCount(harness, fixture.thread.id)).toBe(0);
        expect(
          listQueuedThreadCommands(harness, "thread.stop", fixture.thread.id),
        ).toEqual([]);
      });
    },
  );

  it.each([
    { parentNotifications: "auto", notified: true },
    { parentNotifications: "stuck", notified: true },
    { parentNotifications: "off", notified: false },
  ] as const)(
    "tells the parent when bb stops a child whose turn never started ($parentNotifications)",
    async ({ parentNotifications, notified }) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      await withTestHarness(async (harness) => {
        const fixture = seedIdleThread(harness, 10, parentNotifications);
        const parentId = fixture.parent!.id;
        const requestedAt = Date.now();
        await sendTurnThatNeverStarts(harness, fixture, "never starts");

        await sweepAt(harness, requestedAt + TURN_START_DEADLINE_MS + 1_000);
        await settleDeadlineStop(harness, fixture.thread.id);
        expect(getThread(harness.db, fixture.thread.id)?.status).toBe("error");
        vi.setSystemTime(Date.now() + 5_000);

        if (!notified) {
          await new Promise((resolve) => setTimeout(resolve, 2_500));
          expect(parentSystemRequests(harness, parentId)).toEqual([]);
          return;
        }
        await vi.waitFor(
          () =>
            expect(parentSystemRequests(harness, parentId)).toMatchObject([
              { systemMessageKind: "child-failed" },
            ]),
          { timeout: 5_000 },
        );
        expect(
          JSON.stringify(parentSystemRequests(harness, parentId)[0]?.input),
        ).toContain(
          "was stopped by bb because its provider did not start the turn within 5 minutes",
        );
      });
    },
  );
});
