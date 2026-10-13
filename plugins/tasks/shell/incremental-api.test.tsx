// @vitest-environment jsdom
import { cleanup, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import {
  loadPluginApp,
  renderSlot,
  type PluginRpcTestHandlers,
} from "@get-bb/plugin-sdk/testing/app";
import { createStore, registerTasksApi } from "../api";
import { tasksRpcContract, type TasksRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

function setup() {
  const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
  const store = createStore(bb);
  registerTasksApi(bb, store);
  const project = store.tasks.createProject({
    name: "Review",
    prefix: "REV",
    color: "blue",
  });
  const rpc = Object.fromEntries(
    Object.entries(tasksRpcContract).map(([method, contract]) => [
      method,
      async (input: unknown) =>
        contract.output.parse(await harness.callRpc(method, input)),
    ]),
  ) as PluginRpcTestHandlers<TasksRpcContract>;
  return { harness, store, project, rpc };
}

it("shows a working task in Active without an explicit status filter", async () => {
  const { harness, store, project, rpc } = setup();
  try {
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
    expect(store.tasks.listTasks({ activeOnly: true })).toHaveLength(1);
    const slot = renderSlot(app.navPanels[0]!, { subPath: "active" }, { rpc });
    await slot.findByText("Currently working");
  } finally {
    cleanup();
    await harness.dispose();
  }
});

it.each(["list", "board"])(
  "shows former subtasks after parent deletion in %s",
  async (view) => {
    const { harness, store, project, rpc } = setup();
    try {
      const parent = store.tasks.createTask({
        projectId: project.id,
        title: "Parent task",
        status: "todo",
      });
      const child = store.tasks.createTask({
        projectId: project.id,
        title: "Former child",
        parentTaskId: parent.id,
        status: "todo",
      });
      const slot = renderSlot(
        app.navPanels[0]!,
        { subPath: `${project.id}?view=${view}` },
        { rpc },
      );
      await slot.findByText("Parent task");
      await harness.callRpc("deleteTask", { taskId: parent.id });
      expect(store.tasks.getTask(child.id)?.parentTaskId).toBeNull();
      for (const signal of harness.realtimeSignals)
        await slot.emitRealtime(signal.channel, signal.payload);
      await waitFor(() => expect(slot.queryByText("Parent task")).toBeNull());
      await slot.findByText("Former child");
    } finally {
      cleanup();
      await harness.dispose();
    }
  },
);
