import { afterEach, describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  type FakePluginHarness,
} from "@get-bb/plugin-sdk/testing";
import { createStore, registerTasksApi } from "../api";
import { tasksRpcContract } from "../shared/contract";
import { rpcInput } from "../test-fixtures.js";
import { fetchBoard, patchBoard } from "../views/board/board-data.js";
import { listTasksQuery } from "../views/list/data.js";
import { listAllTasks, patchTasks, type TasksRpc } from "./data.js";
import { signalTaskIds, type TaskSignal } from "./signal-scheduler.js";

const harnesses: FakePluginHarness[] = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.dispose()));
});

function setup() {
  const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
  harnesses.push(harness);
  const store = createStore(bb);
  registerTasksApi(bb, store);
  const project = store.tasks.createProject({
    name: "Review",
    prefix: "REV",
    color: "blue",
  });
  const calls: { method: string; input: unknown }[] = [];
  const rpc: TasksRpc = {
    async call(method, ...args) {
      const input = args[0];
      calls.push({ method, input });
      return tasksRpcContract[method].output.parse(
        await harness.callRpc(method, input),
      );
    },
  };
  const callsTo = (method: string) =>
    calls
      .filter((call) => call.method === method)
      .map((call) => rpcInput(call.input).taskId);
  const resetCalls = () => {
    calls.length = 0;
  };
  const taskSignals = (): TaskSignal[] =>
    harness.realtimeSignals.map((signal) => ({
      channel: "tasks:changed",
      taskId: String(rpcInput(signal.payload).taskId),
    }));
  return { harness, store, project, rpc, callsTo, resetCalls, taskSignals };
}

describe("patchTasks", () => {
  it("re-reads only the changed row instead of refetching the list", async () => {
    const { store, project, rpc, callsTo, resetCalls } = setup();
    const first = store.tasks.createTask({
      projectId: project.id,
      title: "First",
    });
    const second = store.tasks.createTask({
      projectId: project.id,
      title: "Second",
    });
    const current = await listAllTasks(rpc, { projectId: project.id });
    resetCalls();

    store.tasks.updateTask(first.id, { title: "First renamed" });
    const next = await patchTasks(rpc, current, [first.id], () => true);

    expect(next.map((task) => [task.id, task.title])).toEqual([
      [first.id, "First renamed"],
      [second.id, "Second"],
    ]);
    expect(callsTo("getTask")).toEqual([first.id]);
    expect(callsTo("listTasks")).toEqual([]);
  });

  it("drops a deleted task without a refetch", async () => {
    const { store, project, rpc, callsTo, resetCalls } = setup();
    const first = store.tasks.createTask({
      projectId: project.id,
      title: "First",
    });
    const second = store.tasks.createTask({
      projectId: project.id,
      title: "Second",
    });
    const current = await listAllTasks(rpc, { projectId: project.id });
    resetCalls();

    store.tasks.deleteTask(second.id);
    const next = await patchTasks(rpc, current, [second.id], () => true);

    expect(next.map((task) => task.id)).toEqual([first.id]);
    expect(callsTo("listTasks")).toEqual([]);
  });

  it("adds subtasks promoted by deleting their parent", async () => {
    const { harness, store, project, rpc, taskSignals } = setup();
    const parent = store.tasks.createTask({
      projectId: project.id,
      title: "Parent task",
    });
    const child = store.tasks.createTask({
      projectId: project.id,
      title: "Former child",
      parentTaskId: parent.id,
    });
    const current = await listAllTasks(rpc, {
      projectId: project.id,
      parentTaskId: null,
    });

    await harness.callRpc("deleteTask", { taskId: parent.id });
    const next = await patchTasks(
      rpc,
      current,
      signalTaskIds(taskSignals(), "tasks:changed"),
      (task) => task.parentTaskId === null,
    );

    expect(next.map((task) => task.id)).toEqual([child.id]);
  });
});

describe("patchBoard", () => {
  it("shows subtasks promoted by deleting their parent as cards", async () => {
    const { harness, store, project, rpc, taskSignals } = setup();
    const parent = store.tasks.createTask({
      projectId: project.id,
      title: "Parent task",
    });
    const child = store.tasks.createTask({
      projectId: project.id,
      title: "Former child",
      parentTaskId: parent.id,
    });
    const current = await fetchBoard(rpc, project.id);
    expect(current.tasks.map((task) => task.id)).toEqual([parent.id]);

    await harness.callRpc("deleteTask", { taskId: parent.id });
    const next = await patchBoard(rpc, project.id, current, taskSignals());

    expect(next?.tasks.map((task) => task.id)).toEqual([child.id]);
    expect(next?.subtasks).toEqual([]);
  });

  it("re-reads only the changed card", async () => {
    const { store, project, rpc, callsTo, resetCalls } = setup();
    const first = store.tasks.createTask({
      projectId: project.id,
      title: "First",
      status: "todo",
    });
    store.tasks.createTask({
      projectId: project.id,
      title: "Second",
      status: "done",
    });
    const current = await fetchBoard(rpc, project.id);
    resetCalls();

    store.tasks.updateTask(first.id, { status: "in_review" });
    const next = await patchBoard(rpc, project.id, current, [
      { channel: "tasks:changed", taskId: first.id },
    ]);

    expect(next?.tasks.find((task) => task.id === first.id)?.status).toBe(
      "in_review",
    );
    expect(callsTo("getTask")).toEqual([first.id]);
    expect(callsTo("listAttachments")).toEqual([first.id]);
    expect(callsTo("listTasks")).toEqual([]);
  });

  it("ignores thread signals for tasks outside the board", async () => {
    const { store, project, rpc, callsTo, resetCalls } = setup();
    store.tasks.createTask({ projectId: project.id, title: "First" });
    const current = await fetchBoard(rpc, project.id);
    resetCalls();

    const next = await patchBoard(rpc, project.id, current, [
      { channel: "threads:changed", taskId: "01HZZZZZZZZZZZZZZZZZZZZOTHER" },
    ]);

    expect(next?.tasks).toEqual(current.tasks);
    expect(callsTo("getTask")).toEqual([]);
    expect(callsTo("listTaskThreads")).toEqual([]);
    expect(callsTo("listTasks")).toEqual([]);
  });
});

describe("listTasksQuery", () => {
  it("finds a working task in Active without an explicit status filter", async () => {
    const { store, project, rpc } = setup();
    const task = store.tasks.createTask({
      projectId: project.id,
      title: "Currently working",
      status: "todo",
    });
    store.tasks.upsertTaskThread({
      taskId: task.id,
      threadId: "thr_review",
      presetName: "Default",
      title: "Worker",
      liveStatus: "working",
    });

    const tasks = await listAllTasks(
      rpc,
      listTasksQuery(null, true, {
        statuses: [],
        priorities: [],
        labelIds: null,
      }),
    );

    expect(tasks.map((entry) => entry.title)).toEqual(["Currently working"]);
  });
});
