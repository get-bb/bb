import { getThread, listEvents, listQueuedThreadMessages } from "@bb/db";
import type { PluginDispatchGateStage } from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it } from "vitest";
import {
  setDispatchGateProvider,
  type DispatchGateRegistration,
} from "../../src/services/plugins/dispatch-gate-registry.js";
import { setFreedThreadCapacityListener } from "../../src/services/threads/freed-capacity-signal.js";
import {
  archiveThreadAndHiddenSourceForks,
  resolveArchiveThreadEnvironment,
} from "../../src/services/threads/thread-archive.js";
import { runFreedCapacityQueueDrain } from "../../src/services/threads/queue-drains.js";
import { acceptThreadSendRequest } from "../../src/services/threads/thread-send-request.js";
import { applyLoggedThreadLifecycleEvent } from "../../src/services/threads/lifecycle-outcome.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const WORKSPACE_PATH = "/tmp/freed-capacity-project";

type GateRegistry = {
  [S in PluginDispatchGateStage]: DispatchGateRegistration<S>[];
};

function installGates(registry: GateRegistry): void {
  setDispatchGateProvider({
    listGates: (stage) => registry[stage],
    invokeGate: async (_pluginId, _label, run) => ({
      ok: true,
      value: await run(),
    }),
    decisionTimeoutMs: 10_000,
  });
}

afterEach(() => {
  setDispatchGateProvider(undefined);
  setFreedThreadCapacityListener(undefined);
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

describe("the freed-capacity drain", () => {
  it("re-attempts a plugin-parked row once the gate lets it through", async () => {
    // The release path that replaced a plugin releasing its own wait: core
    // re-attempts, the gate re-decides, and a row that is still blocked simply
    // re-parks. No plugin has to work out which row deserves the freed slot.
    await withTestHarness(async (harness) => {
      let full = true;
      const registry: GateRegistry = { dispatch: [], "turn.failed": [] };
      registry.dispatch.push({
        pluginId: "limiter",
        handler: () =>
          full
            ? ({ action: "wait", reason: "1 of 1 running on all hosts" } as const)
            : ({ action: "proceed" } as const),
      });
      installGates(registry);
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-freed-drain",
        status: "idle",
      });

      // Parked inline, so the re-park pacing window never opens.
      await acceptThreadSendRequest(harness.deps, {
        payload: { input: textInput("held work"), mode: "auto" },
        thread,
      });
      const turnsBefore = turnRequests(harness, thread.id).length;
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(1);

      full = false;
      await runFreedCapacityQueueDrain(harness.deps);

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
      const registry: GateRegistry = { dispatch: [], "turn.failed": [] };
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-core-wait",
        status: "active",
      });
      await acceptThreadSendRequest(harness.deps, {
        payload: { input: textInput("after this turn"), mode: "queue-if-active" },
        thread,
      });
      const parked = listQueuedThreadMessages(harness.db, thread.id);
      expect(parked).toHaveLength(1);

      registry.dispatch.push({
        pluginId: "limiter",
        handler: (context) => {
          seen.push(context.thread.id);
          return { action: "proceed" } as const;
        },
      });
      installGates(registry);
      await runFreedCapacityQueueDrain(harness.deps);

      expect(seen).toEqual([]);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(1);
    });
  });

  it("honours the re-park pacing so a plugin that stays full is not re-asked in a loop", async () => {
    await withTestHarness(async (harness) => {
      let passes = 0;
      const registry: GateRegistry = { dispatch: [], "turn.failed": [] };
      registry.dispatch.push({
        pluginId: "limiter",
        handler: () => {
          passes += 1;
          return { action: "wait", reason: "still full" } as const;
        },
      });
      installGates(registry);
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-freed-pacing",
        status: "idle",
      });
      await acceptThreadSendRequest(harness.deps, {
        payload: { input: textInput("held work"), mode: "auto" },
        thread,
      });
      expect(passes).toBe(1);

      // The first drain re-parks, which starts the thread's cooldown; the
      // second finds it and does nothing, so a burst of completions costs one
      // gate pass per thread rather than one per completion.
      await runFreedCapacityQueueDrain(harness.deps);
      expect(passes).toBe(2);
      await runFreedCapacityQueueDrain(harness.deps);
      expect(passes).toBe(2);
    });
  });
});

describe("the freed-capacity signal", () => {
  it("fires when a thread leaves the occupying set, and not when it enters it", async () => {
    await withTestHarness(async (harness) => {
      let fired = 0;
      setFreedThreadCapacityListener(() => {
        fired += 1;
      });
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-freed-signal",
        status: "active",
      });

      applyLoggedThreadLifecycleEvent(harness.deps, {
        threadId: thread.id,
        event: { type: "run.succeeded" },
      });
      expect(fired).toBe(1);

      applyLoggedThreadLifecycleEvent(harness.deps, {
        threadId: thread.id,
        event: { type: "run.started" },
      });
      // Going active takes a slot; it does not free one.
      expect(fired).toBe(1);

      // Archiving a running thread stops it, so it frees a slot too — the
      // case a limiter listening only to `thread.idle` used to miss.
      const running = getThread(harness.db, thread.id)!;
      archiveThreadAndHiddenSourceForks(harness.deps, {
        environment: resolveArchiveThreadEnvironment(harness.deps, {
          thread: running,
        }),
        thread: running,
      });
      expect(fired).toBe(2);
    });
  });
});
