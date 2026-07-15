import {
  createFakePluginHost,
  makeThreadResponse,
} from "@bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createStore } from "../api";
import type { TaskThreadLiveStatus } from "../db";
import { registerLifecycle } from ".";

interface TrackedThreadFixture {
  bb: ReturnType<typeof createFakePluginHost>["bb"];
  harness: ReturnType<typeof createFakePluginHost>["harness"];
  store: ReturnType<typeof createStore>;
  taskId: string;
  taskThreadId: string;
}

function trackedThreadFixture(
  liveStatus: TaskThreadLiveStatus,
  sdkStatus: "idle" | "starting" | "active" | "stopping" | "error",
): TrackedThreadFixture {
  const host = createFakePluginHost({
    pluginId: "tasks",
    sdk: {
      threads: {
        get: async () =>
          makeThreadResponse({
            id: "thr_worker",
            title: "Lifecycle worker",
            status: sdkStatus,
          }),
      },
    },
  });
  const store = createStore(host.bb);
  const project = store.tasks.createProject({
    name: "Tasks plugin",
    prefix: "TASK",
    color: "blue",
  });
  const task = store.tasks.createTask({
    projectId: project.id,
    title: "Track lifecycle",
  });
  const taskThread = store.tasks.upsertTaskThread({
    taskId: task.id,
    threadId: "thr_worker",
    presetName: "GPT-5.6 · high",
    title: "Lifecycle worker",
    liveStatus,
  });

  return {
    ...host,
    store,
    taskId: task.id,
    taskThreadId: taskThread.id,
  };
}

describe("task thread lifecycle", () => {
  it("moves a working thread to completed, comments, and publishes", async () => {
    const fixture = trackedThreadFixture("working", "active");
    await registerLifecycle(fixture.bb, fixture.store);

    await fixture.harness.emitThreadEvent("thread.deleted", {
      thread: makeThreadResponse({
        id: "thr_worker",
        title: "Lifecycle worker",
        deletedAt: Date.now(),
      }),
    });

    expect(
      fixture.store.tasks.getTaskThread(fixture.taskThreadId)?.liveStatus,
    ).toBe("completed");
    expect(fixture.store.tasks.listComments(fixture.taskId)).toContainEqual(
      expect.objectContaining({
        kind: "system",
        authorName: "Tasks",
        presetName: "GPT-5.6 · high",
        threadId: "thr_worker",
        body: 'Thread "Lifecycle worker" completed — final message posted · thr_worker',
      }),
    );
    expect(fixture.harness.realtimeSignals).toEqual([
      { channel: "threads:changed", payload: { taskId: fixture.taskId } },
      { channel: "comments:changed", payload: { taskId: fixture.taskId } },
    ]);

    await fixture.harness.dispose();
  });

  it("moves a working thread to failed, comments, and publishes", async () => {
    const fixture = trackedThreadFixture("working", "active");
    await registerLifecycle(fixture.bb, fixture.store);

    await fixture.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({
        id: "thr_worker",
        title: "Lifecycle worker",
        status: "error",
      }),
      error: "provider exited",
    });

    expect(
      fixture.store.tasks.getTaskThread(fixture.taskThreadId)?.liveStatus,
    ).toBe("failed");
    expect(fixture.store.tasks.listComments(fixture.taskId)).toContainEqual(
      expect.objectContaining({
        kind: "system",
        body: 'Thread "Lifecycle worker" failed — final message posted · thr_worker',
      }),
    );
    expect(fixture.harness.realtimeSignals).toEqual([
      { channel: "threads:changed", payload: { taskId: fixture.taskId } },
      { channel: "comments:changed", payload: { taskId: fixture.taskId } },
    ]);

    await fixture.harness.dispose();
  });

  it("reconciles a stale non-terminal row on load", async () => {
    const fixture = trackedThreadFixture("starting", "idle");

    await registerLifecycle(fixture.bb, fixture.store);

    expect(fixture.harness.sdk.callsTo("threads.get")).toEqual([
      [{ threadId: "thr_worker" }],
    ]);
    expect(
      fixture.store.tasks.getTaskThread(fixture.taskThreadId)?.liveStatus,
    ).toBe("idle");
    expect(fixture.harness.realtimeSignals).toEqual([
      { channel: "threads:changed", payload: { taskId: fixture.taskId } },
      { channel: "comments:changed", payload: { taskId: fixture.taskId } },
    ]);

    await fixture.harness.dispose();
  });

  it("ignores lifecycle events for non-tracked threads", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
    const store = createStore(bb);
    await registerLifecycle(bb, store);

    await harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thr_untracked", status: "error" }),
      error: "not ours",
    });

    expect(harness.realtimeSignals).toEqual([]);
    expect(store.tasks.listTasks()).toEqual([]);

    await harness.dispose();
  });
});
