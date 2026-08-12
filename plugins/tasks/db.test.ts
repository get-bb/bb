import { createHash } from "node:crypto";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import {
  createTasksStore,
  decodeTaskActorTriple,
  initializeTasksSchema,
  LEGACY_SYSTEM_TASK_ACTOR,
  requireTaskActorSnapshot,
  TasksPageCursorError,
  type TaskActorSnapshot,
} from "./db";
import { TASKS_SCHEMA_MIGRATIONS } from "./db/schema";

const LOCAL_OWNER: TaskActorSnapshot = {
  principalId: "local-owner",
  principalKind: "human",
  displayName: "Local Owner",
};

const ALICE: TaskActorSnapshot = {
  principalId: "user:alice",
  principalKind: "human",
  displayName: "Alice",
};

const BOB: TaskActorSnapshot = {
  principalId: "user:bob",
  principalKind: "human",
  displayName: "Bob",
};

function setup(initialActor: TaskActorSnapshot = LOCAL_OWNER) {
  const { bb, harness } = createFakePluginHost({ pluginId: "tasks-db-test" });
  const db = bb.storage.database();
  let currentActor = initialActor;
  const store = createTasksStore(db, {
    currentActor: () => currentActor,
  });
  return {
    bb,
    db,
    harness,
    store,
    setActor(actor: TaskActorSnapshot) {
      currentActor = actor;
    },
  };
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

function storeOptions(actor: TaskActorSnapshot = LOCAL_OWNER) {
  return { currentActor: () => actor };
}

function cursorForEmptyArrayFilter(
  cursor: string,
  projectId: string,
  filter: "statuses" | "priorities" | "labelIds",
): string {
  const decoded: unknown = JSON.parse(
    Buffer.from(cursor, "base64url").toString("utf8"),
  );
  if (typeof decoded !== "object" || decoded === null) {
    throw new Error("expected an object cursor fixture");
  }
  const normalized = JSON.stringify({
    projectId,
    statuses: filter === "statuses" ? [] : null,
    priorities: filter === "priorities" ? [] : null,
    labelIds: filter === "labelIds" ? [] : null,
    activeOnly: false,
    parentTaskId: { specified: false, value: null },
    search: null,
    sort: "manual",
  });
  const query = createHash("sha256").update(normalized).digest("base64url");
  return Buffer.from(JSON.stringify({ ...decoded, query }), "utf8").toString(
    "base64url",
  );
}

describe("tasks storage", () => {
  it("initializes its versioned schema idempotently", async () => {
    const { db, harness } = setup();
    try {
      createTasksStore(db, storeOptions());
      expect(
        db
          .prepare<
            [],
            { count: number }
          >("SELECT COUNT(*) AS count FROM schema_version")
          .get()?.count,
      ).toBe(6);
    } finally {
      await harness.dispose();
    }
  });

  it("migrates existing presets to the project-default environment", async () => {
    const { db, harness } = setup();
    try {
      db.exec(`
        DELETE FROM schema_version WHERE version = 3;
        DROP TABLE presets;
        CREATE TABLE presets (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          provider_id TEXT NOT NULL,
          model_id TEXT NOT NULL,
          reasoning_level TEXT NOT NULL,
          permission_mode TEXT NOT NULL,
          instructions TEXT NOT NULL,
          builtin INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0, 1)),
          created_at TEXT NOT NULL
        );
        INSERT INTO presets (
          id, name, provider_id, model_id, reasoning_level, permission_mode,
          instructions, builtin, created_at
        ) VALUES (
          '01J00000000000000000000000', 'Legacy', 'codex', 'gpt-5', 'high',
          'full', '', 0, '2026-07-15T00:00:00.000Z'
        );
      `);

      const migrated = createTasksStore(db, storeOptions()).getPreset(
        "01J00000000000000000000000",
      );

      expect(migrated).toMatchObject({
        environmentKind: "project-default",
        baseBranch: null,
        machineId: null,
      });
    } finally {
      await harness.dispose();
    }
  });

  it("migrates retired preset permission modes to Accept Edits", async () => {
    const { db, harness } = setup();
    try {
      db.exec(`
        DELETE FROM schema_version WHERE version = 5;
        INSERT INTO presets (
          id, name, provider_id, model_id, reasoning_level, permission_mode,
          instructions, builtin, created_at
        ) VALUES
          (
            '01J00000000000000000000001', 'Legacy readonly', 'codex',
            'gpt-5', 'high', 'readonly', '', 0,
            '2026-07-15T00:00:00.000Z'
          ),
          (
            '01J00000000000000000000002', 'Legacy workspace', 'codex',
            'gpt-5', 'high', 'workspace-write', '', 0,
            '2026-07-15T00:00:00.000Z'
          );
      `);

      const modes = createTasksStore(db, storeOptions())
        .listPresets()
        .filter((preset) => preset.name.startsWith("Legacy "))
        .map((preset) => preset.permissionMode);

      expect(modes).toEqual(["accept-edits", "accept-edits"]);
    } finally {
      await harness.dispose();
    }
  });

  it("normalizes legacy image flags to the safe raster MIME allowlist", async () => {
    const { db, harness, store } = setup();
    try {
      const project = createProject(store, "IMG");
      const task = store.createTask({
        projectId: project.id,
        title: "Legacy attachment",
      });
      const svg = store.createAttachment({
        taskId: task.id,
        fileName: "active.svg",
        mime: "image/svg+xml",
        sizeBytes: 1,
        blobPath: "blobs/svg/active.svg",
        isImage: true,
      });
      const png = store.createAttachment({
        taskId: task.id,
        fileName: "safe.png",
        mime: "image/png",
        sizeBytes: 1,
        blobPath: "blobs/png/safe.png",
        isImage: false,
      });
      db.prepare("DELETE FROM schema_version WHERE version = 2").run();

      createTasksStore(db, storeOptions());

      expect(store.getAttachment(svg.id)?.isImage).toBe(false);
      expect(store.getAttachment(png.id)?.isImage).toBe(true);
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

  it("traverses deterministic filtered and sorted keyset pages without gaps", async () => {
    const { harness, store } = setup();
    try {
      const project = createProject(store, "PAG");
      const bug = store.createLabel({
        projectId: project.id,
        name: "Bug",
        color: "red",
      });
      const fixtures = [
        { title: "Low later", priority: "low" as const, dueDate: "2026-08-03" },
        { title: "Urgent undated", priority: "urgent" as const, dueDate: null },
        {
          title: "High soon",
          priority: "high" as const,
          dueDate: "2026-08-01",
        },
        {
          title: "High later",
          priority: "high" as const,
          dueDate: "2026-08-02",
        },
        {
          title: "Ignored",
          priority: "urgent" as const,
          dueDate: "2026-07-01",
        },
      ].map((fixture, index) =>
        store.createTask({
          projectId: project.id,
          title: fixture.title,
          status: index === 4 ? "done" : "todo",
          priority: fixture.priority,
          dueDate: fixture.dueDate,
        }),
      );
      for (const task of fixtures.slice(0, 4)) {
        store.addTaskLabel(task.id, bug.id);
      }

      const collect = (sort: "manual" | "priority" | "due") => {
        const keys: string[] = [];
        let cursor: string | undefined;
        do {
          const page = store.listTasksPage({
            projectId: project.id,
            statuses: ["todo"],
            priorities: ["urgent", "high", "low"],
            labelIds: [bug.id],
            search: "later",
            sort,
            limit: 1,
            ...(cursor === undefined ? {} : { cursor }),
          });
          keys.push(...page.tasks.map((task) => task.key));
          cursor = page.nextCursor ?? undefined;
        } while (cursor !== undefined);
        return keys;
      };

      expect(collect("manual")).toEqual([fixtures[0]!.key, fixtures[3]!.key]);
      expect(collect("priority")).toEqual([fixtures[3]!.key, fixtures[0]!.key]);
      expect(collect("due")).toEqual([fixtures[3]!.key, fixtures[0]!.key]);
    } finally {
      await harness.dispose();
    }
  });

  it("invalidates cursors after tasks are added, removed, reordered, or updated", async () => {
    const { harness, store } = setup();
    try {
      const project = createProject(store, "MUT");
      const tasks = Array.from({ length: 5 }, (_, index) =>
        store.createTask({
          projectId: project.id,
          title: `Task ${index + 1}`,
          status: "todo",
        }),
      );
      const firstCursor = () => {
        const cursor = store.listTasksPage({
          projectId: project.id,
          limit: 2,
        }).nextCursor;
        expect(cursor).not.toBeNull();
        if (cursor === null) throw new Error("expected another task page");
        return cursor;
      };
      const expectStale = (cursor: string) => {
        try {
          store.listTasksPage({ projectId: project.id, limit: 2, cursor });
          throw new Error("expected stale cursor failure");
        } catch (error) {
          if (!(error instanceof TasksPageCursorError)) throw error;
          expect(error.code).toBe("stale_cursor");
        }
      };

      let cursor = firstCursor();
      store.createTask({
        projectId: project.id,
        title: "Added",
        status: "todo",
      });
      expectStale(cursor);

      cursor = firstCursor();
      store.deleteTask(tasks[4]!.id);
      expectStale(cursor);

      cursor = firstCursor();
      store.updatePosition(tasks[3]!.id, {
        status: "in_progress",
        beforeTaskId: null,
        afterTaskId: null,
      });
      expectStale(cursor);

      cursor = firstCursor();
      store.updateTask(tasks[2]!.id, { title: "Updated" });
      expectStale(cursor);
    } finally {
      await harness.dispose();
    }
  });

  it("rejects cursors reused with different filters or sorting", async () => {
    const { harness, store } = setup();
    try {
      const project = createProject(store, "CUR");
      for (let index = 0; index < 3; index += 1) {
        store.createTask({
          projectId: project.id,
          title: `Task ${index + 1}`,
          status: "todo",
        });
      }
      const cursor = store.listTasksPage({
        projectId: project.id,
        statuses: ["todo"],
        limit: 1,
      }).nextCursor;
      if (cursor === null) throw new Error("expected another task page");

      expect(() =>
        store.listTasksPage({
          projectId: project.id,
          statuses: ["done"],
          limit: 1,
          cursor,
        }),
      ).toThrow("does not match the current filters");
      expect(() =>
        store.listTasksPage({
          projectId: project.id,
          statuses: ["todo"],
          sort: "due",
          limit: 1,
          cursor,
        }),
      ).toThrow("does not match --sort");
    } finally {
      await harness.dispose();
    }
  });

  it("validates invalid, mismatched, and stale cursors for empty array filters", async () => {
    const { harness, store } = setup();
    try {
      const project = createProject(store, "EMP");
      for (let index = 0; index < 3; index += 1) {
        store.createTask({
          projectId: project.id,
          title: `Task ${index + 1}`,
          status: "todo",
        });
      }
      const cursor = store.listTasksPage({
        projectId: project.id,
        statuses: ["todo"],
        limit: 1,
      }).nextCursor;
      if (cursor === null) throw new Error("expected another task page");

      const filters = ["statuses", "priorities", "labelIds"] as const;
      const matchingCursors = new Map(
        filters.map((filter) => [
          filter,
          cursorForEmptyArrayFilter(cursor, project.id, filter),
        ]),
      );
      for (const filter of filters) {
        const emptyFilter = { [filter]: [] };
        expect(
          store.listTasksPage({
            projectId: project.id,
            ...emptyFilter,
            cursor: matchingCursors.get(filter),
          }),
        ).toEqual({ tasks: [], nextCursor: null });
        expect(() =>
          store.listTasksPage({
            projectId: project.id,
            ...emptyFilter,
            cursor: "not-a-cursor",
          }),
        ).toThrow("invalid task-list cursor");
        expect(() =>
          store.listTasksPage({
            projectId: project.id,
            ...emptyFilter,
            cursor,
          }),
        ).toThrow("does not match the current filters");
      }
      expect(() =>
        store.listTasksPage({
          projectId: project.id,
          statuses: [],
          limit: 0,
        }),
      ).toThrow("Task page limit must be an integer");

      store.createTask({
        projectId: project.id,
        title: "Mutation",
        status: "todo",
      });
      for (const filter of filters) {
        expect(() =>
          store.listTasksPage({
            projectId: project.id,
            [filter]: [],
            cursor: matchingCursors.get(filter),
          }),
        ).toThrow("task-list data changed after this cursor was issued");
      }
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

  it("finds the latest agent comment by reply time and ignores other activity", async () => {
    const { db, harness, store } = setup();
    try {
      const project = createProject(store, "LAR");
      const task = store.createTask({ projectId: project.id, title: "Task" });
      const latest = store.createComment({
        taskId: task.id,
        kind: "agent",
        authorName: "Latest responder",
        threadId: "thr_latest",
        body: "Latest agent reply",
      });
      const older = store.createComment({
        taskId: task.id,
        kind: "agent",
        authorName: "Older responder",
        threadId: "thr_older",
        body: "Older agent reply",
      });
      store.createComment({
        taskId: task.id,
        kind: "user",
        authorName: "Sawyer",
        body: "Newer user activity",
      });
      const setCreatedAt = db.prepare<[string, string]>(
        "UPDATE comments SET created_at = ? WHERE id = ?",
      );
      setCreatedAt.run("2026-07-15T10:00:00.000Z", older.id);
      setCreatedAt.run("2026-07-15T11:00:00.000Z", latest.id);

      expect(store.getLatestAgentComment(task.id, null)).toMatchObject({
        id: latest.id,
        threadId: "thr_latest",
      });
    } finally {
      await harness.dispose();
    }
  });

  it("uses insertion order when agent replies share a timestamp", async () => {
    const { db, harness, store } = setup();
    try {
      const project = createProject(store, "TIE");
      const task = store.createTask({ projectId: project.id, title: "Task" });
      const earlier = store.createComment({
        id: "01H00000000000000000000002",
        taskId: task.id,
        kind: "agent",
        authorName: "Earlier responder",
        threadId: "thr_earlier",
        body: "Earlier reply",
      });
      const later = store.createComment({
        // Deliberately lexicographically smaller than the earlier ID.
        id: "01H00000000000000000000001",
        taskId: task.id,
        kind: "agent",
        authorName: "Later responder",
        threadId: "thr_later",
        body: "Later reply",
      });
      const setCreatedAt = db.prepare<[string, string]>(
        "UPDATE comments SET created_at = ? WHERE id = ?",
      );
      const sharedTime = "2026-07-15T10:00:00.000Z";
      setCreatedAt.run(sharedTime, earlier.id);
      setCreatedAt.run(sharedTime, later.id);

      expect(store.listComments(task.id).map((comment) => comment.id)).toEqual([
        earlier.id,
        later.id,
      ]);
      expect(store.getLatestAgentComment(task.id, null)).toMatchObject({
        id: later.id,
        threadId: "thr_later",
      });
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
        permissionMode: "accept-edits",
        environmentKind: "project-default" as const,
        baseBranch: null,
        machineId: null,
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

  it("upgrades a populated version-5 DB to actor columns without rewriting payloads", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks-db-v5" });
    const db = bb.storage.database();
    try {
      db.pragma("foreign_keys = ON");
      db.exec(`
        CREATE TABLE schema_version (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        )
      `);
      const recordVersion = db.prepare<[number, string]>(
        "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
      );
      for (const [index, sql] of TASKS_SCHEMA_MIGRATIONS.slice(
        0,
        5,
      ).entries()) {
        db.exec(sql);
        recordVersion.run(index + 1, "2026-07-15T11:00:00.000Z");
      }
      expect(
        db
          .prepare<
            [],
            { count: number }
          >("SELECT COUNT(*) AS count FROM schema_version")
          .get()?.count,
      ).toBe(5);

      const createdAt = "2026-07-15T12:00:00.000Z";
      db.prepare(
        `
        INSERT INTO projects (
          id, name, prefix, next_task_number, color, folder_id,
          linked_bb_project_id, created_at
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
      `,
      ).run(
        "01J0000000000000000000PROJ",
        "Legacy",
        "LEG",
        2,
        "blue",
        createdAt,
      );
      db.prepare(
        `
        INSERT INTO tasks (
          id, project_id, number, title, description, status, priority,
          due_date, parent_task_id, position, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
      `,
      ).run(
        "01J0000000000000000000TASK",
        "01J0000000000000000000PROJ",
        1,
        "Legacy task",
        "keep me",
        "todo",
        "high",
        1024,
        createdAt,
        createdAt,
      );
      db.prepare(
        `
        INSERT INTO comments (
          id, task_id, kind, author_name, preset_name, thread_id, body,
          notified_count, created_at
        ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)
      `,
      ).run(
        "01J0000000000000000000CMNT",
        "01J0000000000000000000TASK",
        "user",
        "You",
        "legacy comment body",
        0,
        createdAt,
      );

      const taskBefore = db
        .prepare("SELECT title, description, status, priority FROM tasks")
        .get();
      const commentBefore = db
        .prepare("SELECT kind, author_name, body, notified_count FROM comments")
        .get();

      const store = createTasksStore(db, storeOptions());
      expect(
        db
          .prepare<
            [],
            { count: number }
          >("SELECT COUNT(*) AS count FROM schema_version")
          .get()?.count,
      ).toBe(6);

      const taskRow = db
        .prepare(
          `
          SELECT title, description, status, priority,
            created_principal_id, created_principal_kind, created_display_name,
            updated_principal_id, updated_principal_kind, updated_display_name
          FROM tasks WHERE id = ?
        `,
        )
        .get("01J0000000000000000000TASK") as Record<string, unknown>;
      const commentRow = db
        .prepare(
          `
          SELECT kind, author_name, body, notified_count,
            actor_principal_id, actor_principal_kind, actor_display_name
          FROM comments WHERE id = ?
        `,
        )
        .get("01J0000000000000000000CMNT") as Record<string, unknown>;

      expect({
        title: taskRow.title,
        description: taskRow.description,
        status: taskRow.status,
        priority: taskRow.priority,
      }).toEqual(taskBefore);
      expect({
        kind: commentRow.kind,
        author_name: commentRow.author_name,
        body: commentRow.body,
        notified_count: commentRow.notified_count,
      }).toEqual(commentBefore);
      expect(taskRow.created_principal_id).toBeNull();
      expect(taskRow.updated_principal_id).toBeNull();
      expect(commentRow.actor_principal_id).toBeNull();

      const task = store.getTask("01J0000000000000000000TASK");
      const comment = store.getComment("01J0000000000000000000CMNT");
      expect(task?.createdBy).toEqual(LEGACY_SYSTEM_TASK_ACTOR);
      expect(task?.updatedBy).toEqual(LEGACY_SYSTEM_TASK_ACTOR);
      expect(comment?.actor).toEqual(LEGACY_SYSTEM_TASK_ACTOR);
    } finally {
      await harness.dispose();
    }
  });

  it("resolves the actor lazily once per attributed mutation", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "tasks-db-lazy-actor",
    });
    const db = bb.storage.database();
    let resolutions = 0;
    const store = createTasksStore(db, {
      currentActor: () => {
        resolutions += 1;
        return ALICE;
      },
    });
    try {
      expect(resolutions).toBe(0);
      const project = createProject(store, "LAZ");
      expect(resolutions).toBe(0);

      const task = store.createTask({
        projectId: project.id,
        title: "Resolve on write",
      });
      expect(resolutions).toBe(1);
      expect(store.getTask(task.id)?.createdBy).toEqual(ALICE);
      expect(store.listTasks({ projectId: project.id })).toHaveLength(1);
      expect(resolutions).toBe(1);

      store.updateTask(task.id, { title: "Resolve again" });
      expect(resolutions).toBe(2);
      const comment = store.createComment({
        taskId: task.id,
        kind: "user",
        authorName: "Alice",
        body: "Resolve for comment",
      });
      expect(resolutions).toBe(3);

      store.updateComment(comment.id, { notifiedCount: 1 });
      expect(store.getComment(comment.id)?.actor).toEqual(ALICE);
      expect(resolutions).toBe(3);
    } finally {
      await harness.dispose();
    }
  });

  it("stamps createdBy on create and only updatedBy on later mutations", async () => {
    const { harness, store, setActor } = setup(ALICE);
    try {
      const project = createProject(store, "ACT");
      const task = store.createTask({
        projectId: project.id,
        title: "Owned by Alice",
      });
      expect(task.createdBy).toEqual(ALICE);
      expect(task.updatedBy).toEqual(ALICE);

      setActor(BOB);
      const updated = store.updateTask(task.id, { title: "Edited by Bob" });
      expect(updated.createdBy).toEqual(ALICE);
      expect(updated.updatedBy).toEqual(BOB);

      const moved = store.updatePosition(task.id, {
        status: "in_progress",
        beforeTaskId: null,
        afterTaskId: null,
      });
      expect(moved.createdBy).toEqual(ALICE);
      expect(moved.updatedBy).toEqual(BOB);
    } finally {
      await harness.dispose();
    }
  });

  it("keeps comment actor immutable across body and notification updates", async () => {
    const { harness, store, setActor } = setup(ALICE);
    try {
      const project = createProject(store, "CMT");
      const task = store.createTask({
        projectId: project.id,
        title: "Comment owner",
      });
      const comment = store.createComment({
        taskId: task.id,
        kind: "user",
        authorName: "Alice",
        body: "Hello",
      });
      expect(comment.actor).toEqual(ALICE);

      setActor(BOB);
      const afterNotify = store.updateComment(comment.id, {
        notifiedCount: 2,
      });
      expect(afterNotify.actor).toEqual(ALICE);
      expect(afterNotify.notifiedCount).toBe(2);

      const afterBody = store.updateComment(comment.id, {
        body: "Hello (edited)",
      });
      expect(afterBody.actor).toEqual(ALICE);
      expect(afterBody.body).toBe("Hello (edited)");
    } finally {
      await harness.dispose();
    }
  });

  it("rolls back task and comment actor stamps with failed mutations", async () => {
    const { db, harness, store } = setup(ALICE);
    try {
      const project = createProject(store, "RBK");
      db.exec(`
        CREATE TRIGGER fail_forced_task_insert
        BEFORE INSERT ON tasks
        WHEN NEW.title = 'FORCE_FAIL_TASK'
        BEGIN
          SELECT RAISE(ABORT, 'forced task failure');
        END;
      `);
      db.exec(`
        CREATE TRIGGER fail_forced_comment_insert
        BEFORE INSERT ON comments
        WHEN NEW.body = 'FORCE_FAIL_COMMENT'
        BEGIN
          SELECT RAISE(ABORT, 'forced comment failure');
        END;
      `);

      expect(() =>
        store.createTask({
          projectId: project.id,
          title: "FORCE_FAIL_TASK",
        }),
      ).toThrow(/forced task failure/);
      expect(
        db
          .prepare<
            [],
            { count: number }
          >("SELECT COUNT(*) AS count FROM tasks WHERE project_id = ?")
          .get(project.id)?.count,
      ).toBe(0);

      const task = store.createTask({
        projectId: project.id,
        title: "Survivor",
      });
      expect(() =>
        store.createComment({
          taskId: task.id,
          kind: "user",
          authorName: "Alice",
          body: "FORCE_FAIL_COMMENT",
        }),
      ).toThrow(/forced comment failure/);
      expect(store.listComments(task.id)).toEqual([]);
    } finally {
      await harness.dispose();
    }
  });

  it("rejects partial actor triples and round-trips complete snapshots", async () => {
    const { db, harness, store } = setup(ALICE);
    try {
      const project = createProject(store, "DEC");
      const task = store.createTask({
        projectId: project.id,
        title: "Decode me",
      });
      const comment = store.createComment({
        taskId: task.id,
        kind: "user",
        authorName: "Alice",
        body: "Stamp",
      });

      expect(() =>
        decodeTaskActorTriple({
          principalId: "user:alice",
          principalKind: null,
          displayName: "Alice",
        }),
      ).toThrow(/Corrupt tasks actor triple/);
      expect(() =>
        decodeTaskActorTriple({
          principalId: null,
          principalKind: "human",
          displayName: null,
        }),
      ).toThrow(/Corrupt tasks actor triple/);

      db.prepare(
        `
        UPDATE tasks SET
          created_principal_id = ?, created_principal_kind = NULL,
          created_display_name = ?
        WHERE id = ?
      `,
      ).run(ALICE.principalId, ALICE.displayName, task.id);
      expect(() => store.getTask(task.id)).toThrow(
        /Corrupt tasks actor triple/,
      );

      db.prepare(
        `
        UPDATE comments SET
          actor_principal_id = ?, actor_principal_kind = ?,
          actor_display_name = NULL
        WHERE id = ?
      `,
      ).run(ALICE.principalId, ALICE.principalKind, comment.id);
      expect(() => store.getComment(comment.id)).toThrow(
        /Corrupt tasks actor triple/,
      );

      const agent = requireTaskActorSnapshot({
        principalId: "agent:worker",
        principalKind: "agent",
        displayName: "Worker",
      });
      const system = requireTaskActorSnapshot({
        principalId: "system:bb",
        principalKind: "system",
        displayName: "System",
      });
      expect(agent).toEqual({
        principalId: "agent:worker",
        principalKind: "agent",
        displayName: "Worker",
      });
      expect(system).toEqual({
        principalId: "system:bb",
        principalKind: "system",
        displayName: "System",
      });
      expect(
        decodeTaskActorTriple({
          principalId: null,
          principalKind: null,
          displayName: null,
        }),
      ).toEqual(LEGACY_SYSTEM_TASK_ACTOR);
    } finally {
      await harness.dispose();
    }
  });

  it("does not bleed actor state across primary/child tasks or comments", async () => {
    const { harness, store, setActor } = setup(ALICE);
    try {
      const project = createProject(store, "ISO");
      const parent = store.createTask({
        projectId: project.id,
        title: "Parent",
      });
      setActor(BOB);
      const child = store.createTask({
        projectId: project.id,
        title: "Child",
        parentTaskId: parent.id,
      });
      const aliceComment = store.createComment({
        taskId: parent.id,
        kind: "user",
        authorName: "Bob writing on Alice task",
        body: "Parent note",
      });
      setActor(ALICE);
      const bobTaskComment = store.createComment({
        taskId: child.id,
        kind: "user",
        authorName: "Alice writing on Bob task",
        body: "Child note",
      });

      expect(store.getTask(parent.id)?.createdBy).toEqual(ALICE);
      expect(store.getTask(parent.id)?.updatedBy).toEqual(ALICE);
      expect(store.getTask(child.id)?.createdBy).toEqual(BOB);
      expect(store.getTask(child.id)?.updatedBy).toEqual(BOB);
      expect(aliceComment.actor).toEqual(BOB);
      expect(bobTaskComment.actor).toEqual(ALICE);
      expect(store.listComments(parent.id).map((c) => c.actor)).toEqual([BOB]);
      expect(store.listComments(child.id).map((c) => c.actor)).toEqual([ALICE]);
    } finally {
      await harness.dispose();
    }
  });
});
