import { getLatestThreadSequence, listDispatchHolds, listEvents } from "@bb/db";
import type {
  PluginDispatchGateStage,
  PluginTurnFailedGateContext,
} from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it } from "vitest";
import {
  setDispatchGateProvider,
  type DispatchGateRegistration,
} from "../../src/services/plugins/dispatch-gate-registry.js";
import { releaseDispatchHoldAndDispatch } from "../../src/services/threads/dispatch-hold-release.js";
import { parseDispatchHoldPayload } from "../../src/services/threads/dispatch-holds.js";
import { applyLoggedThreadLifecycleEvent } from "../../src/services/threads/lifecycle-outcome.js";
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
type TurnSubmitRegistration = DispatchGateRegistration<"turn.submit">;

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
    "turn.submit": TurnSubmitRegistration[];
  }>,
): void {
  const registry: GateRegistry = {
    "thread.create": [],
    "turn.submit": gates["turn.submit"] ?? [],
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

function liveHolds(harness: TestAppHarness, threadId: string) {
  return listDispatchHolds(harness.db, { threadId, liveOnly: true });
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
      expect(harness.deps.db).toBeDefined();
      expect(liveHolds(harness, thread.id)).toHaveLength(1);
    });
  });

  it("parks one hold per failure even if the failure is applied twice", async () => {
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

      expect(liveHolds(harness, thread.id)).toHaveLength(1);
    });
  });
});

describe("retry hold dispatch", () => {
  it("re-submits the original turn without duplicating the user's message", async () => {
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
      const { requestId, thread } = seedFailableThread(harness, "host-retry");

      failThread(harness, thread.id);
      await flushTurnFailedPass();

      const hold = liveHolds(harness, thread.id)[0];
      if (hold === undefined) throw new Error("expected a retry hold");
      const payload = parseDispatchHoldPayload(hold);
      expect(payload).toEqual({
        kind: "retry",
        retryOfTurnRequestId: requestId,
        attempt: 2,
      });

      await releaseDispatchHoldAndDispatch(harness.deps, {
        hold,
        releaseKind: "timer",
      });

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
      const { requestId, thread } = seedFailableThread(harness, "host-attempts");

      failThread(harness, thread.id);
      await flushTurnFailedPass();
      const first = liveHolds(harness, thread.id)[0];
      if (first === undefined) throw new Error("expected a retry hold");
      await releaseDispatchHoldAndDispatch(harness.deps, {
        hold: first,
        releaseKind: "timer",
      });

      failThread(harness, thread.id);
      await flushTurnFailedPass();

      expect(attempts).toEqual([1, 2]);
      // The chain still points at the turn the user actually sent.
      expect(originals).toEqual([requestId, requestId]);
      const second = liveHolds(harness, thread.id)[0];
      if (second === undefined) throw new Error("expected a second hold");
      expect(parseDispatchHoldPayload(second)).toEqual({
        kind: "retry",
        retryOfTurnRequestId: requestId,
        attempt: 3,
      });
    });
  });

  it("still respects a limiter when the retry comes back", async () => {
    await withTestHarness(async (harness) => {
      let submitCalls = 0;
      installGates({
        "turn.submit": [
          {
            pluginId: "concurrency-limit",
            handler: (context) => {
              submitCalls += 1;
              // The releasing pass must look like a re-decision, not a fresh
              // dispatch, or a limiter would double-count it.
              expect(context.isReleaseReevaluation).toBe(true);
              return { action: "hold", reason: "At capacity" };
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
      const retryHold = liveHolds(harness, thread.id)[0];
      if (retryHold === undefined) throw new Error("expected a retry hold");

      await releaseDispatchHoldAndDispatch(harness.deps, {
        hold: retryHold,
        releaseKind: "timer",
      });

      expect(submitCalls).toBe(1);
      // The turn did not dispatch; it is parked again, this time by the limiter.
      expect(turnRequests(harness, thread.id)).toHaveLength(1);
      const holds = liveHolds(harness, thread.id);
      expect(holds).toHaveLength(1);
      expect(holds[0]?.holder).toBe("plugin:concurrency-limit");
    });
  });
});
