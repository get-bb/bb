import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginRpcMethodContract } from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  makeThreadResponse,
  type FakePluginHarness,
} from "@get-bb/plugin-sdk/testing";
import { registerAttachments } from "../attachments";
import { registerTasksCli } from "../cli";
import { registerDelegation } from "../delegate";
import { delegationRpcContract } from "../delegate/contract";
import { tasksRpcContract } from "../shared/contract";
import { createStore, registerTasksApi } from ".";

const harnesses: FakePluginHarness[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(harnesses.splice(0).map((harness) => harness.dispose()));
});

function setup() {
  const { bb, harness } = createFakePluginHost({
    pluginId: "tasks",
    sdk: {
      threads: {
        get: async ({ threadId }) =>
          makeThreadResponse({ id: threadId, status: "active" }),
      },
    },
  });
  harnesses.push(harness);
  const store = createStore(bb);
  registerTasksApi(bb, store);
  registerAttachments(bb, store.tasks);
  registerDelegation(bb, store);
  registerTasksCli(bb, store, { name: "tasks", version: "test" });
  const project = store.tasks.createProject({
    name: "Review",
    prefix: "REV",
    color: "blue",
  });
  const other = store.tasks.createProject({
    name: "Other",
    prefix: "OTH",
    color: "red",
  });
  const task = store.tasks.createTask({ projectId: project.id, title: "One" });
  const sibling = store.tasks.createTask({
    projectId: project.id,
    title: "Two",
  });
  const label = store.tasks.createLabel({
    projectId: project.id,
    name: "bug",
    color: "red",
  });

  async function readTags(method: string, input: unknown) {
    const declaration: PluginRpcMethodContract | undefined =
      method in tasksRpcContract
        ? tasksRpcContract[method as keyof typeof tasksRpcContract]
        : undefined;
    if (declaration === undefined) throw new Error(`unknown read ${method}`);
    const parsed = await declaration.input["~standard"].validate(input);
    if (parsed.issues !== undefined) throw new Error(`bad input ${method}`);
    const output = await harness.callRpc(method, input);
    const keyed =
      declaration.keyTags === undefined ||
      typeof output !== "object" ||
      output === null
        ? []
        : Object.entries(output).flatMap(
            ([key, value]) => declaration.keyTags?.(key, value) ?? [],
          );
    return [...(declaration.tags?.(parsed.value, output) ?? []), ...keyed];
  }

  async function refreshes(
    read: [method: string, input: unknown],
    write: () => Promise<unknown>,
  ): Promise<boolean> {
    const tags = await readTags(...read);
    const before = harness.experimental_rpcInvalidations.length;
    await write();
    return harness.experimental_rpcInvalidations
      .slice(before)
      .some((invalidated) =>
        invalidated === null
          ? true
          : invalidated.some((tag) => tags.includes(tag)),
      );
  }

  return { harness, store, project, other, task, sibling, label, refreshes };
}

describe("Tasks live reads", () => {
  it("refreshes a task's detail and lists when the task is edited", async () => {
    const { harness, project, task, refreshes } = setup();
    const edit = () =>
      harness.callRpc("updateTask", { taskId: task.id, title: "Renamed" });

    expect(await refreshes(["getTaskByKey", { taskKey: "REV-1" }], edit)).toBe(
      true,
    );
    expect(
      await refreshes(["listAllTasks", { projectId: project.id }], edit),
    ).toBe(true);
    expect(await refreshes(["listAllTasks", {}], edit)).toBe(true);
    expect(await refreshes(["sidebarOpenTaskCount", null], edit)).toBe(true);
  });

  it("leaves other tasks, other projects and comments alone on a title edit", async () => {
    const { harness, other, task, refreshes } = setup();
    const edit = () =>
      harness.callRpc("updateTask", { taskId: task.id, title: "Renamed" });

    expect(await refreshes(["getTaskByKey", { taskKey: "REV-2" }], edit)).toBe(
      false,
    );
    expect(
      await refreshes(["listAllTasks", { projectId: other.id }], edit),
    ).toBe(false);
    expect(await refreshes(["listComments", { taskId: task.id }], edit)).toBe(
      false,
    );
    expect(
      await refreshes(
        ["listTaskCardMeta", { projectId: task.projectId }],
        edit,
      ),
    ).toBe(false);
  });

  it("refreshes activity when an edit writes a system comment", async () => {
    const { harness, task, refreshes } = setup();

    expect(
      await refreshes(["listComments", { taskId: task.id }], () =>
        harness.callRpc("updateTask", { taskId: task.id, status: "done" }),
      ),
    ).toBe(true);
    expect(
      await refreshes(["listComments", { taskId: task.id }], () =>
        harness.callRpc("createComment", {
          taskId: task.id,
          body: "Note",
          notify: false,
        }),
      ),
    ).toBe(true);
  });

  it("resolves a task-key miss once a matching task is created", async () => {
    const { harness, project, refreshes } = setup();

    expect(
      await refreshes(["getTaskByKey", { taskKey: "REV-03" }], () =>
        harness.callRpc("createTask", {
          projectId: project.id,
          title: "Three",
        }),
      ),
    ).toBe(true);
  });

  it("refreshes task keys when the project prefix changes", async () => {
    const { harness, project, refreshes } = setup();
    const rename = () =>
      harness.callRpc("renameProjectPrefix", {
        projectId: project.id,
        prefix: "NEW",
      });

    expect(
      await refreshes(["getTaskByKey", { taskKey: "REV-1" }], rename),
    ).toBe(true);
    expect(
      await refreshes(["listAllTasks", { projectId: project.id }], rename),
    ).toBe(true);
  });

  it("refreshes both projects' boards when a task moves", async () => {
    const { harness, other, project, task, refreshes } = setup();
    const move = (projectId: string) => () =>
      harness.callRpc("moveTaskToProject", { taskId: task.id, projectId });

    expect(
      await refreshes(
        ["listAllTasks", { projectId: project.id }],
        move(other.id),
      ),
    ).toBe(true);
    expect(
      await refreshes(
        ["listAllTasks", { projectId: other.id }],
        move(project.id),
      ),
    ).toBe(true);
    expect(await refreshes(["listProjects", {}], move(other.id))).toBe(true);
  });

  it("refreshes card counts and attachment lists on upload", async () => {
    const { harness, project, task, refreshes } = setup();
    const upload = () =>
      harness.fetchHttp(
        "POST",
        `/attachments/upload?taskId=${task.id}&fileName=a.txt&mime=text/plain`,
        { body: "a" },
      );

    expect(
      await refreshes(["listTaskCardMeta", { projectId: project.id }], upload),
    ).toBe(true);
    expect(
      await refreshes(["listAttachments", { taskId: task.id }], upload),
    ).toBe(true);
  });

  it("refreshes working agents when a thread is attached", async () => {
    const { harness, project, task, refreshes } = setup();
    const attach = (threadId: string) => () =>
      harness.callRpc("taskThreadsAttach", { taskId: task.id, threadId });

    expect(
      await refreshes(
        ["listTaskCardMeta", { projectId: project.id }],
        attach("thr_one"),
      ),
    ).toBe(true);
    expect(
      await refreshes(
        ["listAllTasks", { activeOnly: true }],
        attach("thr_two"),
      ),
    ).toBe(true);
    expect(
      await refreshes(
        ["listTaskThreads", { taskId: task.id }],
        attach("thr_three"),
      ),
    ).toBe(true);
    expect(Object.keys(delegationRpcContract)).toContain("taskThreadsAttach");
  });

  it("refreshes card metadata when a subtask becomes a top-level task", async () => {
    const { harness, project, store, task, refreshes } = setup();
    const child = () =>
      store.tasks.createTask({
        projectId: project.id,
        title: "Child",
        parentTaskId: task.id,
      });
    const cards: [string, unknown] = [
      "listTaskCardMeta",
      { projectId: project.id },
    ];

    const promoted = child();
    expect(
      await refreshes(cards, () =>
        harness.callRpc("updateTask", {
          taskId: promoted.id,
          parentTaskId: null,
        }),
      ),
    ).toBe(true);
    child();
    expect(
      await refreshes(cards, () =>
        harness.callRpc("deleteTask", { taskId: task.id }),
      ),
    ).toBe(true);
  });

  it("refreshes keyed project labels and labelled tasks", async () => {
    const { harness, label, project, refreshes } = setup();

    expect(
      await refreshes(["labelsByProject", { keys: [project.id] }], () =>
        harness.callRpc("createLabel", {
          projectId: project.id,
          name: "ux",
          color: "blue",
        }),
      ),
    ).toBe(true);
    expect(
      await refreshes(["listAllTasks", { projectId: project.id }], () =>
        harness.callRpc("deleteLabel", { labelId: label.id }),
      ),
    ).toBe(true);
  });

  it("refreshes folders, projects and presets", async () => {
    const { harness, refreshes, store } = setup();
    const folder = store.tasks.createFolder({ name: "Old" });

    expect(
      await refreshes(["listFolders", null], () =>
        harness.callRpc("createFolder", { name: "New" }),
      ),
    ).toBe(true);
    expect(
      await refreshes(["listProjects", {}], () =>
        harness.callRpc("deleteFolder", { folderId: folder.id }),
      ),
    ).toBe(true);
    expect(
      await refreshes(["listPresets", null], () =>
        harness.callRpc("createPreset", {
          name: "Worker",
          providerId: "codex",
          modelId: "gpt",
          reasoningLevel: "medium",
          permissionMode: "auto",
        }),
      ),
    ).toBe(true);
  });

  it("refreshes reads after a CLI edit", async () => {
    const { harness, refreshes, store, task } = setup();

    expect(
      await refreshes(["getTaskByKey", { taskKey: "REV-1" }], () =>
        harness.runCli(["update", "REV-1", "--title", "From CLI"]),
      ),
    ).toBe(true);
    expect(store.tasks.getTask(task.id)?.title).toBe("From CLI");
  });
});

describe("listAllTasks and listTaskCardMeta", () => {
  it("returns every matching task past one page", async () => {
    const { harness, project, store } = setup();
    for (let index = 0; index < 600; index += 1)
      store.tasks.createTask({ projectId: project.id, title: `Bulk ${index}` });

    const result = tasksRpcContract.listAllTasks.output.parse(
      await harness.callRpc("listAllTasks", { projectId: project.id }),
    );

    expect(result.tasks).toHaveLength(602);
  });

  it("counts top-level attachments and lists only working agents", async () => {
    const { harness, project, store, task, sibling } = setup();
    const subtask = store.tasks.createTask({
      projectId: project.id,
      title: "Child",
      parentTaskId: task.id,
    });
    for (const [taskId, liveStatus] of [
      [task.id, "working"],
      [sibling.id, "completed"],
      [subtask.id, "working"],
    ] as const)
      store.tasks.upsertTaskThread({
        taskId,
        threadId: `thr_${liveStatus}_${taskId.slice(-4)}`,
        presetName: "Worker",
        title: "Worker",
        liveStatus,
      });
    for (const taskId of [task.id, task.id, subtask.id])
      await harness.fetchHttp(
        "POST",
        `/attachments/upload?taskId=${taskId}&fileName=a.txt&mime=text/plain`,
        { body: "a" },
      );

    const { cards } = tasksRpcContract.listTaskCardMeta.output.parse(
      await harness.callRpc("listTaskCardMeta", { projectId: project.id }),
    );

    expect(cards).toEqual([
      expect.objectContaining({
        taskId: task.id,
        attachmentCount: 2,
        activeThreads: [expect.objectContaining({ liveStatus: "working" })],
      }),
    ]);
  });
});
