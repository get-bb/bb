import {
  claimQueuedThreadMessageGroup,
  listEvents,
  listQueuedThreadMessages,
  setThreadExecutionOverride,
  updateQueuedThreadMessage,
} from "@bb/db";
import {
  turnRequestEventDataSchema,
  type TurnRequestEventData,
} from "@bb/domain";
import type {
  MessageDispatchHookContext,
  PluginHookName,
} from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleDaemonSocketClosed } from "../../src/internal/session-owner-side-effects.js";
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
  releaseOrphanedQueuedMessageDispatchClaims,
} from "../../src/services/threads/queued-messages.js";
import { runQueuedMessageDispatch } from "../../src/services/threads/queued-message-dispatch.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { toThreadQueuedMessage } from "../../src/services/threads/thread-queued-messages.js";
import { onDaemonSocketOpen } from "../../src/ws/daemon-protocol.js";
import {
  listQueuedThreadCommands,
  registerTestHostRpcCapture,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import {
  createUserAnswerResolution,
  createUserQuestionPayload,
} from "../helpers/pending-interactions.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedSession,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const WORKSPACE_PATH = "/tmp/system-notice-project";

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
    "message.dispatch": [{ pluginId: "notice-test", handler }],
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
            pluginId: "notice-test",
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
        pluginId: "notice-test",
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

describe("notice recovery", () => {
  it("recovers a notice whose first attempt never ran on a parent that stays active", async () => {
    await withTestHarness(async (harness) => {
      const { thread: parent } = seedRunnableThread(harness, {
        hostId: "host-notice-recovery",
        status: "active",
      });
      const blocker = await createQueuedMessageForThread(harness.deps, {
        thread: parent,
        payload: { input: textInput("Behind the turn") },
      });
      claimQueuedThreadMessageGroup(harness.db, harness.hub, blocker.id, {
        kind: "explicit-send",
      });

      await queueParentSystemMessage(harness.deps, {
        input: textInput("Child completed"),
        parentThreadId: parent.id,
        systemMessageKind: "child-completed",
        systemMessageSubject: null,
      });
      releaseOrphanedQueuedMessageDispatchClaims(harness.deps, Date.now());
      await runQueuedMessageDispatch(harness.deps, {
        kind: "idle-recovery",
        now: Date.now(),
      });

      expect(
        turnRequests(harness, parent.id).filter(
          (request) => request.initiator === "system",
        ),
      ).toHaveLength(1);
    });
  });
});

function queueChildCompletedNotice(harness: TestAppHarness, parentId: string) {
  return queueParentSystemMessage(harness.deps, {
    input: textInput("Child completed"),
    parentThreadId: parentId,
    systemMessageKind: "child-completed",
    systemMessageSubject: null,
  });
}

function turnSubmitTargets(harness: TestAppHarness, threadId: string) {
  return listQueuedThreadCommands(harness, "turn.submit", threadId).map(
    (command) => (command.type === "turn.submit" ? command.target : null),
  );
}

describe("notices to a parent mid-turn", () => {
  it("steer into the running turn", async () => {
    await withTestHarness(async (harness) => {
      const { thread: parent } = seedRunnableThread(harness, {
        hostId: "host-steer-running",
        status: "active",
      });

      await expect(queueChildCompletedNotice(harness, parent.id)).resolves.toBe(
        true,
      );

      expect(turnSubmitTargets(harness, parent.id)).toEqual([
        { mode: "auto", expectedTurnId: "turn-host-steer-running" },
      ]);
      expect(queuedRows(harness, parent.id)).toEqual([]);
    });
  });

  it("pass a limiter at its cap as a join-turn attempt", async () => {
    await withTestHarness(async (harness) => {
      const attempts: MessageDispatchHookContext["attempt"][] = [];
      installDispatchHook((context) => {
        attempts.push(context.attempt);
        return context.attempt === "join-turn"
          ? { action: "proceed" }
          : { action: "wait", reason: "At capacity" };
      });
      const { thread: parent } = seedRunnableThread(harness, {
        hostId: "host-steer-at-cap",
        status: "active",
      });

      await queueChildCompletedNotice(harness, parent.id);

      expect(attempts).toEqual(["join-turn"]);
      expect(turnSubmitTargets(harness, parent.id)).toEqual([
        { mode: "auto", expectedTurnId: "turn-host-steer-at-cap" },
      ]);
      expect(queuedRows(harness, parent.id)).toEqual([]);
    });
  });

  it("keep a held notice as a steer row that joins the turn when released", async () => {
    await withTestHarness(async (harness) => {
      let holding = true;
      installDispatchHook(() =>
        holding ? { action: "wait", reason: "Hold" } : { action: "proceed" },
      );
      const { thread: parent } = seedRunnableThread(harness, {
        hostId: "host-steer-held",
        status: "active",
      });

      await queueChildCompletedNotice(harness, parent.id);
      expect(listQueuedThreadMessages(harness.db, parent.id)).toEqual([
        expect.objectContaining({ deliveryMode: "steer" }),
      ]);

      holding = false;
      await runQueuedMessageDispatch(harness.deps, {
        kind: "plugin-unregistered",
        pluginId: "notice-test",
      });

      expect(turnSubmitTargets(harness, parent.id)).toEqual([
        { mode: "auto", expectedTurnId: "turn-host-steer-held" },
      ]);
      expect(queuedRows(harness, parent.id)).toEqual([]);
    });
  });

  it("wait on a pending question, then steer into the same turn", async () => {
    await withTestHarness(async (harness) => {
      const { thread: parent } = seedRunnableThread(harness, {
        hostId: "host-steer-question",
        status: "active",
      });
      const registered =
        harness.deps.pendingInteractions.registerPendingInteraction({
          interaction: {
            threadId: parent.id,
            turnId: "turn-host-steer-question",
            providerId: "codex",
            providerThreadId: "provider-host-steer-question",
            providerRequestId: "request-steer-question",
            payload: createUserQuestionPayload(),
          },
        });
      if (registered.outcome === "rejected") {
        throw new Error(`Expected registration: ${registered.reason}`);
      }

      await queueChildCompletedNotice(harness, parent.id);
      expect(turnSubmitTargets(harness, parent.id)).toEqual([]);
      expect(queuedRows(harness, parent.id)).toEqual([
        expect.objectContaining({ waitingOn: { kind: "interaction" } }),
      ]);

      harness.deps.pendingInteractions.resolvePendingInteraction({
        threadId: parent.id,
        interactionId: registered.interaction.id,
        resolution: createUserAnswerResolution(),
      });
      const resolve = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "interactive.resolve" &&
          command.interactionId === registered.interaction.id,
      );
      await reportQueuedCommandSuccess(harness, resolve, {});

      await vi.waitFor(() => {
        expect(turnSubmitTargets(harness, parent.id)).toEqual([
          { mode: "auto", expectedTurnId: "turn-host-steer-question" },
        ]);
      });
      expect(queuedRows(harness, parent.id)).toEqual([]);
    });
  });

  it("wait for an offline host, then steer into the same turn", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, thread: parent } = seedRunnableThread(harness, {
        hostId: "host-steer-offline",
        status: "active",
      });
      handleDaemonSocketClosed(harness.deps, { sessionId: session.id });
      harness.hub.cancelPendingDaemonDisconnect(session.id);

      await queueChildCompletedNotice(harness, parent.id);
      expect(listQueuedThreadMessages(harness.db, parent.id)).toEqual([
        expect.objectContaining({ deliveryMode: "steer" }),
      ]);
      expect(queuedRows(harness, parent.id)).toEqual([
        expect.objectContaining({
          waitingOn: { kind: "host-offline", hostName: host.name },
        }),
      ]);

      const reconnect = seedSession(harness.deps, host.id);
      onDaemonSocketOpen(harness.deps, {
        hostId: host.id,
        sessionId: reconnect.id,
        socket: registerTestHostRpcCapture(harness.deps, {
          hostId: host.id,
          sessionId: reconnect.id,
        }),
      });

      await vi.waitFor(() => {
        expect(turnSubmitTargets(harness, parent.id)).toEqual([
          { mode: "auto", expectedTurnId: "turn-host-steer-offline" },
        ]);
      });
      expect(queuedRows(harness, parent.id)).toEqual([]);
    });
  });
});
