import {
  getQueuedThreadMessage,
  listEvents,
  listQueuedThreadMessages,
  setQueuedThreadMessageGroupBoundary,
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

const WORKSPACE_PATH = "/tmp/dispatcher-paths-project";

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
    "message.dispatch": [{ pluginId: "dispatcher-paths-test", handler }],
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

describe("queued context clear", () => {
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

  it.each([
    ["steer", "queue-if-active"],
    ["queue-if-active", "steer"],
  ] as const)(
    "waits for the running turn with a group of a %s row and a %s row",
    async (...modes) => {
      await withTestHarness(async (harness) => {
        const { thread } = seedRunnableThread(harness, {
          hostId: `host-mixed-group-${modes[0]}`,
          status: "active",
        });
        const sendAt = Date.now() + 60_000;
        for (const mode of modes) {
          await acceptThreadSendRequest(harness.deps, {
            payload: { input: textInput(mode), mode, sendAt },
            thread,
          });
        }
        const rows = listQueuedThreadMessages(harness.db, thread.id);
        expect(
          setQueuedThreadMessageGroupBoundary({
            db: harness.db,
            notifier: harness.hub,
            threadId: thread.id,
            expectedGroupedPrefixQueuedMessageIds: rows.map((row) => row.id),
            groupBoundaryQueuedMessageId: rows[1]!.id,
          }).kind,
        ).toBe("updated");

        await runQueuedMessageDispatch(harness.deps, {
          kind: "time-reached",
          now: sendAt + 1,
        });

        expect(
          listQueuedThreadCommands(harness, "turn.submit", thread.id),
        ).toHaveLength(0);
        expect(queuedRows(harness, thread.id)).toEqual([
          expect.objectContaining({ waitingOn: { kind: "thread-busy" } }),
          expect.objectContaining({ waitingOn: { kind: "thread-busy" } }),
        ]);
      });
    },
  );
});

describe("queue intent after the dispatch hook", () => {
  it("keeps a queue-mode row waiting when the main run resumes during the hook", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedRunnableThread(harness, {
        hostId: "host-resume-during-hook",
        status: "active",
      });
      const mainRun = (sequence: number, state: "idle" | "running") =>
        seedEvent(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          providerThreadId: "provider-host-resume-during-hook",
          sequence,
          type: "turn/mainRun/updated",
          scope: turnScope("turn-host-resume-during-hook"),
          data: { state },
        });
      mainRun(10, "idle");
      const sendAt = Date.now() + 60_000;
      await acceptThreadSendRequest(harness.deps, {
        payload: { input: textInput("Later"), mode: "queue-if-active", sendAt },
        thread,
      });
      installDispatchHook(async () => {
        mainRun(11, "running");
        return { action: "proceed" };
      });

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
});
