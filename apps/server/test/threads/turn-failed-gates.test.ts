import {
  getLatestThreadSequence,
  listEvents,
  listQueuedThreadMessages,
} from "@bb/db";
import type { ThreadQueuedMessage } from "@bb/domain";
import type {
  PluginDispatchGateStage,
  PluginTurnFailedGateContext,
} from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it } from "vitest";
import {
  setDispatchGateProvider,
  type DispatchGateRegistration,
} from "../../src/services/plugins/dispatch-gate-registry.js";
import { applyLoggedThreadLifecycleEvent } from "../../src/services/threads/lifecycle-outcome.js";
import { runDueScheduledQueueSweep } from "../../src/services/threads/queue-drains.js";
import { toThreadQueuedMessage } from "../../src/services/threads/thread-queued-messages.js";
import {
  seedEnvironment,
  seedEvent,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const WORKSPACE_PATH = "/tmp/turn-failed-project";

type TurnFailedRegistration = DispatchGateRegistration<"turn.failed">;
type DispatchRegistration = DispatchGateRegistration<"dispatch">;

/**
 * The gate registry, per stage. Reading a mapped type through a generic key is
 * sound, which is what lets the fake provider satisfy `listGates<S>` with no
 * cast.
 */
type GateRegistry = {
  [S in PluginDispatchGateStage]: DispatchGateRegistration<S>[];
};

function installGates(
  gates: Partial<{
    "turn.failed": TurnFailedRegistration[];
    dispatch: DispatchRegistration[];
  }>,
): void {
  const registry: GateRegistry = {
    dispatch: gates.dispatch ?? [],
    "turn.failed": gates["turn.failed"] ?? [],
  };
  setDispatchGateProvider({
    listGates: (stage) => registry[stage],
    invokeGate: async (_pluginId, _label, run) => {
      try {
        return { ok: true, value: await run() };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    decisionTimeoutMs: 10_000,
  });
}

afterEach(() => {
  setDispatchGateProvider(undefined);
});

/**
 * The `turn.failed` pass is deferred to a macrotask so it never runs inside the
 * transaction that applied the failure. Tests wait the same way the runtime
 * does rather than reaching into the scheduler.
 */
async function flushTurnFailedPass(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * A thread whose most recent turn is the user's original request.
 *
 * `seedThreadRuntimeState` writes that request itself, so this deliberately
 * does not add another: the retry tests are about how many `client/turn/
 * requested` events exist, and a second seeded one would hide a duplicate.
 */
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
    sequence: getLatestThreadSequence(harness.db, { threadId: args.threadId }) + 1,
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
    sequence: getLatestThreadSequence(harness.db, { threadId: args.threadId }) + 1,
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

/** The thread's parked rows: a live queued row with a wait on it. */
function parkedRows(
  harness: TestAppHarness,
  threadId: string,
): ThreadQueuedMessage[] {
  return listQueuedThreadMessages(harness.db, threadId)
    .map(toThreadQueuedMessage)
    .filter((entry) => entry.waitingOn !== null);
}

function onlyParkedRow(
  harness: TestAppHarness,
  threadId: string,
): ThreadQueuedMessage {
  const rows = parkedRows(harness, threadId);
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new Error(`expected exactly one parked row, found ${rows.length}`);
  }
  return rows[0];
}

/**
 * Fires the due sweep as the timer would once the retry's `resumeAt` passed.
 * The sweep re-attempts the row through the same dispatch checkpoint an inline
 * send uses, which is what these tests are actually about.
 */
async function sweepPastResume(harness: TestAppHarness): Promise<void> {
  await runDueScheduledQueueSweep(harness.deps, Date.now() + 120_000);
}

describe("turn.failed gate context", () => {
  it("hands the gate the failed turn, the provider's error and the rate-limit window", async () => {
    await withTestHarness(async (harness) => {
      const contexts: PluginTurnFailedGateContext[] = [];
      installGates({
        "turn.failed": [
          {
            pluginId: "retry-policy",
            handler: (context) => {
              contexts.push(context);
              return { action: "none" };
            },
          },
        ],
      });
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
      await flushTurnFailedPass();

      expect(contexts).toHaveLength(1);
      const context = contexts[0];
      if (context === undefined) throw new Error("expected a gate call");
      expect(context.stage).toBe("turn.failed");
      expect(context.thread.id).toBe(thread.id);
      expect(context.failure.requestId).toBe(requestId);
      // A first failure is attempt 1, and its own request starts the chain.
      expect(context.failure.attemptNumber).toBe(1);
      expect(context.failure.originalRequestId).toBe(requestId);
      expect(context.failure.errorInfo).toEqual({
        category: "rate-limit",
        providerCode: "usage_limit_reached",
        httpStatusCode: 429,
      });
      expect(context.failure.message).toBe("Usage limit reached");
      expect(context.failure.rateLimits?.windows[0]?.resetsAtMs).toBe(
        resetsAtMs,
      );
      // The tuple the failed attempt actually ran with, so a policy can see it.
      expect(context.requestedExecution.model).toBe("gpt-5");
      expect(context.input.text).toBe("Do the thing");
    });
  });

  it("does not run at all when the thread succeeds or is merely stopped", async () => {
    await withTestHarness(async (harness) => {
      let calls = 0;
      installGates({
        "turn.failed": [
          {
            pluginId: "retry-policy",
            handler: () => {
              calls += 1;
              return { action: "none" };
            },
          },
        ],
      });
      const { thread } = seedFailableThread(harness, "host-ok");

      applyLoggedThreadLifecycleEvent(harness.deps, {
        event: { type: "run.succeeded" },
        threadId: thread.id,
      });
      await flushTurnFailedPass();

      expect(calls).toBe(0);
    });
  });

  it("keeps the failure intact when the gate throws, and names the plugin", async () => {
    await withTestHarness(async (harness) => {
      installGates({
        "turn.failed": [
          {
            pluginId: "broken-retry",
            handler: () => {
              throw new Error("policy exploded");
            },
          },
          {
            pluginId: "working-retry",
            handler: () => ({
              action: "retry",
              reason: "Rate limited",
              resumeAt: Date.now() + 60_000,
            }),
          },
        ],
      });
      const { thread } = seedFailableThread(harness, "host-throw");

      failThread(harness, thread.id);
      await flushTurnFailedPass();

      // Fail-closed here means the broken plugin loses its vote, not that the
      // failure becomes unrecoverable: the thread stays in error and the next
      // gate still gets to decide.
      expect(onlyParkedRow(harness, thread.id).waitingOn).toMatchObject({
        kind: "plugin",
        pluginId: "working-retry",
      });
    });
  });

  it("parks one retry row per failure even if the failure is applied twice", async () => {
    await withTestHarness(async (harness) => {
      installGates({
        "turn.failed": [
          {
            pluginId: "retry-policy",
            handler: () => ({
              action: "retry",
              reason: "Rate limited",
              resumeAt: Date.now() + 60_000,
            }),
          },
        ],
      });
      const { thread } = seedFailableThread(harness, "host-twice");

      failThread(harness, thread.id);
      await flushTurnFailedPass();
      failThread(harness, thread.id);
      await flushTurnFailedPass();

      expect(parkedRows(harness, thread.id)).toHaveLength(1);
    });
  });
});

describe("parked retry dispatch", () => {
  it("re-submits the original turn without duplicating the user's message", async () => {
    await withTestHarness(async (harness) => {
      const resumeAt = Date.now() + 60_000;
      installGates({
        "turn.failed": [
          {
            pluginId: "retry-policy",
            handler: () => ({
              action: "retry",
              reason: "Rate limited",
              resumeAt,
            }),
          },
        ],
      });
      const { requestId, thread } = seedFailableThread(harness, "host-retry");

      failThread(harness, thread.id);
      await flushTurnFailedPass();

      const parked = onlyParkedRow(harness, thread.id);
      // A by-reference row: it names the request it will re-submit, waits on
      // the plugin that asked for the retry, and is due at that plugin's
      // `resumeAt` so the ordinary due sweep is what wakes it.
      expect(parked.payload).toEqual({
        kind: "retry",
        retryOfTurnRequestId: requestId,
        attempt: 2,
      });
      expect(parked.waitingOn).toEqual({
        kind: "plugin",
        pluginId: "retry-policy",
        reason: "Rate limited",
      });
      expect(parked.sendAt).toBe(resumeAt);

      await sweepPastResume(harness);

      const requests = turnRequests(harness, thread.id);
      expect(requests).toHaveLength(2);
      const retryRequest = requests[1];
      if (retryRequest === undefined) throw new Error("expected a retry turn");
      const data = turnRequestData(retryRequest);

      // The retry marker is on the new attempt, pointing back at the original.
      expect(data.retryOfRequestId).toBe(requestId);
      expect(data.retryAttempt).toBe(2);
      // The provider is asked the identical question...
      expect(data.input[0]?.text).toBe("Do the thing");
      expect(data.execution.model).toBe("gpt-5");
      // ...but nothing re-enters the conversation as the user: the retry is a
      // system dispatch whose blocks are agent-only, which is what keeps the
      // timeline from showing "Do the thing" twice.
      expect(data.initiator).toBe("system");
      expect(data.input[0]?.visibility).toBe("agent-only");
      const userRequests = turnRequests(harness, thread.id).filter(
        (event) => turnRequestData(event).initiator === "user",
      );
      expect(userRequests).toHaveLength(1);
      // The row was consumed by the dispatch rather than left on the queue.
      expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
    });
  });

  it("counts the next failure as a later attempt of the same original turn", async () => {
    await withTestHarness(async (harness) => {
      const attempts: number[] = [];
      const originals: string[] = [];
      installGates({
        "turn.failed": [
          {
            pluginId: "retry-policy",
            handler: (context) => {
              attempts.push(context.failure.attemptNumber);
              originals.push(context.failure.originalRequestId);
              return {
                action: "retry",
                reason: "Rate limited",
                resumeAt: Date.now() + 60_000,
              };
            },
          },
        ],
      });
      const { requestId, thread } = seedFailableThread(
        harness,
        "host-attempts",
      );

      failThread(harness, thread.id);
      await flushTurnFailedPass();
      await sweepPastResume(harness);

      failThread(harness, thread.id);
      await flushTurnFailedPass();

      expect(attempts).toEqual([1, 2]);
      // The chain still points at the turn the user actually sent.
      expect(originals).toEqual([requestId, requestId]);
      expect(onlyParkedRow(harness, thread.id).payload).toEqual({
        kind: "retry",
        retryOfTurnRequestId: requestId,
        attempt: 3,
      });
    });
  });

  it("still respects a limiter when the retry comes back", async () => {
    await withTestHarness(async (harness) => {
      let dispatchCalls = 0;
      installGates({
        dispatch: [
          {
            pluginId: "concurrency-limit",
            handler: (context) => {
              dispatchCalls += 1;
              // The re-attempt must look like a re-decision about an existing
              // parked row, not a fresh send, or a limiter would double-count
              // it — and the row it names is the retry, not a user message.
              expect(context.queuedMessage?.payload.kind).toBe("retry");
              return { action: "wait", reason: "At capacity" };
            },
          },
        ],
        "turn.failed": [
          {
            pluginId: "retry-policy",
            handler: () => ({
              action: "retry",
              reason: "Rate limited",
              resumeAt: Date.now() + 60_000,
            }),
          },
        ],
      });
      const { thread } = seedFailableThread(harness, "host-limit");

      failThread(harness, thread.id);
      await flushTurnFailedPass();

      await sweepPastResume(harness);

      expect(dispatchCalls).toBe(1);
      // The turn did not dispatch; the same row is parked again, this time by
      // the limiter, and its schedule is cleared because the limiter named no
      // retry instant.
      expect(turnRequests(harness, thread.id)).toHaveLength(1);
      const reparked = onlyParkedRow(harness, thread.id);
      expect(reparked.waitingOn).toEqual({
        kind: "plugin",
        pluginId: "concurrency-limit",
        reason: "At capacity",
      });
      expect(reparked.sendAt).toBeNull();
      expect(reparked.payload.kind).toBe("retry");
    });
  });
});
