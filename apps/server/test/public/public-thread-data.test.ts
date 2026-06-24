import { and, eq } from "drizzle-orm";
import {
  archiveThread,
  claimQueuedThreadMessage,
  createPromptHistoryEntry,
  createQueuedThreadMessageId,
  deleteQueuedThreadMessage,
  deleteHost,
  environments,
  events,
  getQueuedThreadMessage,
  listQueuedThreadMessages,
  getThread,
  queuedThreadMessages,
  setThreadExecutionOverride,
  upsertProjectExecutionDefaults,
} from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  threadQueuedMessageSchema,
  threadScope,
  threadSchema,
  turnScope,
} from "@bb/domain";
import {
  type TimelineRow,
  threadComposerBootstrapResponseSchema,
  threadQueuedMessageListResponseSchema,
  threadTimelineResponseSchema,
  threadWithIncludesResponseSchema,
  timelineTurnSummaryDetailsResponseSchema,
  uploadedPromptAttachmentSchema,
} from "@bb/server-contract";
import { renderTemplate } from "@bb/templates";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { registerProviderHostRpcResponder } from "../helpers/host-rpc.js";
import {
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedHost,
  seedQueuedMessage,
  seedEnvironment,
  seedEvent,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
  seedStoredEvent,
  seedThread,
  seedThreadFixture,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const queuedMessageIdResponseSchema = z.object({
  id: z.string(),
});

const threadReadResponseSchema = z.object({
  lastReadAt: z.number().nullable(),
});

const threadEventWaitResponseSchema = z.object({
  seq: z.number(),
  type: z.string(),
});

const clientTurnRequestedDataSchema = z.object({
  initiator: z.string(),
  input: z.array(z.object({ text: z.string(), type: z.literal("text") })),
  senderThreadId: z.string().nullable(),
});

type TimelineTurnRow = Extract<TimelineRow, { kind: "turn" }>;

describe("public thread data routes", () => {
  it("rejects contradictory folder and unfiled thread list filters", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        "/api/v1/threads?folderId=fld_work&unfiled=true",
      );

      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
        message: "folderId and unfiled cannot be used together",
      });
    });
  });

  it("embeds thread environment and host snapshots when requested", async () => {
    await withTestHarness(async (harness) => {
      const { host, environment, thread } = seedThreadFixture(harness, {
        session: {
          id: "host-thread-include",
        },
      });

      const leanResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}`,
      );
      expect(leanResponse.status).toBe(200);
      const leanThread = await readJson(leanResponse);
      expect(leanThread).not.toHaveProperty("environment");
      expect(leanThread).not.toHaveProperty("host");

      const includeResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}?include=environment,host`,
      );
      expect(includeResponse.status).toBe(200);
      const includedThread = threadWithIncludesResponseSchema.parse(
        await readJson(includeResponse),
      );

      expect(includedThread.environment?.id).toBe(environment.id);
      expect(includedThread.host?.id).toBe(host.id);
      expect(includedThread.host?.status).toBe("connected");
    });
  });

  it("returns null thread includes when relations are absent or unresolved", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-null-include",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const threadWithoutEnvironment = seedThread(harness.deps, {
        environmentId: null,
        projectId: project.id,
      });
      const threadWithMissingHost = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      deleteHost(harness.deps.db, harness.deps.hub, host.id);

      const noEnvironmentResponse = await harness.app.request(
        `/api/v1/threads/${threadWithoutEnvironment.id}?include=environment,host`,
      );
      expect(noEnvironmentResponse.status).toBe(200);
      const noEnvironmentThread = threadWithIncludesResponseSchema.parse(
        await readJson(noEnvironmentResponse),
      );
      expect(noEnvironmentThread.environment).toBeNull();
      expect(noEnvironmentThread.host).toBeNull();

      const missingHostResponse = await harness.app.request(
        `/api/v1/threads/${threadWithMissingHost.id}?include=host`,
      );
      expect(missingHostResponse.status).toBe(200);
      const missingHostThread = threadWithIncludesResponseSchema.parse(
        await readJson(missingHostResponse),
      );
      expect(missingHostThread).not.toHaveProperty("environment");
      expect(missingHostThread.host).toBeNull();
    });
  });

  it("rejects invalid thread include values", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}?include=environment,timeline`,
      );
      expect(response.status).toBe(400);
    });
  });

  it("returns timeline rows from thread events", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);

      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "system/manager/user_message",
        scope: threadScope(),
        data: { text: "Legacy note one" },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 2,
        type: "system/manager/user_message",
        scope: threadScope(),
        data: { text: "Legacy note two" },
      });

      const timelineResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline`,
      );
      expect(timelineResponse.status).toBe(200);
      await expect(readJson(timelineResponse)).resolves.toEqual(
        expect.objectContaining({
          rows: expect.arrayContaining([
            expect.objectContaining({
              kind: "conversation",
            }),
          ]),
        }),
      );
    });
  });

  it("uses uploaded project attachments for localFile prompt input and timeline metadata", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-uploaded-local-file",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/uploaded-local-file-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/uploaded-local-file-project",
      });
      const formData = new FormData();
      formData.set(
        "file",
        new File(["alpha\n"], "alpha.txt", { type: "text/plain" }),
      );

      const uploadResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/attachments`,
        {
          method: "POST",
          body: formData,
        },
      );
      expect(uploadResponse.status).toBe(201);
      const uploaded = uploadedPromptAttachmentSchema.parse(
        await readJson(uploadResponse),
      );
      if (uploaded.type !== "localFile") {
        throw new Error("Expected text upload to produce localFile attachment");
      }

      const promptText = "Review @alpha.txt";
      const mentionText = "@alpha.txt";
      const mentionStart = promptText.indexOf(mentionText);
      const mentionEnd = mentionStart + mentionText.length;
      const mention = {
        start: mentionStart,
        end: mentionEnd,
        resource: {
          kind: "path",
          source: "workspace",
          entryKind: "file",
          path: "alpha.txt",
          label: "alpha.txt",
        },
      };
      const attachmentInput = {
        type: "localFile",
        path: uploaded.path,
        name: uploaded.name,
        sizeBytes: uploaded.sizeBytes,
        ...(uploaded.mimeType ? { mimeType: uploaded.mimeType } : {}),
      };

      const createThreadResponse = await harness.app.request(
        "/api/v1/threads",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            origin: "app",
            projectId: project.id,
            providerId: "codex",
            model: "gpt-5",
            input: [
              { type: "text", text: promptText, mentions: [mention] },
              attachmentInput,
            ],
            environment: {
              type: "reuse",
              environmentId: environment.id,
            },
          }),
        },
      );

      expect(createThreadResponse.status).toBe(201);
      const createdThread = threadSchema.parse(
        await readJson(createThreadResponse),
      );
      const queuedStart = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" &&
          command.threadId === createdThread.id,
      );
      if (queuedStart.command.type !== "thread.start") {
        throw new Error("Expected queued thread.start command");
      }
      expect(queuedStart.command.input).toEqual([
        { type: "text", text: promptText, mentions: [mention] },
        attachmentInput,
      ]);

      const timelineResponse = await harness.app.request(
        `/api/v1/threads/${createdThread.id}/timeline`,
      );
      expect(timelineResponse.status).toBe(200);
      const timeline = threadTimelineResponseSchema.parse(
        await readJson(timelineResponse),
      );
      const userRow = timeline.rows.find(
        (row) => row.kind === "conversation" && row.role === "user",
      );
      if (
        !userRow ||
        userRow.kind !== "conversation" ||
        userRow.role !== "user"
      ) {
        throw new Error("Expected user conversation timeline row");
      }
      expect(userRow.text).toBe(promptText);
      expect(userRow.mentions).toEqual([mention]);
      expect(userRow.attachments).toEqual({
        webImages: 0,
        localImages: 0,
        localFiles: 1,
        imageUrls: [],
        localImagePaths: [],
        localFilePaths: [uploaded.path],
      });
    });
  });

  it("rejects bare relative localFile prompt paths that were not uploaded", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-missing-local-file-token",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/missing-local-file-token-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/missing-local-file-token-project",
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          model: "gpt-5",
          input: [
            { type: "text", text: "Review @alpha.txt", mentions: [] },
            { type: "localFile", path: "alpha.txt" },
          ],
          environment: {
            type: "reuse",
            environmentId: environment.id,
          },
        }),
      });

      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
        message: expect.stringContaining(
          "relative workspace file paths are not valid attachment references",
        ),
      });
      expect(
        harness.db
          .select({ id: events.id })
          .from(events)
          .where(eq(events.type, "client/turn/requested"))
          .all(),
      ).toHaveLength(0);
    });
  });

  it("hydrates timeline turn-summary details from the summary row identity and range", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);

      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("turn-1"),
        sequence: 1,
        type: "turn/started",
        data: {},
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("turn-1"),
        sequence: 2,
        type: "item/completed",
        data: {
          item: {
            type: "toolCall",
            id: "tool-1",
            tool: "exec_command",
            arguments: { cmd: "pnpm test" },
            status: "completed",
          },
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("turn-1"),
        sequence: 3,
        type: "item/completed",
        data: {
          item: {
            type: "agentMessage",
            id: "assistant-1",
            text: "Done.",
          },
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("turn-1"),
        sequence: 4,
        type: "turn/completed",
        data: {
          status: "completed",
        },
      });

      const timelineResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline`,
      );
      expect(timelineResponse.status).toBe(200);
      const timeline = threadTimelineResponseSchema.parse(
        await readJson(timelineResponse),
      );
      const turnRow = timeline.rows.find(
        (row): row is TimelineTurnRow => row.kind === "turn",
      );
      expect(turnRow).toBeDefined();
      if (!turnRow) {
        throw new Error("Expected a turn row");
      }
      expect(turnRow.children).toBeNull();

      const toolDetailsResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline/turn-summary-details?turnId=${turnRow.turnId}&sourceSeqStart=${turnRow.sourceSeqStart}&sourceSeqEnd=${turnRow.sourceSeqEnd}`,
      );
      expect(toolDetailsResponse.status).toBe(200);
      const toolDetails = timelineTurnSummaryDetailsResponseSchema.parse(
        await readJson(toolDetailsResponse),
      );

      expect(toolDetails.rows.map((row) => row.kind)).toEqual(["work"]);
      expect(toolDetails.rows[0]?.kind).toBe("work");
      const detailRow = toolDetails.rows[0];
      if (detailRow?.kind === "work" && detailRow.workKind === "tool") {
        expect(detailRow.workKind).toBe("tool");
        expect(detailRow.callId).toBe("tool-1");
      }
    });
  });

  it("hydrates turn-summary workflow details with late background task completion", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const taskData = (
        status: "pending" | "completed",
        taskStatus: "running" | "completed",
      ) => ({
        item: {
          type: "backgroundTask" as const,
          id: "task:wf-1",
          taskType: "local_workflow",
          description: "fixture workflow",
          status,
          taskStatus,
          skipTranscript: false,
          workflowName: "fixture-mini",
          ...(status === "completed" ? { summary: "done" } : {}),
        },
      });

      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("turn-1"),
        sequence: 1,
        type: "turn/started",
        data: {},
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("turn-1"),
        sequence: 2,
        type: "item/started",
        data: taskData("pending", "running"),
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("turn-1"),
        sequence: 3,
        type: "item/completed",
        data: {
          item: {
            type: "agentMessage",
            id: "assistant-1",
            text: "Workflow launched.",
          },
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("turn-1"),
        sequence: 4,
        type: "turn/completed",
        data: {
          status: "completed",
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: threadScope(),
        sequence: 5,
        type: "item/backgroundTask/completed",
        data: taskData("completed", "completed"),
      });

      const timelineResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline`,
      );
      expect(timelineResponse.status).toBe(200);
      const timeline = threadTimelineResponseSchema.parse(
        await readJson(timelineResponse),
      );
      const turnRow = timeline.rows.find(
        (row): row is TimelineTurnRow => row.kind === "turn",
      );
      expect(turnRow).toBeDefined();
      if (!turnRow) {
        throw new Error("Expected a turn row");
      }

      const detailsResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline/turn-summary-details?turnId=${turnRow.turnId}&sourceSeqStart=${turnRow.sourceSeqStart}&sourceSeqEnd=${turnRow.sourceSeqEnd}`,
      );
      expect(detailsResponse.status).toBe(200);
      const details = timelineTurnSummaryDetailsResponseSchema.parse(
        await readJson(detailsResponse),
      );
      const workflowRow = details.rows.find(
        (row) =>
          row.kind === "work" &&
          row.workKind === "workflow" &&
          row.itemId === "task:wf-1",
      );
      expect(workflowRow).toBeDefined();
      if (
        !workflowRow ||
        workflowRow.kind !== "work" ||
        workflowRow.workKind !== "workflow"
      ) {
        throw new Error("Expected a workflow detail row");
      }

      expect(workflowRow.status).toBe("completed");
      expect(workflowRow.taskStatus).toBe("completed");
      expect(workflowRow.summary).toBe("done");
      expect(workflowRow.completedAt).not.toBeNull();
    });
  });

  it("returns active background task state when the task started outside the latest window", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      const requestData = (requestId: number, text: string) => ({
        direction: "outbound" as const,
        requestId: encodeClientTurnRequestIdNumber({ value: requestId }),
        input: [{ type: "text" as const, text }],
        target: { kind: "new-turn" as const },
        execution: {
          model: "gpt-5",
          reasoningLevel: "medium",
          permissionMode: "full" as const,
          serviceTier: "default",
          source: "client/turn/requested" as const,
        },
        initiator: "user" as const,
        senderThreadId: null,
        request: {
          method: "turn/start" as const,
          params: {},
        },
        source: "tell" as const,
      });
      const taskData = (args: {
        itemId: string;
        taskType: string;
        description: string;
      }) => ({
        item: {
          type: "backgroundTask" as const,
          id: args.itemId,
          taskType: args.taskType,
          description: args.description,
          status: "pending" as const,
          taskStatus: "running" as const,
          skipTranscript: false,
          ...(args.taskType === "local_workflow"
            ? { workflowName: "fixture-mini" }
            : {}),
        },
      });
      const providerThreadId = "provider-thread-1";
      const seedClientRequest = (
        sequence: number,
        requestId: number,
        text: string,
      ) => {
        seedEvent(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          sequence,
          type: "client/turn/requested",
          scope: threadScope(),
          data: requestData(requestId, text),
        });
      };
      const seedCompletedMessageTurn = (args: {
        requestId: number;
        requestSequence: number;
        text: string;
        turnId: string;
      }) => {
        seedClientRequest(args.requestSequence, args.requestId, args.text);
        seedEvent(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          providerThreadId,
          sequence: args.requestSequence + 1,
          type: "turn/started",
          scope: turnScope(args.turnId),
          data: {},
        });
        seedEvent(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          providerThreadId,
          sequence: args.requestSequence + 2,
          type: "item/completed",
          scope: turnScope(args.turnId),
          data: {
            item: {
              type: "agentMessage",
              id: `${args.turnId}-assistant`,
              text: `${args.text} done.`,
            },
          },
        });
        seedEvent(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          providerThreadId,
          sequence: args.requestSequence + 3,
          type: "turn/completed",
          scope: turnScope(args.turnId),
          data: { status: "completed" },
        });
      };
      const activeTasks = [
        {
          itemId: "task:wf-open",
          taskType: "local_workflow",
          description: "fixture workflow",
        },
        {
          itemId: "task:cmd-open",
          taskType: "local_bash",
          description: "sleep 30",
        },
      ] as const;

      seedClientRequest(1, 101, "Start background work");
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId,
        sequence: 2,
        type: "turn/started",
        scope: turnScope("turn-1"),
        data: {},
      });
      for (const [index, task] of activeTasks.entries()) {
        seedEvent(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          providerThreadId,
          sequence: 3 + index,
          type: "item/started",
          scope: turnScope("turn-1"),
          data: taskData(task),
        });
        seedEvent(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          providerThreadId,
          sequence: 5 + index,
          type: "item/backgroundTask/progress",
          scope: threadScope(),
          data: taskData(task),
        });
      }
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId,
        sequence: 7,
        type: "turn/completed",
        scope: turnScope("turn-1"),
        data: { status: "completed" },
      });
      seedCompletedMessageTurn({
        requestId: 202,
        requestSequence: 10,
        text: "Middle turn",
        turnId: "turn-2",
      });
      seedCompletedMessageTurn({
        requestId: 303,
        requestSequence: 20,
        text: "Latest turn",
        turnId: "turn-3",
      });

      const timelineResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline?segmentLimit=1`,
      );
      expect(timelineResponse.status).toBe(200);
      const timeline = threadTimelineResponseSchema.parse(
        await readJson(timelineResponse),
      );

      expect(timeline.activeWorkflow).toMatchObject({
        itemId: "task:wf-open",
        status: "pending",
        taskStatus: "running",
      });
      expect(timeline.activeBackgroundCommands).toHaveLength(1);
      expect(timeline.activeBackgroundCommands[0]).toMatchObject({
        itemId: "task:cmd-open",
        status: "pending",
        taskStatus: "running",
      });
    });
  });

  it("hydrates turn-summary details when the range overlaps another turn", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);

      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("parent-turn"),
        sequence: 1,
        type: "turn/started",
        data: {},
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("child-turn"),
        sequence: 2,
        type: "turn/started",
        data: {},
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("child-turn"),
        sequence: 3,
        type: "item/completed",
        data: {
          item: {
            type: "toolCall",
            id: "child-tool",
            tool: "exec_command",
            arguments: { cmd: "pnpm test" },
            status: "completed",
          },
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("parent-turn"),
        sequence: 4,
        type: "item/completed",
        data: {
          item: {
            type: "agentMessage",
            id: "parent-message",
            text: "Parent is still working.",
          },
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("child-turn"),
        sequence: 5,
        type: "item/completed",
        data: {
          item: {
            type: "agentMessage",
            id: "child-message",
            text: "Child done.",
          },
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("child-turn"),
        sequence: 6,
        type: "turn/completed",
        data: {
          status: "completed",
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("parent-turn"),
        sequence: 7,
        type: "turn/completed",
        data: {
          status: "completed",
        },
      });

      const timelineResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline`,
      );
      expect(timelineResponse.status).toBe(200);
      const timeline = threadTimelineResponseSchema.parse(
        await readJson(timelineResponse),
      );
      const childTurnRow = timeline.rows.find(
        (row): row is TimelineTurnRow =>
          row.kind === "turn" && row.turnId === "child-turn",
      );
      expect(childTurnRow).toBeDefined();
      if (!childTurnRow) {
        throw new Error("Expected child turn row");
      }

      const detailsResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline/turn-summary-details?turnId=${childTurnRow.turnId}&sourceSeqStart=${childTurnRow.sourceSeqStart}&sourceSeqEnd=${childTurnRow.sourceSeqEnd}`,
      );
      expect(detailsResponse.status).toBe(200);
      const details = timelineTurnSummaryDetailsResponseSchema.parse(
        await readJson(detailsResponse),
      );

      expect(details.rows.map((row) => row.kind)).toEqual(["work"]);
      expect(details.rows[0]?.kind).toBe("work");
      const detailRow = details.rows[0];
      if (detailRow?.kind === "work" && detailRow.workKind === "tool") {
        expect(detailRow.callId).toBe("child-tool");
      } else {
        throw new Error("Expected child tool detail row");
      }
    });
  });

  it("hydrates turn-summary details with future accepted input context", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);

      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        data: {
          direction: "outbound",
          requestId: encodeClientTurnRequestIdNumber({ value: 101 }),
          input: [{ type: "text", text: "Requested turn prompt" }],
          target: { kind: "new-turn" },
          execution: {
            model: "gpt-4o-mini",
            reasoningLevel: "medium",
            permissionMode: "full",
            serviceTier: "fast",
            source: "client/turn/requested",
          },
          initiator: "user",
          senderThreadId: null,
          request: {
            method: "turn/start",
            params: {},
          },
          source: "tell",
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("requested-turn"),
        sequence: 2,
        type: "turn/started",
        data: {},
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("requested-turn"),
        sequence: 3,
        type: "item/completed",
        data: {
          item: {
            type: "toolCall",
            id: "requested-tool",
            tool: "exec_command",
            arguments: { cmd: "pnpm test" },
            status: "completed",
          },
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 4,
        type: "client/turn/requested",
        scope: threadScope(),
        data: {
          direction: "outbound",
          requestId: encodeClientTurnRequestIdNumber({ value: 202 }),
          input: [{ type: "text", text: "Other turn prompt" }],
          target: { kind: "new-turn" },
          execution: {
            model: "gpt-4o-mini",
            reasoningLevel: "medium",
            permissionMode: "full",
            serviceTier: "fast",
            source: "client/turn/requested",
          },
          initiator: "user",
          senderThreadId: null,
          request: {
            method: "turn/start",
            params: {},
          },
          source: "tell",
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("requested-turn"),
        sequence: 5,
        type: "item/completed",
        data: {
          item: {
            type: "agentMessage",
            id: "requested-message",
            text: "Requested turn done.",
          },
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("requested-turn"),
        sequence: 6,
        type: "turn/input/accepted",
        data: {
          clientRequestId: encodeClientTurnRequestIdNumber({ value: 101 }),
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("other-turn"),
        sequence: 7,
        type: "turn/input/accepted",
        data: {
          clientRequestId: encodeClientTurnRequestIdNumber({ value: 202 }),
        },
      });

      const detailsResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline/turn-summary-details?turnId=requested-turn&sourceSeqStart=1&sourceSeqEnd=5`,
      );
      expect(detailsResponse.status).toBe(200);
      const details = timelineTurnSummaryDetailsResponseSchema.parse(
        await readJson(detailsResponse),
      );

      const detailText = JSON.stringify(details.rows);
      expect(detailText).toContain("Requested turn prompt");
      expect(detailText).toContain("requested-tool");
      expect(detailText).not.toContain("Other turn prompt");
    });
  });

  it("hydrates a single-event turn-summary detail range", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);

      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("turn-1"),
        sequence: 1,
        type: "turn/started",
        data: {},
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("turn-1"),
        sequence: 2,
        type: "item/completed",
        data: {
          item: {
            type: "agentMessage",
            id: "assistant-1",
            text: "Single detail.",
          },
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("turn-1"),
        sequence: 3,
        type: "turn/completed",
        data: {
          status: "completed",
        },
      });

      const detailsResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline/turn-summary-details?turnId=turn-1&sourceSeqStart=2&sourceSeqEnd=2`,
      );
      expect(detailsResponse.status).toBe(200);
      const details = timelineTurnSummaryDetailsResponseSchema.parse(
        await readJson(detailsResponse),
      );

      expect(details.rows).toHaveLength(1);
      expect(details.rows[0]?.kind).toBe("conversation");
      if (details.rows[0]?.kind === "conversation") {
        expect(details.rows[0].role).toBe("assistant");
        expect(details.rows[0].text).toBe("Single detail.");
        expect(details.rows[0].sourceSeqStart).toBe(2);
        expect(details.rows[0].sourceSeqEnd).toBe(2);
      }
    });
  });

  it("rejects invalid thread data query params with a 400", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/timeline/turn-summary-details?turnId=turn-1&sourceSeqStart=oops&sourceSeqEnd=2`,
      );
      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
    });
  });

  it("returns thread output and default execution options from stored events", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);

      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        data: {
          direction: "outbound",
          requestId: encodeClientTurnRequestIdNumber({ value: 101 }),
          input: [{ type: "text", text: "Explain the result" }],
          target: { kind: "new-turn" },
          execution: {
            model: "gpt-4o-mini",
            reasoningLevel: "medium",
            permissionMode: "full",
            serviceTier: "fast",
            source: "client/turn/requested",
          },
          initiator: "user",
          senderThreadId: null,
          request: {
            method: "turn/start",
            params: {},
          },
          source: "tell",
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-output",
        scope: turnScope("turn-1"),
        sequence: 2,
        type: "item/completed",
        data: {
          item: {
            type: "agentMessage",
            id: "msg-1",
            text: "First assistant reply",
          },
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-output",
        scope: turnScope("turn-2"),
        sequence: 3,
        type: "item/completed",
        data: {
          item: {
            type: "agentMessage",
            id: "msg-2",
            text: "Last assistant reply",
          },
        },
      });

      const outputResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/output`,
      );
      expect(outputResponse.status).toBe(200);
      await expect(readJson(outputResponse)).resolves.toEqual({
        output: "Last assistant reply",
      });

      const defaultsResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/default-execution-options`,
      );
      expect(defaultsResponse.status).toBe(200);
      await expect(readJson(defaultsResponse)).resolves.toEqual({
        model: "gpt-4o-mini",
        reasoningLevel: "medium",
        permissionMode: "full",
        serviceTier: "fast",
        source: "client/turn/requested",
      });
    });
  });

  it("returns a user-visible system output when a later assistant item is empty", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);

      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-output",
        scope: turnScope("turn-1"),
        sequence: 1,
        type: "system/manager/user_message",
        data: {
          text: "Visible system update",
          toolCallId: "call-1",
          turnId: "turn-1",
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-output",
        scope: turnScope("turn-1"),
        sequence: 2,
        type: "item/completed",
        data: {
          item: {
            type: "agentMessage",
            id: "msg-1",
            text: "",
          },
        },
      });

      const outputResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/output`,
      );
      expect(outputResponse.status).toBe(200);
      await expect(readJson(outputResponse)).resolves.toEqual({
        output: "Visible system update",
      });
    });
  });

  it("skips malformed item/completed events and returns the last valid output", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);

      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-output",
        scope: turnScope("turn-1"),
        sequence: 1,
        type: "item/completed",
        data: {
          item: {
            type: "agentMessage",
            id: "msg-1",
            text: "Earlier assistant reply",
          },
        },
      });
      // Malformed: missing item.type, so the derived item_kind column is null.
      // The row is filtered out at the DB level instead of turning into a 500.
      seedStoredEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-output",
        scope: turnScope("turn-2"),
        itemId: "msg-2",
        itemKind: null,
        sequence: 2,
        type: "item/completed",
        data: {
          item: {
            id: "msg-2",
          },
        },
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/output`,
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        output: "Earlier assistant reply",
      });
    });
  });

  it("returns the latest stored execution options from request events", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);

      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        data: {
          direction: "outbound",
          requestId: encodeClientTurnRequestIdNumber({ value: 201 }),
          input: [{ type: "text", text: "Initial request" }],
          target: { kind: "thread-start" },
          execution: {
            model: "gpt-5",
            reasoningLevel: "medium",
            permissionMode: "full",
            serviceTier: "default",
            source: "client/turn/requested",
          },
          initiator: "user",
          senderThreadId: null,
          request: {
            method: "thread/start",
            params: {},
          },
          source: "spawn",
        },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 2,
        type: "client/turn/requested",
        scope: threadScope(),
        data: {
          direction: "outbound",
          requestId: encodeClientTurnRequestIdNumber({ value: 202 }),
          input: [{ type: "text", text: "Follow up request" }],
          target: { kind: "new-turn" },
          execution: {
            model: "gpt-5-mini",
            reasoningLevel: "high",
            permissionMode: "workspace-write",
            serviceTier: "fast",
            source: "client/turn/requested",
          },
          initiator: "user",
          senderThreadId: null,
          request: {
            method: "turn/start",
            params: {},
          },
          source: "tell",
        },
      });

      const defaultsResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/default-execution-options`,
      );
      expect(defaultsResponse.status).toBe(200);
      await expect(readJson(defaultsResponse)).resolves.toEqual({
        model: "gpt-5-mini",
        reasoningLevel: "high",
        permissionMode: "workspace-write",
        serviceTier: "fast",
        source: "client/turn/requested",
      });
    });
  });

  it("returns sticky execution overrides in thread default execution options", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness, {
        thread: { providerId: "claude-code" },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        data: {
          direction: "outbound",
          requestId: encodeClientTurnRequestIdNumber({ value: 203 }),
          input: [{ type: "text", text: "Initial request" }],
          target: { kind: "new-turn" },
          execution: {
            model: "claude-sonnet-4-6",
            reasoningLevel: "medium",
            permissionMode: "full",
            serviceTier: "default",
            source: "client/turn/requested",
          },
          initiator: "user",
          senderThreadId: null,
          request: {
            method: "turn/start",
            params: {},
          },
          source: "tell",
        },
      });
      setThreadExecutionOverride(harness.db, {
        threadId: thread.id,
        modelOverride: "claude-opus-4-8",
        reasoningLevelOverride: "high",
      });

      const defaultsResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/default-execution-options`,
      );

      expect(defaultsResponse.status).toBe(200);
      await expect(readJson(defaultsResponse)).resolves.toEqual({
        model: "claude-opus-4-8",
        reasoningLevel: "high",
        permissionMode: "full",
        serviceTier: "default",
        source: "client/turn/requested",
      });
    });
  });

  it("returns null default execution options for stale stored provider capabilities", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness, {
        thread: { providerId: "pi" },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        data: {
          direction: "outbound",
          requestId: encodeClientTurnRequestIdNumber({ value: 204 }),
          input: [{ type: "text", text: "Prior request" }],
          target: { kind: "new-turn" },
          execution: {
            model: "openai/codex-mini",
            reasoningLevel: "medium",
            permissionMode: "workspace-write",
            serviceTier: "default",
            source: "client/turn/requested",
          },
          initiator: "user",
          senderThreadId: null,
          request: {
            method: "turn/start",
            params: {},
          },
          source: "tell",
        },
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/default-execution-options`,
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toBeNull();
    });
  });

  it("fails loudly when the latest stored request event is malformed", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);

      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        data: {
          direction: "outbound",
          requestId: encodeClientTurnRequestIdNumber({ value: 301 }),
          input: [{ type: "text", text: "Earlier valid request" }],
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
          request: {
            method: "turn/start",
            params: {},
          },
          source: "tell",
        },
      });
      seedStoredEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        itemId: null,
        itemKind: null,
        sequence: 2,
        type: "client/turn/requested",
        scope: threadScope(),
        data: {
          direction: "outbound",
          requestId: encodeClientTurnRequestIdNumber({ value: 302 }),
          input: [{ type: "text", text: "Malformed latest request" }],
          initiator: "user",
          senderThreadId: null,
          request: {
            method: "turn/start",
            params: {},
          },
          source: "tell",
        },
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/default-execution-options`,
      );

      expect(response.status).toBe(500);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "internal_error",
        message: expect.stringContaining(`thread ${thread.id}`),
      });
    });
  });

  it("marks threads as read and unread", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);

      const readResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/read`,
        {
          method: "POST",
        },
      );
      expect(readResponse.status).toBe(200);
      const readThread = threadReadResponseSchema.parse(
        await readJson(readResponse),
      );
      expect(readThread.lastReadAt).toBeTypeOf("number");
      const threadAfterRead = getThread(harness.db, thread.id);
      expect(threadAfterRead?.lastReadAt).toBeTypeOf("number");
      expect(threadAfterRead?.latestAttentionAt).toBe(thread.latestAttentionAt);

      const unreadResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/unread`,
        {
          method: "POST",
        },
      );
      expect(unreadResponse.status).toBe(200);
      await expect(readJson(unreadResponse)).resolves.toMatchObject({
        lastReadAt: null,
      });
      const threadAfterUnread = getThread(harness.db, thread.id);
      expect(threadAfterUnread?.lastReadAt).toBeNull();
      expect(threadAfterUnread?.latestAttentionAt).toBe(
        thread.latestAttentionAt,
      );
    });
  });

  it("creates and deletes thread queued messages", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        data: {
          direction: "outbound",
          requestId: encodeClientTurnRequestIdNumber({ value: 401 }),
          input: [{ type: "text", text: "Earlier work" }],
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
          request: {
            method: "turn/start",
            params: {},
          },
          source: "tell",
        },
      });

      const createResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            input: [{ type: "text", text: "Queued message from test" }],
            reasoningLevel: "high",
            permissionMode: "full",
          }),
        },
      );
      expect(createResponse.status).toBe(201);
      const queuedMessage = queuedMessageIdResponseSchema.parse(
        await readJson(createResponse),
      );
      expect(
        getQueuedThreadMessage(harness.db, queuedMessage.id),
      ).toMatchObject({
        id: queuedMessage.id,
      });

      const deleteResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages/${queuedMessage.id}`,
        {
          method: "DELETE",
        },
      );
      expect(deleteResponse.status).toBe(200);
      await expect(readJson(deleteResponse)).resolves.toEqual({ ok: true });
      expect(getQueuedThreadMessage(harness.db, queuedMessage.id)).toBeNull();
    });
  });

  it("queues public send requests with sender context while the target thread is active", async () => {
    await withTestHarness(async (harness) => {
      const { project, thread } = seedThreadFixture(harness, {
        thread: {
          status: "active",
        },
      });
      const senderThread = seedThread(harness.deps, {
        projectId: project.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            input: [{ type: "text", text: "Queued active follow-up" }],
            mode: "queue-if-active",
            model: "gpt-5",
            permissionMode: "full",
            reasoningLevel: "medium",
            serviceTier: "default",
            senderThreadId: senderThread.id,
          }),
        },
      );

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({ ok: true });
      const queuedRows = listQueuedThreadMessages(harness.db, thread.id);
      expect(queuedRows).toMatchObject([
        {
          senderThreadId: senderThread.id,
          threadId: thread.id,
        },
      ]);
      expect(JSON.parse(queuedRows[0]?.content ?? "null")).toEqual([
        { type: "text", text: "Queued active follow-up", mentions: [] },
      ]);
      expect(
        harness.db
          .select({ id: events.id })
          .from(events)
          .where(eq(events.threadId, thread.id))
          .all(),
      ).toHaveLength(0);
    });
  });

  it("queues send requests whose senderThreadId is in another project", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        thread: {
          status: "active",
        },
      });
      const { host: otherHost } = seedHostSession(harness.deps, {
        id: "host-cross-project-sender",
      });
      const { project: otherProject } = seedProjectWithSource(harness.deps, {
        hostId: otherHost.id,
      });
      const crossProjectSender = seedThread(harness.deps, {
        projectId: otherProject.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            input: [{ type: "text", text: "Cross-project attribution" }],
            mode: "queue-if-active",
            model: "gpt-5",
            permissionMode: "full",
            reasoningLevel: "medium",
            serviceTier: "default",
            senderThreadId: crossProjectSender.id,
          }),
        },
      );

      // Sender attribution is allowed across projects, so the message queues
      // with the cross-project sender preserved for the reply affordance.
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({ ok: true });
      expect(listQueuedThreadMessages(harness.db, thread.id)).toMatchObject([
        {
          senderThreadId: crossProjectSender.id,
          threadId: thread.id,
        },
      ]);
    });
  });

  it("sends queued sender messages as agent-originated turn requests", async () => {
    await withTestHarness(async (harness) => {
      const { project, thread } = seedThreadFixture(harness);
      const senderThread = seedThread(harness.deps, {
        projectId: project.id,
      });

      const createResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            input: [{ type: "text", text: "Queued agent follow-up" }],
            model: "gpt-5",
            permissionMode: "full",
            reasoningLevel: "medium",
            serviceTier: "default",
            senderThreadId: senderThread.id,
          }),
        },
      );
      expect(createResponse.status).toBe(201);
      const queuedMessage = queuedMessageIdResponseSchema.parse(
        await readJson(createResponse),
      );

      const sendResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages/${queuedMessage.id}/send`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ mode: "auto" }),
        },
      );

      expect(sendResponse.status).toBe(200);
      const requestedEvent = harness.db
        .select({ data: events.data })
        .from(events)
        .where(eq(events.threadId, thread.id))
        .get();
      const requestedData = clientTurnRequestedDataSchema.parse(
        requestedEvent ? JSON.parse(requestedEvent.data) : null,
      );
      expect(requestedData).toMatchObject({
        initiator: "agent",
        senderThreadId: senderThread.id,
      });
      expect(requestedData.input[0]?.text).toBe(
        renderTemplate("agentThreadMessage", {
          messageText: "Queued agent follow-up",
          senderThreadId: senderThread.id,
        }),
      );
      expect(getQueuedThreadMessage(harness.db, queuedMessage.id)).toBeNull();
    });
  });

  it("reorders thread queued messages", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-queued-message-reorder",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-queued-message-reorder-source",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
      });
      const firstQueuedMessage = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("First queued message"),
      });
      const secondQueuedMessage = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("Second queued message"),
      });
      const thirdQueuedMessage = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("Third queued message"),
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages/${thirdQueuedMessage.id}/order`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            previousQueuedMessageId: null,
            nextQueuedMessageId: firstQueuedMessage.id,
          }),
        },
      );

      expect(response.status).toBe(200);
      const queuedMessages = threadQueuedMessageListResponseSchema.parse(
        await readJson(response),
      );
      expect(queuedMessages.map((queuedMessage) => queuedMessage.id)).toEqual([
        thirdQueuedMessage.id,
        firstQueuedMessage.id,
        secondQueuedMessage.id,
      ]);
      expect(
        listQueuedThreadMessages(harness.db, thread.id).map(
          (queuedMessage) => queuedMessage.id,
        ),
      ).toEqual([
        thirdQueuedMessage.id,
        firstQueuedMessage.id,
        secondQueuedMessage.id,
      ]);
    });
  });

  it("maps queued message reorder not-found and invalid-neighbor errors", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-queued-message-reorder-errors",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-queued-message-reorder-errors-source",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
      });
      const firstQueuedMessage = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("First queued message"),
      });
      const secondQueuedMessage = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("Second queued message"),
      });
      const thirdQueuedMessage = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("Third queued message"),
      });

      const notFoundResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages/qmsg_missing/order`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            previousQueuedMessageId: null,
            nextQueuedMessageId: firstQueuedMessage.id,
          }),
        },
      );
      expect(notFoundResponse.status).toBe(404);
      await expect(readJson(notFoundResponse)).resolves.toMatchObject({
        code: "invalid_request",
        message: "Queued message not found",
      });

      const invalidNeighborResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages/${firstQueuedMessage.id}/order`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            previousQueuedMessageId: thirdQueuedMessage.id,
            nextQueuedMessageId: secondQueuedMessage.id,
          }),
        },
      );
      expect(invalidNeighborResponse.status).toBe(409);
      await expect(readJson(invalidNeighborResponse)).resolves.toMatchObject({
        code: "invalid_request",
        message: "Queued message order is invalid",
      });
    });
  });

  it("returns queued messages without notification for unchanged reorder requests", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-queued-message-reorder-unchanged",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-queued-message-reorder-unchanged-source",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
      });
      const firstQueuedMessage = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("First queued message"),
      });
      const secondQueuedMessage = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("Second queued message"),
      });
      const thirdQueuedMessage = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("Third queued message"),
      });
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages/${secondQueuedMessage.id}/order`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            previousQueuedMessageId: firstQueuedMessage.id,
            nextQueuedMessageId: thirdQueuedMessage.id,
          }),
        },
      );

      expect(response.status).toBe(200);
      const queuedMessages = threadQueuedMessageListResponseSchema.parse(
        await readJson(response),
      );
      expect(queuedMessages.map((queuedMessage) => queuedMessage.id)).toEqual([
        firstQueuedMessage.id,
        secondQueuedMessage.id,
        thirdQueuedMessage.id,
      ]);
    });
  });

  it("rejects stale and claimed queued message reorder requests", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-queued-message-reorder-stale",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/thread-queued-message-reorder-stale-source",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
      });
      const firstQueuedMessage = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("First queued message"),
      });
      const secondQueuedMessage = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("Second queued message"),
      });
      const thirdQueuedMessage = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("Third queued message"),
      });

      expect(
        deleteQueuedThreadMessage(
          harness.db,
          harness.hub,
          firstQueuedMessage.id,
        ),
      ).toBe(true);
      const staleResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages/${thirdQueuedMessage.id}/order`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            previousQueuedMessageId: null,
            nextQueuedMessageId: firstQueuedMessage.id,
          }),
        },
      );
      expect(staleResponse.status).toBe(409);
      await expect(readJson(staleResponse)).resolves.toMatchObject({
        code: "invalid_request",
        message: "Queued message order changed",
      });

      const claimedQueuedMessage = claimQueuedThreadMessage(
        harness.db,
        harness.hub,
        secondQueuedMessage.id,
      );
      expect(claimedQueuedMessage?.id).toBe(secondQueuedMessage.id);
      const claimedResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages/${secondQueuedMessage.id}/order`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            previousQueuedMessageId: null,
            nextQueuedMessageId: thirdQueuedMessage.id,
          }),
        },
      );
      expect(claimedResponse.status).toBe(409);
      await expect(readJson(claimedResponse)).resolves.toMatchObject({
        code: "invalid_request",
        message: "Queued message is already being sent",
      });
    });
  });

  it("auto-sends queued messages created on idle provider threads", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-queued-message-create-idle-auto-send",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/queued-message-create-idle-auto-send-source",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/queued-message-create-idle-auto-send-environment",
        workspaceProvisionType: "unmanaged",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-queued-message-create-idle-auto-send",
      });

      const createResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            input: [{ type: "text", text: "Queued message ready to send" }],
            permissionMode: "full",
          }),
        },
      );
      expect(createResponse.status).toBe(201);
      const queuedMessage = queuedMessageIdResponseSchema.parse(
        await readJson(createResponse),
      );

      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "turn.submit" && command.threadId === thread.id,
      );
      expect(queued.command).toMatchObject({
        environmentId: environment.id,
        input: [{ type: "text", text: "Queued message ready to send" }],
        resumeContext: {
          providerThreadId: "provider-queued-message-create-idle-auto-send",
        },
      });
      expect(getQueuedThreadMessage(harness.db, queuedMessage.id)).toBeNull();
      expect(getThread(harness.db, thread.id)?.status).toBe("active");
    });
  });

  it("lists queued thread messages", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("First queued message"),
        model: "gpt-5",
        reasoningLevel: "medium",
        permissionMode: "full",
        serviceTier: "default",
      });
      seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("Second queued message"),
        model: "gpt-5",
        reasoningLevel: "high",
        permissionMode: "full",
        serviceTier: "fast",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages`,
      );

      expect(response.status).toBe(200);
      const queuedMessages = threadQueuedMessageListResponseSchema.parse(
        await readJson(response),
      );
      expect(queuedMessages).toHaveLength(2);
      expect(queuedMessages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            content: textInput("First queued message"),
            model: "gpt-5",
            reasoningLevel: "medium",
            permissionMode: "full",
            serviceTier: "default",
          }),
          expect.objectContaining({
            content: textInput("Second queued message"),
            model: "gpt-5",
            reasoningLevel: "high",
            permissionMode: "full",
            serviceTier: "fast",
          }),
        ]),
      );
    });
  });

  it("loads legacy thread composer bootstrap state", async () => {
    await withTestHarness(async (harness) => {
      seedHostSession(harness.deps, {
        id: "host-composer-default",
      });
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-composer-thread",
      });
      seedPrimaryHost(harness.deps, host.id);
      const providerResponder = registerProviderHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        modelsByProviderId: {
          codex: {
            models: [
              {
                id: "gpt-5.5",
                model: "gpt-5.5",
                displayName: "GPT-5.5",
                description: "Frontier model",
                supportedReasoningEfforts: [
                  {
                    reasoningEffort: "xhigh",
                    description: "Extra high",
                  },
                ],
                defaultReasoningEffort: "xhigh",
                isDefault: true,
              },
            ],
            selectedOnlyModels: [],
          },
        },
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        data: {
          direction: "outbound",
          requestId: encodeClientTurnRequestIdNumber({ value: 601 }),
          input: [{ type: "text", text: "Accepted prompt" }],
          target: { kind: "new-turn" },
          execution: {
            model: "gpt-5.5",
            serviceTier: "default",
            reasoningLevel: "xhigh",
            permissionMode: "workspace-write",
            source: "client/turn/requested",
          },
          initiator: "user",
          senderThreadId: null,
          request: {
            method: "turn/start",
            params: {},
          },
          source: "tell",
        },
      });
      createPromptHistoryEntry(harness.deps.db, {
        projectId: project.id,
        threadId: thread.id,
        scope: "thread",
        requestSequence: 1,
        input: textInput("Accepted prompt"),
      });
      seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("Queued message"),
        model: "gpt-5.5",
        reasoningLevel: "xhigh",
        permissionMode: "workspace-write",
        serviceTier: "default",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/composer-bootstrap`,
      );

      expect(response.status).toBe(200);
      const bootstrap = threadComposerBootstrapResponseSchema.parse(
        await readJson(response),
      );
      expect(bootstrap.defaultExecutionOptions).toMatchObject({
        model: "gpt-5.5",
        reasoningLevel: "xhigh",
        permissionMode: "workspace-write",
      });
      expect(bootstrap.queuedMessages).toHaveLength(1);
      expect(bootstrap.queuedMessages[0]?.content).toEqual(
        textInput("Queued message"),
      );
      expect(bootstrap.pendingInteractions).toEqual([]);
      expect(bootstrap.promptHistory.map((entry) => entry.input)).toEqual(
        expect.arrayContaining([
          textInput("Accepted prompt"),
          textInput("Queued message"),
        ]),
      );
      const { executionOptions } = bootstrap;
      if (executionOptions === null) {
        throw new Error(
          "expected resolved executionOptions for an environment-backed thread",
        );
      }
      const codexProvider = executionOptions.providers.find(
        (provider) => provider.id === "codex",
      );
      expect(codexProvider).toMatchObject({
        id: "codex",
      });
      expect(executionOptions.models[0]?.model).toBe("gpt-5.5");
      expect(
        providerResponder.requests.map((request) => request.command),
      ).toEqual([
        {
          type: "known_acp_agents.status",
          agents: [{ id: "acp-opencode", executableName: "opencode" }],
        },
        { type: "provider.list_models", providerId: "codex" },
      ]);
    });
  });

  it("returns null composer defaults for stale project execution defaults", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-composer-stale-project-defaults",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      upsertProjectExecutionDefaults(harness.deps.db, {
        projectId: project.id,
        providerId: "codex",
        model: "gpt-5.5",
        reasoningLevel: "max",
        permissionMode: "full",
        serviceTier: "default",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: null,
        providerId: "codex",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/composer-bootstrap`,
      );

      expect(response.status).toBe(200);
      const bootstrap = threadComposerBootstrapResponseSchema.parse(
        await readJson(response),
      );
      expect(bootstrap.defaultExecutionOptions).toBeNull();
      expect(bootstrap.executionOptions).toBeNull();
    });
  });

  it("returns null composer execution options for archived threads on offline hosts", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, {
        id: "host-composer-archived-offline",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      archiveThread(harness.db, harness.hub, thread.id);

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/composer-bootstrap`,
      );

      expect(response.status).toBe(200);
      const bootstrap = threadComposerBootstrapResponseSchema.parse(
        await readJson(response),
      );
      expect(bootstrap.executionOptions).toBeNull();
    });
  });

  it("inherits thread default execution options when queued message overrides are omitted", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "client/turn/requested",
        scope: threadScope(),
        data: {
          direction: "outbound",
          requestId: encodeClientTurnRequestIdNumber({ value: 501 }),
          input: [{ type: "text", text: "Earlier work" }],
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
          request: {
            method: "turn/start",
            params: {},
          },
          source: "tell",
        },
      });

      const createResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            input: [{ type: "text", text: "Queued message from test" }],
          }),
        },
      );
      expect(createResponse.status).toBe(201);
      const queuedMessage = queuedMessageIdResponseSchema.parse(
        await readJson(createResponse),
      );
      expect(
        getQueuedThreadMessage(harness.db, queuedMessage.id),
      ).toMatchObject({
        id: queuedMessage.id,
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "full",
      });
    });
  });

  it("persists queued message model and service tier and clears the queued message after reprovision send", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/queued-message-reprovision",
        status: "error",
        managed: true,
        workspaceProvisionType: "managed-worktree",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      const createResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            input: [{ type: "text", text: "Queued message from test" }],
            model: "gpt-5",
            serviceTier: "default",
            reasoningLevel: "high",
            permissionMode: "full",
          }),
        },
      );
      expect(createResponse.status).toBe(201);
      const createdQueuedMessage = threadQueuedMessageSchema.parse(
        await readJson(createResponse),
      );
      expect(createdQueuedMessage).toMatchObject({
        model: "gpt-5",
        serviceTier: "default",
      });

      const sendResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages/${createdQueuedMessage.id}/send`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ mode: "auto" }),
        },
      );

      expect(sendResponse.status).toBe(200);
      expect(
        getQueuedThreadMessage(harness.db, createdQueuedMessage.id),
      ).toBeNull();
      const provisionCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "environment.provision" &&
          command.environmentId === environment.id,
      );
      expect(provisionCommand.command.type).toBe("environment.provision");
      const requestedEvent = harness.db
        .select({ data: events.data })
        .from(events)
        .where(eq(events.threadId, thread.id))
        .orderBy(events.sequence)
        .all()
        .find((event) => {
          const parsed = JSON.parse(event.data) as {
            execution?: { model?: string; serviceTier?: string };
          };
          return parsed.execution?.model === "gpt-5";
        });
      expect(requestedEvent).toBeTruthy();
      expect(
        requestedEvent ? JSON.parse(requestedEvent.data) : null,
      ).toMatchObject({
        execution: {
          model: "gpt-5",
          serviceTier: "default",
        },
      });
      expect(
        harness.db
          .select({ id: events.id })
          .from(events)
          .where(
            and(
              eq(events.threadId, thread.id),
              eq(events.type, "client/turn/requested"),
            ),
          )
          .all(),
      ).toHaveLength(1);
    });
  });

  it("keeps queued messages when send is attempted while a starting thread is still starting", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-queued-message-created-thread-send",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/queued-message-created-thread-send",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/queued-message-created-thread-send",
      });

      const createThreadResponse = await harness.app.request(
        "/api/v1/threads",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            origin: "app",
            projectId: project.id,
            providerId: "codex",
            model: "gpt-5",
            input: [{ type: "text", text: "Initial start request" }],
            environment: {
              type: "reuse",
              environmentId: environment.id,
            },
          }),
        },
      );

      expect(createThreadResponse.status).toBe(201);
      const createdThread = threadSchema.parse(
        await readJson(createThreadResponse),
      );
      expect(createdThread.status).toBe("starting");

      const createQueuedThreadMessageResponse = await harness.app.request(
        `/api/v1/threads/${createdThread.id}/queued-messages`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            input: [
              {
                type: "text",
                text: "Queued message follow-up while starting",
              },
            ],
          }),
        },
      );
      expect(createQueuedThreadMessageResponse.status).toBe(201);
      const createdQueuedMessage = queuedMessageIdResponseSchema.parse(
        await readJson(createQueuedThreadMessageResponse),
      );

      const sendResponse = await harness.app.request(
        `/api/v1/threads/${createdThread.id}/queued-messages/${createdQueuedMessage.id}/send`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ mode: "auto" }),
        },
      );

      expect(sendResponse.status).toBe(409);
      await expect(readJson(sendResponse)).resolves.toMatchObject({
        code: "thread_not_writable",
        details: {
          reason: "still_starting",
          threadStatus: "starting",
        },
      });
      expect(
        getQueuedThreadMessage(harness.db, createdQueuedMessage.id),
      ).toMatchObject({
        id: createdQueuedMessage.id,
      });
      const requestedEvents = harness.db
        .select({ type: events.type })
        .from(events)
        .where(eq(events.threadId, createdThread.id))
        .all()
        .filter((event) => event.type === "client/turn/requested");
      expect(requestedEvents).toHaveLength(1);
      expect(
        harness.db
          .select({ id: queuedThreadMessages.id })
          .from(queuedThreadMessages)
          .where(eq(queuedThreadMessages.threadId, createdThread.id))
          .all(),
      ).toHaveLength(1);
    });
  });

  it("lists thread storage files via host.list_files", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-source",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/project-source",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      const threadStoragePath = `/tmp/bb-host-data/${host.id}/thread-storage/${thread.id}`;

      const filesPromise = harness.app.request(
        `/api/v1/threads/${thread.id}/thread-storage/files?query=notes`,
      );
      const filesCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.list_files" &&
          command.path === threadStoragePath,
      );
      expect(filesCommand.command).toMatchObject({
        path: threadStoragePath,
        query: "notes",
        limit: 1000,
      });
      await reportQueuedCommandSuccess(harness, filesCommand, {
        files: [
          { path: "notes/plan.md", name: "plan.md" },
          { path: "notes/todo.md", name: "todo.md" },
        ],
        truncated: false,
      });
      const filesResponse = await filesPromise;
      expect(filesResponse.status).toBe(200);
      await expect(readJson(filesResponse)).resolves.toEqual({
        files: [
          { path: "notes/plan.md", name: "plan.md" },
          { path: "notes/todo.md", name: "todo.md" },
        ],
        truncated: false,
        storageRootPath: threadStoragePath,
      });
    });
  });

  it("lists thread storage paths via host.list_paths", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-source",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/project-source",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      const threadStoragePath = `/tmp/bb-host-data/${host.id}/thread-storage/${thread.id}`;

      const pathsPromise = harness.app.request(
        `/api/v1/threads/${thread.id}/thread-storage/paths?query=notes&includeFiles=true&includeDirectories=true`,
      );
      const pathsCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.list_paths" &&
          command.path === threadStoragePath,
      );
      expect(pathsCommand.command).toMatchObject({
        path: threadStoragePath,
        query: "notes",
        limit: 1000,
        includeFiles: true,
        includeDirectories: true,
      });
      await reportQueuedCommandSuccess(harness, pathsCommand, {
        paths: [
          {
            kind: "directory",
            path: "notes",
            name: "notes",
            score: 100,
            positions: [0, 1, 2, 3, 4],
          },
          {
            kind: "file",
            path: "notes/plan.md",
            name: "plan.md",
            score: 75,
            positions: [0, 1, 2, 3, 4],
          },
        ],
        truncated: false,
      });
      const pathsResponse = await pathsPromise;
      expect(pathsResponse.status).toBe(200);
      await expect(readJson(pathsResponse)).resolves.toEqual({
        paths: [
          {
            kind: "directory",
            path: "notes",
            name: "notes",
            score: 100,
            positions: [0, 1, 2, 3, 4],
          },
          {
            kind: "file",
            path: "notes/plan.md",
            name: "plan.md",
            score: 75,
            positions: [0, 1, 2, 3, 4],
          },
        ],
        truncated: false,
        storageRootPath: threadStoragePath,
      });
    });
  });

  it("lists thread storage files for threads with environments", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-source",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/project-source",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      const threadStoragePath = `/tmp/bb-host-data/${host.id}/thread-storage/${thread.id}`;

      const filesPromise = harness.app.request(
        `/api/v1/threads/${thread.id}/thread-storage/files`,
      );
      const filesCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.list_files" &&
          command.path === threadStoragePath,
      );
      await reportQueuedCommandSuccess(harness, filesCommand, {
        files: [{ path: "notes/plan.md", name: "plan.md" }],
        truncated: false,
      });

      const filesResponse = await filesPromise;
      expect(filesResponse.status).toBe(200);
      await expect(readJson(filesResponse)).resolves.toEqual({
        files: [{ path: "notes/plan.md", name: "plan.md" }],
        truncated: false,
        storageRootPath: threadStoragePath,
      });
    });
  });

  it("lists thread storage files without requiring a ready environment", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-source",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/project-source",
        status: "provisioning",
      });
      harness.db
        .update(environments)
        .set({
          path: null,
          status: "provisioning",
          updatedAt: Date.now(),
        })
        .where(eq(environments.id, environment.id))
        .run();
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "starting",
      });
      const threadStoragePath = `/tmp/bb-host-data/${host.id}/thread-storage/${thread.id}`;

      const filesPromise = harness.app.request(
        `/api/v1/threads/${thread.id}/thread-storage/files`,
      );
      const filesCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.list_files" &&
          command.path === threadStoragePath,
      );
      await reportQueuedCommandSuccess(harness, filesCommand, {
        files: [{ path: "notes/plan.md", name: "plan.md" }],
        truncated: false,
      });

      const filesResponse = await filesPromise;
      expect(filesResponse.status).toBe(200);
      await expect(readJson(filesResponse)).resolves.toEqual({
        files: [{ path: "notes/plan.md", name: "plan.md" }],
        truncated: false,
        storageRootPath: threadStoragePath,
      });
    });
  });

  it("serves thread storage file content as raw bytes", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-source",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/project-source",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      const pngBytes = Uint8Array.from([137, 80, 78, 71]);
      const threadStorageRoot = `/tmp/bb-host-data/${host.id}/thread-storage/${thread.id}`;
      const threadStorageFilePath = `${threadStorageRoot}/images/diagram.png`;

      const filePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/thread-storage/content?path=${encodeURIComponent("images/diagram.png")}`,
      );
      const fileCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.read_file" &&
          command.path === threadStorageFilePath,
      );
      expect(fileCommand.command).toMatchObject({
        path: threadStorageFilePath,
        rootPath: threadStorageRoot,
      });
      await reportQueuedCommandSuccess(harness, fileCommand, {
        path: threadStorageFilePath,
        content: Buffer.from(pngBytes).toString("base64"),
        contentEncoding: "base64",
        mimeType: "image/png",
        sizeBytes: pngBytes.byteLength,
      });
      const fileResponse = await filePromise;
      expect(fileResponse.status).toBe(200);
      expect(fileResponse.headers.get("content-type")).toBe("image/png");
      expect(fileResponse.headers.get("x-bb-content-encoding")).toBeNull();
      expect(fileResponse.headers.get("x-bb-size-bytes")).toBeNull();
      expect(new Uint8Array(await fileResponse.arrayBuffer())).toEqual(
        pngBytes,
      );
    });
  });

  it("serves worktree HTML preview content as raw text/html without app bridge injection", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-source",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/project-source",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      const html = "<!doctype html><script>window.localOnly = true</script>";

      const filePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/worktree/files/public/report.html`,
      );
      const fileCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.read_file" &&
          command.path === "/tmp/project-source/public/report.html",
      );
      expect(fileCommand.command).toMatchObject({
        type: "host.read_file",
        path: "/tmp/project-source/public/report.html",
        rootPath: "/tmp/project-source",
      });
      await reportQueuedCommandSuccess(harness, fileCommand, {
        path: "/tmp/project-source/public/report.html",
        content: html,
        contentEncoding: "utf8",
        mimeType: "text/html",
        sizeBytes: Buffer.byteLength(html),
      });

      const fileResponse = await filePromise;
      expect(fileResponse.status).toBe(200);
      expect(fileResponse.headers.get("content-type")).toBe(
        "text/html; charset=utf-8",
      );
      expect(fileResponse.headers.get("content-security-policy")).toBe(
        "sandbox allow-scripts",
      );
      expect(fileResponse.headers.get("cache-control")).toBe("no-store");
      const body = await fileResponse.text();
      expect(body).toBe(html);
      expect(body).not.toContain("window.bb");
    });
  });

  it("serves thread storage HTML preview content as raw text/html without app bridge injection", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-source",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/project-source",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      const threadStorageRoot = `/tmp/bb-host-data/${host.id}/thread-storage/${thread.id}`;
      const html = "<!doctype html><h1>Preview</h1>";

      // Percent-encoded segments decode exactly once before hitting the host.
      const filePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/thread-storage/files/reports/preview%20v2.html`,
      );
      const fileCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.read_file" &&
          command.path === `${threadStorageRoot}/reports/preview v2.html`,
      );
      expect(fileCommand.command).toMatchObject({
        type: "host.read_file",
        path: `${threadStorageRoot}/reports/preview v2.html`,
        rootPath: threadStorageRoot,
      });
      await reportQueuedCommandSuccess(harness, fileCommand, {
        path: `${threadStorageRoot}/reports/preview v2.html`,
        content: html,
        contentEncoding: "utf8",
        mimeType: "text/html",
        sizeBytes: Buffer.byteLength(html),
      });

      const fileResponse = await filePromise;
      expect(fileResponse.status).toBe(200);
      expect(fileResponse.headers.get("content-type")).toBe(
        "text/html; charset=utf-8",
      );
      expect(fileResponse.headers.get("content-security-policy")).toBe(
        "sandbox allow-scripts",
      );
      expect(await fileResponse.text()).toBe(html);
    });
  });

  it("serves absolute-path HTML files via files/raw with preview headers", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-source",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/project-source",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      const html = "<!doctype html><h1>Raw preview</h1>";

      const filePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/files/raw?path=${encodeURIComponent("/tmp/anywhere/report.html")}`,
      );
      const fileCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.read_file" &&
          command.path === "/tmp/anywhere/report.html",
      );
      expect(fileCommand.command).toMatchObject({
        type: "host.read_file",
        path: "/tmp/anywhere/report.html",
      });
      await reportQueuedCommandSuccess(harness, fileCommand, {
        path: "/tmp/anywhere/report.html",
        content: html,
        contentEncoding: "utf8",
        mimeType: "text/html",
        sizeBytes: Buffer.byteLength(html),
      });

      const fileResponse = await filePromise;
      expect(fileResponse.status).toBe(200);
      expect(fileResponse.headers.get("content-type")).toBe(
        "text/html; charset=utf-8",
      );
      expect(fileResponse.headers.get("content-security-policy")).toBe(
        "sandbox allow-scripts",
      );
      expect(fileResponse.headers.get("cache-control")).toBe("no-store");
      expect(fileResponse.headers.get("x-content-type-options")).toBe(
        "nosniff",
      );
      expect(await fileResponse.text()).toBe(html);
    });
  });

  it("rejects relative and non-HTML files/raw paths without contacting the host", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-source",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/project-source",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      const relativeResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/files/raw?path=${encodeURIComponent("relative/report.html")}`,
      );
      expect(relativeResponse.status).toBe(400);
      await expect(readJson(relativeResponse)).resolves.toMatchObject({
        code: "invalid_path",
      });

      const nonHtmlResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/files/raw?path=${encodeURIComponent("/tmp/anywhere/data.json")}`,
      );
      expect(nonHtmlResponse.status).toBe(415);
      await expect(readJson(nonHtmlResponse)).resolves.toMatchObject({
        code: "unsupported_media_type",
      });

      const missingPathResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/files/raw`,
      );
      expect(missingPathResponse.status).toBe(400);
      await expect(readJson(missingPathResponse)).resolves.toMatchObject({
        code: "invalid_request",
      });
    });
  });

  it("caps generic HTML preview responses at 5 MB", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-source",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/project-source",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      const filePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/worktree/files/large.html`,
      );
      const fileCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.read_file" &&
          command.path === "/tmp/project-source/large.html",
      );
      await reportQueuedCommandSuccess(harness, fileCommand, {
        path: "/tmp/project-source/large.html",
        content: "",
        contentEncoding: "utf8",
        mimeType: "text/html",
        sizeBytes: 5 * 1024 * 1024 + 1,
      });

      const fileResponse = await filePromise;
      expect(fileResponse.status).toBe(413);
      await expect(readJson(fileResponse)).resolves.toEqual({
        code: "file_too_large",
        message: "HTML preview exceeds the 5 MB limit",
        retryable: false,
      });
    });
  });

  it("serves host file content from the thread environment host without requiring a ready environment", async () => {
    await withTestHarness(async (harness) => {
      seedHostSession(harness.deps, { id: "host-other" });
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-environment",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/project-source",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/project-source",
        status: "provisioning",
      });
      harness.db
        .update(environments)
        .set({
          path: null,
          status: "provisioning",
          updatedAt: Date.now(),
        })
        .where(eq(environments.id, environment.id))
        .run();
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      const hostFilePath = "/Users/me/notes/plan.md";
      const fileBytes = new TextEncoder().encode("# Plan\n");

      const filePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/host-files/content?path=${encodeURIComponent(hostFilePath)}`,
      );
      const fileCommand = await waitForQueuedCommand(
        harness,
        ({ command, row }) =>
          row.hostId === host.id &&
          command.type === "host.read_file" &&
          command.path === hostFilePath,
      );
      expect(fileCommand.command).toEqual({
        type: "host.read_file",
        path: hostFilePath,
      });
      await reportQueuedCommandSuccess(
        harness,
        fileCommand,
        {
          path: hostFilePath,
          content: "# Plan\n",
          contentEncoding: "utf8",
          mimeType: "text/markdown",
          sizeBytes: fileBytes.byteLength,
        },
        { hostId: host.id },
      );
      const fileResponse = await filePromise;
      expect(fileResponse.status).toBe(200);
      expect(fileResponse.headers.get("content-type")).toBe("text/markdown");
      expect(new Uint8Array(await fileResponse.arrayBuffer())).toEqual(
        fileBytes,
      );
    });
  });

  it("rejects host file content requests for threads without environments", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: null,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/host-files/content?path=${encodeURIComponent("/Users/me/notes/plan.md")}`,
      );

      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "thread_environment_unavailable",
        details: {
          reason: "never_attached",
          environmentStatus: null,
        },
      });
    });
  });

  it.each([
    {
      errorCode: "invalid_path",
      errorMessage: "Path is a directory, not a file",
      expectedStatus: 400,
    },
    {
      errorCode: "ENOENT",
      errorMessage: "Path does not exist",
      expectedStatus: 404,
    },
    {
      errorCode: "file_too_large",
      errorMessage: "File exceeds limit",
      expectedStatus: 413,
    },
  ])(
    "maps host file $errorCode errors to user-facing responses",
    async ({ errorCode, errorMessage, expectedStatus }) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps);
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
        });
        const thread = seedThread(harness.deps, {
          projectId: project.id,
          environmentId: environment.id,
        });
        const hostFilePath = "/Users/me/notes/plan.md";

        const filePromise = harness.app.request(
          `/api/v1/threads/${thread.id}/host-files/content?path=${encodeURIComponent(hostFilePath)}`,
        );
        const fileCommand = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "host.read_file" && command.path === hostFilePath,
        );
        const fileErrorResponse = await reportQueuedCommandError(
          harness,
          fileCommand,
          {
            errorCode,
            errorMessage,
          },
        );
        expect(fileErrorResponse.status).toBe(200);

        const fileResponse = await filePromise;
        expect(fileResponse.status).toBe(expectedStatus);
        await expect(readJson(fileResponse)).resolves.toEqual({
          code: errorCode,
          message: errorMessage,
          retryable: false,
        });
      });
    },
  );

  it("maps thread storage root-escape failures to invalid_path", async () => {
    await withTestHarness(async (harness) => {
      const { host, thread } = seedThreadFixture(harness);
      const threadStorageRoot = `/tmp/bb-host-data/${host.id}/thread-storage/${thread.id}`;

      const filePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/thread-storage/content?path=${encodeURIComponent("notes/secrets")}`,
      );
      const fileCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "host.read_file" &&
          command.path === `${threadStorageRoot}/notes/secrets`,
      );
      expect(fileCommand.command).toMatchObject({
        path: `${threadStorageRoot}/notes/secrets`,
        rootPath: threadStorageRoot,
      });
      const fileErrorResponse = await reportQueuedCommandError(
        harness,
        fileCommand,
        {
          errorCode: "invalid_path",
          errorMessage: "Path escapes read root",
        },
      );
      expect(fileErrorResponse.status).toBe(200);

      const fileResponse = await filePromise;
      expect(fileResponse.status).toBe(400);
      await expect(readJson(fileResponse)).resolves.toEqual({
        code: "invalid_path",
        message: "Path escapes read root",
        retryable: false,
      });
    });
  });

  it("returns an empty thread storage file list when the durable storage is absent", async () => {
    await withTestHarness(async (harness) => {
      const { host, thread } = seedThreadFixture(harness);
      const threadStoragePath = `/tmp/bb-host-data/${host.id}/thread-storage/${thread.id}`;

      const filesPromise = harness.app.request(
        `/api/v1/threads/${thread.id}/thread-storage/files`,
      );
      const filesCommand = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "host.list_files",
      );
      const filesErrorResponse = await reportQueuedCommandError(
        harness,
        filesCommand,
        {
          errorCode: "ENOENT",
          errorMessage: "Path does not exist",
        },
      );
      expect(filesErrorResponse.status).toBe(200);

      const filesResponse = await filesPromise;
      expect(filesResponse.status).toBe(200);
      await expect(readJson(filesResponse)).resolves.toEqual({
        files: [],
        truncated: false,
        storageRootPath: threadStoragePath,
      });
    });
  });

  it("maps thread storage file read failures to user-facing 4xx responses", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);

      const filePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/thread-storage/content?path=${encodeURIComponent("notes/missing.txt")}`,
      );
      const fileCommand = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "host.read_file",
      );
      const fileErrorResponse = await reportQueuedCommandError(
        harness,
        fileCommand,
        {
          errorCode: "file_too_large",
          errorMessage: "File exceeds limit",
        },
      );
      expect(fileErrorResponse.status).toBe(200);

      const fileResponse = await filePromise;
      expect(fileResponse.status).toBe(413);
      await expect(readJson(fileResponse)).resolves.toEqual({
        code: "file_too_large",
        message: "File exceeds limit",
        retryable: false,
      });
    });
  });

  it("fails loudly when stored queued message content is malformed", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);
      const now = Date.now();
      const queuedMessageId = createQueuedThreadMessageId();
      const queuedMessage = harness.db
        .insert(queuedThreadMessages)
        .values({
          id: queuedMessageId,
          threadId: thread.id,
          content: "not-json",
          model: "gpt-5",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "full",
          claimedAt: null,
          sortKey: "V",
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages/${queuedMessage.id}/send`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ mode: "auto" }),
        },
      );

      expect(response.status).toBe(500);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "internal_error",
        message: expect.stringContaining(`queued message ${queuedMessage.id}`),
      });
    });
  });

  it("returns existing matching event immediately from /events/wait", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);

      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "system/manager/user_message",
        scope: threadScope(),
        data: { text: "A legacy note" },
      });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("turn-1"),
        sequence: 2,
        type: "item/completed",
        data: { item: { type: "agentMessage", id: "msg-1", text: "Reply" } },
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/events/wait?type=item/completed&waitMs=1000`,
      );
      expect(response.status).toBe(200);
      const body = threadEventWaitResponseSchema.parse(
        await readJson(response),
      );
      expect(body.type).toBe("item/completed");
      expect(body.seq).toBe(2);
    });
  });

  it("returns 204 on timeout when no matching event exists", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);

      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 1,
        type: "system/manager/user_message",
        scope: threadScope(),
        data: { text: "Unrelated event" },
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/events/wait?type=item/completed&waitMs=100`,
      );
      expect(response.status).toBe(204);
    });
  });

  it("respects afterSeq when waiting for events", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadFixture(harness);

      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        scope: turnScope("turn-1"),
        sequence: 5,
        type: "item/completed",
        data: { item: { type: "agentMessage", id: "msg-1", text: "Reply" } },
      });

      // afterSeq=5 means "after sequence 5" — the match at seq 5 should NOT be returned
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/events/wait?type=item/completed&afterSeq=5&waitMs=100`,
      );
      expect(response.status).toBe(204);
    });
  });

  it("returns 404 for nonexistent thread on /events/wait", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        `/api/v1/threads/nonexistent-thread-id/events/wait?type=item/completed&waitMs=100`,
      );
      expect(response.status).toBe(404);
    });
  });

  it("rejects invalid event types on /events/wait", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness);

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/events/wait?type=not-a-real-event&waitMs=100`,
      );
      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
        message: "Invalid event type",
      });
    });
  });
});
