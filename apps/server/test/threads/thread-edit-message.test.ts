import {
  createPromptHistoryEntry,
  getThread,
  listEvents,
  listStoredProjectPromptHistoryRows,
  listStoredThreadPromptHistoryRows,
  setExperiments,
} from "@bb/db";
import {
  defaultExperiments,
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  editThreadMessage,
  getLatestThreadMessageEdit,
} from "../../src/services/threads/thread-edit-message.js";
import {
  listQueuedThreadCommands,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedStoredEvent,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedCompletedTurn(
  harness: TestAppHarness,
  args: {
    providerThreadId: string;
    providerCheckpointId?: string;
    initiator?: "agent" | "user";
    requestSequence: number;
    senderThreadId?: string;
    text: string;
    threadId: string;
    turnId: string;
  },
): void {
  const requestId = encodeClientTurnRequestIdNumber({
    value: args.requestSequence,
  });
  seedStoredEvent(harness.deps, {
    threadId: args.threadId,
    providerThreadId: args.providerThreadId,
    sequence: args.requestSequence,
    type: "client/turn/requested",
    scope: threadScope(),
    data: {
      direction: "outbound",
      requestId,
      input: [{ type: "text", text: args.text, mentions: [] }],
      target:
        args.requestSequence === 2
          ? { kind: "thread-start" }
          : { kind: "new-turn" },
      execution: {
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium" as const,
        permissionMode: "full",
        source: "client/turn/requested",
      },
      initiator: args.initiator ?? "user",
      senderThreadId: args.senderThreadId ?? null,
      request: { method: "turn/start", params: {} },
      source: "tell",
    },
  });
  seedStoredEvent(harness.deps, {
    threadId: args.threadId,
    providerThreadId: args.providerThreadId,
    sequence: args.requestSequence + 1,
    type: "turn/started",
    scope: turnScope(args.turnId),
    data: { providerThreadId: args.providerThreadId },
  });
  seedStoredEvent(harness.deps, {
    threadId: args.threadId,
    providerThreadId: args.providerThreadId,
    sequence: args.requestSequence + 2,
    type: "turn/input/accepted",
    scope: turnScope(args.turnId),
    data: {
      providerThreadId: args.providerThreadId,
      clientRequestId: requestId,
    },
  });
  seedStoredEvent(harness.deps, {
    threadId: args.threadId,
    providerThreadId: args.providerThreadId,
    sequence: args.requestSequence + 3,
    type: "item/completed",
    scope: turnScope(args.turnId),
    itemId: `message-${args.turnId}`,
    itemKind: "agentMessage",
    data: {
      item: {
        id: `message-${args.turnId}`,
        type: "agentMessage",
        text: `Reply to ${args.text}`,
      },
    },
  });
  seedStoredEvent(harness.deps, {
    threadId: args.threadId,
    providerThreadId: args.providerThreadId,
    sequence: args.requestSequence + 4,
    type: "turn/completed",
    scope: turnScope(args.turnId),
    data: {
      providerThreadId: args.providerThreadId,
      status: "completed",
      ...(args.providerCheckpointId !== undefined
        ? { providerCheckpointId: args.providerCheckpointId }
        : {}),
    },
  });
}

function seedEditableThread(
  harness: TestAppHarness,
  args: {
    editMessagesExperiment?: boolean;
    firstProviderCheckpoint?: string | null;
    includeSecondTurn?: boolean;
    providerId?: "claude-code" | "codex" | "pi";
  } = {},
) {
  setExperiments(harness.db, {
    ...defaultExperiments,
    editMessages: args.editMessagesExperiment ?? true,
  });
  const { host } = seedHostSession(harness.deps, {
    id: "host-edit-message",
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/tmp/edit-message",
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: "/tmp/edit-message",
    status: "ready",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    providerId: args.providerId ?? "codex",
    status: "idle",
  });
  seedStoredEvent(harness.deps, {
    threadId: thread.id,
    environmentId: environment.id,
    providerThreadId: "provider-original",
    sequence: 1,
    type: "thread/identity",
    scope: threadScope(),
    data: {},
  });
  seedCompletedTurn(harness, {
    providerThreadId: "provider-original",
    requestSequence: 2,
    text: "First message",
    threadId: thread.id,
    turnId: "turn-first",
    ...(args.firstProviderCheckpoint !== null
      ? {
          providerCheckpointId:
            args.firstProviderCheckpoint ?? "checkpoint-first",
        }
      : {}),
  });
  createPromptHistoryEntry(harness.db, {
    input: [{ type: "text", text: "First message", mentions: [] }],
    projectId: project.id,
    requestSequence: 2,
    scope: "project",
    threadId: thread.id,
  });
  if (args.includeSecondTurn !== false) {
    seedCompletedTurn(harness, {
      providerThreadId: "provider-original",
      requestSequence: 7,
      text: "Original last message",
      threadId: thread.id,
      turnId: "turn-last",
      providerCheckpointId: "checkpoint-last",
    });
    createPromptHistoryEntry(harness.db, {
      input: [{ type: "text", text: "Original last message", mentions: [] }],
      projectId: project.id,
      requestSequence: 7,
      scope: "thread",
      threadId: thread.id,
    });
  }
  return { environment, thread };
}

describe("editThreadMessage", () => {
  it("resolves the latest user message when a later turn was agent-initiated", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedEditableThread(harness);
      seedCompletedTurn(harness, {
        initiator: "agent",
        providerCheckpointId: "checkpoint-agent",
        providerThreadId: "provider-original",
        requestSequence: 12,
        senderThreadId: "sender-thread",
        text: "Agent follow-up",
        threadId: thread.id,
        turnId: "turn-agent",
      });

      expect(getLatestThreadMessageEdit(harness.deps, thread)).toMatchObject({
        expectedRequestSequence: 7,
      });
    });
  });

  it("replaces an earlier Codex turn and removes every later conversation turn", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedEditableThread(harness);

      await expect(
        editThreadMessage(harness.deps, {
          environment,
          thread,
          payload: {
            operationId: "edit-op-earlier-turn",
            expectedRequestSequence: 2,
            input: [
              { type: "text", text: "Replacement first message", mentions: [] },
            ],
          },
        }),
      ).resolves.toEqual({
        ok: true,
        operationId: "edit-op-earlier-turn",
        requestSequence: 13,
      });

      expect(
        listQueuedThreadCommands(harness, "thread.rewind.prepare", thread.id),
      ).toHaveLength(0);
      await waitForQueuedCommand(
        harness,
        (queued) =>
          queued.command.type === "thread.start" &&
          queued.command.threadId === thread.id,
      );
      expect(
        listEvents(harness.db, { threadId: thread.id }).map(
          (event) => event.sequence,
        ),
      ).toEqual([1, 12, 13]);
    });
  });

  it("starts a fresh Codex session when editing the first turn", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedEditableThread(harness, {
        includeSecondTurn: false,
      });

      await expect(
        editThreadMessage(harness.deps, {
          environment,
          thread,
          payload: {
            operationId: "edit-op-first-turn",
            expectedRequestSequence: 2,
            input: [
              { type: "text", text: "Replacement first message", mentions: [] },
            ],
          },
        }),
      ).resolves.toEqual({
        ok: true,
        operationId: "edit-op-first-turn",
        requestSequence: 8,
      });

      expect(
        listQueuedThreadCommands(harness, "thread.rewind.prepare", thread.id),
      ).toHaveLength(0);
      await waitForQueuedCommand(
        harness,
        (queued) =>
          queued.command.type === "thread.start" &&
          queued.command.threadId === thread.id,
      );
      expect(
        listQueuedThreadCommands(harness, "thread.start", thread.id),
      ).toEqual([expect.not.objectContaining({ fork: expect.anything() })]);
      expect(
        listEvents(harness.db, { threadId: thread.id }).map(
          (event) => event.sequence,
        ),
      ).toEqual([1, 7, 8]);
      expect(
        listStoredProjectPromptHistoryRows(harness.db, {
          projectId: thread.projectId,
          limit: 10,
        }).map((entry) => entry.requestSequence),
      ).toEqual([8]);
      expect(
        listStoredThreadPromptHistoryRows(harness.db, {
          threadId: thread.id,
          limit: 10,
        }),
      ).toEqual([]);
    });
  });

  it("keeps history intact until the staged Codex rewind succeeds, then replaces the suffix", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedEditableThread(harness);
      expect(getLatestThreadMessageEdit(harness.deps, thread)).toEqual({
        expectedRequestSequence: 7,
        input: [
          {
            type: "text",
            text: "Original last message",
            mentions: [],
          },
        ],
      });

      const payload = {
        operationId: "edit-op-success",
        expectedRequestSequence: 7,
        input: [
          { type: "text" as const, text: "Replacement message", mentions: [] },
        ],
        model: "gpt-5",
        serviceTier: "default" as const,
        reasoningLevel: "medium" as const,
        permissionMode: "full" as const,
      };
      const editPromise = editThreadMessage(harness.deps, {
        environment,
        thread,
        payload,
      });
      const rewind = await waitForQueuedCommand(
        harness,
        (queued) => queued.command.type === "thread.rewind.prepare",
      );
      expect(rewind.command).toMatchObject({
        sourceProviderThreadId: "provider-original",
        retainThroughProviderCheckpoint: "turn-first",
        threadId: thread.id,
      });
      expect(listEvents(harness.db, { threadId: thread.id })).toHaveLength(11);

      if (rewind.command.type !== "thread.rewind.prepare") {
        throw new Error("Expected a thread.rewind.prepare command");
      }
      await reportQueuedCommandSuccess(harness, rewind, {
        providerThreadId: "provider-staged-rewind",
      });
      await expect(editPromise).resolves.toEqual({
        ok: true,
        operationId: "edit-op-success",
        requestSequence: 13,
      });

      const stored = listEvents(harness.db, { threadId: thread.id });
      expect(stored.map((event) => event.sequence)).toEqual([
        1, 2, 3, 4, 5, 6, 12, 13,
      ]);
      const replacement = stored.find((event) => event.sequence === 13);
      expect(replacement).toMatchObject({ type: "client/turn/requested" });
      expect(JSON.parse(replacement?.data ?? "null")).toMatchObject({
        input: [{ type: "text", text: "Replacement message", mentions: [] }],
      });
      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "active",
      });
      await waitForQueuedCommand(
        harness,
        (queued) =>
          queued.command.type === "thread.start" &&
          queued.command.threadId === thread.id,
      );
      expect(
        listQueuedThreadCommands(harness, "thread.start", thread.id),
      ).toEqual([
        expect.objectContaining({
          fork: { sourceProviderThreadId: "provider-staged-rewind" },
          input: [{ type: "text", text: "Replacement message", mentions: [] }],
        }),
      ]);
      await expect(
        editThreadMessage(harness.deps, {
          environment,
          thread,
          payload,
        }),
      ).resolves.toEqual({
        ok: true,
        operationId: "edit-op-success",
        requestSequence: 13,
      });
      expect(
        listQueuedThreadCommands(harness, "thread.start", thread.id),
      ).toHaveLength(1);
      expect(
        listStoredProjectPromptHistoryRows(harness.db, {
          projectId: thread.projectId,
          limit: 10,
        }).map((entry) => entry.requestSequence),
      ).toEqual([2]);
      expect(
        listStoredThreadPromptHistoryRows(harness.db, {
          threadId: thread.id,
          limit: 10,
        }).map((entry) => entry.requestSequence),
      ).toEqual([13]);
    });
  });

  it.each(["claude-code", "pi"] as const)(
    "stages %s history through the preceding provider checkpoint",
    async (providerId) => {
      await withTestHarness(async (harness) => {
        const { environment, thread } = seedEditableThread(harness, {
          providerId,
        });
        const editPromise = editThreadMessage(harness.deps, {
          environment,
          thread,
          payload: {
            operationId: `edit-op-${providerId}`,
            expectedRequestSequence: 7,
            input: [
              { type: "text", text: "Replacement message", mentions: [] },
            ],
          },
        });

        const rewind = await waitForQueuedCommand(
          harness,
          (queued) => queued.command.type === "thread.rewind.prepare",
        );
        expect(rewind.command).toMatchObject({
          providerId,
          retainThroughProviderCheckpoint: "checkpoint-first",
          sourceProviderThreadId: "provider-original",
        });
        if (rewind.command.type !== "thread.rewind.prepare") {
          throw new Error("Expected a thread.rewind.prepare command");
        }
        await reportQueuedCommandSuccess(harness, rewind, {
          providerThreadId: `provider-staged-${providerId}`,
        });
        await expect(editPromise).resolves.toMatchObject({
          ok: true,
          operationId: `edit-op-${providerId}`,
        });
      });
    },
  );

  it.each(["claude-code", "pi"] as const)(
    "rejects a %s rewind through legacy history without a checkpoint",
    async (providerId) => {
      await withTestHarness(async (harness) => {
        const { environment, thread } = seedEditableThread(harness, {
          firstProviderCheckpoint: null,
          providerId,
        });

        await expect(
          editThreadMessage(harness.deps, {
            environment,
            thread,
            payload: {
              operationId: `edit-op-legacy-${providerId}`,
              expectedRequestSequence: 7,
              input: [{ type: "text", text: "Replacement", mentions: [] }],
            },
          }),
        ).rejects.toThrow("no editable history checkpoint");
        expect(
          listQueuedThreadCommands(harness, "thread.rewind.prepare", thread.id),
        ).toHaveLength(0);
      });
    },
  );

  it("leaves the original suffix untouched when Codex cannot stage the rewind", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedEditableThread(harness);
      const editPromise = editThreadMessage(harness.deps, {
        environment,
        thread,
        payload: {
          operationId: "edit-op-failure",
          expectedRequestSequence: 7,
          input: [{ type: "text", text: "Replacement", mentions: [] }],
        },
      });
      const rejectedEdit =
        expect(editPromise).rejects.toThrow("Codex fork failed");
      const rewind = await waitForQueuedCommand(
        harness,
        (queued) => queued.command.type === "thread.rewind.prepare",
      );
      await reportQueuedCommandError(harness, rewind, {
        errorCode: "provider_error",
        errorMessage: "Codex fork failed",
      });

      await rejectedEdit;
      expect(listEvents(harness.db, { threadId: thread.id })).toHaveLength(11);
      expect(getLatestThreadMessageEdit(harness.deps, thread)).toMatchObject({
        expectedRequestSequence: 7,
      });
      expect(
        listQueuedThreadCommands(harness, "thread.start", thread.id),
      ).toHaveLength(0);
    });
  });

  it("rejects reads and mutations while the experiment is disabled", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedEditableThread(harness, {
        editMessagesExperiment: false,
      });

      expect(() => getLatestThreadMessageEdit(harness.deps, thread)).toThrow(
        "Enable the Edit messages experiment",
      );
      await expect(
        editThreadMessage(harness.deps, {
          environment,
          thread,
          payload: {
            operationId: "edit-op-disabled",
            expectedRequestSequence: 7,
            input: [{ type: "text", text: "Replacement", mentions: [] }],
          },
        }),
      ).rejects.toThrow("Enable the Edit messages experiment");
    });
  });
});
