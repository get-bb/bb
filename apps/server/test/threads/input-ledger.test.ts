import {
  getLatestSessionForHost,
  getThread,
  listQueuedThreadMessages,
  queuedThreadMessages,
  type EnvironmentRow,
} from "@bb/db";
import { eq } from "drizzle-orm";
import { turnScope, type Thread, type ThreadEvent } from "@bb/domain";
import { groupHostDaemonEvents } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import {
  returnUnsettledSubmittedInputs,
  SUBMITTED_INPUT_SETTLE_MS,
} from "../../src/services/threads/input-ledger.js";
import { applyLoggedThreadLifecycleEvent } from "../../src/services/threads/lifecycle-outcome.js";
import { handleHostSessionOpened } from "../../src/internal/session-owner-side-effects.js";
import { acceptThreadSendRequest } from "../../src/services/threads/thread-send-request.js";
import { retryFailedTurn } from "../../src/services/threads/turn-retry.js";
import { retryTurnRequestSchema } from "@bb/server-contract";
import {
  internalAuthHeaders,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  type QueuedCommand,
} from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedSession,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

interface LedgerFixture {
  environment: EnvironmentRow;
  providerThreadId: string;
  sessionId: string;
  thread: Thread;
}

function seedLedgerFixture(
  harness: TestAppHarness,
  args: { status: "active" | "idle"; value: number },
): LedgerFixture {
  const { host, session } = seedHostSession(harness.deps, {
    id: `host-ledger-${args.value}`,
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: `/tmp/ledger-${args.value}`,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: `/tmp/ledger-${args.value}`,
    status: "ready",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: args.status,
  });
  const providerThreadId = `provider-ledger-${args.value}`;
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId,
    threadId: thread.id,
  });
  return { environment, providerThreadId, sessionId: session.id, thread };
}

async function reportDaemonIdle(
  harness: TestAppHarness,
  fixture: LedgerFixture,
): Promise<void> {
  const hostId = fixture.environment.hostId;
  const previousSession = getLatestSessionForHost(harness.db, { hostId });
  const openedSession = seedSession(harness.deps, hostId);
  fixture.sessionId = openedSession.id;
  await handleHostSessionOpened(harness.deps, {
    activeThreads: [],
    openThreadWork: [],
    undeliveredEventThreadIds: [],
    hostId,
    openedSession,
    previousSession,
  });
}

async function postDaemonEvents(
  harness: TestAppHarness,
  fixture: LedgerFixture,
  events: ThreadEvent[],
): Promise<void> {
  const response = await harness.app.request("/internal/session/events", {
    method: "POST",
    headers: internalAuthHeaders(harness),
    body: JSON.stringify({
      sessionId: fixture.sessionId,
      eventGroups: groupHostDaemonEvents(
        events.map((event) => ({ threadId: fixture.thread.id, event })),
      ),
    }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
}

function turnCompleted(fixture: LedgerFixture, turnId: string): ThreadEvent {
  return {
    type: "turn/completed",
    threadId: fixture.thread.id,
    providerThreadId: fixture.providerThreadId,
    scope: turnScope(turnId),
    status: "completed",
  };
}

async function send(
  harness: TestAppHarness,
  fixture: LedgerFixture,
  args: { mode: "auto" | "steer"; text: string },
): Promise<QueuedCommand & { command: { type: "turn.submit" } }> {
  const thread = getThread(harness.db, fixture.thread.id)!;
  await expect(
    acceptThreadSendRequest(harness.deps, {
      thread,
      payload: { input: textInput(args.text), mode: args.mode },
    }),
  ).resolves.toMatchObject({ delivery: "sent" });
  return waitForTurnSubmit(harness, fixture, args.text);
}

async function waitForTurnSubmit(
  harness: TestAppHarness,
  fixture: LedgerFixture,
  text: string,
): Promise<QueuedCommand & { command: { type: "turn.submit" } }> {
  const queued = await waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "turn.submit" &&
      command.threadId === fixture.thread.id &&
      JSON.stringify(command.input).includes(text),
  );
  if (queued.command.type !== "turn.submit") {
    throw new Error("Expected turn.submit");
  }
  return queued as QueuedCommand & { command: { type: "turn.submit" } };
}

function ledgerRows(harness: TestAppHarness, threadId: string) {
  return harness.db
    .select()
    .from(queuedThreadMessages)
    .where(eq(queuedThreadMessages.threadId, threadId))
    .all();
}

function queuedTexts(harness: TestAppHarness, threadId: string): string[] {
  return listQueuedThreadMessages(harness.db, threadId).map(
    (row) => row.content,
  );
}

describe("input ledger", () => {
  it("holds an input as submitted until the provider accepts it", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedLedgerFixture(harness, { status: "idle", value: 1 });
      const submit = await send(harness, fixture, {
        mode: "auto",
        text: "accept me",
      });

      expect(ledgerRows(harness, fixture.thread.id)).toMatchObject([
        { state: "submitted", submittedRequestId: submit.command.requestId },
      ]);
      expect(queuedTexts(harness, fixture.thread.id)).toEqual([]);

      await reportQueuedCommandSuccess(harness, submit, {
        trace: { spans: [] },
      });
      expect(ledgerRows(harness, fixture.thread.id)).toHaveLength(1);

      await postDaemonEvents(harness, fixture, [
        {
          type: "turn/started",
          threadId: fixture.thread.id,
          providerThreadId: fixture.providerThreadId,
          scope: turnScope("turn-accepted"),
        },
        {
          type: "turn/input/accepted",
          threadId: fixture.thread.id,
          providerThreadId: fixture.providerThreadId,
          scope: turnScope("turn-accepted"),
          clientRequestId: submit.command.requestId,
        },
      ]);
      expect(ledgerRows(harness, fixture.thread.id)).toEqual([]);
    });
  });

  it("queues a start refused for a competing turn and sends it when that turn ends", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedLedgerFixture(harness, { status: "idle", value: 2 });
      const submit = await send(harness, fixture, {
        mode: "auto",
        text: "refused for a competing turn",
      });
      seedTurnStarted(harness.deps, {
        environmentId: fixture.environment.id,
        providerThreadId: fixture.providerThreadId,
        threadId: fixture.thread.id,
        turnId: "turn-unrequested",
      });

      await reportQueuedCommandError(harness, submit, {
        errorCode: "competing_turn",
        errorMessage: "Refusing to start a competing turn",
      });

      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("active");
      expect(
        listQueuedThreadMessages(harness.db, fixture.thread.id),
      ).toMatchObject([
        {
          content: JSON.stringify(textInput("refused for a competing turn")),
          state: "waiting",
        },
      ]);

      await postDaemonEvents(harness, fixture, [
        turnCompleted(fixture, "turn-unrequested"),
      ]);
      const resent = await waitForTurnSubmit(
        harness,
        fixture,
        "refused for a competing turn",
      );
      expect(resent.command.requestId).not.toBe(submit.command.requestId);
      expect(queuedTexts(harness, fixture.thread.id)).toEqual([]);
    });
  });

  it("sends a steer that reached the daemon after its turn ended as the next turn", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedLedgerFixture(harness, {
        status: "active",
        value: 3,
      });
      seedTurnStarted(harness.deps, {
        environmentId: fixture.environment.id,
        providerThreadId: fixture.providerThreadId,
        threadId: fixture.thread.id,
        turnId: "turn-ending",
      });
      const submit = await send(harness, fixture, {
        mode: "steer",
        text: "late steer",
      });
      expect(submit.command.target).toMatchObject({
        mode: "steer",
        expectedTurnId: "turn-ending",
      });

      await postDaemonEvents(harness, fixture, [
        turnCompleted(fixture, "turn-ending"),
      ]);
      await reportQueuedCommandError(harness, submit, {
        errorCode: "stale_turn",
        errorMessage: "Expected active turn turn-ending",
      });

      const resent = await waitForTurnSubmit(harness, fixture, "late steer");
      expect(resent.command.target).toMatchObject({ mode: "start" });
    });
  });

  it("keeps a live turn running when its steer is refused and queues the steer", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedLedgerFixture(harness, {
        status: "active",
        value: 4,
      });
      seedTurnStarted(harness.deps, {
        environmentId: fixture.environment.id,
        providerThreadId: fixture.providerThreadId,
        threadId: fixture.thread.id,
        turnId: "turn-live",
      });
      const submit = await send(harness, fixture, {
        mode: "steer",
        text: "refused steer",
      });

      await reportQueuedCommandError(harness, submit, {
        errorCode: "provider_error",
        errorMessage: "steer is not accepted right now",
      });

      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("active");
      expect(queuedTexts(harness, fixture.thread.id)).toEqual([
        JSON.stringify(textInput("refused steer")),
      ]);
    });
  });

  it("keeps a refused start with its failed turn until a newer message replaces it", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedLedgerFixture(harness, { status: "idle", value: 5 });
      const submit = await send(harness, fixture, {
        mode: "auto",
        text: "fails the run",
      });

      await reportQueuedCommandError(harness, submit, {
        errorCode: "provider_error",
        errorMessage: "session is gone",
      });

      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("error");
      expect(ledgerRows(harness, fixture.thread.id)).toMatchObject([
        { state: "submitted", submittedRequestId: submit.command.requestId },
      ]);

      await send(harness, fixture, { mode: "auto", text: "something else" });

      expect(
        listQueuedThreadMessages(harness.db, fixture.thread.id),
      ).toMatchObject([
        {
          content: JSON.stringify(textInput("fails the run")),
          state: "failed_exhausted",
        },
      ]);
    });
  });

  it("lets a retry carry a refused start without queueing it again", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedLedgerFixture(harness, { status: "idle", value: 7 });
      const submit = await send(harness, fixture, {
        mode: "auto",
        text: "retry me",
      });
      await reportQueuedCommandError(harness, submit, {
        errorCode: "provider_error",
        errorMessage: "session is gone",
      });

      await retryFailedTurn(harness.deps, {
        thread: getThread(harness.db, fixture.thread.id)!,
        request: retryTurnRequestSchema.parse({}),
      });

      const retried = await waitForTurnSubmit(harness, fixture, "retry me");
      expect(retried.command.requestId).not.toBe(submit.command.requestId);
      expect(ledgerRows(harness, fixture.thread.id)).toMatchObject([
        { state: "submitted", submittedRequestId: retried.command.requestId },
      ]);
    });
  });

  it("returns an input whose turn never started once its run ends", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedLedgerFixture(harness, { status: "idle", value: 6 });
      const submit = await send(harness, fixture, {
        mode: "auto",
        text: "never started",
      });
      await reportQueuedCommandSuccess(harness, submit, {
        trace: { spans: [] },
      });
      applyLoggedThreadLifecycleEvent(harness.deps, {
        threadId: fixture.thread.id,
        event: { type: "stop.requested" },
      });
      await reportDaemonIdle(harness, fixture);
      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("idle");

      returnUnsettledSubmittedInputs(harness.deps, Date.now());
      expect(queuedTexts(harness, fixture.thread.id)).toEqual([]);

      returnUnsettledSubmittedInputs(
        harness.deps,
        Date.now() + SUBMITTED_INPUT_SETTLE_MS + 1,
      );
      expect(
        listQueuedThreadMessages(harness.db, fixture.thread.id),
      ).toMatchObject([
        {
          content: JSON.stringify(textInput("never started")),
          state: "failed_exhausted",
        },
      ]);
    });
  });

  it("keeps a steer whose fallback start is slow, and drops a returned copy once it is accepted", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedLedgerFixture(harness, {
        status: "active",
        value: 8,
      });
      seedTurnStarted(harness.deps, {
        environmentId: fixture.environment.id,
        providerThreadId: fixture.providerThreadId,
        threadId: fixture.thread.id,
        turnId: "turn-a",
      });
      const submit = await send(harness, fixture, {
        mode: "steer",
        text: "slow fallback",
      });
      await postDaemonEvents(harness, fixture, [
        turnCompleted(fixture, "turn-a"),
      ]);
      await reportQueuedCommandSuccess(harness, submit, {
        trace: { spans: [] },
      });
      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("idle");

      returnUnsettledSubmittedInputs(
        harness.deps,
        Date.now() + SUBMITTED_INPUT_SETTLE_MS + 1,
      );
      expect(queuedTexts(harness, fixture.thread.id)).toEqual([]);

      await reportDaemonIdle(harness, fixture);
      returnUnsettledSubmittedInputs(
        harness.deps,
        Date.now() + SUBMITTED_INPUT_SETTLE_MS + 1,
      );
      expect(queuedTexts(harness, fixture.thread.id)).toEqual([
        JSON.stringify(textInput("slow fallback")),
      ]);

      await postDaemonEvents(harness, fixture, [
        {
          type: "turn/started",
          threadId: fixture.thread.id,
          providerThreadId: fixture.providerThreadId,
          scope: turnScope("turn-b"),
        },
        {
          type: "turn/input/accepted",
          threadId: fixture.thread.id,
          providerThreadId: fixture.providerThreadId,
          scope: turnScope("turn-b"),
          clientRequestId: submit.command.requestId,
        },
      ]);
      expect(ledgerRows(harness, fixture.thread.id)).toEqual([]);
    });
  });
});
