import {
  createQueuedThreadMessage,
  getLastStoredTurnRequestEvent,
  getLatestThreadSequence,
  getThread,
  listEvents,
  listQueuedThreadMessages,
} from "@bb/db";
import { threadScope, turnScope, type ThreadEvent } from "@bb/domain";
import { groupHostDaemonEvents } from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it } from "vitest";
import { setPluginHookProvider } from "../../src/services/plugins/plugin-hook-registry.js";
import { applyLoggedThreadLifecycleEvent } from "../../src/services/threads/lifecycle-outcome.js";
import { interruptActiveThreadsForHost } from "../../src/services/threads/thread-lifecycle.js";
import { parseStoredTurnRequestEvent } from "../../src/services/threads/thread-events.js";
import { retryFailedTurn } from "../../src/services/threads/turn-retry.js";
import {
  createTestDaemonEventEnvelope,
  internalAuthHeaders,
} from "../helpers/commands.js";
import {
  seedEvent,
  seedThreadFixture,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedInterrupted(harness: TestAppHarness) {
  const fixture = seedThreadFixture(harness, { thread: { status: "active" } });
  const { environment, thread, host } = fixture;
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    threadId: thread.id,
    providerThreadId: "provider-live",
  });
  const row = getLastStoredTurnRequestEvent(harness.db, thread.id);
  if (!row) throw new Error("Missing seeded request");
  const request = parseStoredTurnRequestEvent(row);
  seedTurnStarted(harness.deps, {
    environmentId: environment.id,
    threadId: thread.id,
    turnId: "turn-live",
    providerThreadId: "provider-live",
  });
  seedEvent(harness.deps, {
    threadId: thread.id,
    environmentId: environment.id,
    providerThreadId: "provider-live",
    sequence: getLatestThreadSequence(harness.db, { threadId: thread.id }) + 1,
    type: "turn/input/accepted",
    scope: turnScope("turn-live"),
    data: {
      providerThreadId: "provider-live",
      clientRequestId: request.requestId,
    },
  });
  interruptActiveThreadsForHost(harness.deps, {
    hostId: host.id,
    reason: "host-daemon-restarted",
    cause: "host-connection-lost",
  });
  expect(getThread(harness.db, thread.id)?.status).toBe("error");
  return { ...fixture, request };
}

async function complete(
  harness: TestAppHarness,
  fixture: ReturnType<typeof seedInterrupted>,
  turnId = "turn-live",
) {
  const event: ThreadEvent = {
    type: "turn/completed",
    threadId: fixture.thread.id,
    providerThreadId: "provider-live",
    scope: turnScope(turnId),
    status: "completed",
  };
  await postEvents(harness, fixture, [event]);
}

async function postEvents(
  harness: TestAppHarness,
  fixture: ReturnType<typeof seedInterrupted>,
  events: ThreadEvent[],
) {
  const response = await harness.app.request("/internal/session/events", {
    method: "POST",
    headers: internalAuthHeaders(harness, { hostId: fixture.host.id }),
    body: JSON.stringify({
      sessionId: fixture.session.id,
      eventGroups: groupHostDaemonEvents(
        events.map((event) => createTestDaemonEventEnvelope({ event })),
      ),
    }),
  });
  expect(response.status).toBe(200);
}

afterEach(() => setPluginHookProvider(undefined));

describe("late completion after host connection loss", () => {
  it.each([1, 2, 3])(
    "settles %i buffered turns without another user request",
    async (count) => {
      await withTestHarness(async (harness) => {
        const fixture = seedInterrupted(harness);
        await retryFailedTurn(harness.deps, {
          thread: getThread(harness.db, fixture.thread.id)!,
          request: {
            turnRequestId: fixture.request.requestId,
            sendAt: Date.now() + 60_000,
            reason: "Host recovery test",
          },
        });
        const events: ThreadEvent[] = [];
        for (let i = 0; i < count; i++) {
          const scope = turnScope(i === 0 ? "turn-live" : `goal-${i}`);
          const context = {
            threadId: fixture.thread.id,
            providerThreadId: "provider-live",
            scope,
          };
          if (i > 0) events.push({ ...context, type: "turn/started" });
          events.push({
            ...context,
            type: "turn/completed",
            status: "completed",
          });
        }
        await postEvents(harness, fixture, events);
        expect(getThread(harness.db, fixture.thread.id)?.status).toBe("idle");
        expect(
          listQueuedThreadMessages(harness.db, fixture.thread.id),
        ).toHaveLength(0);
        expect(
          listEvents(harness.db, { threadId: fixture.thread.id }).filter(
            (row) => row.type === "client/turn/requested",
          ),
        ).toHaveLength(1);
      });
    },
  );

  it("keeps a newer buffered goal turn active until its own completion", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedInterrupted(harness);
      const context = {
        threadId: fixture.thread.id,
        providerThreadId: "provider-live",
      };
      await postEvents(harness, fixture, [
        {
          ...context,
          scope: turnScope("turn-live"),
          type: "turn/completed",
          status: "completed",
        },
        { ...context, scope: turnScope("goal-next"), type: "turn/started" },
      ]);
      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("active");
      await complete(harness, fixture, "goal-next");
      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("idle");
    });
  });

  it("does not restart buffered goal turns after a manual stop", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedInterrupted(harness);
      seedEvent(harness.deps, {
        threadId: fixture.thread.id,
        environmentId: fixture.environment.id,
        sequence:
          getLatestThreadSequence(harness.db, { threadId: fixture.thread.id }) +
          1,
        type: "system/thread/interrupted",
        scope: threadScope(),
        data: { reason: "manual-stop" },
      });
      const context = {
        threadId: fixture.thread.id,
        providerThreadId: "provider-live",
      };
      await postEvents(harness, fixture, [
        {
          ...context,
          scope: turnScope("turn-live"),
          type: "turn/completed",
          status: "completed",
        },
        { ...context, scope: turnScope("goal-next"), type: "turn/started" },
        {
          ...context,
          scope: turnScope("goal-next"),
          type: "turn/completed",
          status: "completed",
        },
      ]);
      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("error");
    });
  });

  it("restores idle through event ingestion and rejects a retry of completed work", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedInterrupted(harness);
      await complete(harness, fixture);
      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("idle");
      const thread = getThread(harness.db, fixture.thread.id)!;
      await expect(
        retryFailedTurn(harness.deps, {
          thread,
          request: {
            turnRequestId: fixture.request.requestId,
            sendAt: null,
            reason: "Host recovery test",
          },
        }),
      ).rejects.toMatchObject({ body: { code: "no_failed_turn" } });
      expect(
        listEvents(harness.db, { threadId: thread.id }).filter(
          (row) => row.type === "system/thread/interrupted",
        ),
      ).toHaveLength(1);
      await complete(harness, fixture);
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
    });
  });

  it.each(["new-request", "manual-stop", "provider-error", "another-turn"])(
    "does not clear an error superseded by %s",
    async (kind) => {
      await withTestHarness(async (harness) => {
        const fixture = seedInterrupted(harness);
        const { thread, environment } = fixture;
        if (kind === "new-request") {
          seedThreadRuntimeState(harness.deps, {
            threadId: thread.id,
            environmentId: environment.id,
            providerThreadId: "provider-live",
            sequenceStart:
              getLatestThreadSequence(harness.db, { threadId: thread.id }) + 1,
          });
        } else if (kind === "another-turn") {
          seedTurnStarted(harness.deps, {
            threadId: thread.id,
            environmentId: environment.id,
            turnId: "new-turn",
          });
        } else {
          seedEvent(harness.deps, {
            threadId: thread.id,
            environmentId: environment.id,
            sequence:
              getLatestThreadSequence(harness.db, { threadId: thread.id }) + 1,
            type:
              kind === "manual-stop"
                ? "system/thread/interrupted"
                : "provider/error",
            scope: threadScope(),
            data:
              kind === "manual-stop"
                ? { reason: "manual-stop" }
                : {
                    providerThreadId: "provider-live",
                    message: "New provider failure",
                  },
          });
        }
        await complete(harness, fixture);
        expect(getThread(harness.db, thread.id)?.status).toBe("error");
      });
    },
  );

  it("cancels only the obsolete retry when completion arrives while it is queued", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedInterrupted(harness);
      const thread = getThread(harness.db, fixture.thread.id)!;
      const retry = await retryFailedTurn(harness.deps, {
        thread,
        request: {
          turnRequestId: fixture.request.requestId,
          sendAt: Date.now() + 60_000,
          reason: "Host recovery test",
        },
      });
      expect(retry.delivery).toBe("queued");
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(1);
      const userMessage = createQueuedThreadMessage(harness.db, harness.hub, {
        threadId: thread.id,
        content: [{ type: "text", text: "Next task", mentions: [] }],
        model: "gpt-5",
        reasoningLevel: "medium",
        permissionMode: "full",
        serviceTier: "default",
        waitingOn: { kind: "time" },
        sendAt: Date.now() + 120_000,
        payload: { kind: "inline" },
        systemNotice: null,
      });
      await complete(harness, fixture);
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
      expect(
        listQueuedThreadMessages(harness.db, thread.id).map((row) => row.id),
      ).toEqual([userMessage.id]);
      expect(
        listEvents(harness.db, { threadId: thread.id }).filter(
          (row) => row.type === "client/turn/requested",
        ),
      ).toHaveLength(1);
    });
  });
  it("rejects a retry if completion arrives while its dispatch hook is awaiting", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedInterrupted(harness);
      let calls = 0;
      setPluginHookProvider({
        listHooks: () => [
          {
            pluginId: "test-race",
            handler: async () => {
              calls += 1;
              await complete(harness, fixture);
              return { action: "proceed" };
            },
          },
        ],
        invokeHook: async (_pluginId, _label, run) => ({
          ok: true,
          value: await run(),
        }),
        decisionTimeoutMs: 10_000,
      });
      await expect(
        retryFailedTurn(harness.deps, {
          thread: getThread(harness.db, fixture.thread.id)!,
          request: {
            turnRequestId: fixture.request.requestId,
            sendAt: null,
            reason: "Host recovery test",
          },
        }),
      ).rejects.toMatchObject({ body: { code: "no_failed_turn" } });
      expect(calls).toBe(1);
      expect(getThread(harness.db, fixture.thread.id)?.status).toBe("idle");
      expect(
        listEvents(harness.db, { threadId: fixture.thread.id }).filter(
          (row) => row.type === "client/turn/requested",
        ),
      ).toHaveLength(1);
      expect(
        listQueuedThreadMessages(harness.db, fixture.thread.id),
      ).toHaveLength(0);
    });
  });

  it("rejects retrying completed work even when its stored status is still error", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedInterrupted(harness);
      seedEvent(harness.deps, {
        threadId: fixture.thread.id,
        environmentId: fixture.environment.id,
        providerThreadId: "provider-live",
        sequence:
          getLatestThreadSequence(harness.db, { threadId: fixture.thread.id }) +
          1,
        type: "turn/completed",
        scope: turnScope("turn-live"),
        data: { providerThreadId: "provider-live", status: "completed" },
      });
      await expect(
        retryFailedTurn(harness.deps, {
          thread: getThread(harness.db, fixture.thread.id)!,
          request: {
            turnRequestId: fixture.request.requestId,
            sendAt: null,
            reason: "Host recovery test",
          },
        }),
      ).rejects.toMatchObject({ body: { code: "no_failed_turn" } });
    });
  });
  it.each(["starting", "active"])(
    "does not settle newer %s work with an older completion",
    async (status) => {
      await withTestHarness(async (harness) => {
        const fixture = seedInterrupted(harness);
        seedThreadRuntimeState(harness.deps, {
          threadId: fixture.thread.id,
          environmentId: fixture.environment.id,
          providerThreadId: "provider-live",
          sequenceStart:
            getLatestThreadSequence(harness.db, {
              threadId: fixture.thread.id,
            }) + 1,
        });
        applyLoggedThreadLifecycleEvent(harness.deps, {
          threadId: fixture.thread.id,
          event: { type: "run.preparing" },
        });
        if (status === "active") {
          seedTurnStarted(harness.deps, {
            threadId: fixture.thread.id,
            turnId: "new-turn",
          });
          applyLoggedThreadLifecycleEvent(harness.deps, {
            threadId: fixture.thread.id,
            event: { type: "run.started" },
          });
        }
        await complete(harness, fixture);
        expect(getThread(harness.db, fixture.thread.id)?.status).toBe(status);
      });
    },
  );
});
