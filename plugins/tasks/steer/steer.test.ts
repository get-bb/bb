import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createTasksStore } from "../db";
import { deliverCommentToLatestAgent } from ".";

function setup(
  getThread: (threadId: string) => ReturnType<typeof makeThreadResponse> = (
    threadId,
  ) => makeThreadResponse({ id: threadId, status: "active" }),
) {
  const host = createFakePluginHost({
    pluginId: "tasks",
    sdk: {
      threads: {
        get: async ({ threadId }) => getThread(threadId),
        send: async () => undefined,
      },
    },
  });
  const db = host.bb.storage.database();
  const store = createTasksStore(db);
  const project = store.createProject({
    name: "Plugin",
    prefix: "PLUG",
    color: "blue",
  });
  const task = store.createTask({ projectId: project.id, title: "Steer work" });
  return { ...host, db, store, task };
}

const input = {
  commentId: "01J00000000000000000000000",
  authorName: "Sawyer",
  body: "Please include the regression test.",
};

describe("comment notification delivery", () => {
  it("notifies only the latest replying agent despite newer unrelated task activity", async () => {
    const { bb, db, harness, store, task } = setup();
    const older = store.createComment({
      taskId: task.id,
      kind: "agent",
      authorName: "First agent",
      threadId: "thr_first",
      body: "First reply",
    });
    const latest = store.createComment({
      taskId: task.id,
      kind: "agent",
      authorName: "Second agent",
      threadId: "thr_second",
      body: "Latest reply",
    });
    store.upsertTaskThread({
      taskId: task.id,
      threadId: "thr_second",
      presetName: "Default",
      title: "Second agent",
      liveStatus: "working",
    });
    const unrelated = store.upsertTaskThread({
      taskId: task.id,
      threadId: "thr_first",
      presetName: "Default",
      title: "First agent",
      liveStatus: "working",
    });
    db.prepare("UPDATE comments SET created_at = ? WHERE id = ?").run(
      "2026-07-16T10:00:00.000Z",
      older.id,
    );
    db.prepare("UPDATE comments SET created_at = ? WHERE id = ?").run(
      "2026-07-16T11:00:00.000Z",
      latest.id,
    );
    db.prepare("UPDATE task_threads SET updated_at = ? WHERE id = ?").run(
      "2026-07-16T12:00:00.000Z",
      unrelated.id,
    );

    await expect(
      deliverCommentToLatestAgent(bb, store, { taskId: task.id, ...input }),
    ).resolves.toEqual({
      notifiedCount: 1,
      outcomes: [{ threadId: "thr_second", status: "delivered" }],
    });
    expect(harness.sdk.callsTo("threads.send")).toEqual([
      [
        {
          threadId: "thr_second",
          input: [
            {
              type: "text",
              text:
                "New comment on task PLUG-1 from Sawyer: Please include the regression test.\n\n" +
                "Treat this as updated context for your work on this task; reply via bb tasks comment PLUG-1 when relevant.",
              mentions: [],
            },
          ],
          mode: "steer-if-active",
        },
      ],
    ]);
  });

  it("uses resume-capable delivery for an idle latest responder", async () => {
    const { bb, harness, store, task } = setup((threadId) =>
      makeThreadResponse({ id: threadId, status: "idle" }),
    );
    store.createComment({
      taskId: task.id,
      kind: "agent",
      authorName: "Idle agent",
      threadId: "thr_idle",
      body: "Ready for more context",
    });

    await expect(
      deliverCommentToLatestAgent(bb, store, { taskId: task.id, ...input }),
    ).resolves.toEqual({
      notifiedCount: 1,
      outcomes: [{ threadId: "thr_idle", status: "delivered" }],
    });
    expect(harness.sdk.callsTo("threads.send")).toEqual([
      [
        expect.objectContaining({
          threadId: "thr_idle",
          mode: "steer-if-active",
        }),
      ],
    ]);
  });

  it("does nothing when no agent has replied", async () => {
    const { bb, harness, store, task } = setup();

    await expect(
      deliverCommentToLatestAgent(bb, store, { taskId: task.id, ...input }),
    ).resolves.toEqual({ notifiedCount: 0, outcomes: [] });
    expect(harness.sdk.callsTo("threads.get")).toEqual([]);
    expect(harness.sdk.callsTo("threads.send")).toEqual([]);
  });

  it("does not fall back when the latest agent reply has no thread", async () => {
    const { bb, harness, store, task } = setup();
    store.createComment({
      taskId: task.id,
      kind: "agent",
      authorName: "Older linked agent",
      threadId: "thr_older",
      body: "Older reply",
    });
    store.createComment({
      taskId: task.id,
      kind: "agent",
      authorName: "Legacy agent",
      body: "Latest unlinked reply",
    });

    await expect(
      deliverCommentToLatestAgent(bb, store, { taskId: task.id, ...input }),
    ).resolves.toEqual({
      notifiedCount: 0,
      outcomes: [
        {
          threadId: null,
          status: "skipped",
          reason: "latest agent reply has no thread",
        },
      ],
    });
    expect(harness.sdk.callsTo("threads.send")).toEqual([]);
  });

  it("preserves side-chat privacy and does not fall back", async () => {
    const { bb, harness, store, task } = setup((threadId) =>
      makeThreadResponse({
        id: threadId,
        status: "idle",
        originKind: "fork",
        originPluginId: "side-chat",
        visibility: "hidden",
      }),
    );
    store.createComment({
      taskId: task.id,
      kind: "agent",
      authorName: "Side chat",
      threadId: "thr_side_chat",
      body: "Private reply",
    });

    await expect(
      deliverCommentToLatestAgent(bb, store, { taskId: task.id, ...input }),
    ).resolves.toEqual({
      notifiedCount: 0,
      outcomes: [
        {
          threadId: "thr_side_chat",
          status: "skipped",
          reason: "latest agent reply belongs to a side chat",
        },
      ],
    });
    expect(harness.sdk.callsTo("threads.send")).toEqual([]);
  });

  it("preserves side-chat privacy for the plugin's hidden forks too", async () => {
    const { bb, harness, store, task } = setup((threadId) =>
      makeThreadResponse({
        id: threadId,
        status: "idle",
        originKind: "fork",
        originPluginId: "side-chat",
        visibility: "hidden",
      }),
    );
    store.createComment({
      taskId: task.id,
      kind: "agent",
      authorName: "Side chat",
      threadId: "thr_plugin_side_chat",
      body: "Private reply",
    });

    await expect(
      deliverCommentToLatestAgent(bb, store, { taskId: task.id, ...input }),
    ).resolves.toEqual({
      notifiedCount: 0,
      outcomes: [
        {
          threadId: "thr_plugin_side_chat",
          status: "skipped",
          reason: "latest agent reply belongs to a side chat",
        },
      ],
    });
    expect(harness.sdk.callsTo("threads.send")).toEqual([]);
  });

  it("records delivery failure without trying another agent", async () => {
    const { bb, harness, store, task } = setup();
    store.createComment({
      taskId: task.id,
      kind: "agent",
      authorName: "Latest agent",
      threadId: "thr_latest",
      body: "Latest reply",
    });
    harness.sdk.stub("threads.send", async () => {
      throw Object.assign(new Error("thread awaiting interaction"), {
        status: 409,
      });
    });

    await expect(
      deliverCommentToLatestAgent(bb, store, { taskId: task.id, ...input }),
    ).resolves.toEqual({
      notifiedCount: 0,
      outcomes: [
        {
          threadId: "thr_latest",
          status: "failed",
          reason: "thread awaiting interaction",
        },
      ],
    });
    expect(harness.sdk.callsTo("threads.send")).toHaveLength(1);
    expect(harness.logEntries).toContainEqual({
      level: "warn",
      message:
        "failed to deliver comment 01J00000000000000000000000 to thread thr_latest: thread awaiting interaction",
    });
  });
});
