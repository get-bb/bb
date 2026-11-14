import { describe, expect, it } from "vitest";
import { getLatestThreadSequence, listQueuedThreadMessages } from "@bb/db";
import {
  createStandaloneBuiltinCompactCommandInput,
  THREAD_PROVIDER_COMMANDS_STATE_KIND,
  threadScope,
  turnScope,
} from "@bb/domain";
import type { ClientTurnRequestId } from "@bb/domain";
import { applyTurnCompletedEvent } from "../../src/internal/turn-completed-events.js";
import { sendNextQueuedMessageIfPresent } from "../../src/services/threads/queued-messages.js";
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
import { listEvents } from "@bb/db/testing";

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

function seedProviderCommandsState(
  harness: TestAppHarness,
  args: { threadId: string; providerThreadId: string; names: string[] },
): void {
  seedEvent(harness.deps, {
    threadId: args.threadId,
    providerThreadId: args.providerThreadId,
    sequence:
      getLatestThreadSequence(harness.db, { threadId: args.threadId }) + 1,
    type: "thread/extensionState/updated",
    scope: threadScope(),
    data: {
      kind: THREAD_PROVIDER_COMMANDS_STATE_KIND,
      payload: {
        commands: args.names.map((name) => ({ name, description: "" })),
      },
    },
  });
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
    "offers %s the built-in /compact only while its live commands list compact",
    async (providerId) => {
      await withTestHarness(async (harness) => {
        const providerThreadId = "provider-thread-acp";
        const { host, session, thread } = seedCompactableThread(harness, {
          providerId,
          providerThreadId,
        });
        const responder = registerSuccessfulTurnResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
        });
        const turnSubmits = () =>
          responder.requests.flatMap(({ command }) =>
            command.type === "turn.submit" ? [command] : [],
          );
        const compact = () =>
          harness.app.request(`/api/v1/threads/${thread.id}/compact`, {
            method: "POST",
          });
        const compactFirst = () =>
          harness.app.request(`/api/v1/threads/${thread.id}/send`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              mode: "queue-if-active",
              compactFirst: true,
              input: [{ type: "text", text: "after compacting" }],
            }),
          });
        const unsupported = `Provider "${providerId}" does not support manual context compaction`;

        const refused = await compact();
        expect(refused.status).toBe(409);
        await expect(readJson(refused)).resolves.toMatchObject({
          message: unsupported,
        });
        const refusedFirst = await compactFirst();
        expect(refusedFirst.status).toBe(409);
        expect(turnSubmits()).toHaveLength(0);

        seedProviderCommandsState(harness, {
          threadId: thread.id,
          providerThreadId,
          names: ["compact", "init"],
        });
        const accepted = await compact();
        expect(
          accepted.status,
          JSON.stringify(await readJson(accepted.clone())),
        ).toBe(200);
        expect(turnSubmits()).toHaveLength(1);
        expect(turnSubmits()[0]).toMatchObject({
          threadId: thread.id,
          input: createStandaloneBuiltinCompactCommandInput(),
          resumeContext: { providerId, providerThreadId },
        });

        seedProviderCommandsState(harness, {
          threadId: thread.id,
          providerThreadId,
          names: ["init"],
        });
        expect((await compact()).status).toBe(409);
        expect(turnSubmits()).toHaveLength(1);
      });
    },
  );

  it("re-queues a send the runtime refuses busy during compaction and delivers it after the compaction turn", async () => {
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
      let compacting = true;
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: ({ command }): HostRpcHandlerResult => {
          if (command.type === "host.read_workspace_agent_context") {
            return { ok: true, result: EMPTY_WORKSPACE_AGENT_CONTEXT };
          }
          if (command.type === "turn.submit" && compacting) {
            return {
              ok: false,
              errorCode: "thread_busy",
              errorMessage: "The agent is compacting context.",
            };
          }
          if (command.type === "turn.submit") {
            return { ok: true, result: { trace: { spans: [] } } };
          }
          return { ok: true, result: {} };
        },
      });
      const compactionTurnId = "turn-extension-compaction";
      seedTurnStarted(harness.deps, {
        environmentId: thread.environmentId,
        providerThreadId,
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
            input: [{ type: "text", text: "Sent during compaction" }],
          }),
        },
      );
      expect(sendResponse.status).toBe(200);
      await expect
        .poll(() =>
          listQueuedThreadMessages(harness.db, thread.id).map(
            (row) => row.payloadKind,
          ),
        )
        .toEqual(["retry"]);
      expect(
        listEvents(harness.db, { threadId: thread.id }).some(
          (event) =>
            event.type === "client/turn/rejected" &&
            JSON.parse(event.data).reason === "thread_busy",
        ),
      ).toBe(true);

      compacting = false;
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
        afterIdle: null,
        payload: {
          threadId: thread.id,
          providerThreadId,
          type: "turn/completed",
          scope: turnScope(compactionTurnId),
          status: "completed",
        },
      });
      expect(completion).toEqual({ kind: "settled", nextStatus: "idle" });
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

  it("re-sends every message the runtime refused busy, not only the latest", async () => {
    await withTestHarness(async (harness) => {
      const providerThreadId = "provider-thread-two-busy-sends";
      const { host, session, thread } = seedCompactableThread(harness, {
        providerId: "pi",
        providerThreadId,
        status: "active",
      });
      if (!thread.environmentId) {
        throw new Error("Expected compactable thread environment");
      }
      let releaseBusy: () => void = () => {};
      const bothSubmitted = new Promise<void>((resolve) => {
        releaseBusy = resolve;
      });
      let submits = 0;
      let compacting = true;
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: async ({ command }): Promise<HostRpcHandlerResult> => {
          if (command.type === "host.read_workspace_agent_context") {
            return { ok: true, result: EMPTY_WORKSPACE_AGENT_CONTEXT };
          }
          if (command.type === "turn.submit" && !compacting) {
            return { ok: true, result: { trace: { spans: [] } } };
          }
          if (command.type === "turn.submit") {
            submits += 1;
            if (submits >= 2) {
              releaseBusy();
            }
            await Promise.race([
              bothSubmitted,
              new Promise((resolve) => setTimeout(resolve, 1_000)),
            ]);
            return {
              ok: false,
              errorCode: "thread_busy",
              errorMessage: "The agent is compacting context.",
            };
          }
          return { ok: true, result: {} };
        },
      });
      const compactionTurnId = "turn-compaction-two-sends";
      seedTurnStarted(harness.deps, {
        environmentId: thread.environmentId,
        providerThreadId,
        threadId: thread.id,
        turnId: compactionTurnId,
      });

      const send = (text: string) =>
        harness.app.request(`/api/v1/threads/${thread.id}/send`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "steer",
            input: [{ type: "text", text }],
          }),
        });
      const responses = await Promise.all([send("first"), send("second")]);
      expect(responses.map((response) => response.status)).toEqual([
        200, 200,
      ]);

      const rejectedRequestIds = () =>
        listEvents(harness.db, { threadId: thread.id }).flatMap((event) =>
          event.type === "client/turn/rejected"
            ? [JSON.parse(event.data).requestId as string]
            : [],
        );
      await expect.poll(() => rejectedRequestIds().length).toBe(2);
      await expect
        .poll(() =>
          listQueuedThreadMessages(harness.db, thread.id)
            .flatMap((row) =>
              row.retryOfTurnRequestId === null
                ? []
                : [row.retryOfTurnRequestId],
            )
            .sort(),
        )
        .toEqual([...rejectedRequestIds()].sort());

      compacting = false;
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
      applyTurnCompletedEvent(harness.deps, {
        afterIdle: null,
        payload: {
          threadId: thread.id,
          providerThreadId,
          type: "turn/completed",
          scope: turnScope(compactionTurnId),
          status: "completed",
        },
      });
      expect(
        await sendNextQueuedMessageIfPresent(harness.deps, {
          threadId: thread.id,
        }),
      ).toBe(true);
      expect(
        listQueuedThreadMessages(harness.db, thread.id).map((row) => ({
          retryOf: row.retryOfTurnRequestId,
          waitingOn: row.waitingOn,
        })),
      ).toEqual([
        { retryOf: expect.any(String), waitingOn: '{"kind":"thread-busy"}' },
      ]);
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
        afterIdle: null,
        payload: {
          threadId: thread.id,
          providerThreadId: "provider-thread-compact-first",
          type: "turn/completed",
          scope: turnScope(compactionTurnId),
          status: "completed",
        },
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

  it("rejects manual compaction for active threads", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const activeThread = seedThread(harness.deps, {
        projectId: project.id,
        providerId: "codex",
        status: "active",
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
