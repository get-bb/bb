import { eq } from "drizzle-orm";
import {
  getLatestThreadSequence,
  getThread,
  listEvents,
  listQueuedThreadMessages,
  setExperiments,
  threads,
} from "@bb/db";
import { turnRequestEventDataSchema, turnScope } from "@bb/domain";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  groupHostDaemonEvents,
} from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleDaemonSocketClosed } from "../../src/internal/session-owner-side-effects.js";
import { applyLoggedThreadLifecycleEvent } from "../../src/services/threads/lifecycle-outcome.js";
import { runQueuedMessageDispatch } from "../../src/services/threads/queued-message-dispatch.js";
import { acceptThreadSendRequest } from "../../src/services/threads/thread-send-request.js";
import { toThreadQueuedMessage } from "../../src/services/threads/thread-queued-messages.js";
import {
  internalAuthHeaders,
  registerTestHostRpcCapture,
} from "../helpers/commands.js";
import { createUserQuestionPayload } from "../helpers/pending-interactions.js";
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

const HOST_ID = "host-restart";
const WORKSPACE_PATH = "/tmp/restart-resume-project";

afterEach(() => vi.useRealTimers());

function continueAfterRestarts(harness: TestAppHarness, enabled: boolean) {
  setExperiments(harness.db, { continueThreadsAfterRestarts: enabled });
}

function seedHostWithProject(harness: TestAppHarness) {
  const { host, session } = seedHostSession(harness.deps, { id: HOST_ID });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: WORKSPACE_PATH,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: WORKSPACE_PATH,
  });
  return { environment, host, project, session };
}

type HostFixture = ReturnType<typeof seedHostWithProject>;

function seedRunningThread(
  harness: TestAppHarness,
  fixture: HostFixture,
  args: { parentThreadId?: string; text?: string; turnId?: string } = {},
) {
  const thread = seedThread(harness.deps, {
    environmentId: fixture.environment.id,
    projectId: fixture.project.id,
    status: "active",
    ...(args.parentThreadId === undefined
      ? {}
      : { parentThreadId: args.parentThreadId }),
  });
  const providerThreadId = `provider-${thread.id}`;
  seedThreadRuntimeState(harness.deps, {
    environmentId: fixture.environment.id,
    inputText: args.text ?? "Do the thing",
    providerThreadId,
    threadId: thread.id,
  });
  const turnId = args.turnId ?? `turn-${thread.id}`;
  seedTurnStarted(harness.deps, {
    environmentId: fixture.environment.id,
    providerThreadId,
    threadId: thread.id,
    turnId,
  });
  const requestId = lastTurnRequest(harness, thread.id).requestId;
  seedEvent(harness.deps, {
    threadId: thread.id,
    environmentId: fixture.environment.id,
    providerThreadId,
    sequence: getLatestThreadSequence(harness.db, { threadId: thread.id }) + 1,
    type: "turn/input/accepted",
    scope: turnScope(turnId),
    data: { providerThreadId, clientRequestId: requestId },
  });
  return { providerThreadId, requestId, thread, turnId };
}

let instanceCounter = 0;

async function restartDaemon(
  harness: TestAppHarness,
  fixture: HostFixture,
): Promise<string> {
  instanceCounter += 1;
  const response = await harness.app.request("/internal/session/open", {
    method: "POST",
    headers: internalAuthHeaders(harness, { hostId: fixture.host.id }),
    body: JSON.stringify({
      hostId: fixture.host.id,
      instanceId: `instance-restarted-${instanceCounter}`,
      hostName: "Test Host",
      hasMachineCredential: false,
      platform: "darwin",
      dataDir: `/tmp/bb-host-data/${fixture.host.id}`,
      localApiPort: null,
      protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
      activeThreads: [],
      openThreadWork: [],
    }),
  });
  expect(response.status).toBe(201);
  const { sessionId } = (await response.json()) as { sessionId: string };
  registerTestHostRpcCapture(harness.deps, {
    hostId: fixture.host.id,
    sessionId,
  });
  await runQueuedMessageDispatch(harness.deps, {
    kind: "host-connected",
    hostId: fixture.host.id,
  });
  return sessionId;
}

function turnRequests(harness: TestAppHarness, threadId: string) {
  return listEvents(harness.db, { threadId })
    .filter((event) => event.type === "client/turn/requested")
    .map((event) => turnRequestEventDataSchema.parse(JSON.parse(event.data)));
}

function lastTurnRequest(harness: TestAppHarness, threadId: string) {
  const last = turnRequests(harness, threadId).at(-1);
  if (last === undefined) throw new Error("expected a turn request");
  return last;
}

function requestTexts(harness: TestAppHarness, threadId: string): string[] {
  return turnRequests(harness, threadId).map((request) => {
    const block = request.input[0];
    return block?.type === "text" ? block.text : "";
  });
}

function queue(harness: TestAppHarness, threadId: string) {
  return listQueuedThreadMessages(harness.db, threadId).map(
    toThreadQueuedMessage,
  );
}

function threadStatus(harness: TestAppHarness, threadId: string) {
  return getThread(harness.db, threadId)?.status;
}

function interruptionErrors(
  harness: TestAppHarness,
  threadId: string,
): { detail: string; message: string }[] {
  return listEvents(harness.db, { threadId })
    .filter((event) => event.type === "system/error")
    .map((event) => {
      const { detail, message } = JSON.parse(event.data) as {
        detail: string;
        message: string;
      };
      return { detail, message };
    })
    .filter((data) => data.message.startsWith("Thread interrupted"));
}

function interruptionErrorDetails(
  harness: TestAppHarness,
  threadId: string,
): string[] {
  return interruptionErrors(harness, threadId).map((data) => data.detail);
}

async function sweepPastResume(harness: TestAppHarness): Promise<void> {
  await runQueuedMessageDispatch(harness.deps, {
    kind: "time-reached",
    now: Date.now() + 120_000,
  });
}

async function finishTurnAndDrain(
  harness: TestAppHarness,
  threadId: string,
): Promise<void> {
  applyLoggedThreadLifecycleEvent(harness.deps, {
    event: { type: "run.succeeded" },
    threadId,
  });
  await runQueuedMessageDispatch(harness.deps, {
    kind: "thread-ready",
    threadId,
  });
}

async function sendMessage(
  harness: TestAppHarness,
  args: {
    mode: "auto" | "queue-if-active";
    text: string;
    threadId: string;
  },
): Promise<void> {
  const thread = getThread(harness.db, args.threadId);
  if (thread === null) throw new Error("expected a thread");
  await acceptThreadSendRequest(harness.deps, {
    payload: { input: textInput(args.text), mode: args.mode },
    thread,
  });
}

function requireRetryPayload(
  row: ReturnType<typeof queue>[number] | undefined,
) {
  if (row?.payload.kind !== "retry") {
    throw new Error("expected a retry row");
  }
  return row.payload;
}

describe("continuing threads after a restart", () => {
  it("queues a resume for a turn a daemon restart cut off, then continues it", async () => {
    await withTestHarness(async (harness) => {
      continueAfterRestarts(harness, true);
      const fixture = seedHostWithProject(harness);
      const { requestId, thread } = seedRunningThread(harness, fixture);

      await restartDaemon(harness, fixture);

      expect(threadStatus(harness, thread.id)).toBe("error");
      expect(interruptionErrors(harness, thread.id)).toEqual([
        {
          message: "Thread interrupted because bb restarted",
          detail: "bb will continue the thread in a few seconds.",
        },
      ]);
      const [resume, ...rest] = queue(harness, thread.id);
      expect(rest).toEqual([]);
      expect(requireRetryPayload(resume)).toEqual({
        kind: "retry",
        retryOfTurnRequestId: requestId,
        attempt: 2,
        reason: "bb restarted",
      });
      expect(resume?.waitingOn).toEqual({ kind: "time" });
      expect(resume?.sendAt).toBeGreaterThan(Date.now());

      await sweepPastResume(harness);

      expect(threadStatus(harness, thread.id)).toBe("active");
      expect(queue(harness, thread.id)).toEqual([]);
      expect(lastTurnRequest(harness, thread.id)).toMatchObject({
        retryOfRequestId: requestId,
        retryAttempt: 2,
        input: [
          expect.objectContaining({
            text: "Please continue.",
            visibility: "agent-only",
          }),
        ],
      });
    });
  });

  it("sends messages queued during the restart after the resume, in order", async () => {
    await withTestHarness(async (harness) => {
      continueAfterRestarts(harness, true);
      const fixture = seedHostWithProject(harness);
      const { thread } = seedRunningThread(harness, fixture);

      handleDaemonSocketClosed(harness.deps, {
        sessionId: fixture.session.id,
      });
      await sendMessage(harness, {
        mode: "queue-if-active",
        text: "First follow-up",
        threadId: thread.id,
      });
      await sendMessage(harness, {
        mode: "queue-if-active",
        text: "Second follow-up",
        threadId: thread.id,
      });
      await restartDaemon(harness, fixture);
      await runQueuedMessageDispatch(harness.deps, {
        kind: "thread-ready",
        threadId: thread.id,
      });

      expect(requestTexts(harness, thread.id)).toEqual(["Do the thing"]);
      expect(
        queue(harness, thread.id).map((row) => row.payload.kind),
      ).toEqual(["retry", "inline", "inline"]);

      await sweepPastResume(harness);
      await finishTurnAndDrain(harness, thread.id);
      await finishTurnAndDrain(harness, thread.id);

      expect(requestTexts(harness, thread.id)).toEqual([
        "Do the thing",
        "Please continue.",
        "First follow-up",
        "Second follow-up",
      ]);
      expect(queue(harness, thread.id)).toEqual([]);
    });
  });

  it("drops a pending resume when the user sends a message first", async () => {
    await withTestHarness(async (harness) => {
      continueAfterRestarts(harness, true);
      const fixture = seedHostWithProject(harness);
      const { thread } = seedRunningThread(harness, fixture);

      await restartDaemon(harness, fixture);
      expect(
        queue(harness, thread.id).map((row) => row.payload.kind),
      ).toEqual(["retry"]);

      await sendMessage(harness, {
        mode: "auto",
        text: "Actually, do this instead",
        threadId: thread.id,
      });
      await sweepPastResume(harness);

      expect(requestTexts(harness, thread.id)).toEqual([
        "Do the thing",
        "Actually, do this instead",
      ]);
      expect(queue(harness, thread.id)).toEqual([]);
    });
  });

  it("resumes only turns the restart cut: not a manual stop, a pending question, or an archived thread", async () => {
    await withTestHarness(async (harness) => {
      continueAfterRestarts(harness, true);
      const fixture = seedHostWithProject(harness);
      const running = seedRunningThread(harness, fixture);
      const stopped = seedRunningThread(harness, fixture);
      applyLoggedThreadLifecycleEvent(harness.deps, {
        event: { type: "stop.requested" },
        threadId: stopped.thread.id,
      });
      const asking = seedRunningThread(harness, fixture);
      const registered =
        harness.deps.pendingInteractions.registerPendingInteraction({
          interaction: {
            threadId: asking.thread.id,
            turnId: asking.turnId,
            providerId: "codex",
            providerThreadId: asking.providerThreadId,
            providerRequestId: "question-1",
            payload: createUserQuestionPayload(),
          },
        });
      expect(registered.outcome).not.toBe("rejected");
      const archived = seedRunningThread(harness, fixture);
      harness.db
        .update(threads)
        .set({ archivedAt: Date.now() })
        .where(eq(threads.id, archived.thread.id))
        .run();

      await restartDaemon(harness, fixture);
      await sweepPastResume(harness);

      expect(requestTexts(harness, running.thread.id)).toEqual([
        "Do the thing",
        "Please continue.",
      ]);
      for (const other of [stopped, asking, archived]) {
        expect(queue(harness, other.thread.id)).toEqual([]);
        expect(requestTexts(harness, other.thread.id)).toEqual([
          "Do the thing",
        ]);
      }
      expect(threadStatus(harness, stopped.thread.id)).toBe("idle");
      expect(threadStatus(harness, asking.thread.id)).toBe("error");
      expect(interruptionErrorDetails(harness, asking.thread.id)).toEqual([
        "Please retry the thread to continue.",
      ]);
    });
  });

  it("stops resuming a turn after three restarts in a row cut it off", async () => {
    await withTestHarness(async (harness) => {
      continueAfterRestarts(harness, true);
      const fixture = seedHostWithProject(harness);
      const { requestId, thread } = seedRunningThread(harness, fixture);

      for (const attempt of [2, 3, 4]) {
        await restartDaemon(harness, fixture);
        await sweepPastResume(harness);
        expect(lastTurnRequest(harness, thread.id)).toMatchObject({
          retryOfRequestId: requestId,
          retryAttempt: attempt,
        });
        expect(threadStatus(harness, thread.id)).toBe("active");
      }

      await restartDaemon(harness, fixture);
      await sweepPastResume(harness);

      expect(threadStatus(harness, thread.id)).toBe("error");
      expect(queue(harness, thread.id)).toEqual([]);
      expect(turnRequests(harness, thread.id)).toHaveLength(4);
      expect(interruptionErrorDetails(harness, thread.id).at(-1)).toBe(
        "Please retry the thread to continue.",
      );
    });
  });

  it("leaves cut threads in error while the experiment is off", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedHostWithProject(harness);
      const first = seedRunningThread(harness, fixture);

      await restartDaemon(harness, fixture);
      await sweepPastResume(harness);

      expect(threadStatus(harness, first.thread.id)).toBe("error");
      expect(queue(harness, first.thread.id)).toEqual([]);
      expect(requestTexts(harness, first.thread.id)).toEqual(["Do the thing"]);
      expect(interruptionErrorDetails(harness, first.thread.id)).toEqual([
        "Please retry the thread to continue.",
      ]);

      continueAfterRestarts(harness, true);
      const second = seedRunningThread(harness, fixture);
      await restartDaemon(harness, fixture);
      await sweepPastResume(harness);

      expect(requestTexts(harness, first.thread.id)).toEqual(["Do the thing"]);
      expect(requestTexts(harness, second.thread.id)).toEqual([
        "Do the thing",
        "Please continue.",
      ]);
    });
  });

  it("tells the parent nothing when a child resumes, and tells it when the child finishes", async () => {
    await withTestHarness(async (harness) => {
      continueAfterRestarts(harness, true);
      const fixture = seedHostWithProject(harness);
      const parent = seedThread(harness.deps, {
        environmentId: fixture.environment.id,
        projectId: fixture.project.id,
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: fixture.environment.id,
        inputText: "Delegate the work",
        providerThreadId: `provider-${parent.id}`,
        threadId: parent.id,
      });
      const child = seedRunningThread(harness, fixture, {
        parentThreadId: parent.id,
      });

      const sessionId = await restartDaemon(harness, fixture);
      await sweepPastResume(harness);

      expect(threadStatus(harness, child.thread.id)).toBe("active");
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      expect(queue(harness, parent.id)).toEqual([]);
      expect(
        turnRequests(harness, parent.id).map((request) => request.initiator),
      ).toEqual(["user"]);

      const response = await harness.app.request("/internal/session/events", {
        method: "POST",
        headers: internalAuthHeaders(harness, { hostId: fixture.host.id }),
        body: JSON.stringify({
          sessionId,
          eventGroups: groupHostDaemonEvents([
            {
              threadId: child.thread.id,
              event: {
                type: "turn/started",
                threadId: child.thread.id,
                providerThreadId: child.providerThreadId,
                scope: turnScope("resumed-turn"),
              },
            },
            {
              threadId: child.thread.id,
              event: {
                type: "turn/completed",
                threadId: child.thread.id,
                providerThreadId: child.providerThreadId,
                scope: turnScope("resumed-turn"),
                status: "completed",
              },
            },
          ]),
        }),
      });
      expect(response.status).toBe(200);

      await vi.waitFor(
        () =>
          expect(
            turnRequests(harness, parent.id).map(
              (request) => request.initiator,
            ),
          ).toEqual(["user", "system"]),
        { timeout: 10_000 },
      );
    });
  });
});
