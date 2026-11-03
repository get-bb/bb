import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  claimQueuedThreadMessageGroup,
  environments,
  getLatestThreadSequence,
  getThread,
  listEvents,
  listQueuedThreadMessages,
  setThreadExecutionOverride,
} from "@bb/db";
import type { ThreadQueuedMessage } from "@bb/domain";
import type { PluginHookName } from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it } from "vitest";
import {
  invokePluginInline,
  setPluginHookProvider,
  type PluginHookRegistration,
} from "../../src/services/plugins/plugin-hook-registry.js";
import { setPluginThreadEventEmitter } from "../../src/services/plugins/plugin-thread-events.js";
import { applyLoggedThreadLifecycleEvent } from "../../src/services/threads/lifecycle-outcome.js";
import { runQueuedMessageDispatch } from "../../src/services/threads/queued-message-dispatch.js";
import { sendQueuedMessageNow } from "../../src/services/threads/queued-messages.js";
import { acceptThreadSendRequest } from "../../src/services/threads/thread-send-request.js";
import { toThreadQueuedMessage } from "../../src/services/threads/thread-queued-messages.js";
import { readThreadProvisionContext } from "../../src/services/threads/thread-startup-store.js";
import { buildTurnFailedEvent } from "../../src/services/threads/turn-failed.js";
import { retryFailedTurn } from "../../src/services/threads/turn-retry.js";
import { attemptDispatch } from "../../src/services/threads/dispatch-attempt.js";
import {
  seedEnvironment,
  seedEvent,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { textInput } from "../helpers/prompt-input.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const WORKSPACE_PATH = "/tmp/turn-failed-project";

type MessageDispatchRegistration = PluginHookRegistration<"message.dispatch">;

type HookRegistry = {
  [K in PluginHookName]: PluginHookRegistration<K>[];
};

function installHooks(
  handlers: Partial<{ "message.dispatch": MessageDispatchRegistration[] }>,
): void {
  const registry: HookRegistry = {
    "message.dispatch": handlers["message.dispatch"] ?? [],
  };
  setPluginHookProvider({
    listHooks: (hook) => registry[hook],
    invokeHook: (_pluginId, _label, run) => invokePluginInline(run),
    decisionTimeoutMs: 10_000,
  });
}

afterEach(() => {
  setPluginHookProvider(undefined);
  setPluginThreadEventEmitter(undefined);
});

function recordTurnFailedAnnouncements(): string[] {
  const announced: string[] = [];
  setPluginThreadEventEmitter({
    emitThreadEvents: () => {},
    emitTerminalInput: () => {},
    emitHostDeleted: () => {},
    emitEnvironmentRemoved: () => {},
    emitThreadCreated: () => {},
    emitThreadActive: () => {},
    emitThreadIdle: () => {},
    emitThreadFailed: () => {},
    emitThreadArchived: () => {},
    emitThreadDeleted: () => {},
    emitThreadRead: () => {},
    emitInteractionPending: () => {},
    emitMessageQueued: () => {},
    emitMessageDispatched: () => {},
    emitMessageCancelled: () => {},
    emitThreadUnarchived: () => {},
    emitThreadParentChanged: () => {},
    emitTurnFailed: (threadId) => announced.push(threadId),
  });
  return announced;
}

function seedFailableThread(harness: TestAppHarness, hostId: string) {
  const { host } = seedHostSession(harness.deps, { id: hostId });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: WORKSPACE_PATH,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: WORKSPACE_PATH,
  });
  const thread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    status: "active",
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    inputText: "Do the thing",
    providerThreadId: `provider-${hostId}`,
    threadId: thread.id,
  });
  return {
    environment,
    host,
    project,
    thread,
    requestId: lastTurnRequest(harness, thread.id).requestId,
  };
}

interface StoredTurnRequest {
  execution: { model: string };
  initiator: string;
  input: { text: string; visibility?: string }[];
  requestId: string;
  retryAttempt?: number;
  retryOfRequestId?: string;
}

function turnRequestData(event: { data: string }): StoredTurnRequest {
  return JSON.parse(event.data) as StoredTurnRequest;
}

function lastTurnRequest(
  harness: TestAppHarness,
  threadId: string,
): StoredTurnRequest {
  const events = turnRequests(harness, threadId);
  const last = events[events.length - 1];
  if (last === undefined) throw new Error("expected a turn request");
  return turnRequestData(last);
}

function seedRateLimitFailure(
  harness: TestAppHarness,
  args: {
    environmentId: string;
    threadId: string;
    resetsAtMs: number;
    category?: string;
  },
) {
  const providerThreadId = "provider-session";
  seedEvent(harness.deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId,
    sequence:
      getLatestThreadSequence(harness.db, { threadId: args.threadId }) + 1,
    type: "provider/rateLimits/updated",
    scope: { kind: "thread" },
    data: {
      providerThreadId,
      rateLimits: {
        providerId: "codex",
        status: "blocked",
        kind: "subscription-window",
        windows: [
          {
            providerKey: "primary",
            label: "Current session",
            status: "blocked",
            resetsAtMs: args.resetsAtMs,
          },
        ],
        reachedReason: "rate_limit_reached",
        overageStatus: null,
        overageReason: null,
      },
    },
  });
  seedEvent(harness.deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId,
    sequence:
      getLatestThreadSequence(harness.db, { threadId: args.threadId }) + 1,
    type: "provider/error",
    scope: { kind: "thread" },
    data: {
      providerThreadId,
      message: "Usage limit reached",
      errorInfo: {
        category: args.category ?? "rate-limit",
        providerCode: "usage_limit_reached",
        httpStatusCode: 429,
      },
    },
  });
}

function seedInputAccepted(
  harness: TestAppHarness,
  args: { environmentId: string; threadId: string; requestId: string },
) {
  const providerThreadId = "provider-session";
  seedEvent(harness.deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId,
    sequence:
      getLatestThreadSequence(harness.db, { threadId: args.threadId }) + 1,
    type: "turn/input/accepted",
    scope: { kind: "turn", turnId: "turn-1" },
    data: {
      providerThreadId,
      clientRequestId: args.requestId,
    },
  });
}

function seedDoorRejection(
  harness: TestAppHarness,
  args: {
    environmentId: string;
    threadId: string;
    requestId: string;
    reason: string;
  },
) {
  seedEvent(harness.deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    sequence:
      getLatestThreadSequence(harness.db, { threadId: args.threadId }) + 1,
    type: "client/turn/rejected",
    scope: { kind: "thread" },
    data: {
      requestId: args.requestId,
      reason: args.reason,
      message: "Command turn.submit failed",
    },
  });
}

function failThread(harness: TestAppHarness, threadId: string): void {
  applyLoggedThreadLifecycleEvent(harness.deps, {
    event: { type: "run.failed" },
    threadId,
  });
}

function turnRequests(harness: TestAppHarness, threadId: string) {
  return listEvents(harness.db, { threadId }).filter(
    (event) => event.type === "client/turn/requested",
  );
}

function queuedRows(
  harness: TestAppHarness,
  threadId: string,
): ThreadQueuedMessage[] {
  return listQueuedThreadMessages(harness.db, threadId)
    .map(toThreadQueuedMessage)
    .filter((entry) => entry.waitingOn !== null);
}

function onlyQueuedRow(
  harness: TestAppHarness,
  threadId: string,
): ThreadQueuedMessage {
  const rows = queuedRows(harness, threadId);
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new Error(`expected exactly one queued row, found ${rows.length}`);
  }
  return rows[0];
}

function requireThread(harness: TestAppHarness, threadId: string) {
  const thread = getThread(harness.db, threadId);
  if (thread === null) throw new Error("expected a thread");
  return thread;
}

async function sweepPastResume(harness: TestAppHarness): Promise<void> {
  await runQueuedMessageDispatch(harness.deps, {
    kind: "time-reached",
    now: Date.now() + 120_000,
  });
}

async function sendUserMessage(
  harness: TestAppHarness,
  threadId: string,
  text: string,
): Promise<void> {
  const delivery = await attemptDispatch(harness.deps, {
    systemNotice: null,
    thread: requireThread(harness, threadId),
    payload: {
      mode: "queue-if-active",
      input: [{ type: "text", text, mentions: [] }],
    },
    source: { kind: "inline" },
    queuePayload: { kind: "inline" },
    pluginSubmission: null,
    origin: null,
    originPluginId: null,
    startedOnBehalfOf: null,
    trigger: "user",
  });
  expect(delivery.kind).toBe("dispatched");
}

async function failAndRetry(
  harness: TestAppHarness,
  args: {
    environmentId: string;
    threadId: string;
    accepted: boolean;
    sendAt: number;
  },
) {
  const { requestId } = lastTurnRequest(harness, args.threadId);
  if (args.accepted) {
    seedInputAccepted(harness, {
      environmentId: args.environmentId,
      threadId: args.threadId,
      requestId,
    });
  }
  seedRateLimitFailure(harness, {
    environmentId: args.environmentId,
    threadId: args.threadId,
    resetsAtMs: args.sendAt,
  });
  failThread(harness, args.threadId);
  return retryFailedTurn(harness.deps, {
    thread: requireThread(harness, args.threadId),
    request: {
      turnRequestId: requestId,
      sendAt: args.sendAt,
      reason: "Rate limited",
    },
  });
}

async function drainRecoveries(
  harness: TestAppHarness,
  threadId: string,
): Promise<number> {
  const before = turnRequests(harness, threadId).length;
  while (
    queuedRows(harness, threadId).some(
      (row) => row.waitingOn?.kind !== "superseded",
    )
  ) {
    await sweepPastResume(harness);
    applyLoggedThreadLifecycleEvent(harness.deps, {
      event: { type: "run.succeeded" },
      threadId,
    });
    await runQueuedMessageDispatch(harness.deps, {
      kind: "thread-ready",
      threadId,
    });
  }
  return turnRequests(harness, threadId).length - before;
}

describe("the turn.failed announcement", () => {
  it("carries the failed turn's ids and the provider's failure facts", async () => {
    await withTestHarness(async (harness) => {
      const { environment, requestId, thread } = seedFailableThread(
        harness,
        "host-ctx",
      );
      const resetsAtMs = Date.now() + 3_600_000;
      seedRateLimitFailure(harness, {
        environmentId: environment.id,
        threadId: thread.id,
        resetsAtMs,
      });

      failThread(harness, thread.id);

      const event = buildTurnFailedEvent(harness.db, thread.id);
      if (event === null) throw new Error("expected a turn.failed payload");
      expect(event.threadId).toBe(thread.id);
      expect(event.requestId).toBe(requestId);
      expect(event.attemptNumber).toBe(1);
      expect(event.errorInfo).toEqual({
        category: "rate-limit",
        providerCode: "usage_limit_reached",
        httpStatusCode: 429,
      });
      expect(event.rateLimits?.windows[0]?.resetsAtMs).toBe(resetsAtMs);
    });
  });

  it("labels a typed door rejection and reports the input as never accepted", async () => {
    await withTestHarness(async (harness) => {
      const { environment, requestId, thread } = seedFailableThread(
        harness,
        "host-door",
      );
      seedDoorRejection(harness, {
        environmentId: environment.id,
        threadId: thread.id,
        requestId,
        reason: "rate_limited",
      });
      failThread(harness, thread.id);

      const event = buildTurnFailedEvent(harness.db, thread.id);
      expect(event?.errorInfo).toEqual({
        category: "rate-limit",
        providerCode: null,
        httpStatusCode: null,
      });
      expect(event?.turnId).toBeNull();
      expect(event?.inputAccepted).toBe(false);

      const unmapped = seedFailableThread(harness, "host-door-unmapped");
      seedDoorRejection(harness, {
        environmentId: unmapped.environment.id,
        threadId: unmapped.thread.id,
        requestId: unmapped.requestId,
        reason: "stale_turn",
      });
      failThread(harness, unmapped.thread.id);
      expect(
        buildTurnFailedEvent(harness.db, unmapped.thread.id)?.errorInfo,
      ).toBeNull();
    });
  });

  it("reports acceptance when the provider took the input before failing", async () => {
    await withTestHarness(async (harness) => {
      const { environment, requestId, thread } = seedFailableThread(
        harness,
        "host-accepted",
      );
      seedInputAccepted(harness, {
        environmentId: environment.id,
        threadId: thread.id,
        requestId,
      });
      seedRateLimitFailure(harness, {
        environmentId: environment.id,
        threadId: thread.id,
        resetsAtMs: Date.now() + 3_600_000,
      });
      failThread(harness, thread.id);

      expect(buildTurnFailedEvent(harness.db, thread.id)?.inputAccepted).toBe(
        true,
      );
    });
  });

  it("is announced for a failure and for nothing else", async () => {
    await withTestHarness(async (harness) => {
      const announced = recordTurnFailedAnnouncements();
      const succeeding = seedFailableThread(harness, "host-ok").thread;
      const failing = seedFailableThread(harness, "host-not-ok").thread;

      applyLoggedThreadLifecycleEvent(harness.deps, {
        event: { type: "run.succeeded" },
        threadId: succeeding.id,
      });
      expect(announced).toEqual([]);

      failThread(harness, failing.id);
      expect(announced).toEqual([failing.id]);
    });
  });
});

describe("retrying a failed turn", () => {
  it("queues a by-reference row on the clock and re-submits the original turn", async () => {
    await withTestHarness(async (harness) => {
      const sendAt = Date.now() + 60_000;
      const { requestId, thread } = seedFailableThread(harness, "host-retry");
      failThread(harness, thread.id);

      const result = await retryFailedTurn(harness.deps, {
        thread: requireThread(harness, thread.id),
        request: { turnRequestId: requestId, sendAt, reason: "Rate limited" },
      });

      expect(result).toMatchObject({
        delivery: "queued",
        turnRequestId: requestId,
        attempt: 2,
      });
      const queued = onlyQueuedRow(harness, thread.id);
      expect(queued.payload).toEqual({
        kind: "retry",
        retryOfTurnRequestId: requestId,
        attempt: 2,
        reason: "Rate limited",
      });
      expect(queued.waitingOn).toEqual({ kind: "time" });
      expect(queued.sendAt).toBe(sendAt);

      await sweepPastResume(harness);

      const requests = turnRequests(harness, thread.id);
      expect(requests).toHaveLength(2);
      const retryRequest = requests[1];
      if (retryRequest === undefined) throw new Error("expected a retry turn");
      const data = turnRequestData(retryRequest);

      expect(data.retryOfRequestId).toBe(requestId);
      expect(data.retryAttempt).toBe(2);
      expect(data.input[0]?.text).toBe("Do the thing");
      expect(data.execution.model).toBe("gpt-5");
      expect(data.initiator).toBe("system");
      expect(data.input[0]?.visibility).toBe("agent-only");
      const userRequests = turnRequests(harness, thread.id).filter(
        (event) => turnRequestData(event).initiator === "user",
      );
      expect(userRequests).toHaveLength(1);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
    });
  });

  it("moves a waiting retry earlier in place, keeping its attempt", async () => {
    await withTestHarness(async (harness) => {
      const sendAt = Date.now() + 3_600_000;
      const { requestId, thread } = seedFailableThread(
        harness,
        "host-retry-move",
      );
      failThread(harness, thread.id);
      await retryFailedTurn(harness.deps, {
        thread: requireThread(harness, thread.id),
        request: { turnRequestId: requestId, sendAt, reason: "Rate limited" },
      });
      const queued = onlyQueuedRow(harness, thread.id);
      const earlier = Date.now() + 60_000;

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages/${queued.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedUpdatedAt: queued.updatedAt,
            sendAt: earlier,
          }),
        },
      );
      expect(response.status).toBe(200);
      expect(onlyQueuedRow(harness, thread.id)).toMatchObject({
        id: queued.id,
        payload: queued.payload,
        sendAt: earlier,
      });

      await sweepPastResume(harness);

      const data = lastTurnRequest(harness, thread.id);
      expect(data.retryOfRequestId).toBe(requestId);
      expect(data.retryAttempt).toBe(2);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
    });
  });

  it("continues an accepted turn instead of re-asking it", async () => {
    await withTestHarness(async (harness) => {
      const { environment, requestId, thread } = seedFailableThread(
        harness,
        "host-continue",
      );
      seedInputAccepted(harness, {
        environmentId: environment.id,
        threadId: thread.id,
        requestId,
      });
      failThread(harness, thread.id);

      const result = await retryFailedTurn(harness.deps, {
        thread: requireThread(harness, thread.id),
        request: {
          turnRequestId: requestId,
          sendAt: null,
          reason: "Rate limited",
        },
      });
      expect(result.delivery).toBe("sent");

      const requests = turnRequests(harness, thread.id);
      expect(requests).toHaveLength(2);
      const retryRequest = requests[1];
      if (retryRequest === undefined) throw new Error("expected a retry turn");
      const data = turnRequestData(retryRequest);
      expect(data.retryOfRequestId).toBe(requestId);
      expect(data.retryAttempt).toBe(2);
      expect(data.input).toHaveLength(1);
      expect(data.input[0]?.text).toBe("Please continue.");
      expect(data.input[0]?.visibility).toBe("agent-only");
    });
  });

  it("dispatches immediately when no instant is named", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFailableThread(harness, "host-retry-now");
      failThread(harness, thread.id);

      const result = await retryFailedTurn(harness.deps, {
        thread: requireThread(harness, thread.id),
        request: { turnRequestId: null, sendAt: null, reason: "Retry" },
      });

      expect(result.delivery).toBe("sent");
      expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
      expect(turnRequests(harness, thread.id)).toHaveLength(2);
    });
  });

  it("replays the failed attempt's execution instead of re-resolving today's", async () => {
    await withTestHarness(async (harness) => {
      const { requestId, thread } = seedFailableThread(harness, "host-exec");
      failThread(harness, thread.id);
      setThreadExecutionOverride(harness.db, {
        threadId: thread.id,
        modelOverride: "gpt-6-pro",
        reasoningLevelOverride: "max",
      });

      await retryFailedTurn(harness.deps, {
        thread: requireThread(harness, thread.id),
        request: { turnRequestId: requestId, sendAt: null, reason: "Retry" },
      });

      const requests = turnRequests(harness, thread.id);
      const retryRequest = requests[1];
      if (retryRequest === undefined) throw new Error("expected a retry turn");
      expect(turnRequestData(retryRequest).execution.model).toBe("gpt-5");
      expect(requireThread(harness, thread.id).modelOverride).toBe("gpt-6-pro");
      expect(requireThread(harness, thread.id).reasoningLevelOverride).toBe(
        "max",
      );
    });
  });

  it("refuses the second of two concurrent retries of one failure", async () => {
    await withTestHarness(async (harness) => {
      const { requestId, thread } = seedFailableThread(harness, "host-race");
      failThread(harness, thread.id);
      const retry = () =>
        retryFailedTurn(harness.deps, {
          thread: requireThread(harness, thread.id),
          request: {
            turnRequestId: requestId,
            sendAt: Date.now() + 60_000,
            reason: "Rate limited",
          },
        });

      const outcomes = await Promise.allSettled([retry(), retry()]);

      expect(
        outcomes.filter((outcome) => outcome.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = outcomes.find(
        (outcome) => outcome.status === "rejected",
      );
      expect(
        (rejected as PromiseRejectedResult | undefined)?.reason,
      ).toMatchObject({ body: { code: "retry_already_queued" } });
      expect(queuedRows(harness, thread.id)).toHaveLength(1);
    });
  });

  it("counts a retry's own failure as a later attempt of the same original", async () => {
    await withTestHarness(async (harness) => {
      const { requestId, thread } = seedFailableThread(
        harness,
        "host-attempts",
      );
      failThread(harness, thread.id);
      await retryFailedTurn(harness.deps, {
        thread: requireThread(harness, thread.id),
        request: {
          turnRequestId: requestId,
          sendAt: Date.now() + 60_000,
          reason: "Rate limited",
        },
      });
      await sweepPastResume(harness);

      failThread(harness, thread.id);
      const failedAgain = buildTurnFailedEvent(harness.db, thread.id);
      expect(failedAgain?.attemptNumber).toBe(2);
      expect(failedAgain?.requestId).not.toBe(requestId);

      await retryFailedTurn(harness.deps, {
        thread: requireThread(harness, thread.id),
        request: {
          turnRequestId: failedAgain?.requestId ?? null,
          sendAt: Date.now() + 60_000,
          reason: "Rate limited",
        },
      });
      expect(onlyQueuedRow(harness, thread.id).payload).toEqual({
        kind: "retry",
        retryOfTurnRequestId: requestId,
        attempt: 3,
        reason: "Rate limited",
      });
    });
  });

  it("still passes the dispatch hook when the retry comes back", async () => {
    await withTestHarness(async (harness) => {
      let dispatchCalls = 0;
      installHooks({
        "message.dispatch": [
          {
            pluginId: "concurrency-limit",
            handler: (context) => {
              dispatchCalls += 1;
              if (context.queuedMessages.length === 0) {
                return { action: "proceed" };
              }
              expect(context.queuedMessages[0]?.payload.kind).toBe("retry");
              return { action: "wait", reason: "At capacity" };
            },
          },
        ],
      });
      const { thread } = seedFailableThread(harness, "host-limit");
      failThread(harness, thread.id);
      await retryFailedTurn(harness.deps, {
        thread: requireThread(harness, thread.id),
        request: {
          turnRequestId: null,
          sendAt: Date.now() + 60_000,
          reason: "Rate limited",
        },
      });

      await sweepPastResume(harness);

      expect(dispatchCalls).toBe(2);
      expect(turnRequests(harness, thread.id)).toHaveLength(1);
      const requeued = onlyQueuedRow(harness, thread.id);
      expect(requeued.waitingOn).toEqual({
        kind: "plugin",
        pluginId: "concurrency-limit",
        reason: "At capacity",
      });
      expect(requeued.sendAt).toBeNull();
      expect(requeued.payload.kind).toBe("retry");
    });
  });

  it("leaves one waiting retry after later accepted failures", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedFailableThread(harness, "host-join");
      const failure = (sendAt: number) =>
        failAndRetry(harness, {
          environmentId: environment.id,
          threadId: thread.id,
          accepted: true,
          sendAt,
        });
      await failure(Date.now() + 3_600_000);
      await sendUserMessage(harness, thread.id, "Also check the tests");
      await failure(Date.now() + 1_800_000);
      await sendUserMessage(harness, thread.id, "And the docs");
      const latestSendAt = Date.now() + 60_000;
      const lastRequestId = lastTurnRequest(harness, thread.id).requestId;
      const last = await failure(latestSendAt);

      const waiting = onlyQueuedRow(harness, thread.id);
      expect(last).toEqual({
        ok: true,
        delivery: "queued",
        turnRequestId: lastRequestId,
        attempt: 2,
        queuedMessageId: waiting.id,
        waitingOn: { kind: "time" },
        sendAt: latestSendAt,
      });
      expect(waiting.sendAt).toBe(latestSendAt);
      expect(await drainRecoveries(harness, thread.id)).toBe(1);
    });
  });

  it("keeps a separate retry for every input the provider never accepted", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedFailableThread(
        harness,
        "host-unaccepted",
      );
      const sendAt = Date.now() + 60_000;
      const failure = () =>
        failAndRetry(harness, {
          environmentId: environment.id,
          threadId: thread.id,
          accepted: false,
          sendAt,
        });
      await failure();
      await sendUserMessage(harness, thread.id, "Also check the tests");
      await failure();

      expect(
        queuedRows(harness, thread.id).map((row) => ({
          text: row.content[0],
          waitingOn: row.waitingOn?.kind,
        })),
      ).toEqual([
        {
          text: expect.objectContaining({ text: "Do the thing" }),
          waitingOn: "superseded",
        },
        {
          text: expect.objectContaining({ text: "Also check the tests" }),
          waitingOn: "time",
        },
      ]);
      expect(await drainRecoveries(harness, thread.id)).toBe(1);
    });
  });

  it("gives an accepted failure its own retry when the thread's only retry is Not sent", async () => {
    await withTestHarness(async (harness) => {
      const { environment, requestId, thread } = seedFailableThread(
        harness,
        "host-join-not-sent",
      );
      await failAndRetry(harness, {
        environmentId: environment.id,
        threadId: thread.id,
        accepted: false,
        sendAt: Date.now() + 3_600_000,
      });
      await sendUserMessage(harness, thread.id, "Also check the tests");
      const laterRequestId = lastTurnRequest(harness, thread.id).requestId;
      const sendAt = Date.now() + 60_000;
      const later = await failAndRetry(harness, {
        environmentId: environment.id,
        threadId: thread.id,
        accepted: true,
        sendAt,
      });

      expect(later).toMatchObject({
        delivery: "queued",
        turnRequestId: laterRequestId,
        waitingOn: { kind: "time" },
        sendAt,
      });
      expect(
        queuedRows(harness, thread.id).map((row) => ({
          retryOf:
            row.payload.kind === "retry"
              ? row.payload.retryOfTurnRequestId
              : null,
          waitingOn: row.waitingOn?.kind,
        })),
      ).toEqual([
        { retryOf: requestId, waitingOn: "superseded" },
        { retryOf: laterRequestId, waitingOn: "time" },
      ]);
    });
  });

  it("refuses a thread that has not failed, a turn that is not the failed one, and a second live retry", async () => {
    await withTestHarness(async (harness) => {
      const { requestId, thread } = seedFailableThread(harness, "host-refuse");
      const retry = (turnRequestId: string | null) =>
        retryFailedTurn(harness.deps, {
          thread: requireThread(harness, thread.id),
          request: {
            turnRequestId,
            sendAt: Date.now() + 60_000,
            reason: "Retry",
          },
        });

      await expect(retry(null)).rejects.toMatchObject({
        body: { code: "no_failed_turn" },
      });

      failThread(harness, thread.id);
      await expect(retry("creq_2222222222")).rejects.toMatchObject({
        body: { code: "no_failed_turn" },
      });

      await retry(requestId);
      await expect(retry(requestId)).rejects.toMatchObject({
        body: { code: "retry_already_queued" },
      });
      expect(queuedRows(harness, thread.id)).toHaveLength(1);

      const claimed = claimQueuedThreadMessageGroup(
        harness.db,
        harness.deps.hub,
        onlyQueuedRow(harness, thread.id).id,
        { kind: "explicit-send" },
      );
      expect(claimed).toHaveLength(1);
      await expect(retry(requestId)).rejects.toMatchObject({
        body: { code: "retry_already_queued" },
      });
    });
  });

  it("re-sends a never-started turn once however many times it is retried", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFailableThread(harness, "host-repeat");
      for (let attempt = 2; attempt <= 6; attempt += 1) {
        failThread(harness, thread.id);
        await retryFailedTurn(harness.deps, {
          thread: requireThread(harness, thread.id),
          request: { turnRequestId: null, sendAt: null, reason: "Retry" },
        });
        expect(lastTurnRequest(harness, thread.id)).toMatchObject({
          retryAttempt: attempt,
          input: [{ text: "Do the thing", visibility: "agent-only" }],
        });
      }
    });
  });

  it("counts and re-sends a retry once when it has to reprovision the workspace", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-reprovision",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: WORKSPACE_PATH,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: WORKSPACE_PATH,
        environmentProviderId: "personal-workspace",
        environmentProviderPluginId: "bb-plugin-environment-personal-workspace",
        isGitRepo: false,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "active",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        inputText: "Do the thing",
        providerThreadId: "provider-reprovision",
        threadId: thread.id,
      });
      failThread(harness, thread.id);
      await retryFailedTurn(harness.deps, {
        thread: requireThread(harness, thread.id),
        request: { turnRequestId: null, sendAt: null, reason: "Retry" },
      });
      harness.db
        .update(environments)
        .set({ status: "error" })
        .where(eq(environments.id, environment.id))
        .run();
      failThread(harness, thread.id);

      await retryFailedTurn(harness.deps, {
        thread: requireThread(harness, thread.id),
        request: { turnRequestId: null, sendAt: null, reason: "Retry" },
      });

      const resent = [{ text: "Do the thing", visibility: "agent-only" }];
      expect(requireThread(harness, thread.id).status).toBe("starting");
      expect(lastTurnRequest(harness, thread.id)).toMatchObject({
        retryAttempt: 3,
        input: resent,
      });
      expect(
        readThreadProvisionContext(harness.db, thread.id)?.request.input,
      ).toMatchObject(resent);
    });
  });
});

function liveQueue(harness: TestAppHarness, threadId: string) {
  return listQueuedThreadMessages(harness.db, threadId).map(
    toThreadQueuedMessage,
  );
}

function requestTexts(harness: TestAppHarness, threadId: string): string[] {
  return turnRequests(harness, threadId).map(
    (event) => turnRequestData(event).input[0]?.text ?? "",
  );
}

async function scheduleRetry(
  harness: TestAppHarness,
  args: { threadId: string; requestId: string },
): Promise<void> {
  await retryFailedTurn(harness.deps, {
    thread: requireThread(harness, args.threadId),
    request: {
      turnRequestId: args.requestId,
      sendAt: Date.now() + 60_000,
      reason: "Rate limited",
    },
  });
}

async function sendNewMessage(
  harness: TestAppHarness,
  args: { threadId: string; text: string; sendAt?: number },
): Promise<void> {
  await acceptThreadSendRequest(harness.deps, {
    payload: {
      input: textInput(args.text),
      mode: "auto",
      ...(args.sendAt === undefined ? {} : { sendAt: args.sendAt }),
    },
    thread: requireThread(harness, args.threadId),
  });
}

describe("a queued retry", () => {
  it("is kept as Not sent when a newer message overtakes input the provider never accepted", async () => {
    await withTestHarness(async (harness) => {
      const { requestId, thread } = seedFailableThread(
        harness,
        "host-superseded",
      );
      failThread(harness, thread.id);
      await scheduleRetry(harness, { threadId: thread.id, requestId });

      await sendNewMessage(harness, {
        threadId: thread.id,
        text: "Do something else",
      });

      const notSent = onlyQueuedRow(harness, thread.id);
      expect(notSent.payload.kind).toBe("retry");
      expect(notSent.waitingOn).toEqual({ kind: "superseded" });
      expect(notSent.sendAt).toBeNull();

      await sweepPastResume(harness);
      expect(requestTexts(harness, thread.id)).toEqual([
        "Do the thing",
        "Do something else",
      ]);

      applyLoggedThreadLifecycleEvent(harness.deps, {
        event: { type: "run.succeeded" },
        threadId: thread.id,
      });
      await sendQueuedMessageNow(harness.deps, {
        mode: "auto",
        queuedMessageId: notSent.id,
        threadId: thread.id,
      });

      const requests = turnRequests(harness, thread.id);
      expect(requests).toHaveLength(3);
      expect(turnRequestData(requests[2]!)).toMatchObject({
        retryOfRequestId: requestId,
        input: [expect.objectContaining({ text: "Do the thing" })],
      });
      expect(liveQueue(harness, thread.id)).toEqual([]);
    });
  });

  it("is dropped when a newer message overtakes a turn the provider accepted", async () => {
    await withTestHarness(async (harness) => {
      const { environment, requestId, thread } = seedFailableThread(
        harness,
        "host-dropped",
      );
      seedInputAccepted(harness, {
        environmentId: environment.id,
        threadId: thread.id,
        requestId,
      });
      failThread(harness, thread.id);
      await scheduleRetry(harness, { threadId: thread.id, requestId });

      await sendNewMessage(harness, {
        threadId: thread.id,
        text: "Do something else",
      });

      expect(liveQueue(harness, thread.id)).toEqual([]);
      await sweepPastResume(harness);
      expect(requestTexts(harness, thread.id)).toEqual([
        "Do the thing",
        "Do something else",
      ]);
    });
  });

  it("does not hold back messages once it is Not sent", async () => {
    await withTestHarness(async (harness) => {
      const { requestId, thread } = seedFailableThread(
        harness,
        "host-not-blocking",
      );
      failThread(harness, thread.id);
      await scheduleRetry(harness, { threadId: thread.id, requestId });
      await sendNewMessage(harness, {
        threadId: thread.id,
        text: "Do something else",
      });
      await sendNewMessage(harness, {
        threadId: thread.id,
        text: "Then this",
      });
      const [notSent, queued] = liveQueue(harness, thread.id);
      expect(notSent?.waitingOn).toEqual({ kind: "superseded" });
      expect(queued?.payload.kind).toBe("inline");

      applyLoggedThreadLifecycleEvent(harness.deps, {
        event: { type: "run.succeeded" },
        threadId: thread.id,
      });
      await runQueuedMessageDispatch(harness.deps, {
        kind: "thread-ready",
        threadId: thread.id,
      });

      expect(requestTexts(harness, thread.id)).toEqual([
        "Do the thing",
        "Do something else",
        "Then this",
      ]);
    });
  });
});

describe("pooled provider retry integration", () => {
  it("queues a durable retry for a pool 429 without a provider quota event", async () => {
    await withTestHarness(async (harness) => {
      const { thread, environment, host, requestId } = seedFailableThread(
        harness,
        "host-pooled-retry",
      );
      const poolModule = await import(
        new URL(
          "../../../../plugins/account-pool/src/server.ts",
          import.meta.url,
        ).href
      );
      const createAccountPoolPlugin: (options: {
        now: () => number;
        env: NodeJS.ProcessEnv;
        fetch: typeof fetch;
      }) => (bb: BbPluginApi) => Promise<void> =
        poolModule.createAccountPoolPlugin;
      const retryModule = await import(
        new URL("../../../../plugins/provider-retry/server.ts", import.meta.url)
          .href
      );
      const providerRetryPlugin: (bb: BbPluginApi) => Promise<void> =
        retryModule.default;
      const retryAvailabilityMethod = "provider-retry.v1.availability";
      const retryAvailabilitySchema = z.object({
        kind: z.literal("blocked"),
        retryAt: z.number(),
      });
      const now = Date.now();
      const resetAt = now + 3_600_000;
      const dataDir = await mkdtemp(path.join(tmpdir(), "bb-pool-retry-"));
      const pool = createFakePluginHost({
        pluginId: "account-pool",
        dataDir,
        sdk: {
          hosts: { list: async () => [host] },
          system: { providerStates: async () => ({ providers: [] }) },
          threads: {
            events: {
              list: async () => [{ data: lastTurnRequest(harness, thread.id) }],
            },
          },
        },
      });
      const retry = createFakePluginHost({
        pluginId: "provider-retry",
        sdk: {
          plugins: {
            experimental_discoverRpc: async () => [
              {
                pluginId: "account-pool",
                displayName: "Account Pooler",
                method: retryAvailabilityMethod,
              },
            ],
            callRpc: async ({ method, input }) =>
              retryAvailabilitySchema.parse(
                await pool.harness.behavior.callRpc(method, input),
              ),
          },
          threads: {
            retry: async (request) =>
              retryFailedTurn(harness.deps, {
                thread: requireThread(harness, request.threadId),
                request: {
                  turnRequestId: request.turnRequestId ?? null,
                  sendAt: request.sendAt ?? null,
                  reason: request.reason ?? "Rate limited",
                },
              }),
          },
        },
      });
      try {
        await createAccountPoolPlugin({
          now: () => now,
          env: {},
          fetch: async () =>
            Response.json(
              {},
              {
                status: 429,
                headers: {
                  "anthropic-ratelimit-unified-5h-status": "rejected",
                  "anthropic-ratelimit-unified-5h-reset": String(
                    resetAt / 1000,
                  ),
                },
              },
            ),
        })(pool.bb);
        await pool.harness.behavior.callRpc("account.add", {
          provider: "claude",
          apiKey: "test-account",
          label: null,
          priority: 1,
        });
        pool.harness.behavior.runService("hub");
        const entries = await pool.harness.behavior.resolveProviderEnv(
          "claude-code",
          { threadId: thread.id, projectId: thread.projectId, hostId: host.id },
        );
        const token = entries.find(
          (entry) => entry.name === "ANTHROPIC_AUTH_TOKEN",
        )?.value;
        if (typeof token !== "string") throw new Error("Expected a pool token");
        const response = await pool.harness.behavior.fetchHttp(
          "POST",
          "/v1/messages",
          {
            headers: { authorization: `Bearer ${token}` },
            body: JSON.stringify({ model: "claude-opus-4-1", messages: [] }),
          },
        );
        expect(response.status).toBe(429);
        await response.text();
        seedEvent(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          sequence:
            getLatestThreadSequence(harness.db, { threadId: thread.id }) + 1,
          type: "provider/error",
          scope: { kind: "thread" },
          data: {
            providerThreadId: "provider-session",
            message: "No Account Pooler account is currently eligible.",
            errorInfo: {
              category: "rate-limit",
              providerCode: null,
              httpStatusCode: 429,
            },
          },
        });
        failThread(harness, thread.id);
        const failed = buildTurnFailedEvent(harness.db, thread.id);
        if (failed === null) throw new Error("Expected a failed turn");
        expect(failed.rateLimits).toBeNull();
        await providerRetryPlugin(retry.bb);
        expect(
          (await retry.harness.behavior.emitThreadEvent("turn.failed", failed))
            .errors,
        ).toEqual([]);
        const queued = listQueuedThreadMessages(harness.db, thread.id);
        expect(queued).toHaveLength(1);
        const row = queued[0]!;
        expect(row.sendAt).toBeGreaterThanOrEqual(resetAt + 15_000);
        expect(row.sendAt).toBeLessThan(resetAt + 45_000);
        expect(toThreadQueuedMessage(row).payload).toMatchObject({
          kind: "retry",
          retryOfTurnRequestId: requestId,
          attempt: 2,
        });
      } finally {
        await retry.harness.dispose();
        await pool.harness.dispose();
        await rm(dataDir, { recursive: true, force: true });
      }
    });
  });
});
