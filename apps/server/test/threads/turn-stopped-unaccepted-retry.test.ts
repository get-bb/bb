import {
  getLatestThreadSequence,
  getThread,
  listEvents,
  listQueuedThreadMessages,
} from "@bb/db";
import { encodeClientTurnRequestIdNumber } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { applyLoggedThreadLifecycleEvent } from "../../src/services/threads/lifecycle-outcome.js";
import { finalizeStoppedThread } from "../../src/services/threads/thread-lifecycle.js";
import { toThreadResponseFromThread } from "../../src/services/threads/thread-runtime-display.js";
import { retryTurn } from "../../src/services/threads/turn-retry.js";
import {
  seedEvent,
  seedThreadFixture,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedPendingStart(harness: TestAppHarness) {
  const { environment, thread } = seedThreadFixture(harness, {
    session: { id: "host-retry" },
    environment: { path: "/tmp/stopped-unaccepted" },
    thread: { status: "active" },
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    inputText: "Build the sidebar",
    providerThreadId: "provider-retry",
    threadId: thread.id,
  });
  const request = listEvents(harness.db, { threadId: thread.id }).find(
    (event) => event.type === "client/turn/requested",
  );
  if (request === undefined) throw new Error("expected request");
  return {
    environment,
    request,
    requestId: (JSON.parse(request.data) as { requestId: string }).requestId,
    thread,
  };
}

function requireThread(harness: TestAppHarness, threadId: string) {
  const thread = getThread(harness.db, threadId);
  if (thread === null) throw new Error("expected thread");
  return thread;
}

function stop(harness: TestAppHarness, threadId: string): void {
  applyLoggedThreadLifecycleEvent(harness.deps, {
    event: { type: "stop.requested" },
    threadId,
  });
  finalizeStoppedThread(harness.deps, { threadId });
}

async function retry(
  harness: TestAppHarness,
  requestId: string,
  threadId: string,
) {
  return retryTurn(harness.deps, {
    thread: requireThread(harness, threadId),
    request: {
      turnRequestId: requestId,
      sendAt: Date.now() + 60_000,
      reason: "Retry request",
    },
  });
}

function nextSequence(harness: TestAppHarness, threadId: string): number {
  return getLatestThreadSequence(harness.db, { threadId }) + 1;
}

describe("retrying a manually stopped unaccepted request", () => {
  it.each([false, true])(
    "allows retry with watchdog event: %s",
    async (withWatchdog) => {
      await withTestHarness(async (harness) => {
        const { environment, requestId, thread } = seedPendingStart(harness);
        if (withWatchdog) {
          seedEvent(harness.deps, {
            environmentId: environment.id,
            threadId: thread.id,
            sequence: nextSequence(harness, thread.id),
            type: "system/error",
            scope: { kind: "thread" },
            data: {
              code: "provider_turn_start_timeout",
              message: "Provider has not started the turn yet",
            },
          });
        }
        stop(harness, thread.id);
        expect(
          toThreadResponseFromThread(harness.deps, {
            thread: requireThread(harness, thread.id),
          }).retryableStoppedTurnRequestId,
        ).toBe(requestId);
        await expect(
          retry(harness, requestId, thread.id),
        ).resolves.toMatchObject({
          attempt: 2,
          delivery: "queued",
          turnRequestId: requestId,
        });
        expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(1);
      });
    },
  );

  it("requires a manual Stop", async () => {
    await withTestHarness(async (harness) => {
      const { requestId, thread } = seedPendingStart(harness);
      await expect(retry(harness, requestId, thread.id)).rejects.toMatchObject({
        body: { code: "no_failed_turn" },
      });
    });
  });

  it.each(["accepted", "started", "rejected", "completed"] as const)(
    "refuses a request the provider %s",
    async (settlement) => {
      await withTestHarness(async (harness) => {
        const { environment, requestId, thread } = seedPendingStart(harness);
        if (settlement === "started") {
          seedTurnStarted(harness.deps, {
            environmentId: environment.id,
            threadId: thread.id,
            turnId: "turn-started",
          });
        } else {
          seedEvent(harness.deps, {
            environmentId: environment.id,
            threadId: thread.id,
            providerThreadId:
              settlement === "accepted" || settlement === "completed"
                ? "provider-session"
                : undefined,
            sequence: nextSequence(harness, thread.id),
            type:
              settlement === "accepted"
                ? "turn/input/accepted"
                : settlement === "rejected"
                  ? "client/turn/rejected"
                  : "turn/completed",
            scope:
              settlement === "rejected"
                ? { kind: "thread" }
                : { kind: "turn", turnId: `turn-${settlement}` },
            data:
              settlement === "accepted"
                ? {
                    clientRequestId: requestId,
                    providerThreadId: "provider-session",
                  }
                : settlement === "rejected"
                  ? {
                      requestId,
                      reason: "provider_busy",
                      message: "refused",
                    }
                  : { status: "completed" },
          });
        }
        stop(harness, thread.id);
        await expect(
          retry(harness, requestId, thread.id),
        ).rejects.toMatchObject({ body: { code: "no_failed_turn" } });
      });
    },
  );

  it("only allows the latest request", async () => {
    await withTestHarness(async (harness) => {
      const { environment, request, requestId, thread } =
        seedPendingStart(harness);
      const latestRequestId = encodeClientTurnRequestIdNumber({ value: 99 });
      seedEvent(harness.deps, {
        environmentId: environment.id,
        threadId: thread.id,
        providerThreadId: request.providerThreadId,
        sequence: nextSequence(harness, thread.id),
        type: "client/turn/requested",
        scope: { kind: "thread" },
        data: { ...JSON.parse(request.data), requestId: latestRequestId },
      });
      stop(harness, thread.id);
      await expect(retry(harness, requestId, thread.id)).rejects.toMatchObject({
        body: { code: "no_failed_turn" },
      });
      await expect(
        retry(harness, latestRequestId, thread.id),
      ).resolves.toMatchObject({
        attempt: 2,
        turnRequestId: latestRequestId,
      });
    });
  });
});
