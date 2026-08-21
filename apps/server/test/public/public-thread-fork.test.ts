import { ensurePersonalProject, getThread, listEvents } from "@bb/db";
import {
  PERSONAL_PROJECT_ID,
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnRequestEventDataSchema,
  turnScope,
  type ClientTurnRequestId,
} from "@bb/domain";
import {
  threadResponseSchema,
  threadTimelineResponseSchema,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
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

function seedForkSource(
  harness: TestAppHarness,
  args: {
    model?: string;
    permissionMode?: "accept-edits" | "auto" | "full";
    reasoningLevel?: string;
    serviceTier?: string;
  } = {},
) {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/tmp/public-thread-fork",
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: "/tmp/public-thread-fork",
  });
  const sourceThread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    ...(args.model === undefined ? {} : { model: args.model }),
    permissionMode: args.permissionMode ?? "full",
    providerThreadId: "provider-fork-source",
    ...(args.reasoningLevel === undefined
      ? {}
      : { reasoningLevel: args.reasoningLevel }),
    ...(args.serviceTier === undefined
      ? {}
      : { serviceTier: args.serviceTier }),
    threadId: sourceThread.id,
  });
  seedTurnStarted(harness.deps, {
    environmentId: environment.id,
    providerThreadId: "provider-fork-source",
    sequence: 3,
    threadId: sourceThread.id,
    turnId: "turn-fork-source",
  });
  return { environment, host, project, sourceThread };
}

function seedPersonalDirectoryForkSource(harness: TestAppHarness) {
  const { host } = seedHostSession(harness.deps);
  ensurePersonalProject(harness.db);
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    path: "/tmp/personal-switched-directory",
    projectId: PERSONAL_PROJECT_ID,
    workspaceProvisionType: "unmanaged",
  });
  const sourceThread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: PERSONAL_PROJECT_ID,
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    permissionMode: "full",
    providerThreadId: "provider-personal-directory-source",
    threadId: sourceThread.id,
  });
  seedTurnStarted(harness.deps, {
    environmentId: environment.id,
    providerThreadId: "provider-personal-directory-source",
    sequence: 3,
    threadId: sourceThread.id,
    turnId: "turn-personal-directory-source",
  });
  return { environment, sourceThread };
}

async function postFork(
  harness: TestAppHarness,
  body: Record<string, unknown>,
) {
  return harness.app.request("/api/v1/threads/fork", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("public thread fork route", () => {
  it("reuses a switched directory from a personal-project source", async () => {
    await withTestHarness(async (harness) => {
      const { environment, sourceThread } =
        seedPersonalDirectoryForkSource(harness);

      const response = await postFork(harness, {
        sourceThreadId: sourceThread.id,
        workspace: "reuse",
      });

      expect(response.status).toBe(201);
      const fork = threadResponseSchema.parse(await readJson(response));
      expect(getThread(harness.db, fork.id)?.environmentId).toBe(
        environment.id,
      );
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === fork.id,
      );
      if (queued.command.type !== "thread.start") {
        throw new Error("Expected thread.start");
      }
      expect(queued.command.fork).toEqual({
        sourceProviderThreadId: "provider-personal-directory-source",
      });
    });
  });

  it("uses a personal workspace for an isolated fork after a directory switch", async () => {
    await withTestHarness(async (harness) => {
      const { environment, sourceThread } =
        seedPersonalDirectoryForkSource(harness);

      const response = await postFork(harness, {
        sourceThreadId: sourceThread.id,
        workspace: "isolated",
      });

      expect(response.status).toBe(201);
      const fork = threadResponseSchema.parse(await readJson(response));
      expect(getThread(harness.db, fork.id)?.environmentId).not.toBe(
        environment.id,
      );
      const personalEnvironment = getThread(harness.db, fork.id)?.environmentId;
      expect(personalEnvironment).not.toBeNull();
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.provision" &&
          command.environmentId === personalEnvironment,
      );
      if (queued.command.type !== "environment.provision") {
        throw new Error("Expected personal environment.provision");
      }
      expect(queued.command.workspaceProvisionType).toBe("personal");
      if (queued.command.workspaceProvisionType !== "personal") {
        throw new Error("Expected personal environment.provision");
      }
      await reportQueuedCommandSuccess(harness, queued, {
        path: queued.command.targetPath,
        branchName: "main",
        defaultBranch: "main",
        isGitRepo: false,
        isWorktree: false,
        transcript: [],
      });

      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === fork.id,
      );
      if (start.command.type !== "thread.start") {
        throw new Error("Expected thread.start");
      }
      expect(start.command.fork).toEqual({
        sourceProviderThreadId: "provider-personal-directory-source",
      });
    });
  });

  it("creates an idle fork at the source tip with no first run", async () => {
    await withTestHarness(async (harness) => {
      const { sourceThread } = seedForkSource(harness);

      const response = await postFork(harness, {
        sourceThreadId: sourceThread.id,
        workspace: "reuse",
      });

      expect(response.status).toBe(201);
      const fork = threadResponseSchema.parse(await readJson(response));
      expect(fork).toMatchObject({
        originKind: "fork",
        sourceThreadId: sourceThread.id,
        visibility: "visible",
      });
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === fork.id,
      );
      if (queued.command.type !== "thread.start") {
        throw new Error("Expected thread.start");
      }
      expect(queued.command.input).toEqual([]);
      expect(queued.command.fork).toEqual({
        sourceProviderThreadId: "provider-fork-source",
      });
    });
  });

  it("runs optional input from the requested fork point", async () => {
    await withTestHarness(async (harness) => {
      const { environment, sourceThread } = seedForkSource(harness);
      // The source session was replaced after turn 1: the earlier turn's
      // completion names the session (and checkpoint) the fork must clone.
      seedEvent(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-fork-source",
        sequence: 4,
        threadId: sourceThread.id,
        type: "turn/completed",
        scope: turnScope("turn-fork-source"),
        data: {
          providerThreadId: "provider-fork-source",
          status: "completed",
          providerCheckpointId: "checkpoint-fork-source",
        },
      });
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-later-source",
        sequence: 8,
        threadId: sourceThread.id,
        turnId: "turn-later-source",
      });
      const input = [
        { type: "text" as const, text: "Continue here", mentions: [] },
      ];

      const response = await postFork(harness, {
        sourceThreadId: sourceThread.id,
        sourceSeqEnd: 3,
        input,
        workspace: "reuse",
      });

      expect(response.status).toBe(201);
      const fork = threadResponseSchema.parse(await readJson(response));
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === fork.id,
      );
      if (queued.command.type !== "thread.start") {
        throw new Error("Expected thread.start");
      }
      expect(queued.command.input).toEqual(input);
      expect(queued.command.fork).toEqual({
        sourceProviderThreadId: "provider-fork-source",
        sourceProviderCheckpointId: "checkpoint-fork-source",
      });
    });
  });

  it("persists an agent-only seed while keeping an idle fork input empty", async () => {
    await withTestHarness(async (harness) => {
      const { sourceThread } = seedForkSource(harness);
      const seed = {
        type: "text" as const,
        text: "Replying to the selected earlier message",
        mentions: [],
        visibility: "agent-only" as const,
      };

      const response = await postFork(harness, {
        sourceThreadId: sourceThread.id,
        agentContextSeed: [seed],
        workspace: "reuse",
      });

      expect(response.status).toBe(201);
      const fork = threadResponseSchema.parse(await readJson(response));
      const requested = listEvents(harness.db, { threadId: fork.id }).find(
        (event) => event.type === "client/turn/requested",
      );
      expect(requested).toBeDefined();
      const requestData = turnRequestEventDataSchema.parse(
        JSON.parse(requested?.data ?? "null"),
      );
      expect(requestData).toMatchObject({
        initiator: "agent",
        input: [seed],
        senderThreadId: sourceThread.id,
      });
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === fork.id,
      );
      if (queued.command.type !== "thread.start") {
        throw new Error("Expected thread.start");
      }
      expect(queued.command.input).toEqual([]);
    });
  });

  it("inherits the source thread effective permission mode by default", async () => {
    await withTestHarness(async (harness) => {
      const { sourceThread } = seedForkSource(harness, {
        permissionMode: "accept-edits",
      });

      const response = await postFork(harness, {
        sourceThreadId: sourceThread.id,
        workspace: "reuse",
      });

      expect(response.status).toBe(201);
      const fork = threadResponseSchema.parse(await readJson(response));
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === fork.id,
      );
      if (queued.command.type !== "thread.start") {
        throw new Error("Expected thread.start");
      }
      expect(queued.command.options.permissionMode).toBe("accept-edits");
    });
  });

  it("inherits the source's recorded model, reasoning level, and service tier", async () => {
    await withTestHarness(async (harness) => {
      const { sourceThread } = seedForkSource(harness, {
        model: "gpt-5-mini",
        reasoningLevel: "high",
        serviceTier: "fast",
      });

      const response = await postFork(harness, {
        sourceThreadId: sourceThread.id,
        workspace: "reuse",
      });

      expect(response.status).toBe(201);
      const fork = threadResponseSchema.parse(await readJson(response));
      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === fork.id,
      );
      if (queued.command.type !== "thread.start") {
        throw new Error("Expected thread.start");
      }
      expect(queued.command.options).toMatchObject({
        model: "gpt-5-mini",
        reasoningLevel: "high",
        serviceTier: "fast",
      });
    });
  });

  it("forks a custom ACP provider and uses the returned child session", async () => {
    await withTestHarness(
      {
        customAcpAgents: [
          {
            id: "test-agent",
            displayName: "Test Agent",
            command: "test-agent",
            args: ["acp"],
            env: {},
            supportsManualCompaction: false,
          },
        ],
      },
      async (harness) => {
        const { host } = seedHostSession(harness.deps);
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
        });
        const sourceThread = seedThread(harness.deps, {
          environmentId: environment.id,
          projectId: project.id,
          providerId: "acp-test-agent",
        });
        seedThreadRuntimeState(harness.deps, {
          environmentId: environment.id,
          model: "acp-default",
          providerThreadId: "provider-acp-source",
          threadId: sourceThread.id,
        });
        seedTurnStarted(harness.deps, {
          environmentId: environment.id,
          providerThreadId: "provider-acp-source",
          sequence: 3,
          threadId: sourceThread.id,
          turnId: "turn-acp-source",
        });

        const response = await postFork(harness, {
          sourceThreadId: sourceThread.id,
          workspace: "reuse",
        });

        expect(response.status).toBe(201);
        const fork = threadResponseSchema.parse(await readJson(response));
        const start = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "thread.start" && command.threadId === fork.id,
        );
        if (start.command.type !== "thread.start") {
          throw new Error("Expected thread.start");
        }
        expect(start.command).toMatchObject({
          providerId: "acp-test-agent",
          acpLaunchSpec: {
            command: "test-agent",
            args: ["acp"],
          },
          fork: {
            sourceProviderThreadId: "provider-acp-source",
          },
        });

        await reportQueuedCommandSuccess(harness, start, {
          providerThreadId: "provider-acp-child",
        });
        expect(
          listEvents(harness.db, { threadId: fork.id }).some(
            (event) => event.providerThreadId === "provider-acp-child",
          ),
        ).toBe(true);

        const sendResponse = await harness.app.request(
          `/api/v1/threads/${fork.id}/send`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              input: [{ type: "text", text: "Continue the fork" }],
              mode: "auto",
              permissionMode: "full",
            }),
          },
        );
        expect(sendResponse.status).toBe(200);
        const turn = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "turn.submit" && command.threadId === fork.id,
        );
        expect(turn.command).toMatchObject({
          resumeContext: { providerThreadId: "provider-acp-child" },
        });
      },
    );
  });
});

const HISTORY_PROVIDER_THREAD_ID = "provider-history-source";

function seedHistoryUserRequest(
  harness: TestAppHarness,
  args: {
    environmentId: string;
    requestId: ClientTurnRequestId;
    sequence: number;
    text: string;
    threadId: string;
  },
): void {
  seedEvent(harness.deps, {
    environmentId: args.environmentId,
    sequence: args.sequence,
    threadId: args.threadId,
    type: "client/turn/requested",
    scope: threadScope(),
    data: {
      direction: "outbound",
      requestId: args.requestId,
      input: [{ type: "text", text: args.text }],
      target: { kind: "new-turn" },
      execution: {
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "full",
        source: "client/turn/requested",
      },
      initiator: "user",
      senderThreadId: null,
      request: { method: "turn/start", params: {} },
      source: "tell",
    },
  });
}

/**
 * A source with two completed turns and, by default, a third still running.
 * Turn 1 spans sequences 3–7 with a message queued at 6 that turn 2 accepts;
 * turn 2 spans 8–11; turn 3 is requested at 12, started at 13, and has not
 * completed.
 */
function seedConversationForkSource(
  harness: TestAppHarness,
  args: { providerId?: string; runningThirdTurn?: boolean } = {},
) {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/tmp/public-thread-fork-history",
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: "/tmp/public-thread-fork-history",
  });
  const sourceThread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    ...(args.providerId === undefined ? {} : { providerId: args.providerId }),
  });
  // seq 1: thread/identity, seq 2: client/turn/requested (request id 1)
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    inputText: "Reply only with ok.",
    permissionMode: "full",
    providerThreadId: HISTORY_PROVIDER_THREAD_ID,
    threadId: sourceThread.id,
  });
  const base = {
    environmentId: environment.id,
    providerThreadId: HISTORY_PROVIDER_THREAD_ID,
    threadId: sourceThread.id,
  };
  const firstRequestId = encodeClientTurnRequestIdNumber({ value: 1 });
  const secondRequestId = encodeClientTurnRequestIdNumber({ value: 2 });
  const thirdRequestId = encodeClientTurnRequestIdNumber({ value: 3 });
  seedTurnStarted(harness.deps, { ...base, sequence: 3, turnId: "turn-1" });
  seedEvent(harness.deps, {
    ...base,
    sequence: 4,
    type: "turn/input/accepted",
    scope: turnScope("turn-1"),
    data: {
      providerThreadId: HISTORY_PROVIDER_THREAD_ID,
      clientRequestId: firstRequestId,
    },
  });
  seedEvent(harness.deps, {
    ...base,
    createdAt: 1_000,
    sequence: 5,
    type: "item/completed",
    scope: turnScope("turn-1"),
    data: {
      providerThreadId: HISTORY_PROVIDER_THREAD_ID,
      item: { type: "agentMessage", id: "msg-1", text: "ok" },
    },
  });
  seedHistoryUserRequest(harness, {
    ...base,
    requestId: secondRequestId,
    sequence: 6,
    text: "Reply only with the word second.",
  });
  seedEvent(harness.deps, {
    ...base,
    sequence: 7,
    type: "turn/completed",
    scope: turnScope("turn-1"),
    data: {
      providerThreadId: HISTORY_PROVIDER_THREAD_ID,
      status: "completed",
      providerCheckpointId: "checkpoint-after-turn-1",
    },
  });
  seedTurnStarted(harness.deps, { ...base, sequence: 8, turnId: "turn-2" });
  seedEvent(harness.deps, {
    ...base,
    sequence: 9,
    type: "turn/input/accepted",
    scope: turnScope("turn-2"),
    data: {
      providerThreadId: HISTORY_PROVIDER_THREAD_ID,
      clientRequestId: secondRequestId,
    },
  });
  seedEvent(harness.deps, {
    ...base,
    sequence: 10,
    type: "item/completed",
    scope: turnScope("turn-2"),
    data: {
      providerThreadId: HISTORY_PROVIDER_THREAD_ID,
      item: { type: "agentMessage", id: "msg-2", text: "second" },
    },
  });
  seedEvent(harness.deps, {
    ...base,
    sequence: 11,
    type: "turn/completed",
    scope: turnScope("turn-2"),
    data: {
      providerThreadId: HISTORY_PROVIDER_THREAD_ID,
      status: "completed",
      providerCheckpointId: "checkpoint-after-turn-2",
    },
  });
  if (args.runningThirdTurn === false) {
    return { environment, sourceThread };
  }
  seedHistoryUserRequest(harness, {
    ...base,
    requestId: thirdRequestId,
    sequence: 12,
    text: "Reply only with the word third.",
  });
  seedTurnStarted(harness.deps, { ...base, sequence: 13, turnId: "turn-3" });
  seedEvent(harness.deps, {
    ...base,
    sequence: 14,
    type: "turn/input/accepted",
    scope: turnScope("turn-3"),
    data: {
      providerThreadId: HISTORY_PROVIDER_THREAD_ID,
      clientRequestId: thirdRequestId,
    },
  });
  return { environment, sourceThread };
}

async function readConversationTexts(
  harness: TestAppHarness,
  threadId: string,
): Promise<string[]> {
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/timeline`,
  );
  expect(response.status).toBe(200);
  const timeline = threadTimelineResponseSchema.parse(await readJson(response));
  return timeline.rows.flatMap((row) =>
    row.kind === "conversation" ? [row.text] : [],
  );
}

async function waitForForkStart(harness: TestAppHarness, forkId: string) {
  const queued = await waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "thread.start" && command.threadId === forkId,
  );
  if (queued.command.type !== "thread.start") {
    throw new Error("Expected thread.start");
  }
  return queued.command;
}

describe("fork branch point and inherited history", () => {
  it("clones through the anchor turn's checkpoint and inherits its conversation", async () => {
    await withTestHarness(async (harness) => {
      const { sourceThread } = seedConversationForkSource(harness);

      // Sequence 5 is turn 1's assistant message: the anchor the app's
      // per-message Fork button sends for it.
      const response = await postFork(harness, {
        sourceThreadId: sourceThread.id,
        sourceSeqEnd: 5,
        workspace: "reuse",
      });

      expect(response.status).toBe(201);
      const fork = threadResponseSchema.parse(await readJson(response));
      const start = await waitForForkStart(harness, fork.id);
      expect(start.fork).toEqual({
        sourceProviderThreadId: HISTORY_PROVIDER_THREAD_ID,
        sourceProviderCheckpointId: "checkpoint-after-turn-1",
      });
      expect(await readConversationTexts(harness, fork.id)).toEqual([
        "Reply only with ok.",
        "ok",
      ]);

      const forkEvents = listEvents(harness.db, { threadId: fork.id });
      const inherited = forkEvents.filter((event) => event.sequence <= 5);
      // Inherited rows come first, keep their own timestamps, and never name
      // a provider session the fork does not own. The message the source
      // queued during turn 1 (accepted only by turn 2) stays out.
      expect(inherited.map((event) => event.type)).toEqual([
        "client/turn/requested",
        "turn/started",
        "turn/input/accepted",
        "item/completed",
        "turn/completed",
      ]);
      expect(inherited.every((event) => event.providerThreadId === null)).toBe(
        true,
      );
      expect(inherited[3]?.createdAt).toBe(1_000);
      expect(
        forkEvents.filter((event) => event.type === "thread/identity"),
      ).toHaveLength(0);
      // The fork's own thread-start request follows the inherited history.
      expect(forkEvents.at(5)?.type).toBe("client/turn/requested");
    });
  });

  it("anchors a user message before its own turn", async () => {
    await withTestHarness(async (harness) => {
      const { sourceThread } = seedConversationForkSource(harness);

      // Sequence 6 is the request that became turn 2, so forking at it
      // branches before that message.
      const response = await postFork(harness, {
        sourceThreadId: sourceThread.id,
        sourceSeqEnd: 6,
        workspace: "reuse",
      });

      expect(response.status).toBe(201);
      const fork = threadResponseSchema.parse(await readJson(response));
      const start = await waitForForkStart(harness, fork.id);
      expect(start.fork?.sourceProviderCheckpointId).toBe(
        "checkpoint-after-turn-1",
      );
      expect(await readConversationTexts(harness, fork.id)).toEqual([
        "Reply only with ok.",
        "ok",
      ]);
    });
  });

  it("clones the tip of an idle source and inherits every completed turn", async () => {
    await withTestHarness(async (harness) => {
      const { sourceThread } = seedConversationForkSource(harness, {
        runningThirdTurn: false,
      });

      const response = await postFork(harness, {
        sourceThreadId: sourceThread.id,
        workspace: "reuse",
      });

      expect(response.status).toBe(201);
      const fork = threadResponseSchema.parse(await readJson(response));
      const start = await waitForForkStart(harness, fork.id);
      expect(start.fork).toEqual({
        sourceProviderThreadId: HISTORY_PROVIDER_THREAD_ID,
      });
      expect(await readConversationTexts(harness, fork.id)).toEqual([
        "Reply only with ok.",
        "ok",
        "Reply only with the word second.",
        "second",
      ]);
    });
  });

  it("branches a mid-turn source at its last completed turn's checkpoint", async () => {
    await withTestHarness(async (harness) => {
      const { sourceThread } = seedConversationForkSource(harness);

      // Turn 3 is still running: the session tip already holds its prompt,
      // so a tip clone would know a message the inherited timeline lacks.
      const response = await postFork(harness, {
        sourceThreadId: sourceThread.id,
        workspace: "reuse",
      });

      expect(response.status).toBe(201);
      const fork = threadResponseSchema.parse(await readJson(response));
      const start = await waitForForkStart(harness, fork.id);
      expect(start.fork).toEqual({
        sourceProviderThreadId: HISTORY_PROVIDER_THREAD_ID,
        sourceProviderCheckpointId: "checkpoint-after-turn-2",
      });
      expect(await readConversationTexts(harness, fork.id)).toEqual([
        "Reply only with ok.",
        "ok",
        "Reply only with the word second.",
        "second",
      ]);
      expect(
        listEvents(harness.db, { threadId: fork.id }).some(
          (event) => event.turnId === "turn-3",
        ),
      ).toBe(false);
    });
  });

  it("keeps a hidden fork's timeline free of inherited history", async () => {
    await withTestHarness(async (harness) => {
      const { sourceThread } = seedConversationForkSource(harness);

      // A side chat is a hidden fork rendered next to the source, so it still
      // clones the session through the anchor but starts its own timeline
      // empty.
      const response = await postFork(harness, {
        sourceThreadId: sourceThread.id,
        sourceSeqEnd: 5,
        visibility: "hidden",
        workspace: "reuse",
      });

      expect(response.status).toBe(201);
      const fork = threadResponseSchema.parse(await readJson(response));
      const start = await waitForForkStart(harness, fork.id);
      expect(start.fork).toEqual({
        sourceProviderThreadId: HISTORY_PROVIDER_THREAD_ID,
        sourceProviderCheckpointId: "checkpoint-after-turn-1",
      });
      expect(await readConversationTexts(harness, fork.id)).toEqual([]);
      expect(
        listEvents(harness.db, { threadId: fork.id }).map(
          (event) => event.type,
        ),
      ).not.toContain("item/completed");
    });
  });

  it("rejects an anchor inside a running turn or before the first turn", async () => {
    await withTestHarness(async (harness) => {
      const { sourceThread } = seedConversationForkSource(harness);

      const running = await postFork(harness, {
        sourceThreadId: sourceThread.id,
        sourceSeqEnd: 14,
        workspace: "reuse",
      });
      expect(running.status).toBe(400);
      expect(await readJson(running)).toMatchObject({
        code: "fork_source_session_unavailable",
        message:
          "Cannot fork at sequence 14: the turn containing it has not completed",
      });

      const beforeFirstTurn = await postFork(harness, {
        sourceThreadId: sourceThread.id,
        sourceSeqEnd: 2,
        workspace: "reuse",
      });
      expect(beforeFirstTurn.status).toBe(400);
      expect(await readJson(beforeFirstTurn)).toMatchObject({
        code: "fork_source_session_unavailable",
        message:
          "Cannot fork at sequence 2: no turn has started at or before it",
      });
    });
  });

  const TIP_ONLY_PROVIDER_HARNESS = {
    customAcpAgents: [
      {
        id: "test-agent",
        displayName: "Test Agent",
        command: "test-agent",
        args: ["acp"],
        env: {},
        supportsManualCompaction: false,
      },
    ],
  };

  it("clones the tip of a mid-turn source when the provider cannot branch at a checkpoint", async () => {
    await withTestHarness(TIP_ONLY_PROVIDER_HARNESS, async (harness) => {
      const { sourceThread } = seedConversationForkSource(harness, {
        providerId: "acp-test-agent",
      });

      const response = await postFork(harness, {
        sourceThreadId: sourceThread.id,
        workspace: "reuse",
      });

      expect(response.status).toBe(201);
      const fork = threadResponseSchema.parse(await readJson(response));
      const start = await waitForForkStart(harness, fork.id);
      expect(start.fork).toEqual({
        sourceProviderThreadId: HISTORY_PROVIDER_THREAD_ID,
      });
      expect(await readConversationTexts(harness, fork.id)).toEqual([
        "Reply only with ok.",
        "ok",
        "Reply only with the word second.",
        "second",
      ]);
    });
  });

  it("lets a tip-only provider fork at its latest turn but not earlier", async () => {
    await withTestHarness(TIP_ONLY_PROVIDER_HARNESS, async (harness) => {
      const { sourceThread } = seedConversationForkSource(harness, {
        providerId: "acp-test-agent",
        runningThirdTurn: false,
      });

      const earlier = await postFork(harness, {
        sourceThreadId: sourceThread.id,
        sourceSeqEnd: 5,
        workspace: "reuse",
      });
      expect(earlier.status).toBe(400);
      expect(await readJson(earlier)).toMatchObject({
        code: "fork_source_session_unavailable",
        message:
          "Provider acp-test-agent can only fork at the end of a session, not from an earlier point in it",
      });

      // Sequence 10 sits in turn 2, the source's latest turn: the whole
      // session is exactly the requested history.
      const tip = await postFork(harness, {
        sourceThreadId: sourceThread.id,
        sourceSeqEnd: 10,
        workspace: "reuse",
      });
      expect(tip.status).toBe(201);
      const fork = threadResponseSchema.parse(await readJson(tip));
      const start = await waitForForkStart(harness, fork.id);
      expect(start.fork).toEqual({
        sourceProviderThreadId: HISTORY_PROVIDER_THREAD_ID,
      });
      expect(await readConversationTexts(harness, fork.id)).toEqual([
        "Reply only with ok.",
        "ok",
        "Reply only with the word second.",
        "second",
      ]);
    });
  });
});
