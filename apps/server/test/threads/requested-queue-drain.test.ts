import { listEvents, listQueuedThreadMessages, setQueuedThreadMessageGroupBoundary } from "@bb/db";
import type { PluginHookName } from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setPluginHookProvider,
  type PluginHookRegistration,
} from "../../src/services/plugins/plugin-hook-registry.js";
import {
  requestQueueDrain,
  runDueScheduledQueueSweep,
  runRequestedQueueDrain,
} from "../../src/services/threads/queue-drains.js";
import { acceptThreadSendRequest } from "../../src/services/threads/thread-send-request.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedQueuedMessage,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const WORKSPACE_PATH = "/tmp/requested-drain-project";

type HookRegistry = {
  [K in PluginHookName]: PluginHookRegistration<K>[];
};

function installHooks(registry: HookRegistry): void {
  setPluginHookProvider({
    listHooks: (hook) => registry[hook],
    invokeHook: async (_pluginId, _label, run) => ({
      ok: true,
      value: await run(),
    }),
    decisionTimeoutMs: 10_000,
  });
}

afterEach(() => {
  setPluginHookProvider(undefined);
  vi.useRealTimers();
});

function seedRunnableThread(
  harness: TestAppHarness,
  args: { hostId: string; status: "idle" | "active" },
) {
  const { host } = seedHostSession(harness.deps, { id: args.hostId });
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
    status: args.status,
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId: `provider-${args.hostId}`,
    threadId: thread.id,
  });
  if (args.status === "active") {
    seedTurnStarted(harness.deps, {
      environmentId: environment.id,
      threadId: thread.id,
      turnId: `turn-${args.hostId}`,
      providerThreadId: `provider-${args.hostId}`,
    });
  }
  return { environment, project, thread };
}

function turnRequests(harness: TestAppHarness, threadId: string) {
  return listEvents(harness.db, { threadId }).filter(
    (event) => event.type === "client/turn/requested",
  );
}

describe("the requested queue drain", () => {
  it("does not dispatch a scheduled group tail while its lead is postponed", async () => {
    await withTestHarness(async (harness) => {
      vi.useFakeTimers();
      let attempts = 0;
      installHooks({ "message.dispatch": [{ pluginId: "limiter", handler: () => ++attempts === 1 ? ({ action: "wait", reason: "At capacity" } as const) : { action: "proceed" } }] });
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-scheduled-group",
        status: "idle",
      });
      const lead = seedQueuedMessage(harness.deps, { threadId: thread.id, content: textInput("lead"), waitingOn: { kind: "time" }, sendAt: Date.now() - 2_000 });
      const tail = seedQueuedMessage(harness.deps, { threadId: thread.id, content: textInput("tail"), waitingOn: { kind: "time" }, sendAt: Date.now() - 1_000 });
      setQueuedThreadMessageGroupBoundary({ db: harness.db, notifier: harness.deps.hub, threadId: thread.id, expectedGroupedPrefixQueuedMessageIds: [lead.id, tail.id], groupBoundaryQueuedMessageId: tail.id });

      await runDueScheduledQueueSweep(harness.deps, Date.now());
      vi.advanceTimersByTime(1_001);
      await runDueScheduledQueueSweep(harness.deps, Date.now());

      expect(attempts).toBe(1);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(2);
    });
  });

  it("re-attempts a plugin-queued row once the hook lets it through", async () => {
    // The release path that replaced a plugin releasing its own wait: core
    // re-attempts, the hook re-decides, and a row that is still blocked simply
    // re-queues. No plugin has to work out which row deserves the freed slot.
    await withTestHarness(async (harness) => {
      let full = true;
      const registry: HookRegistry = { "message.dispatch": [] };
      registry["message.dispatch"].push({
        pluginId: "limiter",
        handler: () =>
          full
            ? ({ action: "wait", reason: "1 of 1 running on all hosts" } as const)
            : ({ action: "proceed" } as const),
      });
      installHooks(registry);
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-freed-drain",
        status: "idle",
      });

      // Queued inline, so the re-queue pacing window never opens.
      await acceptThreadSendRequest(harness.deps, {
        payload: { input: textInput("held work"), mode: "auto" },
        thread,
      });
      const turnsBefore = turnRequests(harness, thread.id).length;
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(1);

      full = false;
      await runRequestedQueueDrain(harness.deps);

      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(0);
      expect(turnRequests(harness, thread.id)).toHaveLength(turnsBefore + 1);
    });
  });

  it("leaves rows on core waits alone", async () => {
    // A `thread-busy` row is waiting on its own thread's turn ending, not on
    // somebody else's slot. Re-attempting it on every completion in the server
    // would be pure churn.
    await withTestHarness(async (harness) => {
      const seen: string[] = [];
      const registry: HookRegistry = { "message.dispatch": [] };
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-core-wait",
        status: "active",
      });
      await acceptThreadSendRequest(harness.deps, {
        payload: { input: textInput("after this turn"), mode: "queue-if-active" },
        thread,
      });
      const queued = listQueuedThreadMessages(harness.db, thread.id);
      expect(queued).toHaveLength(1);

      registry["message.dispatch"].push({
        pluginId: "limiter",
        handler: (context) => {
          seen.push(context.thread.id);
          return { action: "proceed" } as const;
        },
      });
      installHooks(registry);
      await runRequestedQueueDrain(harness.deps);

      expect(seen).toEqual([]);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(1);
    });
  });

  it("honours the re-queue pacing so a plugin that stays full is not re-asked in a loop", async () => {
    await withTestHarness(async (harness) => {
      let passes = 0;
      const registry: HookRegistry = { "message.dispatch": [] };
      registry["message.dispatch"].push({
        pluginId: "limiter",
        handler: () => {
          passes += 1;
          return { action: "wait", reason: "still full" } as const;
        },
      });
      installHooks(registry);
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-freed-pacing",
        status: "idle",
      });
      await acceptThreadSendRequest(harness.deps, {
        payload: { input: textInput("held work"), mode: "auto" },
        thread,
      });
      expect(passes).toBe(1);

      // The first drain re-queues, which starts the thread's cooldown; the
      // second finds it and does nothing, so a burst of completions costs one
      // hook pass per thread rather than one per completion.
      await runRequestedQueueDrain(harness.deps);
      expect(passes).toBe(2);
      await runRequestedQueueDrain(harness.deps);
      expect(passes).toBe(2);
    });
  });

  it("walks the queued rows in queue order", async () => {
    // A limit can be expressed over any grouping, so core cannot pick which
    // row deserves the freed slot — it re-offers them oldest first and lets the
    // hook decide. A full pool therefore drains in the order it filled.
    await withTestHarness(async (harness) => {
      let admit = false;
      const seen: string[] = [];
      const registry: HookRegistry = { "message.dispatch": [] };
      registry["message.dispatch"].push({
        pluginId: "limiter",
        handler: (context) => {
          seen.push(context.thread.id);
          return admit
            ? ({ action: "proceed" } as const)
            : ({ action: "wait", reason: "full" } as const);
        },
      });
      installHooks(registry);
      const first = seedRunnableThread(harness, {
        hostId: "host-order-first",
        status: "idle",
      }).thread;
      await acceptThreadSendRequest(harness.deps, {
        payload: { input: textInput("first in"), mode: "auto" },
        thread: first,
      });
      const second = seedRunnableThread(harness, {
        hostId: "host-order-second",
        status: "idle",
      }).thread;
      await acceptThreadSendRequest(harness.deps, {
        payload: { input: textInput("second in"), mode: "auto" },
        thread: second,
      });

      seen.length = 0;
      admit = true;
      await runRequestedQueueDrain(harness.deps);

      expect(seen).toEqual([first.id, second.id]);
      expect(listQueuedThreadMessages(harness.db, first.id)).toHaveLength(0);
      expect(listQueuedThreadMessages(harness.db, second.id)).toHaveLength(0);
    });
  });
});

describe("requesting a drain", () => {
  it("coalesces a burst of requests into one walk", async () => {
    // Five turns finishing together are five requests, and one walk of the
    // queue fills as many freed slots as the hook allows. Without the
    // coalescing flag each request would schedule its own walk over the same
    // rows. Asserted on the scheduled work itself: the re-queue pacing makes a
    // redundant walk invisible in the hook-pass count, which is exactly why it
    // must not be the thing under test here.
    await withTestHarness(async (harness) => {
      let passes = 0;
      const registry: HookRegistry = { "message.dispatch": [] };
      registry["message.dispatch"].push({
        pluginId: "limiter",
        handler: () => {
          passes += 1;
          return { action: "wait", reason: "full" } as const;
        },
      });
      installHooks(registry);
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-burst",
        status: "idle",
      });
      await acceptThreadSendRequest(harness.deps, {
        payload: { input: textInput("held work"), mode: "auto" },
        thread,
      });
      expect(passes).toBe(1);

      vi.useFakeTimers();
      try {
        requestQueueDrain(harness.deps);
        requestQueueDrain(harness.deps);
        requestQueueDrain(harness.deps);
        expect(vi.getTimerCount()).toBe(1);
        // Let it run rather than dropping it: the pending flag clears when the
        // walk starts, and a walk that never starts would suppress every later
        // request in the process.
        await vi.runAllTimersAsync();
      } finally {
        vi.useRealTimers();
      }
      expect(passes).toBe(2);

      // The flag cleared when that walk started, so the next burst is its own
      // walk — a thread freeing mid-walk is not silently dropped.
      vi.useFakeTimers();
      try {
        requestQueueDrain(harness.deps);
        expect(vi.getTimerCount()).toBe(1);
        await vi.runAllTimersAsync();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
