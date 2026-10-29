import {
  getActiveStoredTurnId,
  getThread,
  listEvents,
  updateThread,
} from "@bb/db";
import { threadScope, turnScope, type ThreadEvent } from "@bb/domain";
import { groupHostDaemonEvents } from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyLoggedThreadLifecycleEvent } from "../../src/services/threads/lifecycle-outcome.js";
import {
  stopRunsWhoseTurnNeverStarted,
  stopTurnThatOutlivedItsRun,
  TURN_START_DEADLINE_MS,
} from "../../src/services/threads/thread-lifecycle.js";
import { acceptThreadSendRequest } from "../../src/services/threads/thread-send-request.js";
import { retryTurnRequestSchema } from "@bb/server-contract";
import { retryFailedTurn } from "../../src/services/threads/turn-retry.js";
import {
  internalAuthHeaders,
  listQueuedThreadCommands,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedStoredEvent,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedRunFixture(
  harness: TestAppHarness,
  args: { status: "active" | "idle"; value: number },
) {
  const { host, session } = seedHostSession(harness.deps, {
    id: `host-settle-${args.value}`,
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: `/tmp/settle-${args.value}`,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: `/tmp/settle-${args.value}`,
    status: "ready",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: args.status,
  });
  const providerThreadId = `provider-settle-${args.value}`;
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId,
    threadId: thread.id,
  });
  return { environment, providerThreadId, sessionId: session.id, thread };
}

async function postDaemonEvents(
  harness: TestAppHarness,
  args: { events: ThreadEvent[]; sessionId: string; threadId: string },
): Promise<void> {
  const response = await harness.app.request("/internal/session/events", {
    method: "POST",
    headers: internalAuthHeaders(harness),
    body: JSON.stringify({
      sessionId: args.sessionId,
      eventGroups: groupHostDaemonEvents(
        args.events.map((event) => ({ threadId: args.threadId, event })),
      ),
    }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
}

describe("run exit closes its turn", () => {
  it("closes the open turn when the provider process exits mid-turn", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedRunFixture(harness, { status: "active", value: 1 });
      seedTurnStarted(harness.deps, {
        environmentId: fixture.environment.id,
        providerThreadId: fixture.providerThreadId,
        threadId: fixture.thread.id,
        turnId: "turn-orphaned",
      });

      await postDaemonEvents(harness, {
        sessionId: fixture.sessionId,
        threadId: fixture.thread.id,
        events: [
          {
            type: "system/error",
            threadId: fixture.thread.id,
            scope: threadScope(),
            code: "provider_process_exited",
            message: "Provider process exited",
          },
        ],
      });

      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("error");
      expect(getActiveStoredTurnId(harness.db, fixture.thread.id)).toBeNull();
      const completed = listEvents(harness.db, {
        threadId: fixture.thread.id,
      }).filter((event) => event.type === "turn/completed");
      expect(completed).toHaveLength(1);
      expect(JSON.parse(completed[0]!.data)).toMatchObject({
        status: "failed",
      });
    });
  });
});

describe("batched turn boundaries", () => {
  it("keeps the next turn open when its start arrives in the same batch as the previous completion", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedRunFixture(harness, { status: "active", value: 4 });
      seedTurnStarted(harness.deps, {
        environmentId: fixture.environment.id,
        providerThreadId: fixture.providerThreadId,
        threadId: fixture.thread.id,
        turnId: "turn-a",
      });

      await postDaemonEvents(harness, {
        sessionId: fixture.sessionId,
        threadId: fixture.thread.id,
        events: [
          {
            type: "turn/completed",
            threadId: fixture.thread.id,
            providerThreadId: fixture.providerThreadId,
            scope: turnScope("turn-a"),
            status: "completed",
          },
          {
            type: "turn/started",
            threadId: fixture.thread.id,
            providerThreadId: fixture.providerThreadId,
            scope: turnScope("turn-b"),
          },
        ],
      });

      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("active");
      expect(getActiveStoredTurnId(harness.db, fixture.thread.id)).toBe(
        "turn-b",
      );
    });
  });
});

describe("turn start deadline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function startTurnThatNeverStarts(
    harness: TestAppHarness,
    fixture: ReturnType<typeof seedRunFixture>,
  ) {
    await acceptThreadSendRequest(harness.deps, {
      thread: fixture.thread,
      payload: { input: textInput("never starts"), mode: "auto" },
    });
    const submit = await waitForQueuedCommand(
      harness,
      ({ command }) =>
        command.type === "turn.submit" &&
        command.threadId === fixture.thread.id,
    );
    await reportQueuedCommandSuccess(harness, submit, {
      trace: { spans: [] },
    });
    expect(getThread(harness.db, fixture.thread.id)?.status).toBe("active");
  }

  it("fails a run whose turn never started so the input can be retried", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedRunFixture(harness, { status: "idle", value: 2 });
      await startTurnThatNeverStarts(harness, fixture);

      stopRunsWhoseTurnNeverStarted(harness.deps, Date.now());
      expect(
        listQueuedThreadCommands(harness, "thread.stop", fixture.thread.id),
      ).toEqual([]);

      stopRunsWhoseTurnNeverStarted(
        harness.deps,
        Date.now() + TURN_START_DEADLINE_MS,
      );
      const stop = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" &&
          command.threadId === fixture.thread.id,
      );
      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("stopping");
      await reportQueuedCommandSuccess(harness, stop, {
        providerCheckpointId: null,
      });

      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("error");
      expect(
        listEvents(harness.db, { threadId: fixture.thread.id }).some(
          (event) =>
            event.type === "system/error" &&
            JSON.parse(event.data).code === "provider_turn_start_deadline",
        ),
      ).toBe(true);
      await retryFailedTurn(harness.deps, {
        thread: getThread(harness.db, fixture.thread.id)!,
        request: retryTurnRequestSchema.parse({}),
      });
      const retried = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "turn.submit" &&
          command.threadId === fixture.thread.id &&
          JSON.stringify(command.input).includes("never starts"),
      );
      expect(retried.command.type).toBe("turn.submit");
    });
  });

  it("keeps the deadline when only the thread's metadata changes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withTestHarness(async (harness) => {
      const fixture = seedRunFixture(harness, { status: "idle", value: 5 });
      await startTurnThatNeverStarts(harness, fixture);
      vi.setSystemTime(Date.now() + TURN_START_DEADLINE_MS - 60_000);
      updateThread(harness.db, harness.deps.hub, fixture.thread.id, {
        lastReadAt: Date.now(),
      });
      vi.setSystemTime(Date.now() + 2 * 60_000);

      stopRunsWhoseTurnNeverStarted(harness.deps, Date.now());

      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("stopping");
    });
  });

  it("leaves a long run alone between a finished turn and its next start", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withTestHarness(async (harness) => {
      const fixture = seedRunFixture(harness, { status: "idle", value: 6 });
      await startTurnThatNeverStarts(harness, fixture);
      vi.setSystemTime(Date.now() + TURN_START_DEADLINE_MS * 3);
      seedTurnStarted(harness.deps, {
        environmentId: fixture.environment.id,
        providerThreadId: fixture.providerThreadId,
        threadId: fixture.thread.id,
        turnId: "turn-finished",
      });
      seedStoredEvent(harness.deps, {
        threadId: fixture.thread.id,
        environmentId: fixture.environment.id,
        sequence: 100,
        type: "turn/completed",
        scope: turnScope("turn-finished"),
        providerThreadId: fixture.providerThreadId,
        data: {
          providerThreadId: fixture.providerThreadId,
          status: "completed",
        },
      });
      vi.setSystemTime(Date.now() + 60_000);

      stopRunsWhoseTurnNeverStarted(harness.deps, Date.now());

      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("active");
    });
  });

  it("leaves a run alone once its turn has started", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedRunFixture(harness, { status: "idle", value: 3 });
      await startTurnThatNeverStarts(harness, fixture);
      seedTurnStarted(harness.deps, {
        environmentId: fixture.environment.id,
        providerThreadId: fixture.providerThreadId,
        threadId: fixture.thread.id,
        turnId: "turn-long",
      });

      stopRunsWhoseTurnNeverStarted(
        harness.deps,
        Date.now() + TURN_START_DEADLINE_MS * 10,
      );

      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("active");
      expect(
        listQueuedThreadCommands(harness, "thread.stop", fixture.thread.id),
      ).toEqual([]);
    });
  });
});

describe("stale stop results", () => {
  it("leaves a newer run's background task running when an older stop is acknowledged", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedRunFixture(harness, { status: "active", value: 7 });
      seedTurnStarted(harness.deps, {
        environmentId: fixture.environment.id,
        providerThreadId: fixture.providerThreadId,
        threadId: fixture.thread.id,
        turnId: "turn-old",
      });
      applyLoggedThreadLifecycleEvent(harness.deps, {
        event: { type: "run.failed" },
        threadId: fixture.thread.id,
      });
      stopTurnThatOutlivedItsRun(harness.deps, {
        threadId: fixture.thread.id,
        turnId: "turn-old",
      });
      const stop = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" &&
          command.threadId === fixture.thread.id,
      );
      await acceptThreadSendRequest(harness.deps, {
        thread: getThread(harness.db, fixture.thread.id)!,
        payload: { input: textInput("new run"), mode: "auto" },
      });
      const submit = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "turn.submit" &&
          command.threadId === fixture.thread.id,
      );
      if (submit.command.type !== "turn.submit") throw new Error("submit");
      await postDaemonEvents(harness, {
        sessionId: fixture.sessionId,
        threadId: fixture.thread.id,
        events: [
          {
            type: "turn/started",
            threadId: fixture.thread.id,
            providerThreadId: fixture.providerThreadId,
            scope: turnScope("turn-new"),
          },
          {
            type: "turn/input/accepted",
            threadId: fixture.thread.id,
            providerThreadId: fixture.providerThreadId,
            scope: turnScope("turn-new"),
            clientRequestId: submit.command.requestId,
          },
        ],
      });
      seedStoredEvent(harness.deps, {
        threadId: fixture.thread.id,
        environmentId: fixture.environment.id,
        sequence: 100,
        type: "item/started",
        scope: turnScope("turn-new"),
        providerThreadId: fixture.providerThreadId,
        itemId: "task-new",
        itemKind: "backgroundTask",
        data: {
          providerThreadId: fixture.providerThreadId,
          item: {
            id: "task-new",
            type: "backgroundTask",
            taskType: "local_workflow",
            description: "new work",
            status: "pending",
            taskStatus: "running",
            skipTranscript: false,
            foreground: false,
            workflowName: "test",
            usage: { totalTokens: 0, toolUses: 0, durationMs: 0 },
          },
        },
      });

      await reportQueuedCommandSuccess(harness, stop, {
        providerCheckpointId: null,
      });

      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("active");
      expect(
        listEvents(harness.db, { threadId: fixture.thread.id }).filter(
          (event) => event.type === "item/backgroundTask/completed",
        ),
      ).toEqual([]);
    });
  });
});
