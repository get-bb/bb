import { describe, expect, it } from "vitest";
import {
  getLatestThreadSequence,
  listEvents,
  listQueuedThreadMessages,
} from "@bb/db";
import {
  createStandaloneBuiltinCompactCommandInput,
  turnRequestEventDataSchema,
  turnScope,
} from "@bb/domain";
import type { ClientTurnRequestId } from "@bb/domain";
import { applyTurnCompletedEvent } from "../../src/internal/turn-completed-events.js";
import { sendNextQueuedMessageIfPresent } from "../../src/services/threads/queued-messages.js";
import { queueParentSystemMessage } from "../../src/services/threads/parent-system-messages.js";
import {
  registerHostRpcResponder,
  type HostRpcHandlerResult,
  EMPTY_WORKSPACE_AGENT_CONTEXT,
} from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedEvent,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

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
  args: { hostId: string; sessionId: string },
) {
  return registerHostRpcResponder(harness, {
    ...args,
    handle: ({ command }): HostRpcHandlerResult => {
      if (command.type === "host.read_workspace_agent_context") {
        return { ok: true, result: EMPTY_WORKSPACE_AGENT_CONTEXT };
      }
      if (command.type === "turn.submit") {
        return { ok: true, result: { trace: { spans: [] } } };
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

      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: thread.environmentId,
        providerThreadId: "provider-thread-queue",
        sequence:
          getLatestThreadSequence(harness.db, { threadId: thread.id }) + 1,
        type: "turn/completed",
        scope: turnScope(compactionTurnId),
        data: {
          providerThreadId: "provider-thread-queue",
          status: "completed",
        },
      });
      const completion = applyTurnCompletedEvent(harness.deps, {
        threadId: thread.id,
        providerThreadId: "provider-thread-queue",
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
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: thread.environmentId,
        providerThreadId: "provider-thread-compact-first",
        sequence:
          getLatestThreadSequence(harness.db, { threadId: thread.id }) + 1,
        type: "turn/completed",
        scope: turnScope(compactionTurnId),
        data: {
          providerThreadId: "provider-thread-compact-first",
          status: "completed",
        },
      });
      applyTurnCompletedEvent(harness.deps, {
        threadId: thread.id,
        providerThreadId: "provider-thread-compact-first",
        type: "turn/completed",
        scope: turnScope(compactionTurnId),
        status: "completed",
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
