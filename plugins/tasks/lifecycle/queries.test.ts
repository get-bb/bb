import {
  createConnection,
  type SlowDbQueryLogFields,
} from "../../../packages/db/src/connection";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createStore } from "../api";
import { initializeTasksSchema as migrate } from "../db/schema";
import { registerLifecycle } from ".";

function fixture(taskCount: number, mappingCount: number) {
  const queries: SlowDbQueryLogFields[] = [];
  const connection = createConnection(":memory:", {
    slowQueryThresholdMs: 0,
    slowQueryLogger: { info: (fields) => queries.push(fields) },
  });
  const db = connection.$client;
  migrate(db);
  const host = createFakePluginHost({
    pluginId: "tasks",
    sdk: {
      threads: {
        get: async ({ threadId }) =>
          makeThreadResponse({ id: threadId, status: "active" }),
      },
    },
  });
  const bb = {
    ...host.bb,
    storage: { ...host.bb.storage, database: () => db },
  };
  const store = createStore(bb);
  const project = store.tasks.createProject({
    name: "Query counts",
    prefix: "QUERY",
    color: "blue",
  });
  const tasks = Array.from({ length: taskCount }, (_, index) =>
    store.tasks.createTask({ projectId: project.id, title: `Task ${index}` }),
  );
  const mappings = tasks.slice(0, mappingCount).map((task, index) =>
    store.tasks.upsertTaskThread({
      taskId: task.id,
      threadId: `thr_worker_${index}`,
      title: `Worker ${index}`,
      presetName: "Default",
      liveStatus: "working",
    }),
  );
  return {
    ...host,
    bb,
    db,
    store,
    tasks,
    mappings,
    queries,
    async dispose() {
      await host.harness.dispose();
      db.close();
    },
  };
}

async function emitAllEvents(f: ReturnType<typeof fixture>, threadId: string) {
  const thread = makeThreadResponse({ id: threadId, status: "active" });
  await f.harness.emitThreadEvent("thread.created", { thread });
  await f.harness.emitThreadEvent("thread.active", { thread });
  await f.harness.emitThreadEvent("thread.idle", {
    thread,
    lastAssistantText: null,
  });
  await f.harness.emitThreadEvent("thread.failed", { thread, error: "failed" });
  await f.harness.emitThreadEvent("thread.deleted", { thread });
}

describe("lifecycle SQL scope", () => {
  it.each([
    [0, 0],
    [1, 0],
    [1, 1],
    [200, 0],
    [200, 200],
    [501, 501],
  ])(
    "uses one lookup per unrelated event with %i tasks and %i mappings",
    async (tasks, mappings) => {
      const f = fixture(tasks, mappings);
      try {
        await registerLifecycle(f.bb, f.store);
        f.queries.length = 0;
        await emitAllEvents(f, "thr_unrelated");
        console.log(
          JSON.stringify({
            tasks,
            mappings,
            events: 5,
            statements: f.queries.length,
            sql: [...new Set(f.queries.map((q) => q.sql))],
          }),
        );
        expect(f.harness.realtimeSignals).toEqual([]);
        expect(f.queries).toHaveLength(5);
        expect(
          f.queries.every((q) => q.sql.includes("WHERE thread_id = ?")),
        ).toBe(true);
      } finally {
        await f.dispose();
      }
    },
  );

  it.each([1, 3, 200])(
    "preserves %i matching rows through recovery, comments, idempotence and completion",
    async (count) => {
      const f = fixture(count + 1, count + 1);
      try {
        for (const task of f.tasks.slice(0, count)) {
          f.store.tasks.upsertTaskThread({
            taskId: task.id,
            threadId: "thr_shared",
            title: "Shared",
            presetName: "Default",
            liveStatus: "working",
          });
        }
        await registerLifecycle(f.bb, f.store);
        const transition = async (
          status: "active" | "idle" | "error" | "deleted",
          expected: string,
          statementsPerMapping: number,
          comments: number,
        ) => {
          f.queries.length = 0;
          const signalsBefore = f.harness.realtimeSignals.length;
          const thread = makeThreadResponse({
            id: "thr_shared",
            status: status === "deleted" ? "idle" : status,
          });
          if (status === "active")
            await f.harness.emitThreadEvent("thread.active", { thread });
          else if (status === "idle")
            await f.harness.emitThreadEvent("thread.idle", {
              thread,
              lastAssistantText: null,
            });
          else if (status === "error")
            await f.harness.emitThreadEvent("thread.failed", {
              thread,
              error: "failed",
            });
          else await f.harness.emitThreadEvent("thread.deleted", { thread });
          console.log(
            JSON.stringify({
              status,
              expected,
              statements: f.queries.length,
              statementsPerMapping,
            }),
          );
          expect(f.queries).toHaveLength(1 + count * statementsPerMapping);
          expect(f.harness.realtimeSignals.length - signalsBefore).toBe(
            statementsPerMapping === 0 ? 0 : count * 2,
          );
          if (statementsPerMapping > 0) {
            expect(f.harness.realtimeSignals.slice(signalsBefore)).toEqual(
              expect.arrayContaining(
                f.tasks.slice(0, count).flatMap((task) => [
                  { channel: "threads:changed", payload: { taskId: task.id } },
                  { channel: "comments:changed", payload: { taskId: task.id } },
                ]),
              ),
            );
          }
          for (const task of f.tasks.slice(0, count)) {
            expect(
              f.store.tasks.getTaskThreadByThreadId(task.id, "thr_shared")
                ?.liveStatus,
            ).toBe(expected);
            const recorded = f.store.tasks.listComments(task.id);
            expect(recorded).toHaveLength(comments);
            expect(
              recorded.every(
                (comment) =>
                  comment.kind === "system" &&
                  comment.threadId === "thr_shared" &&
                  comment.presetName === "Default",
              ),
            ).toBe(true);
            expect(f.store.tasks.getTask(task.id)!.status).toBe("backlog");
          }
          expect(
            f.store.tasks.getTaskThread(f.mappings[count]!.id)?.liveStatus,
          ).toBe("working");
        };
        await transition("active", "working", 0, 0);
        await transition("idle", "idle", 3, 0);
        await transition("error", "failed", 6, 1);
        await transition("error", "failed", 0, 1);
        await transition("active", "working", 3, 1);
        await transition("deleted", "completed", 6, 2);
        await transition("active", "completed", 0, 2);
        await transition("deleted", "completed", 0, 2);
      } finally {
        await f.dispose();
      }
    },
  );

  it.each([
    ["pending", null, "starting", 4],
    ["starting", null, "starting", 4],
    ["active", null, "working", 1],
    ["stopping", null, "working", 1],
    ["idle", null, "idle", 4],
    ["error", null, "failed", 7],
    ["idle", 1, "completed", 7],
    ["error", 1, "failed", 7],
  ] as const)(
    "maps created %s / deletedAt %s to %s",
    async (status, deletedAt, expected, statements) => {
      const f = fixture(1, 1);
      try {
        await registerLifecycle(f.bb, f.store);
        f.queries.length = 0;
        await f.harness.emitThreadEvent("thread.created", {
          thread: makeThreadResponse({ id: "thr_worker_0", status, deletedAt }),
        });
        expect(f.queries).toHaveLength(statements);
        expect(f.store.tasks.getTaskThread(f.mappings[0]!.id)?.liveStatus).toBe(
          expected,
        );
      } finally {
        await f.dispose();
      }
    },
  );

  it("tracks workers across task status changes without changing task status", async () => {
    const f = fixture(1, 1);
    try {
      await registerLifecycle(f.bb, f.store);
      for (const status of [
        "todo",
        "in_progress",
        "in_review",
        "done",
        "canceled",
      ] as const) {
        f.store.tasks.updateTask(f.tasks[0]!.id, { status });
        f.queries.length = 0;
        await f.harness.emitThreadEvent("thread.idle", {
          thread: makeThreadResponse({ id: "thr_worker_0", status: "idle" }),
          lastAssistantText: null,
        });
        expect(f.queries).toHaveLength(status === "todo" ? 4 : 1);
        expect(f.store.tasks.getTaskThread(f.mappings[0]!.id)?.liveStatus).toBe(
          "idle",
        );
        expect(f.store.tasks.getTask(f.tasks[0]!.id)?.status).toBe(status);
      }
    } finally {
      await f.dispose();
    }
  });

  it("uses the existing non-unique thread index and cascades deleted task mappings", async () => {
    const f = fixture(3, 3);
    try {
      expect(f.db.pragma("foreign_keys", { simple: true })).toBe(1);
      const plan = f.db
        .prepare<[], { detail: string }>(
          "EXPLAIN QUERY PLAN SELECT * FROM task_threads WHERE thread_id = 'thr_worker_0' ORDER BY task_id, id",
        )
        .all();
      console.log(
        JSON.stringify({
          plan,
          indexes: f.db.pragma("index_list(task_threads)"),
        }),
      );
      expect(
        plan.some((row) =>
          row.detail.includes(
            "USING INDEX idx_task_threads_thread (thread_id=?)",
          ),
        ),
      ).toBe(true);
      f.store.tasks.deleteTask(f.tasks[0]!.id);
      expect(f.store.tasks.getTaskThread(f.mappings[0]!.id)).toBeUndefined();
      await registerLifecycle(f.bb, f.store);
      f.queries.length = 0;
      await emitAllEvents(f, "thr_worker_0");
      expect(f.queries).toHaveLength(5);
      expect(f.harness.realtimeSignals).toEqual([]);
    } finally {
      await f.dispose();
    }
  });
});
