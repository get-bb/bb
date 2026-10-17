import { afterEach, describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  type FakePluginHarness,
} from "@get-bb/plugin-sdk/testing";
import { createStore, registerTasksApi } from "../api";
import { tasksRpcContract } from "../shared/contract";
import { listTasksQuery } from "../views/list/data.js";
import type { TasksRpc } from "./data.js";

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
  const rpc: TasksRpc = {
    async call(method, ...args) {
      return tasksRpcContract[method].output.parse(
        await harness.callRpc(method, args[0]),
      );
    },
  };
  return { harness, store, project, rpc };
}

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

    const { tasks } = await rpc.call(
      "listTasks",
      listTasksQuery(null, true, {
        statuses: [],
        priorities: [],
        labelIds: null,
      }),
    );

    expect(tasks.map((entry) => entry.title)).toEqual(["Currently working"]);
  });
});
