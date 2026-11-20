import { afterEach, describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { createStore, registerTasksApi } from ".";
import { tasksRpcContract } from "../shared/contract";

describe("task elapsed time", () => {
  const disposers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    await Promise.all(disposers.splice(0).map((dispose) => dispose()));
  });

  it("keeps the first start across idle, restart and a sub-agent", async () => {
    let status: "active" | "idle" = "active";
    let child = false;
    const { bb, harness } = createFakePluginHost({
      pluginId: "tasks",
      sdk: {
        threads: {
          list: async ({ threadIds = [] } = {}) =>
            threadIds.map((threadId) =>
              makeThreadResponse({
                id: threadId,
                status: threadId === "thr_child" ? "active" : status,
                createdAt: threadId === "thr_child" ? 9_000 : 1_000,
              }),
            ),
          experimental_listDescendants: async ({ threadIds }) => ({
            threads: threadIds.map((threadId) => ({
              threadId,
              descendantIds: child ? ["thr_child"] : [],
            })),
          }),
        },
      },
    });
    disposers.push(() => harness.dispose());
    const store = createStore(bb);
    registerTasksApi(bb, store);
    const project = store.tasks.createProject({
      name: "Test",
      prefix: "TST",
      color: "blue",
    });
    const task = store.tasks.createTask({
      projectId: project.id,
      title: "Test",
    });
    store.tasks.upsertTaskThread({
      taskId: task.id,
      threadId: "thr_root",
      title: "Worker",
      presetName: "Worker",
      liveStatus: "working",
    });
    const read = async () =>
      tasksRpcContract.listTaskTiming.output.parse(
        await harness.callRpc("listTaskTiming", { projectId: project.id }),
      ).timings[0];
    expect(await read()).toEqual({
      taskId: task.id,
      start: 1_000,
      working: true,
    });
    status = "idle";
    expect(await read()).toEqual({
      taskId: task.id,
      start: 1_000,
      working: false,
    });
    status = "active";
    expect(await read()).toEqual({
      taskId: task.id,
      start: 1_000,
      working: true,
    });
    child = true;
    expect(await read()).toEqual({
      taskId: task.id,
      start: 1_000,
      working: true,
    });
  });

  it("reads hidden and archived descendants in bounded batches and skips missing roots", async () => {
    const calls: number[] = [];
    const descendants = Array.from({ length: 201 }, (_, i) => `thr_${i}`);
    const { bb, harness } = createFakePluginHost({
      pluginId: "tasks",
      sdk: {
        threads: {
          list: async ({
            threadIds = [],
            includeHidden,
            limit,
          }: {
            threadIds?: readonly string[];
            includeHidden?: boolean;
            limit?: number;
          } = {}) => {
            expect(includeHidden).toBe(true);
            expect(limit).toBe(200);
            calls.push(threadIds.length);
            return threadIds
              .filter((id) => id !== "thr_deleted")
              .map((id) =>
                makeThreadResponse({
                  id,
                  createdAt: id === "thr_200" ? 100 : 1_000,
                  status: id === "thr_200" ? "active" : "idle",
                }),
              );
          },
          experimental_listDescendants: async (args) => {
            expect(args.includeArchived).toBe(true);
            expect(args.includeHidden).toBe(true);
            return {
              threads: args.threadIds
                .filter((id) => id !== "thr_deleted")
                .map((threadId) => ({ threadId, descendantIds: descendants })),
            };
          },
        },
      },
    });
    disposers.push(() => harness.dispose());
    const store = createStore(bb);
    registerTasksApi(bb, store);
    const project = store.tasks.createProject({
      name: "Test",
      prefix: "TST",
      color: "blue",
    });
    const task = store.tasks.createTask({ projectId: project.id, title: "Test" });
    for (const threadId of ["thr_root", "thr_deleted"]) {
      store.tasks.upsertTaskThread({
        taskId: task.id,
        threadId,
        title: "Worker",
        presetName: "Worker",
        liveStatus: "working",
      });
    }
    const result = tasksRpcContract.listTaskTiming.output.parse(
      await harness.callRpc("listTaskTiming", { projectId: project.id }),
    );
    expect(result.timings).toEqual([{ taskId: task.id, start: 100, working: true }]);
    expect(calls).toEqual([200, 3]);
  });
});
