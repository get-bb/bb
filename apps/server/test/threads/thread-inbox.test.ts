import {
  getQueuedThreadMessage,
  listEvents,
  listQueuedThreadMessages,
  setQueuedThreadMessageGroupBoundary,
  setThreadExecutionOverride,
  updateQueuedThreadMessage,
} from "@bb/db";
import {
  THREAD_CONTEXT_CLEAR_OPERATION,
  turnRequestEventDataSchema,
  turnScope,
  type PromptInput,
  type TurnRequestEventData,
} from "@bb/domain";
import type {
  MessageDispatchHookContext,
  PluginHookName,
} from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it } from "vitest";
import {
  invokePluginInline,
  setPluginHookProvider,
  type PluginHookRegistration,
} from "../../src/services/plugins/plugin-hook-registry.js";
import { queueChildThreadTurnNotificationBestEffort } from "../../src/services/threads/child-thread-notifications.js";
import { queueChildThreadNeedsAttentionNotificationBestEffort } from "../../src/services/threads/child-thread-notifications.js";
import { queueParentSystemMessage } from "../../src/services/threads/parent-system-messages.js";
import {
  createQueuedMessageForThread,
  releaseStaleQueuedMessageDispatchClaims,
  sendNextQueuedMessageIfPresent,
} from "../../src/services/threads/queued-messages.js";
import { runQueuedMessageDispatch } from "../../src/services/threads/queued-message-dispatch.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { toThreadQueuedMessage } from "../../src/services/threads/thread-queued-messages.js";
import { acceptThreadSendRequest } from "../../src/services/threads/thread-send-request.js";
import { listQueuedThreadCommands } from "../helpers/commands.js";
import {
  EMPTY_WORKSPACE_AGENT_CONTEXT,
  registerHostRpcResponder,
} from "../helpers/host-rpc.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedEvent,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const WORKSPACE_PATH = "/tmp/thread-inbox-project";

type HookRegistry = {
  [K in PluginHookName]: PluginHookRegistration<K>[];
};

function installDispatchHook(
  handler: (
    context: MessageDispatchHookContext,
  ) =>
    | { action: "proceed" }
    | { action: "wait"; reason: string }
    | Promise<{ action: "proceed" }>,
): void {
  const registry: HookRegistry = {
    "message.dispatch": [{ pluginId: "inbox-test", handler }],
  };
  setPluginHookProvider({
    listHooks: (hook) => registry[hook],
    invokeHook: (_pluginId, _label, run) => invokePluginInline(run),
    decisionTimeoutMs: 10_000,
  });
}

afterEach(() => {
  setPluginHookProvider(undefined);
});

function seedRunnableThread(
  harness: TestAppHarness,
  args: { hostId: string; status: "idle" | "active"; title?: string },
) {
  const { host, session } = seedHostSession(harness.deps, {
    id: args.hostId,
  });
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
    ...(args.title !== undefined ? { title: args.title } : {}),
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
  return { environment, host, project, session, thread };
}

function turnRequests(
  harness: TestAppHarness,
  threadId: string,
): TurnRequestEventData[] {
  return listEvents(harness.db, { threadId })
    .filter((event) => event.type === "client/turn/requested")
    .map((event) => turnRequestEventDataSchema.parse(JSON.parse(event.data)));
}

function queuedRows(harness: TestAppHarness, threadId: string) {
  return listQueuedThreadMessages(harness.db, threadId).map(
    toThreadQueuedMessage,
  );
}

function firstText(request: TurnRequestEventData | undefined): string {
  const first = request?.input[0];
  return first?.type === "text" ? first.text : "";
}

describe("system notices", () => {
  it("run the dispatch hook as a system turn and wait while it holds them", async () => {
    await withTestHarness(async (harness) => {
      const seen: MessageDispatchHookContext["initiator"][] = [];
      installDispatchHook((context) => {
        seen.push(context.initiator);
        return { action: "wait", reason: "At capacity" };
      });
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-notice-hook",
        status: "idle",
      });
      const before = turnRequests(harness, thread.id).length;

      await expect(
        queueParentSystemMessage(harness.deps, {
          input: textInput("Child completed"),
          parentThreadId: thread.id,
          systemMessageKind: "child-completed",
          systemMessageSubject: null,
        }),
      ).resolves.toBe(true);

      expect(seen).toEqual(["system"]);
      expect(turnRequests(harness, thread.id)).toHaveLength(before);
      expect(queuedRows(harness, thread.id)).toEqual([
        expect.objectContaining({
          initiator: "system",
          waitingOn: {
            kind: "plugin",
            pluginId: "inbox-test",
            reason: "At capacity",
          },
        }),
      ]);
    });
  });

  it("wait for a parent that has no environment yet instead of starting it", async () => {
    await withTestHarness(async (harness) => {
      installDispatchHook(() => ({ action: "wait", reason: "Not yet" }));
      const { host, project } = seedRunnableThread(harness, {
        hostId: "host-pending-parent",
        status: "idle",
      });
      const parent = await createThreadFromRequest(harness.deps, {
        environment: {
          type: "host",
          hostId: host.id,
          workspace: { type: "unmanaged", path: WORKSPACE_PATH },
        },
        input: textInput("Created first"),
        origin: "app",
        projectId: project.id,
        providerId: "codex",
        startedOnBehalfOf: null,
      });
      expect(parent.status).toBe("pending");
      setPluginHookProvider(undefined);

      await expect(
        queueParentSystemMessage(harness.deps, {
          input: textInput("Child completed"),
          parentThreadId: parent.id,
          systemMessageKind: "child-completed",
          systemMessageSubject: null,
        }),
      ).resolves.toBe(true);

      expect(
        queuedRows(harness, parent.id).filter(
          (row) => row.initiator === "system",
        ),
      ).toEqual([
        expect.objectContaining({ waitingOn: { kind: "provisioning" } }),
      ]);
      expect(turnRequests(harness, parent.id)).toEqual([]);
    });
  });
});

describe("child outcome notices", () => {
  it("are one durable row per window that the due sweep delivers as one turn", async () => {
    await withTestHarness(async (harness) => {
      const { project, thread: parent } = seedRunnableThread(harness, {
        hostId: "host-child-outcomes",
        status: "idle",
      });
      const children = ["First child", "Second child"].map((title) =>
        seedThread(harness.deps, {
          parentThreadId: parent.id,
          projectId: project.id,
          title,
        }),
      );
      const before = turnRequests(harness, parent.id).length;

      for (const child of children) {
        await queueChildThreadTurnNotificationBestEffort(harness.deps, {
          childThread: child,
          parentThreadId: parent.id,
          turnStatus: "completed",
        });
      }

      const [row, ...rest] = listQueuedThreadMessages(harness.db, parent.id);
      expect(rest).toEqual([]);
      expect(row).toMatchObject({
        coalesceKey: "child-outcomes",
        state: "scheduled",
      });
      expect(toThreadQueuedMessage(row!)).toMatchObject({
        initiator: "system",
        waitingOn: { kind: "time" },
      });

      await runQueuedMessageDispatch(harness.deps, {
        kind: "time-reached",
        now: row!.sendAt! + 1,
      });

      const delivered = turnRequests(harness, parent.id).slice(before);
      expect(delivered).toEqual([
        expect.objectContaining({
          initiator: "system",
          systemMessageKind: "child-outcome-batch",
          systemMessageSubject: expect.objectContaining({
            count: 2,
            kind: "thread-batch",
          }),
        }),
      ]);
      expect(listQueuedThreadMessages(harness.db, parent.id)).toEqual([]);
    });
  });
});

describe("first message of a pending thread", () => {
  it("keeps the sender thread that started it", async () => {
    await withTestHarness(async (harness) => {
      installDispatchHook(() => ({ action: "wait", reason: "Not yet" }));
      const { host, project } = seedRunnableThread(harness, {
        hostId: "host-pending-sender",
        status: "idle",
      });
      const sender = seedThread(harness.deps, {
        projectId: project.id,
        title: "Sender",
      });
      const pending = await createThreadFromRequest(harness.deps, {
        environment: {
          type: "host",
          hostId: host.id,
          workspace: { type: "unmanaged", path: WORKSPACE_PATH },
        },
        input: textInput("Created first"),
        origin: "app",
        projectId: project.id,
        providerId: "codex",
        startedOnBehalfOf: null,
      });
      expect(pending.status).toBe("pending");
      setPluginHookProvider(undefined);

      await acceptThreadSendRequest(harness.deps, {
        payload: {
          input: textInput("Please review the plan"),
          mode: "auto",
          senderThreadId: sender.id,
        },
        thread: pending,
      });

      const [request] = turnRequests(harness, pending.id);
      expect(request).toMatchObject({
        initiator: "agent",
        senderThreadId: sender.id,
      });
      expect(firstText(request)).toContain(sender.id);
      expect(firstText(request)).toContain("Please review the plan");
    });
  });
});

describe("queued delivery mode", () => {
  it.each([
    { mode: "queue-if-active", steers: false },
    { mode: "steer", steers: true },
  ] as const)(
    "a $mode message that comes due during a running turn steers: $steers",
    async ({ mode, steers }) => {
      await withTestHarness(async (harness) => {
        const { thread } = seedRunnableThread(harness, {
          hostId: `host-due-${mode}`,
          status: "active",
        });
        const sendAt = Date.now() + 60_000;
        const response = await acceptThreadSendRequest(harness.deps, {
          payload: { input: textInput("Later"), mode, sendAt },
          thread,
        });
        expect(response).toMatchObject({
          delivery: "queued",
          queuedMessage: { waitingOn: { kind: "time" } },
        });

        await runQueuedMessageDispatch(harness.deps, {
          kind: "time-reached",
          now: sendAt + 1,
        });

        expect(
          listQueuedThreadCommands(harness, "turn.submit", thread.id),
        ).toHaveLength(steers ? 1 : 0);
        expect(queuedRows(harness, thread.id)).toEqual(
          steers
            ? []
            : [expect.objectContaining({ waitingOn: { kind: "thread-busy" } })],
        );
      });
    },
  );
});

describe("idempotency keys", () => {
  it("send a repeated message once and report the first outcome", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-idempotent-sent",
        status: "idle",
      });
      const before = turnRequests(harness, thread.id).length;
      const send = () =>
        acceptThreadSendRequest(harness.deps, {
          payload: {
            idempotencyKey: "tell-1",
            input: textInput("Only once"),
            mode: "auto",
          },
          thread,
        });

      await expect(send()).resolves.toEqual({ ok: true, delivery: "sent" });
      await expect(send()).resolves.toEqual({ ok: true, delivery: "sent" });

      expect(turnRequests(harness, thread.id)).toHaveLength(before + 1);
    });
  });

  it("return the waiting row for a repeated queued message", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-idempotent-queued",
        status: "active",
      });
      const send = () =>
        acceptThreadSendRequest(harness.deps, {
          payload: {
            idempotencyKey: "tell-2",
            input: textInput("Behind the turn"),
            mode: "queue-if-active",
          },
          thread,
        });

      const first = await send();
      const second = await send();

      expect(first.delivery).toBe("queued");
      expect(second).toEqual(first);
      expect(queuedRows(harness, thread.id)).toHaveLength(1);
    });
  });
});

const CLEAR_INPUT: PromptInput[] = [
  {
    type: "text",
    text: "/clear",
    mentions: [
      {
        start: 0,
        end: "/clear".length,
        resource: {
          kind: "command",
          trigger: "/",
          name: "clear",
          source: "command",
          origin: "builtin",
          label: "clear",
          argumentHint: null,
        },
      },
    ],
  },
];

function contextClearCount(harness: TestAppHarness, threadId: string): number {
  return listEvents(harness.db, { threadId }).filter(
    (event) =>
      event.type === "system/operation" &&
      JSON.parse(event.data).operation === THREAD_CONTEXT_CLEAR_OPERATION,
  ).length;
}

function respondToHost(
  harness: TestAppHarness,
  fixture: ReturnType<typeof seedRunnableThread>,
) {
  return registerHostRpcResponder(harness, {
    hostId: fixture.host.id,
    sessionId: fixture.session.id,
    handle: async ({ command }) => ({
      ok: true,
      result:
        command.type === "thread.stop"
          ? { providerCheckpointId: null }
          : command.type === "host.read_workspace_agent_context"
            ? EMPTY_WORKSPACE_AGENT_CONTEXT
            : { trace: { spans: [] } },
    }),
  });
}

describe("context clear through the inbox", () => {
  it("consumes a queued /clear row so claim recovery cannot run it again", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedRunnableThread(harness, {
        hostId: "host-queued-clear",
        status: "idle",
      });
      respondToHost(harness, fixture);
      const queued = await createQueuedMessageForThread(harness.deps, {
        thread: fixture.thread,
        payload: { input: CLEAR_INPUT },
      });

      await sendNextQueuedMessageIfPresent(harness.deps, {
        threadId: fixture.thread.id,
      });
      releaseStaleQueuedMessageDispatchClaims(
        harness.deps,
        Date.now() + 60 * 60 * 1000,
      );
      await sendNextQueuedMessageIfPresent(harness.deps, {
        threadId: fixture.thread.id,
      });

      expect(getQueuedThreadMessage(harness.db, queued.id)).toBeNull();
      expect(contextClearCount(harness, fixture.thread.id)).toBe(1);
    });
  });

  it("clears once for a repeated idempotency key", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedRunnableThread(harness, {
        hostId: "host-idempotent-clear",
        status: "idle",
      });
      respondToHost(harness, fixture);
      const send = () =>
        acceptThreadSendRequest(harness.deps, {
          payload: {
            idempotencyKey: "clear-1",
            input: CLEAR_INPUT,
            mode: "auto",
          },
          thread: fixture.thread,
        });

      await send();
      await send();

      expect(contextClearCount(harness, fixture.thread.id)).toBe(1);
    });
  });
});

describe("notice durability", () => {
  it("keeps a notice whose dispatch hook throws, for the retry sweep", async () => {
    await withTestHarness(async (harness) => {
      installDispatchHook(() => {
        throw new Error("limiter crashed");
      });
      const { project, thread: parent } = seedRunnableThread(harness, {
        hostId: "host-notice-hook-throws",
        status: "idle",
      });
      const child = seedThread(harness.deps, {
        parentThreadId: parent.id,
        projectId: project.id,
        title: "Blocked child",
      });
      const before = turnRequests(harness, parent.id).length;

      await queueChildThreadNeedsAttentionNotificationBestEffort(harness.deps, {
        blockerSummary: null,
        childThread: child,
        parentThreadId: parent.id,
      });

      expect(turnRequests(harness, parent.id)).toHaveLength(before);
      expect(queuedRows(harness, parent.id)).toEqual([
        expect.objectContaining({
          initiator: "system",
          state: "failed_retrying",
        }),
      ]);
    });
  });

  it("delivers a notice whose parent finished provisioning while the hook ran", async () => {
    await withTestHarness(async (harness) => {
      const { environment, project } = seedRunnableThread(harness, {
        hostId: "host-notice-race",
        status: "idle",
      });
      const parent = seedThread(harness.deps, {
        projectId: project.id,
        status: "pending",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: null,
        providerThreadId: "provider-notice-race",
        threadId: parent.id,
      });
      let calls = 0;
      installDispatchHook(async () => {
        calls += 1;
        if (calls === 1) {
          harness.db.$client
            .prepare(
              "UPDATE threads SET status = 'idle', environment_id = ? WHERE id = ?",
            )
            .run(environment.id, parent.id);
          await runQueuedMessageDispatch(harness.deps, {
            kind: "workspace-ready",
            threadId: parent.id,
          });
        }
        return { action: "proceed" };
      });

      await queueParentSystemMessage(harness.deps, {
        input: textInput("Child completed"),
        parentThreadId: parent.id,
        systemMessageKind: "child-completed",
        systemMessageSubject: null,
      });
      setPluginHookProvider(undefined);
      await runQueuedMessageDispatch(harness.deps, {
        kind: "thread-ready",
        threadId: parent.id,
      });

      expect(queuedRows(harness, parent.id)).toEqual([]);
      expect(
        turnRequests(harness, parent.id).filter(
          (request) => request.initiator === "system",
        ),
      ).toHaveLength(1);
    });
  });

  it("resolves the parent's execution options when a queued notice is delivered", async () => {
    await withTestHarness(async (harness) => {
      let holding = true;
      installDispatchHook(() =>
        holding ? { action: "wait", reason: "Hold" } : { action: "proceed" },
      );
      const { thread: parent } = seedRunnableThread(harness, {
        hostId: "host-notice-execution",
        status: "idle",
      });
      await queueParentSystemMessage(harness.deps, {
        input: textInput("Child completed"),
        parentThreadId: parent.id,
        systemMessageKind: "child-completed",
        systemMessageSubject: null,
      });
      setThreadExecutionOverride(harness.db, {
        threadId: parent.id,
        reasoningLevelOverride: "xhigh",
      });
      holding = false;

      await runQueuedMessageDispatch(harness.deps, {
        kind: "plugin-unregistered",
        pluginId: "inbox-test",
      });

      const notice = turnRequests(harness, parent.id).find(
        (request) => request.initiator === "system",
      );
      expect(notice?.execution.reasoningLevel).toBe("xhigh");
    });
  });
});

describe("coalesced notices", () => {
  it("start a new row once the earlier window has expired", async () => {
    await withTestHarness(async (harness) => {
      const { project, thread: parent } = seedRunnableThread(harness, {
        hostId: "host-expired-window",
        status: "idle",
      });
      const child = seedThread(harness.deps, {
        parentThreadId: parent.id,
        projectId: project.id,
      });
      const notify = (turnStatus: "completed" | "failed") =>
        queueChildThreadTurnNotificationBestEffort(harness.deps, {
          childThread: child,
          parentThreadId: parent.id,
          turnStatus,
        });
      await notify("completed");
      harness.db.$client
        .prepare(
          "UPDATE queued_thread_messages SET send_at = ? WHERE thread_id = ?",
        )
        .run(Date.now() - 1_000, parent.id);

      await notify("failed");

      expect(
        listQueuedThreadMessages(harness.db, parent.id).map(
          (row) => JSON.parse(row.systemNotice ?? "null")?.kind,
        ),
      ).toEqual(["child-completed", "child-failed"]);
    });
  });

  it("leave an edited row alone when the next outcome arrives", async () => {
    await withTestHarness(async (harness) => {
      const { project, thread: parent } = seedRunnableThread(harness, {
        hostId: "host-edited-notice",
        status: "idle",
      });
      const [first, second] = ["First", "Second"].map((title) =>
        seedThread(harness.deps, {
          parentThreadId: parent.id,
          projectId: project.id,
          title,
        }),
      );
      await queueChildThreadTurnNotificationBestEffort(harness.deps, {
        childThread: first!,
        parentThreadId: parent.id,
        turnStatus: "completed",
      });
      const [row] = listQueuedThreadMessages(harness.db, parent.id);
      updateQueuedThreadMessage(harness.db, harness.hub, {
        content: textInput("Edited by hand"),
        expectedUpdatedAt: row!.updatedAt,
        id: row!.id,
        threadId: parent.id,
      });

      await queueChildThreadTurnNotificationBestEffort(harness.deps, {
        childThread: second!,
        parentThreadId: parent.id,
        turnStatus: "completed",
      });

      const rows = queuedRows(harness, parent.id);
      expect(rows).toHaveLength(2);
      expect(rows[0]?.content).toEqual(textInput("Edited by hand"));
    });
  });
});

describe("delivery mode intent", () => {
  it("keeps queue mode for a message sent while only background work runs", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedRunnableThread(harness, {
        hostId: "host-background-queue",
        status: "active",
      });
      const mainRun = (sequence: number, state: "idle" | "running") =>
        seedEvent(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          providerThreadId: "provider-host-background-queue",
          sequence,
          type: "turn/mainRun/updated",
          scope: turnScope("turn-host-background-queue"),
          data: { state },
        });
      mainRun(10, "idle");
      const sendAt = Date.now() + 60_000;
      await acceptThreadSendRequest(harness.deps, {
        payload: { input: textInput("Later"), mode: "queue-if-active", sendAt },
        thread,
      });
      mainRun(11, "running");

      await runQueuedMessageDispatch(harness.deps, {
        kind: "time-reached",
        now: sendAt + 1,
      });

      expect(
        listQueuedThreadCommands(harness, "turn.submit", thread.id),
      ).toHaveLength(0);
      expect(queuedRows(harness, thread.id)).toEqual([
        expect.objectContaining({ waitingOn: { kind: "thread-busy" } }),
      ]);
    });
  });

  it("refuses to group a steering row with a queued one", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedRunnableThread(harness, {
        hostId: "host-mixed-group",
        status: "active",
      });
      const sendAt = Date.now() + 60_000;
      for (const mode of ["steer", "queue-if-active"] as const) {
        await acceptThreadSendRequest(harness.deps, {
          payload: { input: textInput(mode), mode, sendAt },
          thread,
        });
      }
      const rows = listQueuedThreadMessages(harness.db, thread.id);

      const result = setQueuedThreadMessageGroupBoundary({
        db: harness.db,
        notifier: harness.hub,
        threadId: thread.id,
        expectedGroupedPrefixQueuedMessageIds: rows.map((row) => row.id),
        groupBoundaryQueuedMessageId: rows[1]!.id,
      });

      expect(result.kind).toBe("invalid_delivery_mode");
    });
  });
});
