import {
  getThread,
  listEvents,
  listQueuedThreadMessages,
  isThreadQueueAutoSendPaused,
} from "@bb/db";
import { groupHostDaemonEvents } from "@bb/host-daemon-contract";
import { internalAuthHeaders } from "../helpers/commands.js";
import { threadScope } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  interruptActiveThreadsForHost,
  reconcileDaemonReportedThreads,
} from "../../src/services/threads/thread-lifecycle.js";
import { acceptThreadSendRequest } from "../../src/services/threads/thread-send-request.js";
import { runQueuedMessageDispatch } from "../../src/services/threads/queued-message-dispatch.js";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  listQueuedThreadCommands,
} from "../helpers/commands.js";
import { getActiveTurnId } from "../../src/services/threads/thread-events.js";
import { createUserQuestionPayload } from "../helpers/pending-interactions.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedThreadFixture,
  seedTurnStarted,
  seedQueuedMessage,
  seedStoredEvent,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("interrupted turn reconnect", () => {
  it.each([false, true])(
    "does not revive a terminal turn from daemon liveness (trailing event: %s)",
    async (trailingEvent) => {
      await withTestHarness(async (harness) => {
        const { host, thread, environment } = seedThreadFixture(harness, {
          thread: { status: "active" },
        });
        seedTurnStarted(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          turnId: "turn-question",
          providerThreadId: "provider-question",
        });
        const interaction =
          harness.deps.pendingInteractions.registerPendingInteraction({
            interaction: {
              threadId: thread.id,
              turnId: "turn-question",
              providerId: thread.providerId,
              providerThreadId: "provider-question",
              providerRequestId: "question-1",
              payload: createUserQuestionPayload(),
            },
          });
        expect(interaction.outcome).not.toBe("rejected");
        interruptActiveThreadsForHost(harness.deps, {
          hostId: host.id,
          reason: "host-daemon-restarted",
          includeStopping: false,
          cause: "host-connection-lost",
        });
        expect(getThread(harness.db, thread.id)?.status).toBe("error");
        expect(getActiveTurnId(harness.deps, thread.id)).toBeNull();
        expect(
          harness.deps.pendingInteractions.listPendingThreadInteractions(
            thread.id,
          ),
        ).toEqual([]);
        if (trailingEvent)
          seedStoredEvent(harness.deps, {
            threadId: thread.id,
            sequence: 20,
            type: "system/error",
            scope: threadScope(),
            data: { code: "diagnostic", message: "Late diagnostic" },
          });
        const queued = seedQueuedMessage(harness.deps, {
          threadId: thread.id,
          content: textInput("slop cop"),
          waitingOn: { kind: "turn-starting" },
        });
        await reconcileDaemonReportedThreads(harness.deps, {
          hostId: host.id,
          activeThreadIds: [thread.id],
          sameDaemonInstance: true,
        });
        expect(getThread(harness.db, thread.id)?.status).toBe("error");
        expect(getActiveTurnId(harness.deps, thread.id)).toBeNull();
        expect(
          listEvents(harness.db, { threadId: thread.id }).filter(
            (e) => e.type === "turn/started",
          ),
        ).toHaveLength(1);
        expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([
          expect.objectContaining({
            id: queued.id,
            content: JSON.stringify(textInput("slop cop")),
            failureReason: expect.stringContaining("manual recovery"),
            nextAttemptAt: null,
          }),
        ]);
      });
    },
  );

  it("keeps a healthy persisted turn active after a transient error", async () => {
    await withTestHarness(async (harness) => {
      const { host, thread } = seedThreadFixture(harness, {
        thread: { status: "error" },
      });
      seedTurnStarted(harness.deps, {
        threadId: thread.id,
        turnId: "live-turn",
      });
      await reconcileDaemonReportedThreads(harness.deps, {
        hostId: host.id,
        activeThreadIds: [thread.id],
        sameDaemonInstance: true,
      });
      expect(getThread(harness.db, thread.id)?.status).toBe("active");
    });
  });

  it("preserves a watchdog follow-up and makes it actionable only after an explicit stop", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: { status: "active" },
      });
      seedStoredEvent(harness.deps, {
        threadId: thread.id,
        sequence: 1,
        type: "system/error",
        scope: threadScope(),
        data: {
          code: "provider_turn_start_timeout",
          message: "Provider accepted a turn but did not start it",
        },
      });
      const accepted = await acceptThreadSendRequest(harness.deps, {
        thread,
        payload: {
          input: textInput("continue"),
          mode: "auto",
          model: "gpt-5",
          permissionMode: "full",
          reasoningLevel: "medium",
          serviceTier: "default",
        },
      });
      expect(accepted).toMatchObject({
        delivery: "queued",
        queuedMessage: { waitingOn: { kind: "turn-starting" } },
      });
      const queued = listQueuedThreadMessages(harness.db, thread.id)[0]!;
      expect(getThread(harness.db, thread.id)?.status).toBe("active");
      expect(getActiveTurnId(harness.deps, thread.id)).toBeNull();
      const stopping = harness.app.request(
        `/api/v1/threads/${thread.id}/stop`,
        { method: "POST" },
      );
      const command = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.stop" && command.threadId === thread.id,
      );
      expect(command.command).toMatchObject({ intent: "interrupt" });
      await reportQueuedCommandSuccess(harness, command, {
        providerCheckpointId: null,
      });
      expect((await stopping).status).toBe(200);
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
      expect(isThreadQueueAutoSendPaused(harness.db, thread.id)).toBe(true);
      await runQueuedMessageDispatch(harness.deps, {
        kind: "thread-ready",
        threadId: thread.id,
      });
      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(0);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([
        expect.objectContaining({
          id: queued.id,
          content: JSON.stringify(textInput("continue")),
          waitingOn: null,
        }),
      ]);
    });
  });
  it("keeps a follow-up for manual recovery when the provider exits before starting", async () => {
    await withTestHarness(async (harness) => {
      const { thread, session } = seedThreadFixture(harness, {
        thread: { status: "active" },
      });
      const queued = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("continue"),
        waitingOn: { kind: "turn-starting" },
      });
      const response = await harness.app.request("/internal/session/events", {
        method: "POST",
        headers: internalAuthHeaders(harness),
        body: JSON.stringify({
          sessionId: session.id,
          eventGroups: groupHostDaemonEvents([
            {
              threadId: thread.id,
              event: {
                type: "system/error",
                threadId: thread.id,
                scope: threadScope(),
                code: "provider_process_exited",
                message: "Provider process exited before turn start",
              },
            },
          ]),
        }),
      });
      expect(response.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.status).toBe("error");
      await runQueuedMessageDispatch(harness.deps, {
        kind: "failed-retry",
        now: Date.now() + 1_000_000,
      });
      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(0);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([
        expect.objectContaining({
          id: queued.id,
          content: JSON.stringify(textInput("continue")),
          failureReason: expect.stringContaining("manual recovery"),
          nextAttemptAt: null,
        }),
      ]);
    });
  });
});
