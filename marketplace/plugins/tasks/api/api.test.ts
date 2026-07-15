import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { registerAttachments } from "../attachments";
import { tasksRpcContract } from "../shared/contract";
import { createStore, registerTasksApi } from ".";

describe("Tasks RPC domain API", () => {
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
});
