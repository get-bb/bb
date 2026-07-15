import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createTasksStore } from "../db";
import { deliverCommentToAgents } from ".";

function taskWithThreads() {
  const host = createFakePluginHost({
    pluginId: "tasks",
    sdk: { threads: { send: async () => undefined } },
  });
  const store = createTasksStore(host.bb.storage.database());
  const project = store.createProject({
    name: "Plugin",
    prefix: "PLUG",
    color: "blue",
  });
  const task = store.createTask({ projectId: project.id, title: "Steer work" });
  for (const [threadId, liveStatus] of [
    ["thr_starting", "starting"],
    ["thr_working", "working"],
    ["thr_completed", "completed"],
  ] as const) {
    store.upsertTaskThread({
      taskId: task.id,
      threadId,
      presetName: "Default",
      title: threadId,
      liveStatus,
    });
  }
  return { ...host, store, task };
}

describe("comment steer delivery", () => {
  it("steers starting and working threads without waking completed threads", async () => {
    const { bb, harness, store, task } = taskWithThreads();

    await expect(
      deliverCommentToAgents(bb, store, {
        taskId: task.id,
        commentId: "01J00000000000000000000000",
        authorName: "Sawyer",
        body: "Please include the regression test.",
      }),
    ).resolves.toBe(2);

    expect(harness.sdk.callsTo("threads.send")).toEqual([
      [
        {
          threadId: "thr_starting",
          input: [
            {
              type: "text",
              text:
                "New comment on task PLUG-1 from Sawyer: Please include the regression test.\n\n" +
                "This is a steer — fold it into your current work on this task; reply via bb tasks comment PLUG-1 when relevant.",
              mentions: [],
            },
          ],
          mode: "steer",
        },
      ],
      [
        expect.objectContaining({
          threadId: "thr_working",
          mode: "steer",
        }),
      ],
    ]);
  });

  it("isolates send failures and counts only successful deliveries", async () => {
    const { bb, harness, store, task } = taskWithThreads();
    harness.sdk.stub("threads.send", async (input: never) => {
      const request = input as { threadId: string };
      if (request.threadId === "thr_starting") throw new Error("turn ended");
    });

    await expect(
      deliverCommentToAgents(bb, store, {
        taskId: task.id,
        commentId: "01J00000000000000000000000",
        authorName: "Sawyer",
        body: "Please retry safely.",
      }),
    ).resolves.toBe(1);
    expect(harness.logEntries).toContainEqual({
      level: "warn",
      message:
        "failed to steer comment 01J00000000000000000000000 to thread thr_starting: turn ended",
    });
  });
});
