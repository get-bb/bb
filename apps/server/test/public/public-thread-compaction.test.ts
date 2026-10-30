import { afterEach, describe, expect, it } from "vitest";
import {
  getLatestThreadSequence,
  getThreadExecutionOverride,
  listEvents,
  listQueuedThreadMessages,
  setThreadExecutionOverride,
  updateHost,
} from "@bb/db";
import {
  createStandaloneBuiltinCompactCommandInput,
  turnRequestEventDataSchema,
  turnScope,
} from "@bb/domain";
import type { ClientTurnRequestId } from "@bb/domain";
import { createDeferredPromise } from "@bb/test-helpers";
import type { PluginHookName } from "@get-bb/plugin-sdk";
import { applyTurnCompletedEvent } from "../../src/internal/turn-completed-events.js";
import {
  invokePluginInline,
  setPluginHookProvider,
  type PluginHookRegistration,
} from "../../src/services/plugins/plugin-hook-registry.js";
import { setPluginMachineProviderBridge } from "../../src/services/plugins/plugin-machine-provider-registry.js";
import { queueParentSystemMessage } from "../../src/services/threads/parent-system-messages.js";
import { runQueuedMessageDispatch } from "../../src/services/threads/queued-message-dispatch.js";
import { sendNextQueuedMessageIfPresent } from "../../src/services/threads/queued-messages.js";
import { toThreadQueuedMessage } from "../../src/services/threads/thread-queued-messages.js";
import {
  registerHostRpcResponder,
  type HostRpcHandlerResult,
  EMPTY_WORKSPACE_AGENT_CONTEXT,
} from "../helpers/host-rpc.js";
import { availableModelFixture } from "../helpers/available-models.js";
import { readJson } from "../helpers/json.js";
import { installMachineProvider } from "../helpers/machine-provider.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedEvent,
  seedHostSession,
  seedProjectWithSource,
  seedQueuedMessage,
  seedSession,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

afterEach(() => {
  setPluginMachineProviderBridge(undefined);
  setPluginHookProvider(undefined);
});

function installDispatchHook(
  handler: PluginHookRegistration<"message.dispatch">["handler"],
): void {
  const registry: { [K in PluginHookName]: PluginHookRegistration<K>[] } = {
    "message.dispatch": [{ pluginId: "limiter", handler }],
  };
  setPluginHookProvider({
    listHooks: (hook) => registry[hook],
    invokeHook: (_pluginId, _label, run) => invokePluginInline(run),
    decisionTimeoutMs: 10_000,
  });
}

function seedCompactableThread(
  harness: TestAppHarness,
  args: {
    providerId: string;
    providerThreadId: string;
    status?: "active" | "idle";
  },
) {
  const { host, session } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    providerId: args.providerId,
    status: args.status ?? "idle",
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId: args.providerThreadId,
    threadId: thread.id,
  });
  return { host, session, thread };
}

function registerSuccessfulTurnResponder(
  harness: TestAppHarness,
  args: { hostId: string; models?: readonly string[]; sessionId: string },
) {
  return registerHostRpcResponder(harness, {
    hostId: args.hostId,
    sessionId: args.sessionId,
    handle: ({ command }): HostRpcHandlerResult => {
      if (command.type === "host.read_workspace_agent_context") {
        return { ok: true, result: EMPTY_WORKSPACE_AGENT_CONTEXT };
      }
      if (command.type === "turn.submit") {
        return { ok: true, result: { trace: { spans: [] } } };
      }
      if (command.type === "provider.list_models" && args.models) {
        return {
          ok: true,
          result: {
            models: args.models.map((model) =>
              availableModelFixture({ model }),
            ),
            selectedOnlyModels: [],
          },
        };
      }
      return { ok: true, result: {} };
    },
  });
}

function seedAcceptedProviderTurn(
  harness: TestAppHarness,
  args: {
    clientRequestId: ClientTurnRequestId;
    environmentId: string;
    providerThreadId: string;
    threadId: string;
    turnId: string;
  },
): void {
  seedTurnStarted(harness.deps, {
    environmentId: args.environmentId,
    providerThreadId: args.providerThreadId,
    threadId: args.threadId,
    turnId: args.turnId,
  });
  seedEvent(harness.deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: args.providerThreadId,
    sequence:
      getLatestThreadSequence(harness.db, { threadId: args.threadId }) + 1,
    type: "turn/input/accepted",
    scope: turnScope(args.turnId),
    data: {
      providerThreadId: args.providerThreadId,
      clientRequestId: args.clientRequestId,
    },
  });
}

function providerTurns(
  harness: TestAppHarness,
  args: {
    providerThreadId: string;
    thread: { environmentId: string | null; id: string };
  },
) {
  const environmentId = args.thread.environmentId;
  if (environmentId === null) {
    throw new Error("Expected compactable thread environment");
  }
  return (turnId: string, clientRequestId: ClientTurnRequestId) => {
    const turn = {
      environmentId,
      providerThreadId: args.providerThreadId,
      threadId: args.thread.id,
      turnId,
    };
    seedAcceptedProviderTurn(harness, { ...turn, clientRequestId });
    return turn;
  };
}

function completeProviderTurn(
  harness: TestAppHarness,
  args: {
    environmentId: string;
    providerThreadId: string;
    threadId: string;
    turnId: string;
  },
) {
  seedEvent(harness.deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: args.providerThreadId,
    sequence:
      getLatestThreadSequence(harness.db, { threadId: args.threadId }) + 1,
    type: "turn/completed",
    scope: turnScope(args.turnId),
    data: {
      providerThreadId: args.providerThreadId,
      status: "completed",
    },
  });
  return applyTurnCompletedEvent(harness.deps, {
    threadId: args.threadId,
    providerThreadId: args.providerThreadId,
    type: "turn/completed",
    scope: turnScope(args.turnId),
    status: "completed",
  });
}

async function postThreadMessage(
  harness: TestAppHarness,
  threadId: string,
  body: Record<string, unknown>,
) {
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/send`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "queue-if-active", ...body }),
    },
  );
  expect(
    response.status,
    JSON.stringify(await readJson(response.clone())),
  ).toBe(200);
  return readJson(response);
}

async function expectCompactFirstQueuedOnHost(
  harness: TestAppHarness,
  args: { hostName: string; text: string; threadId: string },
) {
  const queuedMessage = {
    content: [{ type: "text", text: args.text }],
    compactFirst: true,
    waitingOn: { kind: "host-offline", hostName: args.hostName },
  };
  await expect(
    postThreadMessage(harness, args.threadId, {
      compactFirst: true,
      input: [{ type: "text", text: args.text }],
    }),
  ).resolves.toMatchObject({ delivery: "queued", queuedMessage });
  expect(
    listQueuedThreadMessages(harness.db, args.threadId).map(
      toThreadQueuedMessage,
    ),
  ).toMatchObject([queuedMessage]);
}

function suspendMachine(
  harness: TestAppHarness,
  args: { hostId: string; sessionId: string },
) {
  const resumeStarted = createDeferredPromise<void>();
  const releaseResume = createDeferredPromise<void>();
  installMachineProvider({
    suspend: async () => ({ resource: { id: "owned" } }),
    resume: async () => {
      resumeStarted.resolve();
      await releaseResume.promise;
      return { resource: { id: "owned" } };
    },
  });
  updateHost(harness.db, harness.hub, args.hostId, {
    machineProviderId: "test-machine",
    phase: "suspended",
    resource: { id: "owned" },
    suspendedAt: Date.now(),
  });
  harness.hub.unregisterDaemon(args.sessionId);
  return { releaseResume, resumeStarted };
}

function turnSubmitsOf(
  responder: ReturnType<typeof registerSuccessfulTurnResponder>,
) {
  return () =>
    responder.requests.flatMap(({ command }) =>
      command.type === "turn.submit" ? [command] : [],
    );
}

describe("public thread compaction", () => {
  it("dispatches the same structured /compact turn as the composer", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, thread } = seedCompactableThread(harness, {
        providerId: "pi",
        providerThreadId: "provider-thread-1",
      });
      const responder = registerSuccessfulTurnResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/compact`,
        { method: "POST" },
      );
      expect(
        response.status,
        JSON.stringify(await readJson(response.clone())),
      ).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        ok: true,
        delivery: "sent",
      });
      const turnSubmitRequests = responder.requests.filter(
        ({ command }) => command.type === "turn.submit",
      );
      expect(turnSubmitRequests).toHaveLength(1);
      expect(turnSubmitRequests[0]?.command).toMatchObject({
        type: "turn.submit",
        threadId: thread.id,
        input: createStandaloneBuiltinCompactCommandInput(),
        resumeContext: {
          providerId: "pi",
          providerThreadId: "provider-thread-1",
        },
      });
    });
  });

  it.each(["acp-omp", "acp-grok"])(
    "routes %s compaction onto the bridge's /compact turn",
    async (providerId) => {
      await withTestHarness(async (harness) => {
        const { host, session, thread } = seedCompactableThread(harness, {
          providerId,
          providerThreadId: "provider-thread-acp",
        });
        const responder = registerSuccessfulTurnResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
        });

        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/compact`,
          { method: "POST" },
        );
        expect(
          response.status,
          JSON.stringify(await readJson(response.clone())),
        ).toBe(200);
        const turnSubmitRequests = responder.requests.filter(
          ({ command }) => command.type === "turn.submit",
        );
        expect(turnSubmitRequests).toHaveLength(1);
        expect(turnSubmitRequests[0]?.command).toMatchObject({
          type: "turn.submit",
          threadId: thread.id,
          input: createStandaloneBuiltinCompactCommandInput(),
          resumeContext: {
            providerId,
            providerThreadId: "provider-thread-acp",
          },
        });
      });
    },
  );

  it("queues sends while a provider-started compaction turn is active", async () => {
    await withTestHarness(async (harness) => {
      const providerThreadId = "provider-thread-extension-compaction";
      const { host, session, thread } = seedCompactableThread(harness, {
        providerId: "pi",
        providerThreadId,
        status: "active",
      });
      if (!thread.environmentId) {
        throw new Error("Expected compactable thread environment");
      }
      const responder = registerSuccessfulTurnResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
      });
      const compactionTurnId = "turn-extension-compaction";
      seedTurnStarted(harness.deps, {
        environmentId: thread.environmentId,
        providerThreadId,
        threadId: thread.id,
        turnId: compactionTurnId,
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: thread.environmentId,
        providerThreadId,
        sequence:
          getLatestThreadSequence(harness.db, { threadId: thread.id }) + 1,
        type: "item/started",
        scope: turnScope(compactionTurnId),
        data: {
          providerThreadId,
          item: { type: "contextCompaction", id: "item-extension-compaction" },
        },
      });

      const sendResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "steer",
            input: [{ type: "text", text: "Sent during compaction" }],
          }),
        },
      );
      expect(sendResponse.status).toBe(200);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(1);
      expect(
        responder.requests.filter(
          ({ command }) => command.type === "turn.submit",
        ),
      ).toHaveLength(0);

      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: thread.environmentId,
        providerThreadId,
        sequence:
          getLatestThreadSequence(harness.db, { threadId: thread.id }) + 1,
        type: "turn/completed",
        scope: turnScope(compactionTurnId),
        data: { providerThreadId, status: "completed" },
      });
      const completion = applyTurnCompletedEvent(harness.deps, {
        threadId: thread.id,
        providerThreadId,
        type: "turn/completed",
        scope: turnScope(compactionTurnId),
        status: "completed",
      });
      expect(completion.nextStatus).toBe("idle");
      expect(
        await sendNextQueuedMessageIfPresent(harness.deps, {
          threadId: thread.id,
        }),
      ).toBe(true);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(0);
      await expect
        .poll(
          () =>
            responder.requests.filter(
              ({ command }) => command.type === "turn.submit",
            ).length,
        )
        .toBe(1);
    });
  });

  it.each(["completed-item", "nested-item", "accepted-input"] as const)(
    "steers sends into an active turn whose compaction is not provider-started and running (%s)",
    async (scenario) => {
      await withTestHarness(async (harness) => {
        const providerThreadId = "provider-thread-compaction-control";
        const { host, session, thread } = seedCompactableThread(harness, {
          providerId: "pi",
          providerThreadId,
          status: scenario === "accepted-input" ? "idle" : "active",
        });
        if (!thread.environmentId) {
          throw new Error("Expected compactable thread environment");
        }
        const responder = registerSuccessfulTurnResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
        });
        const turnId = "turn-compaction-control";
        if (scenario === "accepted-input") {
          const startResponse = await harness.app.request(
            `/api/v1/threads/${thread.id}/send`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                mode: "start",
                input: [{ type: "text", text: "Start ordinary work" }],
              }),
            },
          );
          expect(startResponse.status).toBe(200);
          const startRequest = responder.requests.find(
            ({ command }) => command.type === "turn.submit",
          );
          if (!startRequest || startRequest.command.type !== "turn.submit") {
            throw new Error("Expected ordinary turn request");
          }
          seedAcceptedProviderTurn(harness, {
            clientRequestId: startRequest.command.requestId,
            environmentId: thread.environmentId,
            providerThreadId,
            threadId: thread.id,
            turnId,
          });
        } else {
          seedTurnStarted(harness.deps, {
            environmentId: thread.environmentId,
            providerThreadId,
            threadId: thread.id,
            turnId,
          });
        }
        const compactionItem = {
          threadId: thread.id,
          environmentId: thread.environmentId,
          providerThreadId,
          scope: turnScope(turnId),
          data: {
            providerThreadId,
            item: {
              type: "contextCompaction" as const,
              id: "item-compaction-control",
              ...(scenario === "nested-item"
                ? { parentToolCallId: "call-child-agent" }
                : {}),
            },
          },
        };
        seedEvent(harness.deps, {
          ...compactionItem,
          sequence:
            getLatestThreadSequence(harness.db, { threadId: thread.id }) + 1,
          type: "item/started",
        });
        if (scenario === "completed-item") {
          seedEvent(harness.deps, {
            ...compactionItem,
            sequence:
              getLatestThreadSequence(harness.db, { threadId: thread.id }) + 1,
            type: "item/completed",
          });
        }
        const submissionsBefore = responder.requests.filter(
          ({ command }) => command.type === "turn.submit",
        ).length;

        const sendResponse = await harness.app.request(
          `/api/v1/threads/${thread.id}/send`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              mode: "steer",
              input: [{ type: "text", text: "Keep working" }],
            }),
          },
        );
        expect(sendResponse.status).toBe(200);
        await expect(readJson(sendResponse)).resolves.toMatchObject({
          delivery: "sent",
        });
        expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(0);
        await expect
          .poll(
            () =>
              responder.requests.filter(
                ({ command }) => command.type === "turn.submit",
              ).length,
          )
          .toBe(submissionsBefore + 1);
      });
    },
  );

  it("queues sends and defers send-now while manual compaction is active", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, thread } = seedCompactableThread(harness, {
        providerId: "pi",
        providerThreadId: "provider-thread-queue",
      });
      const responder = registerSuccessfulTurnResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
      });

      const compactResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/compact`,
        { method: "POST" },
      );
      expect(compactResponse.status).toBe(200);
      const compactRequest = responder.requests.find(
        ({ command }) => command.type === "turn.submit",
      );
      if (!compactRequest || compactRequest.command.type !== "turn.submit") {
        throw new Error("Expected compaction turn.submit request");
      }
      if (!thread.environmentId) {
        throw new Error("Expected compactable thread environment");
      }
      const compactionTurnId = "turn-manual-compaction";
      seedAcceptedProviderTurn(harness, {
        clientRequestId: compactRequest.command.requestId,
        environmentId: thread.environmentId,
        providerThreadId: "provider-thread-queue",
        threadId: thread.id,
        turnId: compactionTurnId,
      });

      const sendResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "steer",
            input: [{ type: "text", text: "Send after compaction" }],
          }),
        },
      );
      expect(sendResponse.status).toBe(200);
      const [queuedMessage] = listQueuedThreadMessages(harness.db, thread.id);
      if (!queuedMessage) {
        throw new Error("Expected the send to remain queued");
      }

      const sendNowResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages/${queuedMessage.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "steer" }),
        },
      );
      expect(sendNowResponse.status).toBe(200);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(1);
      expect(
        responder.requests.filter(
          ({ command }) => command.type === "turn.submit",
        ),
      ).toHaveLength(1);

      expect(
        await sendNextQueuedMessageIfPresent(harness.deps, {
          threadId: thread.id,
        }),
      ).toBe(false);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(1);

      const completion = completeProviderTurn(harness, {
        environmentId: thread.environmentId,
        providerThreadId: "provider-thread-queue",
        threadId: thread.id,
        turnId: compactionTurnId,
      });
      expect(completion.nextStatus).toBe("idle");
      expect(
        await sendNextQueuedMessageIfPresent(harness.deps, {
          threadId: thread.id,
        }),
      ).toBe(true);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(0);
      await expect
        .poll(
          () =>
            responder.requests.filter(
              ({ command }) => command.type === "turn.submit",
            ).length,
        )
        .toBe(2);
    });
  });

  it.each([false, true])(
    "queues system notices until compaction finishes (provider accepted: %s)",
    async (accepted) => {
      await withTestHarness(async (harness) => {
        const { host, session, thread } = seedCompactableThread(harness, {
          providerId: "codex",
          providerThreadId: "provider-notice-compaction",
        });
        const responder = registerSuccessfulTurnResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
        });
        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/compact`,
          { method: "POST" },
        );
        expect(response.status).toBe(200);
        const compactRequest = responder.requests.find(
          ({ command }) => command.type === "turn.submit",
        );
        if (
          !compactRequest ||
          compactRequest.command.type !== "turn.submit" ||
          !thread.environmentId
        ) {
          throw new Error("Expected compaction request and environment");
        }
        const turnId = "turn-notice-compaction";
        if (accepted) {
          seedAcceptedProviderTurn(harness, {
            clientRequestId: compactRequest.command.requestId,
            environmentId: thread.environmentId,
            providerThreadId: "provider-notice-compaction",
            threadId: thread.id,
            turnId,
          });
        }
        const input = [
          {
            type: "text" as const,
            text: "Child work is complete.",
            mentions: [],
          },
        ];
        const subject = {
          kind: "thread" as const,
          threadId: "child-notice",
          threadName: "Child",
        };
        expect(
          await queueParentSystemMessage(harness.deps, {
            input,
            parentThreadId: thread.id,
            systemMessageKind: "child-completed",
            systemMessageSubject: subject,
          }),
        ).toBe(true);
        expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([
          expect.objectContaining({
            content: JSON.stringify(input),
            senderThreadId: null,
          }),
        ]);
        expect(
          await sendNextQueuedMessageIfPresent(harness.deps, {
            threadId: thread.id,
          }),
        ).toBe(false);
        expect(
          responder.requests.filter(
            ({ command }) => command.type === "turn.submit",
          ),
        ).toHaveLength(1);
        if (!accepted) {
          seedAcceptedProviderTurn(harness, {
            clientRequestId: compactRequest.command.requestId,
            environmentId: thread.environmentId,
            providerThreadId: "provider-notice-compaction",
            threadId: thread.id,
            turnId,
          });
        }
        seedEvent(harness.deps, {
          threadId: thread.id,
          environmentId: thread.environmentId,
          providerThreadId: "provider-notice-compaction",
          sequence:
            getLatestThreadSequence(harness.db, { threadId: thread.id }) + 1,
          type: "turn/completed",
          scope: turnScope(turnId),
          data: {
            providerThreadId: "provider-notice-compaction",
            status: "completed",
          },
        });
        applyTurnCompletedEvent(harness.deps, {
          threadId: thread.id,
          providerThreadId: "provider-notice-compaction",
          type: "turn/completed",
          scope: turnScope(turnId),
          status: "completed",
        });
        expect(
          await sendNextQueuedMessageIfPresent(harness.deps, {
            threadId: thread.id,
          }),
        ).toBe(true);
        expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
        await expect
          .poll(
            () =>
              responder.requests.filter(
                ({ command }) => command.type === "turn.submit",
              ).length,
          )
          .toBe(2);
        expect(
          responder.requests.filter(
            ({ command }) => command.type === "turn.submit",
          )[1]?.command,
        ).toMatchObject({
          input,
          target: { mode: "start" },
        });
        const notices = listEvents(harness.db, { threadId: thread.id })
          .filter((event) => event.type === "client/turn/requested")
          .map((event) =>
            turnRequestEventDataSchema.parse(JSON.parse(event.data)),
          )
          .filter((event) => event.initiator === "system");
        expect(notices).toEqual([
          expect.objectContaining({
            input,
            senderThreadId: null,
            systemMessageKind: "child-completed",
            systemMessageSubject: subject,
            target: { kind: "new-turn" },
          }),
        ]);
        expect(
          await sendNextQueuedMessageIfPresent(harness.deps, {
            threadId: thread.id,
          }),
        ).toBe(false);
      });
    },
  );

  it("compacts first and delivers the message once compaction finishes", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, thread } = seedCompactableThread(harness, {
        providerId: "pi",
        providerThreadId: "provider-thread-compact-first",
      });
      const responder = registerSuccessfulTurnResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
      });
      const turnSubmits = () =>
        responder.requests.flatMap(({ command }) =>
          command.type === "turn.submit" ? [command] : [],
        );

      const sendResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "queue-if-active",
            compactFirst: true,
            input: [{ type: "text", text: "Continue after compacting" }],
          }),
        },
      );
      expect(
        sendResponse.status,
        JSON.stringify(await readJson(sendResponse.clone())),
      ).toBe(200);
      await expect(readJson(sendResponse)).resolves.toMatchObject({
        delivery: "queued",
      });
      expect(turnSubmits()).toHaveLength(1);
      expect(turnSubmits()[0]).toMatchObject({
        input: createStandaloneBuiltinCompactCommandInput(),
      });
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(1);

      if (!thread.environmentId) {
        throw new Error("Expected compactable thread environment");
      }
      const compactionTurnId = "turn-compact-first";
      seedAcceptedProviderTurn(harness, {
        clientRequestId: turnSubmits()[0]!.requestId,
        environmentId: thread.environmentId,
        providerThreadId: "provider-thread-compact-first",
        threadId: thread.id,
        turnId: compactionTurnId,
      });
      completeProviderTurn(harness, {
        environmentId: thread.environmentId,
        providerThreadId: "provider-thread-compact-first",
        threadId: thread.id,
        turnId: compactionTurnId,
      });
      expect(
        await sendNextQueuedMessageIfPresent(harness.deps, {
          threadId: thread.id,
        }),
      ).toBe(true);
      await expect.poll(() => turnSubmits().length).toBe(2);
      expect(turnSubmits()[1]).toMatchObject({
        input: [{ type: "text", text: "Continue after compacting" }],
      });
    });
  });

  it("answers compact-first sends without waiting for a suspended machine, then compacts once before sending them once it resumes", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, thread } = seedCompactableThread(harness, {
        providerId: "pi",
        providerThreadId: "provider-thread-suspended",
      });
      const startTurn = providerTurns(harness, {
        providerThreadId: "provider-thread-suspended",
        thread,
      });
      const { releaseResume, resumeStarted } = suspendMachine(harness, {
        hostId: host.id,
        sessionId: session.id,
      });

      await expectCompactFirstQueuedOnHost(harness, {
        hostName: host.name,
        text: "Continue once the machine is back",
        threadId: thread.id,
      });
      await expect(
        postThreadMessage(harness, thread.id, {
          compactFirst: true,
          input: [{ type: "text", text: "And this one too" }],
        }),
      ).resolves.toMatchObject({
        delivery: "queued",
        queuedMessage: { compactFirst: true },
      });
      await resumeStarted.promise;

      const resumedSession = seedSession(harness.deps, host.id, {
        instanceId: "instance-resumed",
      });
      const turnSubmits = turnSubmitsOf(
        registerSuccessfulTurnResponder(harness, {
          hostId: host.id,
          sessionId: resumedSession.id,
        }),
      );
      releaseResume.resolve();
      await expect.poll(() => turnSubmits().length).toBe(1);
      expect(turnSubmits()[0]).toMatchObject({
        input: createStandaloneBuiltinCompactCommandInput(),
        target: { mode: "start" },
      });
      await expect
        .poll(() =>
          listQueuedThreadMessages(harness.db, thread.id).map(
            toThreadQueuedMessage,
          ),
        )
        .toMatchObject([
          {
            content: [
              { type: "text", text: "Continue once the machine is back" },
            ],
            compactFirst: false,
            waitingOn: { kind: "thread-busy" },
          },
          {
            content: [{ type: "text", text: "And this one too" }],
            compactFirst: false,
            waitingOn: { kind: "thread-busy" },
          },
        ]);

      completeProviderTurn(
        harness,
        startTurn("turn-compact-after-resume", turnSubmits()[0]!.requestId),
      );
      expect(
        await sendNextQueuedMessageIfPresent(harness.deps, {
          threadId: thread.id,
        }),
      ).toBe(true);
      await expect.poll(() => turnSubmits().length).toBe(2);
      expect(turnSubmits()[1]).toMatchObject({
        input: [{ type: "text", text: "Continue once the machine is back" }],
      });

      completeProviderTurn(
        harness,
        startTurn("turn-first-after-resume", turnSubmits()[1]!.requestId),
      );
      expect(
        await sendNextQueuedMessageIfPresent(harness.deps, {
          threadId: thread.id,
        }),
      ).toBe(true);
      await expect.poll(() => turnSubmits().length).toBe(3);
      expect(turnSubmits()[2]).toMatchObject({
        input: [{ type: "text", text: "And this one too" }],
        target: { mode: "start" },
      });
    });
  });

  it("queues a compact-first send as one row while the host is offline", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, thread } = seedCompactableThread(harness, {
        providerId: "pi",
        providerThreadId: "provider-thread-offline",
      });
      harness.hub.unregisterDaemon(session.id);

      await expectCompactFirstQueuedOnHost(harness, {
        hostName: host.name,
        text: "Continue once the host reconnects",
        threadId: thread.id,
      });
    });
  });

  it.each([
    {
      label: "a compact-first message",
      body: {
        compactFirst: true,
        input: [{ type: "text", text: "Continue after compacting" }],
      },
      followUp: [{ type: "text", text: "Continue after compacting" }],
    },
    {
      label: "a typed /compact",
      body: { input: createStandaloneBuiltinCompactCommandInput() },
      followUp: null,
    },
  ])(
    "compacts for $label as its own turn after a message queued ahead of it finishes",
    async ({ body, followUp }) => {
      await withTestHarness(async (harness) => {
        const { host, session, thread } = seedCompactableThread(harness, {
          providerId: "pi",
          providerThreadId: "provider-thread-queued-ahead",
        });
        const providerTurn = providerTurns(harness, {
          providerThreadId: "provider-thread-queued-ahead",
          thread,
        });
        harness.hub.unregisterDaemon(session.id);
        await postThreadMessage(harness, thread.id, {
          input: [{ type: "text", text: "Queued while the host is away" }],
        });
        await postThreadMessage(harness, thread.id, body);

        const reconnectedSession = seedSession(harness.deps, host.id, {
          instanceId: "instance-reconnected",
        });
        const turnSubmits = turnSubmitsOf(
          registerSuccessfulTurnResponder(harness, {
            hostId: host.id,
            sessionId: reconnectedSession.id,
          }),
        );
        await runQueuedMessageDispatch(harness.deps, {
          kind: "host-connected",
          hostId: host.id,
        });
        const aheadTurn = providerTurn(
          "turn-queued-ahead",
          turnSubmits()[0]!.requestId,
        );
        await runQueuedMessageDispatch(harness.deps, {
          kind: "turn-started",
          threadId: thread.id,
        });
        expect(turnSubmits()).toMatchObject([
          {
            input: [{ type: "text", text: "Queued while the host is away" }],
            target: { mode: "start" },
          },
        ]);

        completeProviderTurn(harness, aheadTurn);
        expect(
          await sendNextQueuedMessageIfPresent(harness.deps, {
            threadId: thread.id,
          }),
        ).toBe(true);
        await expect.poll(() => turnSubmits().length).toBe(2);
        expect(turnSubmits()[1]).toMatchObject({
          input: createStandaloneBuiltinCompactCommandInput(),
          target: { mode: "start" },
        });
        if (followUp === null) return;

        completeProviderTurn(
          harness,
          providerTurn("turn-compaction", turnSubmits()[1]!.requestId),
        );
        expect(
          await sendNextQueuedMessageIfPresent(harness.deps, {
            threadId: thread.id,
          }),
        ).toBe(true);
        await expect.poll(() => turnSubmits().length).toBe(3);
        expect(turnSubmits()[2]).toMatchObject({
          input: followUp,
          target: { mode: "start" },
        });
      });
    },
  );

  it("compacts first when Send now is pressed on a plugin-held compact-first message, then sends it without the plugin holding it again", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, thread } = seedCompactableThread(harness, {
        providerId: "pi",
        providerThreadId: "provider-thread-send-now",
      });
      const startTurn = providerTurns(harness, {
        providerThreadId: "provider-thread-send-now",
        thread,
      });
      const turnSubmits = turnSubmitsOf(
        registerSuccessfulTurnResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
        }),
      );
      installDispatchHook(() => ({ action: "wait", reason: "at capacity" }));
      await expect(
        postThreadMessage(harness, thread.id, {
          compactFirst: true,
          input: [{ type: "text", text: "Send after compacting" }],
        }),
      ).resolves.toMatchObject({
        delivery: "queued",
        queuedMessage: {
          compactFirst: true,
          waitingOn: { kind: "plugin", pluginId: "limiter" },
        },
      });
      const [queuedMessage] = listQueuedThreadMessages(harness.db, thread.id);

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages/${queuedMessage!.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "auto" }),
        },
      );
      expect(
        response.status,
        JSON.stringify(await readJson(response.clone())),
      ).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        delivery: "queued",
        queuedMessage: {
          id: queuedMessage!.id,
          compactFirst: false,
          waitingOn: { kind: "thread-busy" },
        },
      });
      expect(turnSubmits()).toMatchObject([
        {
          input: createStandaloneBuiltinCompactCommandInput(),
          target: { mode: "start" },
        },
      ]);

      completeProviderTurn(
        harness,
        startTurn("turn-send-now-compaction", turnSubmits()[0]!.requestId),
      );
      expect(
        await sendNextQueuedMessageIfPresent(harness.deps, {
          threadId: thread.id,
        }),
      ).toBe(true);
      await expect.poll(() => turnSubmits().length).toBe(2);
      expect(turnSubmits()[1]).toMatchObject({
        input: [{ type: "text", text: "Send after compacting" }],
        target: { mode: "start" },
      });
    });
  });

  it("answers bb thread compact on a suspended machine with one queued compaction, then compacts on the thread's current model once it resumes", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, thread } = seedCompactableThread(harness, {
        providerId: "pi",
        providerThreadId: "provider-thread-compact-suspended",
      });
      setThreadExecutionOverride(harness.db, {
        threadId: thread.id,
        modelOverride: "model-when-queued",
      });
      const { releaseResume, resumeStarted } = suspendMachine(harness, {
        hostId: host.id,
        sessionId: session.id,
      });
      const requestCompaction = async () => {
        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/compact`,
          { method: "POST" },
        );
        expect(
          response.status,
          JSON.stringify(await readJson(response.clone())),
        ).toBe(200);
        return readJson(response);
      };

      await expect(requestCompaction()).resolves.toMatchObject({
        delivery: "queued",
        queuedMessage: {
          content: createStandaloneBuiltinCompactCommandInput(),
          waitingOn: { kind: "host-offline", hostName: host.name },
        },
      });
      const [queuedCompaction] = listQueuedThreadMessages(
        harness.db,
        thread.id,
      );
      await expect(requestCompaction()).resolves.toMatchObject({
        delivery: "queued",
        queuedMessage: { id: queuedCompaction!.id },
      });
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(1);
      setThreadExecutionOverride(harness.db, {
        threadId: thread.id,
        modelOverride: "model-at-resume",
      });
      await resumeStarted.promise;

      const resumedSession = seedSession(harness.deps, host.id, {
        instanceId: "instance-compact-resumed",
      });
      const turnSubmits = turnSubmitsOf(
        registerSuccessfulTurnResponder(harness, {
          hostId: host.id,
          models: ["model-when-queued", "model-at-resume"],
          sessionId: resumedSession.id,
        }),
      );
      releaseResume.resolve();
      await expect.poll(turnSubmits).toMatchObject([
        {
          input: createStandaloneBuiltinCompactCommandInput(),
          options: { model: "model-at-resume" },
          target: { mode: "start" },
        },
      ]);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(0);
      expect(getThreadExecutionOverride(harness.db, thread.id)).toMatchObject({
        modelOverride: "model-at-resume",
      });
    });
  });

  it.each([
    { label: "with no dispatch hook", hooked: false },
    { label: "through the dispatch hook pass", hooked: true },
  ])(
    "covers a compact-first message with the compaction bb thread compact queued ahead of it ($label)",
    async ({ hooked }) => {
      await withTestHarness(async (harness) => {
        const { host, session, thread } = seedCompactableThread(harness, {
          providerId: "pi",
          providerThreadId: "provider-thread-covered",
        });
        const startTurn = providerTurns(harness, {
          providerThreadId: "provider-thread-covered",
          thread,
        });
        if (hooked) installDispatchHook(() => ({ action: "proceed" }));
        harness.hub.unregisterDaemon(session.id);
        const compactResponse = await harness.app.request(
          `/api/v1/threads/${thread.id}/compact`,
          { method: "POST" },
        );
        expect(compactResponse.status).toBe(200);
        await postThreadMessage(harness, thread.id, {
          compactFirst: true,
          input: [{ type: "text", text: "Send after the queued compaction" }],
        });

        const reconnectedSession = seedSession(harness.deps, host.id, {
          instanceId: "instance-covered",
        });
        const turnSubmits = turnSubmitsOf(
          registerSuccessfulTurnResponder(harness, {
            hostId: host.id,
            sessionId: reconnectedSession.id,
          }),
        );
        await runQueuedMessageDispatch(harness.deps, {
          kind: "host-connected",
          hostId: host.id,
        });
        await expect.poll(turnSubmits).toMatchObject([
          {
            input: createStandaloneBuiltinCompactCommandInput(),
            target: { mode: "start" },
          },
        ]);
        expect(
          listQueuedThreadMessages(harness.db, thread.id).map(
            toThreadQueuedMessage,
          ),
        ).toMatchObject([
          {
            content: [
              { type: "text", text: "Send after the queued compaction" },
            ],
            compactFirst: false,
          },
        ]);

        completeProviderTurn(
          harness,
          startTurn("turn-queued-compaction", turnSubmits()[0]!.requestId),
        );
        expect(
          await sendNextQueuedMessageIfPresent(harness.deps, {
            threadId: thread.id,
          }),
        ).toBe(true);
        await expect.poll(() => turnSubmits().length).toBe(2);
        expect(turnSubmits()[1]).toMatchObject({
          input: [{ type: "text", text: "Send after the queued compaction" }],
          target: { mode: "start" },
        });
      });
    },
  );

  it("queues a typed /compact sent to steer a running turn instead of steering it in", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, thread } = seedCompactableThread(harness, {
        providerId: "pi",
        providerThreadId: "provider-thread-steer-compact",
      });
      const startTurn = providerTurns(harness, {
        providerThreadId: "provider-thread-steer-compact",
        thread,
      });
      const turnSubmits = turnSubmitsOf(
        registerSuccessfulTurnResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
        }),
      );
      await postThreadMessage(harness, thread.id, {
        input: [{ type: "text", text: "Work on this" }],
      });
      startTurn("turn-running", turnSubmits()[0]!.requestId);

      await expect(
        postThreadMessage(harness, thread.id, {
          mode: "steer-if-active",
          input: createStandaloneBuiltinCompactCommandInput(),
        }),
      ).resolves.toMatchObject({
        delivery: "queued",
        queuedMessage: {
          content: createStandaloneBuiltinCompactCommandInput(),
          waitingOn: { kind: "thread-busy" },
        },
      });
      expect(turnSubmits()).toHaveLength(1);
    });
  });

  it("keeps a plugin-held message on its plugin wait when a recheck lands during manual compaction", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, thread } = seedCompactableThread(harness, {
        providerId: "pi",
        providerThreadId: "provider-thread-draft",
      });
      if (!thread.environmentId) {
        throw new Error("Expected compactable thread environment");
      }
      const responder = registerSuccessfulTurnResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
      });
      const draftWait = {
        kind: "plugin",
        pluginId: "drafts",
        reason: "Draft",
      } as const;
      seedQueuedMessage(harness.deps, {
        content: textInput("Unfinished draft"),
        threadId: thread.id,
        waitingOn: draftWait,
      });

      const compactResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/compact`,
        { method: "POST" },
      );
      expect(compactResponse.status).toBe(200);
      const compactRequest = responder.requests.find(
        ({ command }) => command.type === "turn.submit",
      );
      if (!compactRequest || compactRequest.command.type !== "turn.submit") {
        throw new Error("Expected compaction turn.submit request");
      }
      seedAcceptedProviderTurn(harness, {
        clientRequestId: compactRequest.command.requestId,
        environmentId: thread.environmentId,
        providerThreadId: "provider-thread-draft",
        threadId: thread.id,
        turnId: "turn-compaction-with-draft",
      });

      await runQueuedMessageDispatch(harness.deps, { kind: "plugin-recheck" });

      expect(
        listQueuedThreadMessages(harness.db, thread.id).map(
          toThreadQueuedMessage,
        ),
      ).toMatchObject([
        {
          content: [{ type: "text", text: "Unfinished draft" }],
          waitingOn: draftWait,
        },
      ]);
    });
  });

  it("rejects invalid follow-up attachments before starting compaction", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, thread } = seedCompactableThread(harness, {
        providerId: "pi",
        providerThreadId: "provider-thread-invalid-attachment",
      });
      const responder = registerSuccessfulTurnResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
      });
      const sequenceBefore = getLatestThreadSequence(harness.db, {
        threadId: thread.id,
      });
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            compactFirst: true,
            mode: "queue-if-active",
            input: [
              {
                type: "localFile",
                path: "/tmp/report.txt",
                sourceProjectId: thread.projectId,
              },
            ],
          }),
        },
      );
      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        message:
          "A source project can only be specified for an uploaded attachment",
      });
      expect(
        responder.requests.filter(
          ({ command }) => command.type === "turn.submit",
        ),
      ).toHaveLength(0);
      expect(getLatestThreadSequence(harness.db, { threadId: thread.id })).toBe(
        sequenceBefore,
      );
      expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(0);
    });
  });

  it.each([
    [{ mode: "steer" }, 400, "compactFirst cannot steer a turn"],
    [
      { mode: "queue-if-active", sendAt: Date.now() + 60_000 },
      400,
      "compactFirst cannot be scheduled with sendAt",
    ],
    [
      {
        mode: "queue-if-active",
        input: createStandaloneBuiltinCompactCommandInput(),
      },
      400,
      "compactFirst needs a message to send after compacting",
    ],
  ])("rejects compactFirst with %j", async (overrides, status, message) => {
    await withTestHarness(async (harness) => {
      const { host, session, thread } = seedCompactableThread(harness, {
        providerId: "pi",
        providerThreadId: "provider-thread-invalid",
      });
      const responder = registerSuccessfulTurnResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
      });
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            compactFirst: true,
            input: [{ type: "text", text: "hello" }],
            ...overrides,
          }),
        },
      );
      expect(response.status).toBe(status);
      await expect(readJson(response)).resolves.toMatchObject({ message });
      expect(responder.requests).toHaveLength(0);
    });
  });

  it("rejects manual compaction for unsupported providers and active threads", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const unsupportedThread = seedThread(harness.deps, {
        projectId: project.id,
        providerId: "acp-cursor",
        status: "idle",
      });
      const activeThread = seedThread(harness.deps, {
        projectId: project.id,
        providerId: "codex",
        status: "active",
      });

      const unsupportedResponse = await harness.app.request(
        `/api/v1/threads/${unsupportedThread.id}/compact`,
        { method: "POST" },
      );
      expect(unsupportedResponse.status).toBe(409);
      await expect(readJson(unsupportedResponse)).resolves.toMatchObject({
        message: expect.stringContaining(
          "does not support manual context compaction",
        ),
      });

      const activeResponse = await harness.app.request(
        `/api/v1/threads/${activeThread.id}/compact`,
        { method: "POST" },
      );
      expect(activeResponse.status).toBe(409);
      await expect(readJson(activeResponse)).resolves.toMatchObject({
        message:
          "Context can only be compacted while the thread is idle or errored",
      });
    });
  });
});
