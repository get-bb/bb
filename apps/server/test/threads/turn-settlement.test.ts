import { getActiveStoredTurnId, getThread, listEvents } from "@bb/db";
import { threadScope, type ThreadEvent } from "@bb/domain";
import { groupHostDaemonEvents } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import {
  stopRunsWhoseTurnNeverStarted,
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

describe("turn start deadline", () => {
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
