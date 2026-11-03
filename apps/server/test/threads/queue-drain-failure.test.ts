import {
  claimQueuedThreadMessageGroup,
  getQueuedThreadMessage,
  listEvents,
  setQueuedThreadMessageFailureReason,
} from "@bb/db";
import type { PluginHookName } from "@get-bb/plugin-sdk";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.js";
import {
  setPluginHookProvider,
  type PluginHookRegistration,
} from "../../src/services/plugins/plugin-hook-registry.js";
import { noteDispatchRequeued } from "../../src/services/threads/dispatch-hooks.js";
import {
  QUEUED_MESSAGE_RETRY_DELAYS_MS,
  recordQueuedMessageDrainFailure,
} from "../../src/services/threads/queue-drain-failure.js";
import { runQueuedMessageDispatch } from "../../src/services/threads/queued-message-dispatch.js";
import { toThreadQueuedMessage } from "../../src/services/threads/thread-queued-messages.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHost,
  seedHostSession,
  seedProjectWithSource,
  seedQueuedMessage,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const WORKSPACE_PATH = "/tmp/queue-drain-failure-project";

type HookRegistry = {
  [K in PluginHookName]: PluginHookRegistration<K>[];
};

function seedQueuedRow(
  harness: TestAppHarness,
  args: { hostConnected: boolean; hostName: string; sendAt?: number },
) {
  const host = args.hostConnected
    ? seedHostSession(harness.deps, { name: args.hostName }).host
    : seedHost(harness.deps, { name: args.hostName });
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
    projectId: project.id,
    environmentId: environment.id,
  });
  const row = seedQueuedMessage(harness.deps, {
    threadId: thread.id,
    content: textInput("Capture the Safari trace"),
    waitingOn: { kind: "thread-busy" },
    ...(args.sendAt === undefined ? {} : { sendAt: args.sendAt }),
  });
  return { host, thread, row };
}

function rereadRow(harness: TestAppHarness, queuedMessageId: string) {
  const row = getQueuedThreadMessage(harness.db, queuedMessageId);
  if (row === null) throw new Error("the queued row vanished");
  return row;
}

function reread(harness: TestAppHarness, queuedMessageId: string) {
  return toThreadQueuedMessage(rereadRow(harness, queuedMessageId));
}

describe("host-connected queue dispatch", () => {
  it("dispatches only the returning machine's rows after its daemon connects", async () => {
    await withTestHarness(async (harness) => {
      const away = seedQueuedRow(harness, {
        hostConnected: false,
        hostName: "M4",
      });
      const otherAway = seedQueuedRow(harness, {
        hostConnected: false,
        hostName: "M2",
      });
      for (const seeded of [away, otherAway]) {
        recordQueuedMessageDrainFailure(harness.deps, {
          error: new ApiError(502, "host_unavailable", "Host is not connected"),
          now: Date.now(),
          row: seeded.row,
          thread: seeded.thread,
        });
      }

      await runQueuedMessageDispatch(harness.deps, {
        hostId: away.host.id,
        kind: "host-connected",
      });
      expect(reread(harness, away.row.id).waitingOn).toEqual({
        kind: "host-offline",
        hostName: "M4",
      });
      seedHostSession(harness.deps, { id: away.host.id, name: "M4" });
      seedThreadRuntimeState(harness.deps, {
        environmentId: away.thread.environmentId,
        providerThreadId: "returning-machine-thread",
        threadId: away.thread.id,
      });
      await runQueuedMessageDispatch(harness.deps, {
        hostId: away.host.id,
        kind: "host-connected",
      });
      expect(getQueuedThreadMessage(harness.db, away.row.id)).toBeNull();
      expect(reread(harness, otherAway.row.id).waitingOn).toEqual({
        kind: "host-offline",
        hostName: "M2",
      });
    });
  });
});

describe("recordQueuedMessageDrainFailure", () => {
  it("hides a failed row from the wakes that are not its booked retry", async () => {
    await withTestHarness(async (harness) => {
      let attempts = 0;
      const registry: HookRegistry = { "message.dispatch": [] };
      registry["message.dispatch"].push({
        pluginId: "rejector",
        handler: () => {
          attempts += 1;
          return { action: "reject", message: "Rejected for testing" } as const;
        },
      });
      setPluginHookProvider({
        listHooks: (hook) => registry[hook],
        invokeHook: async (_pluginId, _label, run) => ({
          ok: true,
          value: await run(),
        }),
        decisionTimeoutMs: 10_000,
      });

      try {
        const { row, thread } = seedQueuedRow(harness, {
          hostConnected: true,
          hostName: "M4",
        });

        await runQueuedMessageDispatch(harness.deps, {
          kind: "thread-ready",
          threadId: thread.id,
        });
        expect(reread(harness, row.id).failureReason).toBe(
          "Rejected for testing",
        );

        await runQueuedMessageDispatch(harness.deps, {
          kind: "thread-ready",
          threadId: thread.id,
        });
        await runQueuedMessageDispatch(harness.deps, {
          kind: "thread-ready",
          threadId: thread.id,
        });

        expect(attempts).toBe(1);
        expect(
          claimQueuedThreadMessageGroup(harness.db, harness.deps.hub, row.id, {
            kind: "explicit-send",
          }),
        ).not.toBeNull();
      } finally {
        setPluginHookProvider(undefined);
      }
    });
  });

  it("records a terminal failure from the turn-started wake", async () => {
    await withTestHarness(async (harness) => {
      const registry: HookRegistry = { "message.dispatch": [] };
      registry["message.dispatch"].push({
        pluginId: "rejector",
        handler: () =>
          ({ action: "reject", message: "Rejected on turn start" }) as const,
      });
      setPluginHookProvider({
        listHooks: (hook) => registry[hook],
        invokeHook: async (_pluginId, _label, run) => ({
          ok: true,
          value: await run(),
        }),
        decisionTimeoutMs: 10_000,
      });

      try {
        const { host } = seedHostSession(harness.deps, { name: "M4" });
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
          providerThreadId: "provider-turn-started",
          threadId: thread.id,
        });
        seedTurnStarted(harness.deps, {
          environmentId: environment.id,
          providerThreadId: "provider-turn-started",
          threadId: thread.id,
          turnId: "turn-started",
        });
        const row = seedQueuedMessage(harness.deps, {
          content: textInput("Wait for the turn"),
          threadId: thread.id,
          waitingOn: { kind: "turn-starting" },
        });
        noteDispatchRequeued(thread.id);

        await runQueuedMessageDispatch(harness.deps, {
          kind: "turn-started",
          threadId: thread.id,
        });

        expect(reread(harness, row.id).failureReason).toBe(
          "Rejected on turn start",
        );
      } finally {
        setPluginHookProvider(undefined);
      }
    });
  });

  it("re-queues on the named host when the machine is the thing that is missing", async () => {
    await withTestHarness(async (harness) => {
      const { thread, row } = seedQueuedRow(harness, {
        hostConnected: false,
        hostName: "M4",
        sendAt: Date.now() - 1_000,
      });

      recordQueuedMessageDrainFailure(harness.deps, {
        error: new ApiError(502, "host_unavailable", "Host is not connected"),
        now: Date.now(),
        row,
        thread,
      });

      const queued = reread(harness, row.id);
      expect(queued.waitingOn).toEqual({
        kind: "host-offline",
        hostName: "M4",
      });
      expect(queued.sendAt).toBeNull();
      expect(queued.failureReason).toBeNull();
      expect(listEvents(harness.db, { threadId: thread.id })).toEqual([]);
    });
  });

  it("records the reason and keeps the wait when the host is present", async () => {
    await withTestHarness(async (harness) => {
      const { thread, row } = seedQueuedRow(harness, {
        hostConnected: true,
        hostName: "M4",
      });

      recordQueuedMessageDrainFailure(harness.deps, {
        error: new ApiError(409, "thread_not_writable", "Thread is archived"),
        now: Date.now(),
        row,
        thread,
      });

      const queued = reread(harness, row.id);
      expect(queued.failureReason).toBe("Thread is archived");
      expect(queued.waitingOn).toEqual({ kind: "thread-busy" });
      expect(listEvents(harness.db, { threadId: thread.id })).toEqual([]);
    });
  });

  it("does not leak an internal fault's wording onto the row", async () => {
    await withTestHarness(async (harness) => {
      const { thread, row } = seedQueuedRow(harness, {
        hostConnected: true,
        hostName: "M4",
      });

      recordQueuedMessageDrainFailure(harness.deps, {
        error: new Error("Cannot read properties of undefined (reading 'id')"),
        now: Date.now(),
        row,
        thread,
      });

      expect(reread(harness, row.id).failureReason).toBe(
        "The message could not be sent.",
      );
    });
  });
});

describe("a failed row's booked retry", () => {
  const [FIRST_DELAY_MS, SECOND_DELAY_MS] = QUEUED_MESSAGE_RETRY_DELAYS_MS;

  function installRejector(): { attempts: () => number; dispose(): void } {
    let attempts = 0;
    const registry: HookRegistry = { "message.dispatch": [] };
    registry["message.dispatch"].push({
      pluginId: "rejector",
      handler: () => {
        attempts += 1;
        return { action: "reject", message: "Rejected for testing" } as const;
      },
    });
    setPluginHookProvider({
      listHooks: (hook) => registry[hook],
      invokeHook: async (_pluginId, _label, run) => ({
        ok: true,
        value: await run(),
      }),
      decisionTimeoutMs: 10_000,
    });
    return {
      attempts: () => attempts,
      dispose: () => setPluginHookProvider(undefined),
    };
  }

  it("books the next attempt rather than giving up on the first failure", async () => {
    await withTestHarness(async (harness) => {
      const { thread, row } = seedQueuedRow(harness, {
        hostConnected: true,
        hostName: "M4",
      });
      const now = Date.now();

      recordQueuedMessageDrainFailure(harness.deps, {
        error: new ApiError(409, "thread_not_writable", "Thread is archived"),
        now,
        row,
        thread,
      });

      const failed = rereadRow(harness, row.id);
      expect(failed.failureReason).toBe("Thread is archived");
      expect(failed.failureCount).toBe(1);
      expect(failed.nextAttemptAt).toBe(now + FIRST_DELAY_MS!);
    });
  });

  it("waits for the booked instant before trying again", async () => {
    await withTestHarness(async (harness) => {
      const rejector = installRejector();
      try {
        const { thread, row } = seedQueuedRow(harness, {
          hostConnected: true,
          hostName: "M4",
        });

        await runQueuedMessageDispatch(harness.deps, {
          kind: "thread-ready",
          threadId: thread.id,
        });
        expect(rejector.attempts()).toBe(1);
        const booked = rereadRow(harness, row.id).nextAttemptAt!;

        await runQueuedMessageDispatch(harness.deps, {
          kind: "failed-retry",
          now: booked - 1,
        });
        expect(rejector.attempts()).toBe(1);

        await runQueuedMessageDispatch(harness.deps, {
          kind: "failed-retry",
          now: booked,
        });
        expect(rejector.attempts()).toBe(2);

        const retried = rereadRow(harness, row.id);
        expect(retried.failureCount).toBe(2);
        expect(retried.nextAttemptAt).toBe(booked + SECOND_DELAY_MS!);
      } finally {
        rejector.dispose();
      }
    });
  });

  it("sends a row whose wait went stale while it sat failed", async () => {
    await withTestHarness(async (harness) => {
      const { host, thread, row } = seedQueuedRow(harness, {
        hostConnected: false,
        hostName: "M4",
      });
      const now = Date.now();

      recordQueuedMessageDrainFailure(harness.deps, {
        error: new ApiError(502, "host_unavailable", "Host is not connected"),
        now,
        row,
        thread,
      });
      expect(reread(harness, row.id).waitingOn).toEqual({
        kind: "host-offline",
        hostName: "M4",
      });

      seedHostSession(harness.deps, { id: host.id, name: "M4" });
      seedThreadRuntimeState(harness.deps, {
        environmentId: thread.environmentId,
        providerThreadId: "returning-machine-thread",
        threadId: thread.id,
      });
      recordQueuedMessageDrainFailure(harness.deps, {
        error: new ApiError(
          409,
          "provider_bridge_unavailable",
          'Provider "claude-code" has no bridge to run on.',
        ),
        now,
        row,
        thread,
      });
      const stale = rereadRow(harness, row.id);
      expect(stale.waitingOn).toContain("host-offline");
      expect(stale.nextAttemptAt).toBe(now + FIRST_DELAY_MS!);

      await runQueuedMessageDispatch(harness.deps, {
        kind: "failed-retry",
        now: stale.nextAttemptAt!,
      });

      expect(getQueuedThreadMessage(harness.db, row.id)).toBeNull();
    });
  });

  it("stops once the row's attempts are spent", async () => {
    await withTestHarness(async (harness) => {
      const rejector = installRejector();
      try {
        const { thread, row } = seedQueuedRow(harness, {
          hostConnected: true,
          hostName: "M4",
        });

        await runQueuedMessageDispatch(harness.deps, {
          kind: "thread-ready",
          threadId: thread.id,
        });
        for (const _delay of QUEUED_MESSAGE_RETRY_DELAYS_MS) {
          const booked = rereadRow(harness, row.id).nextAttemptAt;
          if (booked === null) break;
          await runQueuedMessageDispatch(harness.deps, {
            kind: "failed-retry",
            now: booked,
          });
        }

        const spent = rereadRow(harness, row.id);
        expect(spent.failureCount).toBe(4);
        expect(spent.nextAttemptAt).toBeNull();
        expect(rejector.attempts()).toBe(4);

        await runQueuedMessageDispatch(harness.deps, {
          kind: "failed-retry",
          now: Date.now() + 86_400_000,
        });
        expect(rejector.attempts()).toBe(4);
      } finally {
        rejector.dispose();
      }
    });
  });

  it("gives the attempts back when the row queues again", async () => {
    await withTestHarness(async (harness) => {
      const { thread, row } = seedQueuedRow(harness, {
        hostConnected: false,
        hostName: "M4",
      });

      setQueuedThreadMessageFailureReason(harness.db, harness.deps.hub, {
        id: row.id,
        threadId: row.threadId,
        failureReason: "Thread is archived",
        now: Date.now(),
        retryDelaysMs: QUEUED_MESSAGE_RETRY_DELAYS_MS,
      });
      expect(rereadRow(harness, row.id).failureCount).toBe(1);

      recordQueuedMessageDrainFailure(harness.deps, {
        error: new ApiError(502, "host_unavailable", "Host is not connected"),
        now: Date.now(),
        row,
        thread,
      });

      const requeued = rereadRow(harness, row.id);
      expect(requeued.failureReason).toBeNull();
      expect(requeued.failureCount).toBe(0);
      expect(requeued.nextAttemptAt).toBeNull();
    });
  });
});
