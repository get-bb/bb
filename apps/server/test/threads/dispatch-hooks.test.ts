import {
  createQueuedThreadMessage,
  getThread,
  listEvents,
  listQueuedThreadMessages,
  listQueuedThreadMessagesForApi,
  listRunningThreads,
  setQueuedThreadMessageGroupBoundary,
} from "@bb/db";
import type { ThreadQueuedMessage } from "@bb/domain";
import { createDeferredPromise } from "@bb/test-helpers";
import type { StartedOnBehalfOf } from "@bb/domain";
import type {
  MessageDispatchHookContext,
  PluginHookName,
} from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.js";
import {
  invokePluginInline,
  setPluginHookProvider,
  type PluginHookRegistration,
} from "../../src/services/plugins/plugin-hook-registry.js";
import {
  createAutomaticQueuedMessageGroupEligibility,
  createQueuedMessageForThread,
  sendNextQueuedMessageIfPresent,
  sendQueuedMessage,
} from "../../src/services/threads/queued-messages.js";
import { acceptThreadSendRequest } from "../../src/services/threads/thread-send-request.js";
import { attemptDispatch } from "../../src/services/threads/dispatch-attempt.js";
import { runQueuedMessageDispatch } from "../../src/services/threads/queued-message-dispatch.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { applyLoggedThreadLifecycleEvent } from "../../src/services/threads/lifecycle-outcome.js";
import { createClientTurnRequestId } from "../../src/services/threads/thread-events.js";
import { toThreadQueuedMessage } from "../../src/services/threads/thread-queued-messages.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  listQueuedThreadCommands,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const WORKSPACE_PATH = "/tmp/dispatch-hooks-project";

type HookRegistry = {
  [K in PluginHookName]: PluginHookRegistration<K>[];
};

function emptyRegistry(): HookRegistry {
  return { "message.dispatch": [] };
}

function installHooks(
  registry: HookRegistry,
  options: { decisionTimeoutMs?: number } = {},
): void {
  setPluginHookProvider({
    listHooks: (hook) => registry[hook],
    invokeHook: (_pluginId, _label, run) => invokePluginInline(run),
    decisionTimeoutMs: options.decisionTimeoutMs ?? 10_000,
  });
}

afterEach(() => {
  setPluginHookProvider(undefined);
});

function seedDispatchFixture(harness: TestAppHarness, hostId: string) {
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
  return { environment, host, project };
}

function createHookedThread(
  harness: TestAppHarness,
  args: {
    hostId: string;
    projectId: string;
    origin?: "app" | "cli" | "sdk";
    model?: string;
  },
) {
  return createThreadFromRequest(harness.deps, {
    environment: {
      type: "host",
      hostId: args.hostId,
      workspace: { type: "unmanaged", path: WORKSPACE_PATH },
    },
    input: textInput("Do the thing"),
    origin: args.origin ?? "app",
    projectId: args.projectId,
    providerId: "codex",
    ...(args.model !== undefined ? { model: args.model } : {}),
    startedOnBehalfOf: null,
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

function seedRunnableThread(
  harness: TestAppHarness,
  args: { hostId: string; status: "idle" | "active" },
) {
  const { environment, project } = seedDispatchFixture(harness, args.hostId);
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

async function expectApiError(run: () => Promise<unknown>): Promise<ApiError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected the operation to fail");
}

describe("message.dispatch hook context", () => {
  it("passes plugin submission data through a new thread's first dispatch", async () => {
    await withTestHarness(async (harness) => {
      const seen: unknown[] = [];
      installHooks({
        "message.dispatch": [
          {
            pluginId: "drafts",
            handler: (context) => {
              seen.push(context.experimental_submission);
              return { action: "proceed" };
            },
          },
        ],
      });
      const { host, project } = seedDispatchFixture(
        harness,
        "host-new-thread-submission",
      );
      const pluginSubmission = {
        pluginId: "drafts",
        data: { kind: "draft" },
      };

      await createThreadFromRequest(harness.deps, {
        environment: {
          type: "host",
          hostId: host.id,
          workspace: { type: "unmanaged", path: WORKSPACE_PATH },
        },
        input: textInput("new thread draft"),
        origin: "app",
        pluginSubmission,
        projectId: project.id,
        providerId: "codex",
        startedOnBehalfOf: null,
      });

      expect(seen).toEqual([pluginSubmission]);
    });
  });

  it("applies plugin policy before a future schedule", async () => {
    await withTestHarness(async (harness) => {
      installHooks({
        "message.dispatch": [
          {
            pluginId: "drafts",
            handler: () => ({ action: "wait", reason: "Draft" }),
          },
        ],
      });
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-plugin-before-time",
        status: "idle",
      });

      const sendAt = Date.now() + 60_000;
      const response = await acceptThreadSendRequest(harness.deps, {
        payload: {
          input: textInput("scheduled draft"),
          mode: "auto",
          sendAt,
        },
        thread,
      });

      expect(response.delivery).toBe("queued");
      expect(onlyQueuedRow(harness, thread.id).waitingOn).toEqual({
        kind: "plugin",
        pluginId: "drafts",
        reason: "Draft",
      });
      expect(onlyQueuedRow(harness, thread.id).sendAt).toBeNull();
    });
  });

  it("hands the hook the start intent's host before an environment exists", async () => {
    await withTestHarness(async (harness) => {
      const { host, project } = seedDispatchFixture(harness, "host-intent");
      const seen: { environment: unknown; hostId: string | null }[] = [];
      installHooks({
        "message.dispatch": [
          {
            pluginId: "limits",
            handler: (context) => {
              seen.push({
                environment: context.environment,
                hostId: context.host?.id ?? null,
              });
              return { action: "wait", reason: "Inspecting" };
            },
          },
        ],
      });

      const thread = await createThreadFromRequest(harness.deps, {
        environment: {
          type: "host",
          hostId: host.id,
          workspace: { type: "unmanaged", path: "/tmp/dispatch-hooks-cold" },
        },
        input: textInput("Do the thing"),
        origin: "app",
        projectId: project.id,
        providerId: "codex",
        startedOnBehalfOf: null,
      });

      expect(seen).toEqual([{ environment: null, hostId: host.id }]);
      expect(queuedRows(harness, thread.id)).toHaveLength(1);
    });
  });
});

describe("pending admission races", () => {
  it("re-decides a first message that lost the admission instead of calling it sent", async () => {
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      registry["message.dispatch"].push({
        pluginId: "limiter",
        handler: () => ({ action: "wait", reason: "at capacity" }) as const,
      });
      installHooks(registry);
      const { host, project } = seedDispatchFixture(harness, "host-race");
      const created = await createHookedThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });
      setPluginHookProvider(undefined);
      const stale = getThread(harness.db, created.id);
      if (!stale) throw new Error("expected the pending thread");
      expect(stale.status).toBe("pending");
      const attempt = (text: string) =>
        attemptDispatch(harness.deps, {
          systemNotice: null,
          thread: stale,
          payload: { input: textInput(text), mode: "start" },
          source: { kind: "inline" },
          queuePayload: { kind: "inline" },
          pluginSubmission: null,
          origin: null,
          originPluginId: null,
          startedOnBehalfOf: null,
          trigger: "user",
        });

      expect((await attempt("Winner")).kind).toBe("dispatched");
      const loser = await attempt("Loser");

      expect(loser.kind).toBe("queued");
      if (loser.kind !== "queued") throw new Error("expected a queued outcome");
      expect(loser.entry.waitingOn).toEqual({ kind: "provisioning" });
      expect(
        loser.entry.content.flatMap((block) =>
          block.type === "text" ? [block.text] : [],
        ),
      ).toEqual(["Loser"]);
    });
  });
});

describe("thread status races under a send", () => {
  it("queues a send whose thread changes twice under it, then drains it", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedRunnableThread(harness, {
        hostId: "host-status-flap",
        status: "idle",
      });
      let passes = 0;
      const registry = emptyRegistry();
      registry["message.dispatch"].push({
        pluginId: "limiter",
        handler: () => {
          passes += 1;
          if (passes === 1) {
            applyLoggedThreadLifecycleEvent(harness.deps, {
              event: { type: "run.started" },
              threadId: thread.id,
            });
            seedTurnStarted(harness.deps, {
              environmentId: environment.id,
              providerThreadId: "provider-host-status-flap",
              threadId: thread.id,
              turnId: "turn-host-status-flap",
            });
          }
          if (passes === 2) {
            applyLoggedThreadLifecycleEvent(harness.deps, {
              event: { type: "run.succeeded" },
              threadId: thread.id,
            });
          }
          return { action: "proceed" } as const;
        },
      });
      installHooks(registry);

      const response = await acceptThreadSendRequest(harness.deps, {
        payload: { input: textInput("keep me"), mode: "auto" },
        thread,
      });

      expect(passes).toBe(2);
      expect(response.delivery).toBe("queued");
      if (response.delivery !== "queued") throw new Error("expected queued");
      expect(response.queuedMessage.waitingOn).toEqual({
        kind: "thread-busy",
      });
      const submit = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "turn.submit" && command.threadId === thread.id,
      );
      expect(submit.command).toMatchObject({
        input: textInput("keep me"),
      });
      expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
    });
  });
});

describe("message.dispatch hook composition", () => {
  it("runs every handler in install order and freezes the resolved tuple", async () => {
    await withTestHarness(async (harness) => {
      const seen: string[] = [];
      let secondSawModel: string | null = null;
      const registry = emptyRegistry();
      registry["message.dispatch"].push(
        {
          pluginId: "first",
          handler: () => {
            seen.push("first");
            return { action: "proceed" } as const;
          },
        },
        {
          pluginId: "second",
          handler: (context) => {
            seen.push("second");
            secondSawModel = context.requestedExecution.model;
            return { action: "wait", reason: "checking" } as const;
          },
        },
      );
      installHooks(registry);
      const { host, project } = seedDispatchFixture(harness, "host-hook-order");

      const thread = await createHookedThread(harness, {
        hostId: host.id,
        projectId: project.id,
        model: "requested-model",
      });

      expect(seen).toEqual(["first", "second"]);
      expect(secondSawModel).toBe("requested-model");
      expect(onlyQueuedRow(harness, thread.id).model).toBe("requested-model");
    });
  });

  it("names every waiter on the reason when a pass collects several", async () => {
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      registry["message.dispatch"].push(
        {
          pluginId: "limiter",
          handler: () => ({ action: "wait", reason: "at capacity" }) as const,
        },
        {
          pluginId: "quiet-hours",
          handler: () => ({ action: "wait", reason: "after hours" }) as const,
        },
      );
      installHooks(registry);
      const { host, project } = seedDispatchFixture(harness, "host-hook-multi");

      const thread = await createHookedThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });

      expect(onlyQueuedRow(harness, thread.id).waitingOn).toEqual({
        kind: "plugin",
        pluginId: "limiter",
        reason: "at capacity (also waiting on quiet-hours: after hours)",
      });
    });
  });

  it("short-circuits the pass on reject with a 409 naming the plugin", async () => {
    await withTestHarness(async (harness) => {
      let laterHandlerRan = false;
      const registry = emptyRegistry();
      registry["message.dispatch"].push(
        {
          pluginId: "dlp",
          handler: () =>
            ({ action: "reject", message: "Contains a secret" }) as const,
        },
        {
          pluginId: "never",
          handler: () => {
            laterHandlerRan = true;
            return { action: "proceed" } as const;
          },
        },
      );
      installHooks(registry);
      const { host, project } = seedDispatchFixture(
        harness,
        "host-hook-reject",
      );

      const error = await expectApiError(() =>
        createHookedThread(harness, { hostId: host.id, projectId: project.id }),
      );

      expect(error.status).toBe(409);
      expect(error.body.code).toBe("dispatch_rejected");
      expect(error.body.message).toBe("Contains a secret");
      expect(error.body.details).toEqual({ pluginId: "dlp" });
      expect(laterHandlerRan).toBe(false);
      expect(listQueuedThreadMessagesForApi(harness.db, {})).toEqual([]);
    });
  });

  it("runs one pass at a time so a counting handler never sees itself interleaved", async () => {
    await withTestHarness(async (harness) => {
      let inFlight = 0;
      let maxInFlight = 0;
      const registry = emptyRegistry();
      registry["message.dispatch"].push({
        pluginId: "limiter",
        handler: async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inFlight -= 1;
          return { action: "wait", reason: "counting" } as const;
        },
      });
      installHooks(registry);
      const { host, project } = seedDispatchFixture(harness, "host-hook-lock");

      await Promise.all([
        createHookedThread(harness, { hostId: host.id, projectId: project.id }),
        createHookedThread(harness, { hostId: host.id, projectId: project.id }),
      ]);

      expect(maxInFlight).toBe(1);
    });
  });
});

describe("message.dispatch hook admission visibility", () => {
  it("commits a cleared first dispatch before the lock releases, so the next pass sees it", async () => {
    await withTestHarness(async (harness) => {
      const seen: string[][] = [];
      const registry = emptyRegistry();
      registry["message.dispatch"].push({
        pluginId: "limiter",
        handler: async () => {
          const running = listRunningThreads(harness.db);
          seen.push(running.map((row) => row.id));
          return running.length >= 1
            ? ({
                action: "wait",
                reason: "1 of 1 running on all hosts",
              } as const)
            : ({ action: "proceed" } as const);
        },
      });
      installHooks(registry);
      const { host, project } = seedDispatchFixture(harness, "host-admission");

      const created = await Promise.all([
        createHookedThread(harness, { hostId: host.id, projectId: project.id }),
        createHookedThread(harness, { hostId: host.id, projectId: project.id }),
      ]);

      expect(seen).toHaveLength(2);
      expect(seen[0]).toEqual([]);
      expect(seen[1]).toHaveLength(1);

      const admittedId = seen[1]![0]!;
      const queued = created.find((thread) => thread.id !== admittedId)!;
      expect(created.map((thread) => thread.id)).toContain(admittedId);
      expect(getThread(harness.db, admittedId)?.status).not.toBe("pending");
      expect(getThread(harness.db, queued.id)?.status).toBe("pending");
      expect(onlyQueuedRow(harness, queued.id).waitingOn).toEqual({
        kind: "plugin",
        pluginId: "limiter",
        reason: "1 of 1 running on all hosts",
      });
    });
  });

  it("shows a warm follow-up's admission only after its send lands, not inside the pass", async () => {
    await withTestHarness(async (harness) => {
      const seen: string[][] = [];
      const registry = emptyRegistry();
      registry["message.dispatch"].push({
        pluginId: "limiter",
        handler: () => {
          seen.push(listRunningThreads(harness.db).map((row) => row.id));
          return { action: "proceed" } as const;
        },
      });
      installHooks(registry);
      const { environment, thread } = seedRunnableThread(harness, {
        hostId: "host-warm-admission",
        status: "idle",
      });

      await acceptThreadSendRequest(harness.deps, {
        payload: { input: textInput("first follow-up"), mode: "auto" },
        thread,
      });
      expect(seen).toEqual([[]]);
      expect(listRunningThreads(harness.db).map((row) => row.id)).toEqual([
        thread.id,
      ]);
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-host-warm-admission",
        threadId: thread.id,
        turnId: "turn-host-warm-admission",
      });

      await acceptThreadSendRequest(harness.deps, {
        payload: { input: textInput("a steer"), mode: "steer" },
        thread: getThread(harness.db, thread.id)!,
      });
      expect(seen[1]).toEqual([thread.id]);
    });
  });
});

describe("dispatch hooks and the no-hook path", () => {
  it("leaves creation unchanged when no plugin answers the hook", async () => {
    await withTestHarness(async (harness) => {
      installHooks(emptyRegistry());
      const { host, project } = seedDispatchFixture(harness, "host-hook-none");

      const thread = await createHookedThread(harness, {
        hostId: host.id,
        projectId: project.id,
      });

      expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
      const types = listEvents(harness.db, { threadId: thread.id }).map(
        (event) => event.type,
      );
      expect(types).toContain("client/turn/requested");
    });
  });

  it("hooks a steer into a live turn like any other dispatch", async () => {
    await withTestHarness(async (harness) => {
      const attempts: string[] = [];
      const registry = emptyRegistry();
      registry["message.dispatch"].push({
        pluginId: "limiter",
        handler: (context) => {
          attempts.push(context.attempt);
          return {
            action: "reject",
            message: "no steering right now",
          } as const;
        },
      });
      installHooks(registry);
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-hook-steer",
        status: "active",
      });

      const error = await expectApiError(() =>
        acceptThreadSendRequest(harness.deps, {
          payload: { input: textInput("actually, stop"), mode: "steer" },
          thread,
        }),
      );

      expect(error.status).toBe(409);
      expect(error.body.code).toBe("dispatch_rejected");
      expect(attempts).toEqual(["join-turn"]);
    });
  });
});

describe("message.dispatch hook message author", () => {
  function recordAuthors(queuedMessages: ThreadQueuedMessage[][] = []) {
    const seen: { initiator: string; senderThreadId: string | null }[] = [];
    const registry = emptyRegistry();
    registry["message.dispatch"].push({
      pluginId: "limiter",
      handler: (context) => {
        queuedMessages.push(context.queuedMessages);
        seen.push({
          initiator: context.initiator,
          senderThreadId: context.senderThreadId,
        });
        return { action: "wait", reason: "held" } as const;
      },
    });
    installHooks(registry);
    return seen;
  }

  it("reads a message a user typed as user with no sender", async () => {
    await withTestHarness(async (harness) => {
      const seen = recordAuthors();
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-author-user",
        status: "idle",
      });

      await acceptThreadSendRequest(harness.deps, {
        payload: { input: textInput("typed by hand"), mode: "auto" },
        thread,
      });

      expect(seen).toEqual([{ initiator: "user", senderThreadId: null }]);
    });
  });

  it("reads a retry of a failed turn as system", async () => {
    await withTestHarness(async (harness) => {
      const queuedMessages: ThreadQueuedMessage[][] = [];
      const seen = recordAuthors(queuedMessages);
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-author-retry",
        status: "idle",
      });
      const originalRequestId = createClientTurnRequestId();

      await attemptDispatch(harness.deps, {
        systemNotice: null,
        thread,
        payload: { input: textInput("retried work"), mode: "auto" },
        source: { kind: "inline" },
        queuePayload: {
          kind: "retry",
          retryOfTurnRequestId: originalRequestId,
          attempt: 2,
          reason: "Rate limited",
        },
        pluginSubmission: null,
        retryOf: { requestId: originalRequestId, attempt: 2 },
        origin: null,
        originPluginId: null,
        startedOnBehalfOf: null,
        trigger: "user",
      });

      const queued = onlyQueuedRow(harness, thread.id);
      expect(queued).toMatchObject({
        initiator: "system",
        senderThreadId: null,
      });
      await runQueuedMessageDispatch(harness.deps, { kind: "plugin-recheck" });
      expect(seen).toEqual([
        { initiator: "system", senderThreadId: null },
        { initiator: "system", senderThreadId: null },
      ]);
      expect(queuedMessages).toEqual([
        [],
        [
          expect.objectContaining({
            id: queued.id,
            initiator: "system",
            senderThreadId: null,
          }),
        ],
      ]);
    });
  });

  it("reports the same author on a drained re-attempt as on the first", async () => {
    await withTestHarness(async (harness) => {
      const seen = recordAuthors();
      const { environment, project, thread } = seedRunnableThread(harness, {
        hostId: "host-author-drain",
        status: "idle",
      });
      const sender = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "active",
      });

      await acceptThreadSendRequest(harness.deps, {
        payload: {
          input: textInput("sent by an agent"),
          mode: "auto",
          senderThreadId: sender.id,
        },
        thread,
      });
      onlyQueuedRow(harness, thread.id);

      await runQueuedMessageDispatch(harness.deps, { kind: "plugin-recheck" });

      expect(seen).toEqual([
        { initiator: "agent", senderThreadId: sender.id },
        { initiator: "agent", senderThreadId: sender.id },
      ]);
    });
  });

  it.each(["agent", "system"] as const)(
    "preserves a %s requester in the queued thread-start and hook",
    async (initiator) => {
      await withTestHarness(async (harness) => {
        const queuedMessages: ThreadQueuedMessage[][] = [];
        const seen = recordAuthors(queuedMessages);
        const { environment, project } = seedDispatchFixture(
          harness,
          "host-author-spawn",
        );
        const source = seedThread(harness.deps, {
          environmentId: environment.id,
          projectId: project.id,
        });
        seedThreadRuntimeState(harness.deps, {
          environmentId: environment.id,
          providerThreadId: "provider-author-spawn-source",
          threadId: source.id,
        });
        seedTurnStarted(harness.deps, {
          environmentId: environment.id,
          threadId: source.id,
          turnId: "turn-author-spawn-source",
          providerThreadId: "provider-author-spawn-source",
        });

        const spawned = await createThreadFromRequest(harness.deps, {
          environment: {
            type: "host",
            hostId: "host-author-spawn",
            workspace: { type: "unmanaged", path: WORKSPACE_PATH },
          },
          input: textInput("spawned work"),
          origin: "sdk",
          originKind: "fork",
          projectId: project.id,
          providerId: "codex",
          sourceThreadId: source.id,
          startedOnBehalfOf: { initiator, senderThreadId: source.id },
        });
        const queued = onlyQueuedRow(harness, spawned.id);
        expect(queued).toMatchObject({ initiator, senderThreadId: source.id });

        await runQueuedMessageDispatch(harness.deps, {
          kind: "plugin-recheck",
        });

        expect(queuedMessages).toEqual([
          [],
          [
            expect.objectContaining({
              id: queued.id,
              initiator,
              senderThreadId: source.id,
            }),
          ],
        ]);
        expect(seen).toEqual([
          { initiator, senderThreadId: source.id },
          { initiator, senderThreadId: source.id },
        ]);
      });
    },
  );

  it("reports the same origin on a drained re-attempt as on the first", async () => {
    await withTestHarness(async (harness) => {
      const seen: { origin: string | null; originPluginId: string | null }[] =
        [];
      const registry = emptyRegistry();
      registry["message.dispatch"].push({
        pluginId: "limiter",
        handler: (context) => {
          seen.push({
            origin: context.origin,
            originPluginId: context.originPluginId,
          });
          return { action: "wait", reason: "held" } as const;
        },
      });
      installHooks(registry);
      const { host, project } = seedDispatchFixture(
        harness,
        "host-origin-drain",
      );

      const thread = await createThreadFromRequest(harness.deps, {
        environment: {
          type: "host",
          hostId: host.id,
          workspace: { type: "unmanaged", path: WORKSPACE_PATH },
        },
        input: textInput("queued by a plugin"),
        origin: "plugin",
        originPluginId: "drafts",
        projectId: project.id,
        providerId: "codex",
        startedOnBehalfOf: null,
      });
      onlyQueuedRow(harness, thread.id);

      await runQueuedMessageDispatch(harness.deps, { kind: "plugin-recheck" });

      expect(seen).toEqual([
        { origin: "plugin", originPluginId: "drafts" },
        { origin: "plugin", originPluginId: "drafts" },
      ]);
    });
  });

  it("leaves a drained follow-up send with no origin", async () => {
    await withTestHarness(async (harness) => {
      const seen: (string | null)[] = [];
      const registry = emptyRegistry();
      registry["message.dispatch"].push({
        pluginId: "limiter",
        handler: (context) => {
          seen.push(context.origin);
          return { action: "wait", reason: "held" } as const;
        },
      });
      installHooks(registry);
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-origin-send",
        status: "idle",
      });

      await acceptThreadSendRequest(harness.deps, {
        payload: { input: textInput("a follow-up"), mode: "auto" },
        thread,
      });
      onlyQueuedRow(harness, thread.id);

      await runQueuedMessageDispatch(harness.deps, { kind: "plugin-recheck" });

      expect(seen).toEqual([null, null]);
    });
  });

  it("still emits startedOnBehalfOf for a handler built against an older SDK", async () => {
    await withTestHarness(async (harness) => {
      const seen: (StartedOnBehalfOf | null)[] = [];
      const registry = emptyRegistry();
      registry["message.dispatch"].push({
        pluginId: "legacy",
        handler: (context) => {
          const olderContext = context as MessageDispatchHookContext & {
            startedOnBehalfOf: StartedOnBehalfOf | null;
          };
          seen.push(olderContext.startedOnBehalfOf);
          return { action: "wait", reason: "held" } as const;
        },
      });
      installHooks(registry);
      const { environment, project, thread } = seedRunnableThread(harness, {
        hostId: "host-legacy-behalf",
        status: "idle",
      });
      const sender = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        status: "active",
      });

      await attemptDispatch(harness.deps, {
        systemNotice: null,
        thread,
        payload: { input: textInput("spawned work"), mode: "auto" },
        source: { kind: "inline" },
        queuePayload: { kind: "inline" },
        pluginSubmission: null,
        origin: "sdk",
        originPluginId: null,
        startedOnBehalfOf: { initiator: "agent", senderThreadId: sender.id },
        trigger: "user",
      });

      expect(seen).toEqual([{ initiator: "agent", senderThreadId: sender.id }]);
    });
  });
});

describe("message.dispatch grouped authors", () => {
  it.each([
    {
      name: "human messages",
      authors: ["user", "user"],
      sharedSender: false,
      initiator: "user",
      sender: "none",
      origins: [null, null],
      pluginIds: [null, null],
      origin: null,
      originPluginId: null,
    },
    {
      name: "one agent",
      authors: ["agent", "agent"],
      sharedSender: true,
      initiator: "agent",
      sender: "shared",
      origins: ["plugin", "plugin"],
      pluginIds: ["drafts", "drafts"],
      origin: "plugin",
      originPluginId: "drafts",
    },
    {
      name: "different agents",
      authors: ["agent", "agent"],
      sharedSender: false,
      initiator: "agent",
      sender: "mixed",
      origins: ["plugin", "plugin"],
      pluginIds: ["drafts", "automations"],
      origin: "plugin",
      originPluginId: "mixed",
    },
    {
      name: "agent then human",
      authors: ["agent", "user"],
      sharedSender: false,
      initiator: "mixed",
      sender: "mixed",
      origins: ["plugin", null],
      pluginIds: ["drafts", null],
      origin: "mixed",
      originPluginId: "mixed",
    },
    {
      name: "human then agent",
      authors: ["user", "agent"],
      sharedSender: false,
      initiator: "mixed",
      sender: "mixed",
      origins: ["app", "cli"],
      pluginIds: [null, null],
      origin: "mixed",
      originPluginId: null,
    },
    {
      name: "agent and system requesters",
      authors: ["agent", "system"],
      sharedSender: true,
      initiator: "mixed",
      sender: "shared",
      origins: [null, "plugin"],
      pluginIds: [null, "drafts"],
      origin: "mixed",
      originPluginId: "mixed",
    },
  ] as const)(
    "summarizes $name with origins $origins and plugins $pluginIds without splitting the group",
    async ({
      authors,
      sharedSender,
      initiator,
      sender,
      origins,
      pluginIds,
      origin,
      originPluginId,
    }) => {
      await withTestHarness(async (harness) => {
        const { environment, project, thread } = seedRunnableThread(harness, {
          hostId: "host-grouped-authors",
          status: "idle",
        });
        const senders = [0, 1].map(() =>
          seedThread(harness.deps, {
            environmentId: environment.id,
            projectId: project.id,
          }),
        );
        const senderThreadId =
          sender === "shared"
            ? senders[0]!.id
            : sender === "mixed"
              ? "mixed"
              : null;
        const seen: MessageDispatchHookContext[] = [];
        let proceed = false;
        const registry = emptyRegistry();
        registry["message.dispatch"].push({
          pluginId: "limiter",
          handler: (context) => {
            seen.push(context);
            return proceed
              ? ({ action: "proceed" } as const)
              : ({ action: "wait", reason: "held" } as const);
          },
        });
        installHooks(registry);
        const rows = authors.map((author, index) =>
          createQueuedThreadMessage(harness.db, harness.deps.hub, {
            threadId: thread.id,
            content: textInput(`message ${index + 1}`),
            senderThreadId: null,
            origin: origins[index]!,
            originPluginId: pluginIds[index]!,
            requestedBy:
              author === "user"
                ? null
                : {
                    initiator: author,
                    senderThreadId: senders[sharedSender ? 0 : index]!.id,
                  },
            model: "requested-model",
            reasoningLevel: "medium",
            permissionMode: "auto",
            serviceTier: "default",
            payload: { kind: "inline" },
            waitingOn: { kind: "thread-busy" },
            sendAt: null,
            systemNotice: null,
          }),
        );
        const ids = rows.map((row) => row.id);
        expect(
          setQueuedThreadMessageGroupBoundary({
            db: harness.db,
            notifier: harness.deps.hub,
            threadId: thread.id,
            expectedGroupedPrefixQueuedMessageIds: ids,
            groupBoundaryQueuedMessageId: rows[1]!.id,
          }).kind,
        ).toBe("updated");

        const turnsBefore = turnRequests(harness, thread.id).length;
        expect(
          await sendNextQueuedMessageIfPresent(harness.deps, {
            threadId: thread.id,
          }),
        ).toBe(true);
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({
          initiator,
          senderThreadId,
          origin,
          originPluginId,
          queuedMessages: rows.map((row, index) => ({
            id: row.id,
            origin: origins[index],
            originPluginId: pluginIds[index],
            content: textInput(`message ${index + 1}`),
            initiator: authors[index],
            senderThreadId:
              authors[index] === "user"
                ? null
                : senders[sharedSender ? 0 : index]!.id,
          })),
        });
        expect(seen[0]?.input.text).toContain("message 1");
        expect(seen[0]?.input.text).toContain("message 2");
        expect(Reflect.get(seen[0]!, "queuedMessage")).toEqual(
          seen[0]?.queuedMessages[0],
        );
        expect(
          listQueuedThreadMessages(harness.db, thread.id).map((row) => row.id),
        ).toEqual(ids);
        expect(turnRequests(harness, thread.id)).toHaveLength(turnsBefore);

        proceed = true;
        await sendQueuedMessage(harness.deps, {
          threadId: thread.id,
          queuedMessageId: rows[0]!.id,
          mode: "auto",
          claimPolicy: {
            kind: "automatic",
            isGroupEligible: createAutomaticQueuedMessageGroupEligibility(
              harness.deps,
              { now: Date.now(), retryingFailure: false, thread },
            ),
            retryingFailure: false,
          },
        });
        expect(seen).toHaveLength(2);
        expect(seen[1]).toMatchObject({
          initiator,
          senderThreadId,
          origin,
          originPluginId,
          queuedMessages: ids.map((id) => ({ id })),
        });
        expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
        expect(turnRequests(harness, thread.id)).toHaveLength(turnsBefore + 1);
      });
    },
  );
});

describe("message.dispatch hooks on the queue drain", () => {
  it("uses the durable plugin wait after submission data expires", async () => {
    await withTestHarness(async (harness) => {
      const seen: unknown[] = [];
      const registry = emptyRegistry();
      registry["message.dispatch"].push({
        pluginId: "drafts",
        handler: (context) => {
          seen.push(context.experimental_submission);
          const isDraft =
            context.experimental_submission?.pluginId === "drafts" ||
            context.queuedMessages.some(
              (message) =>
                message.waitingOn?.kind === "plugin" &&
                message.waitingOn.pluginId === "drafts",
            );
          return isDraft
            ? ({ action: "wait", reason: "Draft" } as const)
            : ({ action: "proceed" } as const);
        },
      });
      installHooks(registry);
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-plugin-submission",
        status: "idle",
      });
      const pluginSubmission = {
        pluginId: "drafts",
        data: { kind: "draft" },
      };

      await acceptThreadSendRequest(harness.deps, {
        payload: {
          input: textInput("queued draft"),
          mode: "auto",
          pluginSubmission,
        },
        thread,
      });
      onlyQueuedRow(harness, thread.id);

      await runQueuedMessageDispatch(harness.deps, { kind: "plugin-recheck" });

      expect(seen).toEqual([pluginSubmission, null]);
    });
  });

  it("returns the claimed row to the queue instead of consuming it when the pass waits", async () => {
    await withTestHarness(async (harness) => {
      const registry = emptyRegistry();
      registry["message.dispatch"].push({
        pluginId: "limiter",
        handler: () => ({ action: "wait", reason: "at capacity" }) as const,
      });
      installHooks(registry);
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-hook-drain",
        status: "idle",
      });
      const queued = await createQueuedMessageForThread(harness.deps, {
        payload: { input: textInput("queued work") },
        thread,
      });
      const turnsBefore = turnRequests(harness, thread.id).length;

      const drained = await sendNextQueuedMessageIfPresent(harness.deps, {
        threadId: thread.id,
      });

      expect(drained).toBe(true);
      const waiting = onlyQueuedRow(harness, thread.id);
      expect(waiting.id).toBe(queued.id);
      expect(waiting.content).toEqual(textInput("queued work"));
      expect(waiting.waitingOn).toEqual({
        kind: "plugin",
        pluginId: "limiter",
        reason: "at capacity",
      });
      expect(turnRequests(harness, thread.id)).toHaveLength(turnsBefore);
    });
  });

  it("returns an ordinary row when its hook pass crosses a manual stop", async () => {
    await withTestHarness(async (harness) => {
      const entered = createDeferredPromise<void>();
      const release = createDeferredPromise<void>();
      const registry = emptyRegistry();
      registry["message.dispatch"].push({
        pluginId: "limiter",
        handler: async () => {
          entered.resolve();
          await release.promise;
          return { action: "proceed" } as const;
        },
      });
      installHooks(registry);
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-hook-stop-race",
        status: "idle",
      });
      const queued = await createQueuedMessageForThread(harness.deps, {
        payload: { input: textInput("stay paused") },
        thread,
      });
      const turnsBefore = turnRequests(harness, thread.id).length;

      const draining = sendNextQueuedMessageIfPresent(harness.deps, {
        threadId: thread.id,
      });
      await entered.promise;
      try {
        applyLoggedThreadLifecycleEvent(harness.deps, {
          event: { type: "run.started" },
          threadId: thread.id,
        });
        seedTurnStarted(harness.deps, {
          environmentId: thread.environmentId,
          providerThreadId: "provider-host-hook-stop-race",
          threadId: thread.id,
          turnId: "turn-host-hook-stop-race",
        });
        const stopResponse = harness.app.request(
          `/api/v1/threads/${thread.id}/stop`,
          { method: "POST" },
        );
        const stop = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "thread.stop" && command.threadId === thread.id,
        );
        await reportQueuedCommandSuccess(harness, stop, {
          providerCheckpointId: null,
        });
        expect((await stopResponse).status).toBe(200);
      } finally {
        release.resolve();
      }

      await expect(draining).resolves.toBe(false);
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
      expect(listQueuedThreadMessages(harness.db, thread.id)).toMatchObject([
        { id: queued.id },
      ]);
      expect(turnRequests(harness, thread.id)).toHaveLength(turnsBefore);
      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toEqual([]);
    });
  });
});
