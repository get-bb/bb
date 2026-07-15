import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createTasksStore } from "./db";

function setup() {
  const { bb, harness } = createFakePluginHost({ pluginId: "tasks-db-test" });
  const db = bb.storage.database();
  return { db, harness, store: createTasksStore(db) };
}

function createProject(
  store: ReturnType<typeof createTasksStore>,
  prefix: string,
) {
  return store.createProject({
    name: `${prefix} project`,
    prefix,
    color: "blue",
  });
}

describe("tasks storage", () => {
  it("initializes its versioned schema idempotently", async () => {
    const { db, harness } = setup();
    try {
      createTasksStore(db);
      expect(
        db
          .prepare<
            [],
            { count: number }
          >("SELECT COUNT(*) AS count FROM schema_version")
          .get()?.count,
      ).toBe(1);
    } finally {
      await harness.dispose();
    }
  });

  it("allocates sequential per-project task keys transactionally", async () => {
    const { harness, store } = setup();
    try {
      const project = createProject(store, "TSK");
      const first = store.createTask({ projectId: project.id, title: "First" });
      const second = store.createTask({
        projectId: project.id,
        title: "Second",
      });

      expect([first.key, second.key]).toEqual(["TSK-1", "TSK-2"]);
      expect(store.getProject(project.id)?.nextTaskNumber).toBe(3);
    } finally {
      await harness.dispose();
    }
  });

  it("enforces one level of sub-tasks in both directions", async () => {
    const { harness, store } = setup();
    try {
      const project = createProject(store, "SUB");
      const root = store.createTask({ projectId: project.id, title: "Root" });
      const child = store.createTask({
        projectId: project.id,
        title: "Child",
        parentTaskId: root.id,
      });

      expect(() =>
        store.createTask({
          projectId: project.id,
          title: "Grandchild",
          parentTaskId: child.id,
        }),
      ).toThrow("Tasks support at most one level of sub-tasks");

      const secondRoot = store.createTask({
        projectId: project.id,
        title: "Second root",
      });
      store.createTask({
        projectId: project.id,
        title: "Second child",
        parentTaskId: secondRoot.id,
      });
      expect(() =>
        store.updateTask(secondRoot.id, { parentTaskId: root.id }),
      ).toThrow("A task with sub-tasks cannot itself become a sub-task");
    } finally {
      await harness.dispose();
    }
  });

  it("combines status, label, and active-thread filters in SQL", async () => {
    const { harness, store } = setup();
    try {
      const project = createProject(store, "FLT");
      const label = store.createLabel({
        projectId: project.id,
        name: "Bug",
        color: "red",
      });
      const active = store.createTask({
        projectId: project.id,
        title: "Active match",
        status: "todo",
        priority: "high",
      });
      const inactive = store.createTask({
        projectId: project.id,
        title: "Inactive",
        status: "todo",
        priority: "high",
      });
      const wrongStatus = store.createTask({
        projectId: project.id,
        title: "Done active",
        status: "done",
        priority: "high",
      });
      for (const task of [active, inactive, wrongStatus]) {
        store.addTaskLabel(task.id, label.id);
      }
      for (const task of [active, wrongStatus]) {
        store.upsertTaskThread({
          taskId: task.id,
          threadId: `thr_${task.number}`,
          presetName: "Default",
          title: task.title,
          liveStatus: "working",
        });
      }

      expect(
        store.listTasks({
          projectId: project.id,
          statuses: ["todo"],
          priorities: ["high"],
          labelIds: [label.id],
          activeOnly: true,
        }),
      ).toEqual([active]);
    } finally {
      await harness.dispose();
    }
  });

  it("uses fractional midpoints and renormalizes exhausted gaps", async () => {
    const { db, harness, store } = setup();
    try {
      const project = createProject(store, "ORD");
      const first = store.createTask({
        projectId: project.id,
        title: "First",
        status: "todo",
      });
      const second = store.createTask({
        projectId: project.id,
        title: "Second",
        status: "todo",
      });
      const moved = store.createTask({
        projectId: project.id,
        title: "Moved",
        status: "todo",
      });
      const setPosition = db.prepare<[number, string]>(
        "UPDATE tasks SET position = ? WHERE id = ?",
      );
      setPosition.run(1, first.id);
      setPosition.run(1 + 1e-12, second.id);

      const reordered = store.updatePosition(moved.id, {
        status: "todo",
        beforeTaskId: first.id,
        afterTaskId: second.id,
      });
      const tasks = store.listTasks({
        projectId: project.id,
        statuses: ["todo"],
      });

      expect(tasks.map((task) => task.id)).toEqual([
        first.id,
        moved.id,
        second.id,
      ]);
      expect(tasks.map((task) => task.position)).toEqual([1024, 1536, 2048]);
      expect(reordered.position).toBe(1536);
    } finally {
      await harness.dispose();
    }
  });

  it("lists task comments in chronological order", async () => {
    const { db, harness, store } = setup();
    try {
      const project = createProject(store, "CMT");
      const task = store.createTask({ projectId: project.id, title: "Task" });
      const later = store.createComment({
        taskId: task.id,
        kind: "agent",
        authorName: "Agent",
        body: "Later",
      });
      const earlier = store.createComment({
        taskId: task.id,
        kind: "user",
        authorName: "Sawyer",
        body: "Earlier",
      });
      const setCreatedAt = db.prepare<[string, string]>(
        "UPDATE comments SET created_at = ? WHERE id = ?",
      );
      setCreatedAt.run("2026-07-15T10:00:00.000Z", later.id);
      setCreatedAt.run("2026-07-15T09:00:00.000Z", earlier.id);

      expect(
        store.listComments(task.id).map((comment) => comment.body),
      ).toEqual(["Earlier", "Later"]);
    } finally {
      await harness.dispose();
    }
  });

  it("rejects duplicate preset names", async () => {
    const { harness, store } = setup();
    try {
      const preset = {
        name: "Default",
        providerId: "openai",
        modelId: "gpt-5",
        reasoningLevel: "high",
        permissionMode: "workspace-write",
        instructions: "Work the task.",
      };
      store.createPreset(preset);
      expect(() => store.createPreset(preset)).toThrow(
        /UNIQUE constraint failed: presets.name/,
      );
    } finally {
      await harness.dispose();
    }
  });
});
