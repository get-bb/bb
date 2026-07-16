import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { registerAttachments } from "../attachments";
import { tasksRpcContract } from "../shared/contract";
import { createComment, createStore, registerTasksApi } from ".";

describe("Tasks RPC domain API", () => {
  it("persists successful comment steers and skips completed threads", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "tasks",
      sdk: {
        threads: {
          get: async ({ threadId }) =>
            makeThreadResponse({ id: threadId, status: "active" }),
          send: async () => undefined,
        },
      },
    });
    const store = createStore(bb);
    registerTasksApi(bb, store);
    const project = store.tasks.createProject({
      name: "Notifications",
      prefix: "NTF",
      color: "blue",
    });
    const task = store.tasks.createTask({
      projectId: project.id,
      title: "Notify workers",
    });
    for (const [threadId, liveStatus] of [
      ["thr_one", "working"],
      ["thr_two", "working"],
      ["thr_done", "completed"],
    ] as const) {
      store.tasks.upsertTaskThread({
        taskId: task.id,
        threadId,
        presetName: "Default",
        title: threadId,
        liveStatus,
      });
    }

    const result = tasksRpcContract.createComment.output.parse(
      await harness.callRpc("createComment", {
        taskId: task.id,
        body: "Keep both workers aligned.",
        notify: true,
      }),
    );

    expect(result.comment.notifiedCount).toBe(2);
    expect(store.tasks.getComment(result.comment.id)?.notifiedCount).toBe(2);
    expect(harness.sdk.callsTo("threads.send")).toHaveLength(2);
    expect(harness.realtimeSignals.at(-1)).toEqual({
      channel: "comments:changed",
      payload: { taskId: task.id, notifiedCount: 2 },
    });
    await harness.dispose();
  });

  it("resolves the live thread title for agent comments and falls back otherwise", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "tasks",
      sdk: {
        threads: {
          get: async ({ threadId }: { threadId: string }) => {
            if (threadId === "thr_titled") {
              return makeThreadResponse({
                id: threadId,
                title: "Fix the login bug",
              });
            }
            if (threadId === "thr_fallback_only") {
              return makeThreadResponse({
                id: threadId,
                title: null,
                titleFallback: "Untitled work",
              });
            }
            if (threadId === "thr_blank_title") {
              // A whitespace primary title must not suppress a useful fallback.
              return makeThreadResponse({
                id: threadId,
                title: "   ",
                titleFallback: "Recovered fallback",
              });
            }
            if (threadId === "thr_side_chat") {
              return makeThreadResponse({
                id: threadId,
                title: "Internal side chat",
                originKind: "side-chat",
              });
            }
            if (threadId === "thr_side_chat_legacy") {
              return makeThreadResponse({
                id: threadId,
                title: "Legacy side chat",
                originKind: null,
                childOrigin: "side-chat",
              });
            }
            // Deleted / hidden / inaccessible threads reject.
            throw new Error("thread_not_found");
          },
        },
      },
    });
    const store = createStore(bb);
    registerTasksApi(bb, store);
    const project = store.tasks.createProject({
      name: "Notifications",
      prefix: "NTF",
      color: "blue",
    });
    const task = store.tasks.createTask({
      projectId: project.id,
      title: "Wire up comments",
    });
    // Agent comment whose thread has a human title.
    store.tasks.createComment({
      taskId: task.id,
      kind: "agent",
      authorName: "agent (thr_titled)",
      threadId: "thr_titled",
      body: "Titled",
      notifiedCount: 0,
    });
    // Agent comment whose thread only has a fallback title.
    store.tasks.createComment({
      taskId: task.id,
      kind: "agent",
      authorName: "agent (thr_fallback_only)",
      threadId: "thr_fallback_only",
      body: "Fallback title",
      notifiedCount: 0,
    });
    // Agent comment whose thread has only a whitespace primary title.
    store.tasks.createComment({
      taskId: task.id,
      kind: "agent",
      authorName: "agent (thr_blank_title)",
      threadId: "thr_blank_title",
      body: "Blank title",
      notifiedCount: 0,
    });
    // Agent comment authored by a side chat (must not leak title/link).
    store.tasks.createComment({
      taskId: task.id,
      kind: "agent",
      authorName: "agent (thr_side_chat)",
      threadId: "thr_side_chat",
      body: "Side chat",
      notifiedCount: 0,
    });
    // Agent comment authored by a legacy childOrigin side chat.
    store.tasks.createComment({
      taskId: task.id,
      kind: "agent",
      authorName: "agent (thr_side_chat_legacy)",
      threadId: "thr_side_chat_legacy",
      body: "Legacy side chat",
      notifiedCount: 0,
    });
    // Agent comment whose thread is gone/inaccessible.
    store.tasks.createComment({
      taskId: task.id,
      kind: "agent",
      authorName: "agent (thr_missing)",
      threadId: "thr_missing",
      body: "Missing thread",
      notifiedCount: 0,
    });
    // Legacy agent comment with no thread id.
    store.tasks.createComment({
      taskId: task.id,
      kind: "agent",
      authorName: "agent (legacy)",
      threadId: null,
      body: "Legacy",
      notifiedCount: 0,
    });
    // User comment never resolves a thread title.
    store.tasks.createComment({
      taskId: task.id,
      kind: "user",
      authorName: "You",
      threadId: null,
      body: "Human note",
      notifiedCount: 0,
    });

    const result = tasksRpcContract.listComments.output.parse(
      await harness.callRpc("listComments", { taskId: task.id }),
    );
    const titleByBody = new Map(
      result.comments.map((comment) => [comment.body, comment.threadTitle]),
    );
    expect(titleByBody.get("Titled")).toBe("Fix the login bug");
    expect(titleByBody.get("Fallback title")).toBe("Untitled work");
    expect(titleByBody.get("Blank title")).toBe("Recovered fallback");
    expect(titleByBody.get("Side chat")).toBeNull();
    expect(titleByBody.get("Legacy side chat")).toBeNull();
    expect(titleByBody.get("Missing thread")).toBeNull();
    expect(titleByBody.get("Legacy")).toBeNull();
    expect(titleByBody.get("Human note")).toBeNull();
    // Each distinct agent thread is resolved once, not per comment.
    expect(harness.sdk.callsTo("threads.get")).toHaveLength(6);
    await harness.dispose();
  });

  it("lists bb workspace projects as id/name options", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "tasks",
      sdk: {
        projects: {
          list: async () => [
            { id: "proj_personal", name: "Personal", extra: "dropped" },
            { id: "proj_bb", name: "bb" },
          ],
        },
      },
    });
    registerTasksApi(bb, createStore(bb));

    const result = tasksRpcContract.listBbProjects.output.parse(
      await harness.callRpc("listBbProjects", null),
    );
    expect(result.bbProjects).toEqual([
      { id: "proj_personal", name: "Personal" },
      { id: "proj_bb", name: "bb" },
    ]);
    expect(harness.sdk.callsTo("projects.list")).toEqual([
      [{ includePersonal: true }],
    ]);
    await harness.dispose();
  });

  it("lists providers and provider models from the BB SDK", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "tasks",
      sdk: {
        providers: {
          list: async () => [
            { id: "codex", displayName: "Codex" },
            { id: "claude-code", displayName: "Claude Code" },
          ],
          models: async () => ({
            models: [
              {
                model: "gpt-5.6-sol",
                displayName: "GPT-5.6",
                isDefault: true,
                supportedReasoningEfforts: [
                  { reasoningEffort: "medium" },
                  { reasoningEffort: "high" },
                ],
              },
              {
                model: "gpt-5.5",
                displayName: "GPT-5.5",
                isDefault: false,
                supportedReasoningEfforts: [
                  { reasoningEffort: "low" },
                  { reasoningEffort: "high" },
                ],
              },
            ],
          }),
        },
      },
    });
    registerTasksApi(bb, createStore(bb));

    await expect(harness.callRpc("listProviders", {})).resolves.toEqual({
      providers: [
        { id: "codex", name: "Codex" },
        { id: "claude-code", name: "Claude Code" },
      ],
    });
    await expect(
      harness.callRpc("listProviderModels", { providerId: "codex" }),
    ).resolves.toEqual({
      models: [
        { id: "gpt-5.6-sol", name: "GPT-5.6", isDefault: true },
        { id: "gpt-5.5", name: "GPT-5.5", isDefault: false },
      ],
      reasoningLevels: ["low", "medium", "high"],
    });
    expect(harness.sdk.callsTo("providers.list")).toEqual([[]]);
    expect(harness.sdk.callsTo("providers.models")).toEqual([
      [{ providerId: "codex" }],
    ]);
    await harness.dispose();
  });

  it("lists machines as id/name options from the BB SDK", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "tasks",
      sdk: {
        hosts: {
          list: async () => [
            {
              id: "host_primary",
              name: "Sawyer Air",
              status: "connected",
            },
            {
              id: "host_remote",
              name: "Build box",
              status: "disconnected",
            },
          ],
        },
      },
    });
    registerTasksApi(bb, createStore(bb));

    await expect(harness.callRpc("listMachines", {})).resolves.toEqual({
      machines: [
        { id: "host_primary", name: "Sawyer Air" },
        { id: "host_remote", name: "Build box" },
      ],
    });
    expect(harness.sdk.callsTo("hosts.list")).toEqual([[]]);

    await harness.dispose();
  });

  it("falls back to the standard reasoning levels when models omit metadata", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "tasks",
      sdk: {
        providers: {
          models: async () => ({
            models: [
              {
                model: "model-without-efforts",
                displayName: "Model without efforts",
                isDefault: true,
                supportedReasoningEfforts: [],
              },
            ],
          }),
        },
      },
    });
    registerTasksApi(bb, createStore(bb));

    await expect(
      harness.callRpc("listProviderModels", { providerId: "test" }),
    ).resolves.toMatchObject({
      reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
    });
    await harness.dispose();
  });

  it("searches threads and returns recent threads in updated order", async () => {
    const thread = (
      id: string,
      title: string | null,
      titleFallback: string | null,
      updatedAt: number,
      status: string,
    ) => ({ id, title, titleFallback, updatedAt, status });
    const { bb, harness } = createFakePluginHost({
      pluginId: "tasks",
      sdk: {
        threads: {
          search: async () => ({
            active: {
              results: [
                {
                  thread: thread("thr_old", "Old match", null, 10, "idle"),
                },
                {
                  thread: thread("thr_new", null, "New fallback", 30, "active"),
                },
              ],
            },
            archived: {
              results: [
                {
                  thread: thread(
                    "thr_middle",
                    "Middle match",
                    null,
                    20,
                    "error",
                  ),
                },
              ],
            },
          }),
          list: async () => [
            thread("thr_recent_old", "Recent old", null, 40, "idle"),
            thread("thr_recent_new", null, "Recent new", 50, "starting"),
          ],
        },
      },
    });
    registerTasksApi(bb, createStore(bb));

    await expect(
      harness.callRpc("searchThreads", { query: "match", limit: 2 }),
    ).resolves.toEqual({
      threads: [
        { id: "thr_new", title: "New fallback", status: "active" },
        { id: "thr_middle", title: "Middle match", status: "error" },
      ],
    });
    await expect(
      harness.callRpc("searchThreads", { query: "" }),
    ).resolves.toEqual({
      threads: [
        { id: "thr_recent_new", title: "Recent new", status: "starting" },
        { id: "thr_recent_old", title: "Recent old", status: "idle" },
      ],
    });
    expect(harness.sdk.callsTo("threads.search")).toEqual([
      [{ query: "match", limitPerGroup: "10" }],
    ]);
    expect(harness.sdk.callsTo("threads.list")).toEqual([[{ limit: 10 }]]);
    await harness.dispose();
  });

  it("does not send for notify=false or agent comments", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "tasks",
      sdk: { threads: { send: async () => undefined } },
    });
    const store = createStore(bb);
    registerTasksApi(bb, store);
    const project = store.tasks.createProject({
      name: "Quiet comments",
      prefix: "QIT",
      color: "blue",
    });
    const task = store.tasks.createTask({
      projectId: project.id,
      title: "Avoid loops",
    });
    store.tasks.upsertTaskThread({
      taskId: task.id,
      threadId: "thr_worker",
      presetName: "Default",
      title: "Worker",
      liveStatus: "working",
    });

    const quietResult = tasksRpcContract.createComment.output.parse(
      await harness.callRpc("createComment", {
        taskId: task.id,
        body: "Record this without notifying.",
        notify: false,
      }),
    );
    const agentComment = await createComment(bb, store, {
      taskId: task.id,
      kind: "agent",
      authorName: "Worker",
      body: "Reporting progress.",
      notify: true,
    });

    expect(quietResult.comment.notifiedCount).toBe(0);
    expect(agentComment.notifiedCount).toBe(0);
    expect(harness.sdk.callsTo("threads.send")).toEqual([]);
    expect(harness.realtimeSignals.slice(-2)).toEqual([
      {
        channel: "comments:changed",
        payload: { taskId: task.id, notifiedCount: 0 },
      },
      {
        channel: "comments:changed",
        payload: { taskId: task.id, notifiedCount: 0 },
      },
    ]);
    await harness.dispose();
  });

  it("allows an empty comment body only with attachment intent", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    const store = createStore(bb);
    registerTasksApi(bb, store);
    const project = store.tasks.createProject({
      name: "Attachment comments",
      prefix: "ACM",
      color: "blue",
    });
    const task = store.tasks.createTask({
      projectId: project.id,
      title: "Attach without text",
    });

    await expect(
      harness.callRpc("createComment", {
        taskId: task.id,
        body: "",
        notify: false,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });

    await expect(
      harness.callRpc("createComment", {
        taskId: task.id,
        body: "",
        notify: false,
        allowEmptyBody: true,
      }),
    ).resolves.toEqual({
      comment: expect.objectContaining({
        taskId: task.id,
        body: "",
        notifiedCount: 0,
      }),
    });

    await harness.dispose();
  });

  it("keeps the comment and persists only successful steer deliveries", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "tasks",
      sdk: {
        threads: {
          get: async ({ threadId }) =>
            makeThreadResponse({ id: threadId, status: "active" }),
          send: async (input) => {
            if (input.threadId === "thr_failing") {
              throw new Error("active turn finished");
            }
          },
        },
      },
    });
    const store = createStore(bb);
    registerTasksApi(bb, store);
    const project = store.tasks.createProject({
      name: "Partial delivery",
      prefix: "PRT",
      color: "blue",
    });
    const task = store.tasks.createTask({
      projectId: project.id,
      title: "Keep comments durable",
    });
    for (const threadId of ["thr_success", "thr_failing"]) {
      store.tasks.upsertTaskThread({
        taskId: task.id,
        threadId,
        presetName: "Default",
        title: threadId,
        liveStatus: "working",
      });
    }

    const result = tasksRpcContract.createComment.output.parse(
      await harness.callRpc("createComment", {
        taskId: task.id,
        body: "This comment must survive delivery failures.",
        notify: true,
      }),
    );

    expect(result.comment.notifiedCount).toBe(1);
    expect(store.tasks.getComment(result.comment.id)).toMatchObject({
      body: "This comment must survive delivery failures.",
      notifiedCount: 1,
    });
    expect(harness.logEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          message: expect.stringContaining("thr_failing"),
        }),
      ]),
    );
    await harness.dispose();
  });

  it("removes task and comment attachment blobs when deleting a task", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    const store = createStore(bb);
    registerTasksApi(bb, store);
    registerAttachments(bb, store.tasks);
    const project = store.tasks.createProject({
      name: "Cleanup",
      prefix: "CLN",
      color: "blue",
    });
    const task = store.tasks.createTask({
      projectId: project.id,
      title: "Delete blobs",
    });
    const comment = store.tasks.createComment({
      taskId: task.id,
      kind: "user",
      authorName: "Sawyer",
      body: "Attached context",
    });

    try {
      const taskUpload = await harness.fetchHttp(
        "POST",
        `/attachments/upload?taskId=${task.id}&fileName=task.txt&mime=text%2Fplain`,
        { body: "task blob", headers: { "content-type": "text/plain" } },
      );
      const commentUpload = await harness.fetchHttp(
        "POST",
        `/attachments/upload?commentId=${comment.id}&fileName=comment.txt&mime=text%2Fplain`,
        { body: "comment blob", headers: { "content-type": "text/plain" } },
      );
      const taskAttachmentId = (
        (await taskUpload.json()) as { attachmentId: string }
      ).attachmentId;
      const commentAttachmentId = (
        (await commentUpload.json()) as { attachmentId: string }
      ).attachmentId;
      const taskAttachment = store.tasks.getAttachment(taskAttachmentId);
      const commentAttachment = store.tasks.getAttachment(commentAttachmentId);
      if (!taskAttachment || !commentAttachment) {
        throw new Error("attachment rows were not created");
      }
      const database = bb.storage
        .database()
        .prepare<[], { name: string; file: string }>("PRAGMA database_list")
        .all()
        .find((entry) => entry.name === "main");
      if (!database) throw new Error("test database path is missing");
      const blobDirectories = [taskAttachment, commentAttachment].map(
        (attachment) =>
          dirname(join(dirname(database.file), attachment.blobPath)),
      );

      await expect(
        harness.callRpc("deleteTask", { taskId: task.id }),
      ).resolves.toEqual({ deleted: true });
      for (const blobDirectory of blobDirectories) {
        await expect(stat(blobDirectory)).rejects.toMatchObject({
          code: "ENOENT",
        });
      }
    } finally {
      await harness.dispose();
    }
  });

  it("removes attachment blobs when force-deleting a project", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    const store = createStore(bb);
    registerTasksApi(bb, store);
    registerAttachments(bb, store.tasks);
    const project = store.tasks.createProject({
      name: "Project cleanup",
      prefix: "PRJ",
      color: "blue",
    });
    const task = store.tasks.createTask({
      projectId: project.id,
      title: "Delete project blobs",
    });

    try {
      const upload = await harness.fetchHttp(
        "POST",
        `/attachments/upload?taskId=${task.id}&fileName=project.txt&mime=text%2Fplain`,
        { body: "project blob", headers: { "content-type": "text/plain" } },
      );
      const attachmentId = ((await upload.json()) as { attachmentId: string })
        .attachmentId;
      const attachment = store.tasks.getAttachment(attachmentId);
      if (!attachment) throw new Error("attachment row was not created");
      const database = bb.storage
        .database()
        .prepare<[], { name: string; file: string }>("PRAGMA database_list")
        .all()
        .find((entry) => entry.name === "main");
      if (!database) throw new Error("test database path is missing");
      const blobDirectory = dirname(
        join(dirname(database.file), attachment.blobPath),
      );

      await expect(
        harness.callRpc("deleteProject", {
          projectId: project.id,
          force: true,
        }),
      ).resolves.toEqual({ ok: true, deleted: true });
      await expect(stat(blobDirectory)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await harness.dispose();
    }
  });

  it("runs the project and task flow with comments, filtering, summary SQL, and invalidations", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    const store = createStore(bb);
    registerTasksApi(bb, store);

    const projectResult = tasksRpcContract.createProject.output.parse(
      await harness.callRpc("createProject", {
        name: "Plugin",
        prefix: "PLUG",
        color: "blue",
      }),
    );
    const project = projectResult.project;
    const labelResult = tasksRpcContract.createLabel.output.parse(
      await harness.callRpc("createLabel", {
        projectId: project.id,
        name: "Backend",
        color: "green",
      }),
    );

    const createResult = tasksRpcContract.createTask.output.parse(
      await harness.callRpc("createTask", {
        projectId: project.id,
        title: "Ship domain API",
      }),
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error(createResult.error.message);

    const updateResult = tasksRpcContract.updateTask.output.parse(
      await harness.callRpc("updateTask", {
        taskId: createResult.task.id,
        status: "in_review",
        priority: "high",
        dueDate: "2026-07-20",
        labelIds: [labelResult.label.id],
        authorName: "Sawyer",
      }),
    );
    expect(updateResult).toMatchObject({
      ok: true,
      task: { status: "in_review" },
    });
    expect(store.tasks.listComments(createResult.task.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "system",
          authorName: "Sawyer",
          body: "Status changed to In Review by Sawyer",
          notifiedCount: 0,
        }),
        expect.objectContaining({
          kind: "system",
          body: "Priority changed to High by Sawyer",
        }),
        expect.objectContaining({
          kind: "system",
          body: "Due date changed to 2026-07-20 by Sawyer",
        }),
        expect.objectContaining({
          kind: "system",
          body: "Labels changed to Backend by Sawyer",
        }),
      ]),
    );

    const moveResult = tasksRpcContract.boardMove.output.parse(
      await harness.callRpc("boardMove", {
        taskId: createResult.task.id,
        status: "done",
        authorName: "Sawyer",
      }),
    );
    expect(moveResult).toMatchObject({ ok: true, task: { status: "done" } });

    store.tasks.upsertTaskThread({
      taskId: createResult.task.id,
      threadId: "thr_worker",
      presetName: "Default",
      title: "Implement API",
      liveStatus: "working",
    });

    const listResult = tasksRpcContract.listTasks.output.parse(
      await harness.callRpc("listTasks", {
        projectId: project.id,
        statuses: ["done"],
      }),
    );
    expect(listResult.tasks).toEqual([
      expect.objectContaining({
        id: createResult.task.id,
        key: "PLUG-1",
        status: "done",
        labelIds: [labelResult.label.id],
      }),
    ]);

    const subtask = store.tasks.createTask({
      projectId: project.id,
      parentTaskId: createResult.task.id,
      title: "Nested implementation detail",
    });
    store.tasks.upsertTaskThread({
      taskId: subtask.id,
      threadId: "thr_subtask_worker",
      presetName: "Default",
      title: "Implement nested detail",
      liveStatus: "working",
    });

    const summary = tasksRpcContract.sidebarSummary.output.parse(
      await harness.callRpc("sidebarSummary", null),
    );
    expect(summary).toEqual({
      projects: [
        {
          projectId: project.id,
          taskCount: 1,
          activeAgentCount: 1,
        },
      ],
    });
    await expect(
      harness.callRpc("deleteProject", { projectId: project.id }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "project_not_empty",
        message:
          "A project must be empty before it can be deleted; pass force: true to delete its tasks",
      },
    });
    expect(harness.realtimeSignals).toEqual(
      expect.arrayContaining([
        {
          channel: "projects:changed",
          payload: { projectId: project.id },
        },
        {
          channel: "tasks:changed",
          payload: { taskId: createResult.task.id, projectId: project.id },
        },
        {
          channel: "comments:changed",
          payload: { taskId: createResult.task.id },
        },
      ]),
    );

    await expect(
      harness.callRpc("updateProject", {
        projectId: project.id,
        prefix: "NEW",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });

    await harness.dispose();
  });

  it("returns a typed error when a task would exceed one sub-task level", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    registerTasksApi(bb, createStore(bb));

    const projectResult = tasksRpcContract.createProject.output.parse(
      await harness.callRpc("createProject", {
        name: "Depth",
        prefix: "DEP",
        color: "purple",
      }),
    );
    const parentResult = tasksRpcContract.createTask.output.parse(
      await harness.callRpc("createTask", {
        projectId: projectResult.project.id,
        title: "Parent",
      }),
    );
    if (!parentResult.ok) throw new Error(parentResult.error.message);
    const childResult = tasksRpcContract.createTask.output.parse(
      await harness.callRpc("createTask", {
        projectId: projectResult.project.id,
        title: "Child",
        parentTaskId: parentResult.task.id,
      }),
    );
    if (!childResult.ok) throw new Error(childResult.error.message);

    await expect(
      harness.callRpc("createTask", {
        projectId: projectResult.project.id,
        title: "Grandchild",
        parentTaskId: childResult.task.id,
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "subtask_depth_exceeded",
        message: "Tasks support at most one level of sub-tasks",
      },
    });

    await harness.dispose();
  });

  it("allows legacy built-in rows to be renamed and deleted", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    const store = createStore(bb);
    registerTasksApi(bb, store);
    const preset = store.tasks.createPreset({
      name: "Sonnet · high",
      providerId: "claude-code",
      modelId: "claude-sonnet-5",
      reasoningLevel: "high",
      permissionMode: "full",
      environmentKind: "project-default",
      baseBranch: null,
      machineId: null,
      instructions: "",
      builtin: true,
    });

    const updated = await harness.callRpc("updatePreset", {
      presetId: preset.id,
      name: "Renamed",
      modelId: "claude-sonnet-6",
      permissionMode: "workspace-write",
    });
    expect(updated.preset).toMatchObject({
      name: "Renamed",
      modelId: "claude-sonnet-6",
      permissionMode: "workspace-write",
      builtin: true,
    });
    await expect(
      harness.callRpc("deletePreset", { presetId: preset.id }),
    ).resolves.toEqual({ deleted: true });
    expect(store.tasks.getPreset(preset.id)).toBeUndefined();

    await harness.dispose();
  });
});
