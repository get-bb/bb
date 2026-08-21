// Messages addressed to a thread that is blocked on a pending user interaction
// (AskUserQuestion, approvals) used to be lost (#1650): `/send` returned 409
// and persisted nothing, and `queueParentSystemMessage` returned false with
// nothing logged. They now wait in `deferred_thread_messages` and deliver when
// the interaction settles.
import { and, eq } from "drizzle-orm";
import {
  events,
  getThread,
  listDeferredThreadMessages,
  listQueuedThreadMessages,
  markThreadDeleted,
  type DbConnection,
} from "@bb/db";
import {
  turnRequestEventDataSchema,
  type PendingInteractionCreate,
  type TurnRequestEventData,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import { applyLoggedThreadLifecycleEvent } from "../../src/services/threads/lifecycle-outcome.js";
import { queueParentSystemMessage } from "../../src/services/threads/parent-system-messages.js";
import {
  flushDeferredThreadMessages,
  runDeferredThreadMessageSweep,
} from "../../src/services/threads/thread-send-request.js";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  createUserAnswerResolution,
  createUserQuestionPayload,
} from "../helpers/pending-interactions.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { createTestAppHarness, withTestHarness } from "../helpers/test-app.js";

type TestHarness = Awaited<ReturnType<typeof createTestAppHarness>>;

function listTurnRequests(
  db: DbConnection,
  threadId: string,
): TurnRequestEventData[] {
  return db
    .select()
    .from(events)
    .where(
      and(
        eq(events.threadId, threadId),
        eq(events.type, "client/turn/requested"),
      ),
    )
    .orderBy(events.sequence)
    .all()
    .map((row) => turnRequestEventDataSchema.parse(JSON.parse(row.data)));
}

async function waitFor<T>(
  read: () => T | null | undefined,
  timeoutMs = 4_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== null && value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for the expected state");
}

/**
 * A thread in the middle of a turn (runtime state + turn/started) that is now
 * parked on an AskUserQuestion, exactly like an orchestrator that asked the
 * user something.
 */
function seedBlockedThread(
  harness: TestHarness,
  args: { hostId: string; status?: "active" | "idle" },
) {
  const { host, session } = seedHostSession(harness.deps, { id: args.hostId });
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: `/tmp/${args.hostId}`,
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: args.status ?? "active",
    title: "Orchestrator",
  });
  const providerThreadId = `provider-${args.hostId}`;
  const turnId = `turn-${args.hostId}`;
  seedThreadRuntimeState(harness.deps, {
    threadId: thread.id,
    environmentId: environment.id,
    providerThreadId,
    inputText: "Orchestrate",
    model: "fake-model",
  });
  seedTurnStarted(harness.deps, {
    threadId: thread.id,
    environmentId: environment.id,
    turnId,
    providerThreadId,
  });
  const interaction: PendingInteractionCreate = {
    threadId: thread.id,
    turnId,
    providerId: "codex",
    providerThreadId,
    providerRequestId: `request-${args.hostId}`,
    payload: createUserQuestionPayload(),
  };
  const registered =
    harness.deps.pendingInteractions.registerPendingInteraction({
      interaction,
    });
  if (registered.outcome === "rejected") {
    throw new Error(registered.reason);
  }
  return {
    environment,
    host,
    interactionId: registered.interaction.id,
    project,
    session,
    thread,
  };
}

async function answerQuestion(
  harness: TestHarness,
  args: { interactionId: string; threadId: string },
): Promise<void> {
  const resolveResponse = await harness.app.request(
    `/api/v1/threads/${args.threadId}/interactions/${args.interactionId}/resolve`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createUserAnswerResolution()),
    },
  );
  expect(resolveResponse.status).toBe(200);
  const queuedResolve = await waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "interactive.resolve" &&
      command.interactionId === args.interactionId,
  );
  const reported = await reportQueuedCommandSuccess(harness, queuedResolve, {});
  expect(reported.status).toBe(200);
}

describe("messages to a thread that awaits user interaction (#1650)", () => {
  it("holds a worker's tell instead of refusing it, then steers it in once the question is answered", async () => {
    await withTestHarness(async (harness) => {
      const { interactionId, project, thread } = seedBlockedThread(harness, {
        hostId: "host-1650-tell",
      });
      const worker = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: thread.environmentId,
        title: "Worker",
        parentThreadId: thread.id,
      });

      // `bb thread tell <orchestrator> "..."` from inside the worker.
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "steer-if-active",
            senderThreadId: worker.id,
            input: [{ type: "text", text: "worker report: task done" }],
          }),
        },
      );
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        ok: true,
        delivery: "deferred",
      });
      expect(listDeferredThreadMessages(harness.db, thread.id)).toHaveLength(1);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(0);
      // Nothing reaches the provider while the question is open.
      expect(listTurnRequests(harness.db, thread.id)).toHaveLength(1);

      await answerQuestion(harness, { interactionId, threadId: thread.id });

      const delivered = await waitFor(() =>
        listTurnRequests(harness.db, thread.id).find(
          (request) => request.senderThreadId === worker.id,
        ),
      );
      expect(delivered.initiator).toBe("agent");
      expect(delivered.target.kind).toBe("steer");
      expect(listDeferredThreadMessages(harness.db, thread.id)).toHaveLength(0);
    });
  });

  it("keeps 409 for mode=start, the one mode that demands an idle thread", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedBlockedThread(harness, {
        hostId: "host-1650-start",
        status: "idle",
      });
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "start",
            input: [{ type: "text", text: "Start over" }],
          }),
        },
      );
      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "awaiting_user_interaction",
      });
      expect(listDeferredThreadMessages(harness.db, thread.id)).toHaveLength(0);
    });
  });

  it("rejects a tell from a sender thread that does not exist before holding it", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedBlockedThread(harness, {
        hostId: "host-1650-bad-sender",
      });
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "steer-if-active",
            senderThreadId: "thr_missing",
            input: [{ type: "text", text: "hello" }],
          }),
        },
      );
      expect(response.status).toBe(400);
      expect(listDeferredThreadMessages(harness.db, thread.id)).toHaveLength(0);
    });
  });

  it("holds a child-completed notice for a blocked parent and flushes it after the answer", async () => {
    await withTestHarness(async (harness) => {
      const {
        interactionId,
        project,
        thread: parent,
      } = seedBlockedThread(harness, { hostId: "host-1650-parent" });
      const child = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: parent.environmentId,
        title: "Worker child",
        parentThreadId: parent.id,
      });

      const accepted = await queueParentSystemMessage(harness.deps, {
        input: textInput("[bb system] child completed"),
        parentThreadId: parent.id,
        systemMessageKind: "child-completed",
        systemMessageSubject: {
          kind: "thread",
          threadId: child.id,
          threadName: "Worker child",
        },
      });
      expect(accepted).toBe(true);
      expect(listDeferredThreadMessages(harness.db, parent.id)).toHaveLength(1);
      expect(
        listTurnRequests(harness.db, parent.id).filter(
          (request) => request.initiator === "system",
        ),
      ).toHaveLength(0);

      await answerQuestion(harness, { interactionId, threadId: parent.id });

      const notice = await waitFor(() =>
        listTurnRequests(harness.db, parent.id).find(
          (request) => request.initiator === "system",
        ),
      );
      expect(notice.systemMessageKind).toBe("child-completed");
      expect(notice.systemMessageSubject).toEqual({
        kind: "thread",
        threadId: child.id,
        threadName: "Worker child",
      });
      expect(listDeferredThreadMessages(harness.db, parent.id)).toHaveLength(0);
    });
  });

  it("delivers held messages in arrival order and leaves them in place while the thread is still blocked", async () => {
    await withTestHarness(async (harness) => {
      const { interactionId, thread } = seedBlockedThread(harness, {
        hostId: "host-1650-order",
      });
      for (const text of ["first", "second"]) {
        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/send`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              mode: "auto",
              input: [{ type: "text", text }],
            }),
          },
        );
        expect(response.status).toBe(200);
      }
      await queueParentSystemMessage(harness.deps, {
        input: textInput("third"),
        parentThreadId: thread.id,
        systemMessageKind: "child-completed",
        systemMessageSubject: null,
      });
      expect(listDeferredThreadMessages(harness.db, thread.id)).toHaveLength(3);

      // A sweep (or a settle of some other interaction) must not deliver while
      // the question is still open.
      await runDeferredThreadMessageSweep(harness.deps);
      expect(listDeferredThreadMessages(harness.db, thread.id)).toHaveLength(3);
      expect(listTurnRequests(harness.db, thread.id)).toHaveLength(1);

      harness.deps.pendingInteractions.interruptPendingInteraction({
        interactionId,
        reason: "answered",
      });
      await flushDeferredThreadMessages(harness.deps, thread.id);

      const texts = listTurnRequests(harness.db, thread.id)
        .slice(1)
        .map((request) =>
          request.input
            .map((part) => (part.type === "text" ? part.text : ""))
            .join(""),
        );
      expect(texts).toEqual(["first", "second", "third"]);
      expect(listDeferredThreadMessages(harness.db, thread.id)).toHaveLength(0);
    });
  });

  it("keeps a held message while the thread is stopping and delivers it from the sweep once idle", async () => {
    await withTestHarness(async (harness) => {
      const { interactionId, thread } = seedBlockedThread(harness, {
        hostId: "host-1650-stop",
      });
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "steer-if-active",
            input: [{ type: "text", text: "report while blocked" }],
          }),
        },
      );
      expect(response.status).toBe(200);

      // The user gives up on the question and stops the thread. The stop
      // interrupts the interaction while the thread is still `stopping`, so the
      // settle flush cannot deliver yet; the row must survive for the sweep.
      applyLoggedThreadLifecycleEvent(harness.deps, {
        event: { type: "stop.requested" },
        threadId: thread.id,
      });
      harness.deps.pendingInteractions.interruptPendingInteraction({
        interactionId,
        reason: "thread-stopped",
      });
      await flushDeferredThreadMessages(harness.deps, thread.id);
      expect(listDeferredThreadMessages(harness.db, thread.id)).toHaveLength(1);
      expect(listTurnRequests(harness.db, thread.id)).toHaveLength(1);

      applyLoggedThreadLifecycleEvent(harness.deps, {
        event: { type: "stop.settled" },
        threadId: thread.id,
      });
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");

      await runDeferredThreadMessageSweep(harness.deps);
      const delivered = listTurnRequests(harness.db, thread.id).at(-1);
      expect(delivered?.target.kind).toBe("new-turn");
      expect(listDeferredThreadMessages(harness.db, thread.id)).toHaveLength(0);
    });
  });

  it("drops a held message whose sender was deleted in the meantime instead of blocking the ones behind it", async () => {
    await withTestHarness(async (harness) => {
      const { interactionId, project, thread } = seedBlockedThread(harness, {
        hostId: "host-1650-gone-sender",
      });
      const worker = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: thread.environmentId,
        title: "Worker",
        parentThreadId: thread.id,
      });
      for (const [text, senderThreadId] of [
        ["from the worker", worker.id],
        ["from the user", undefined],
      ] as const) {
        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/send`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              mode: "steer-if-active",
              senderThreadId,
              input: [{ type: "text", text }],
            }),
          },
        );
        expect(response.status).toBe(200);
      }
      expect(listDeferredThreadMessages(harness.db, thread.id)).toHaveLength(2);

      // The worker is deleted while the question is still open. Its tell can
      // no longer deliver (the sender must be a live reply target), which must
      // not strand the user's message behind it forever.
      markThreadDeleted(harness.db, harness.deps.hub, { threadId: worker.id });
      harness.deps.pendingInteractions.interruptPendingInteraction({
        interactionId,
        reason: "answered",
      });
      await flushDeferredThreadMessages(harness.deps, thread.id);

      const texts = listTurnRequests(harness.db, thread.id)
        .slice(1)
        .map((request) =>
          request.input
            .map((part) => (part.type === "text" ? part.text : ""))
            .join(""),
        );
      expect(texts).toEqual(["from the user"]);
      expect(listDeferredThreadMessages(harness.db, thread.id)).toHaveLength(0);
    });
  });
});
