import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createConnection, migrate } from "../../src/index.js";
import { threadPluginMetadata } from "../../src/schema.js";
import { withWriteAfterFirstRead } from "../helpers/interleave.js";
import { createProject } from "../../src/data/projects.js";
import {
  createThread,
  deleteThread,
  searchThreadsWithPendingInteractionState,
} from "../../src/data/threads.js";
import { getThreadPluginMetadata, insertThreadPluginMetadata, listThreadPluginMetadata, patchThreadPluginMetadata } from "../../src/data/thread-plugin-metadata.js";
import { noopNotifier } from "../../src/notifier.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";

function setup(name: string) {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: `${name}-host`, type: "persistent" });
  const { project } = createProject(db, noopNotifier, { name: `${name}-project`, source: { type: "local_path", hostId: host.id, path: `/tmp/${name}` } });
  return { db, project };
}

describe("thread plugin metadata persistence", () => {
  it("seeds one namespace and returns {} when absent", () => {
    const { db, project } = setup("seed");
    const thread = createThread(db, noopNotifier, { projectId: project.id, providerId: "codex", pluginMetadata: { pluginId: "alpha", metadata: { a: 1, nullable: null } } });
    expect(getThreadPluginMetadata(db, thread.id, "alpha")).toEqual({ a: 1, nullable: null });
    expect(getThreadPluginMetadata(db, thread.id, "missing")).toEqual({});
    expect(listThreadPluginMetadata(db, thread.id)).toEqual({
      alpha: { a: 1, nullable: null },
    });
    insertThreadPluginMetadata(db, {
      threadId: thread.id,
      pluginId: "beta",
      metadata: { b: 2 },
    });
    expect(listThreadPluginMetadata(db, thread.id)).toEqual({
      alpha: { a: 1, nullable: null },
      beta: { b: 2 },
    });
  });

  it("shallow sets then removes atomically, including null and empty deletion", () => {
    const { db, project } = setup("patch");
    const thread = createThread(db, noopNotifier, { projectId: project.id, providerId: "codex" });
    insertThreadPluginMetadata(db, { threadId: thread.id, pluginId: "p", metadata: { nested: { old: true }, keep: 1 } });
    expect(
      patchThreadPluginMetadata(db, {
        threadId: thread.id,
        pluginId: "p",
        set: { nested: { next: true }, nullable: null },
        remove: ["keep"],
      }),
    ).toEqual({ nested: { next: true }, nullable: null });
    expect(
      patchThreadPluginMetadata(db, {
        threadId: thread.id,
        pluginId: "p",
        remove: ["missing"],
      }),
    ).toEqual({ nested: { next: true }, nullable: null });
    expect(() =>
      patchThreadPluginMetadata(db, {
        threadId: thread.id,
        pluginId: "p",
        set: { nested: {} },
        remove: ["nested"],
      }),
    ).toThrow(/overlap/u);
    expect(() =>
      patchThreadPluginMetadata(db, {
        threadId: thread.id,
        pluginId: "p",
        remove: ["nested", "nested"],
      }),
    ).toThrow(/duplicate/u);
    expect(getThreadPluginMetadata(db, thread.id, "p")).toEqual({
      nested: { next: true },
      nullable: null,
    });
    expect(
      patchThreadPluginMetadata(db, {
        threadId: thread.id,
        pluginId: "p",
        remove: ["nested", "nullable"],
      }),
    ).toEqual({});
    expect(getThreadPluginMetadata(db, thread.id, "p")).toEqual({});
    insertThreadPluginMetadata(db, {
      threadId: thread.id,
      pluginId: "oversized",
      metadata: { preserved: true },
    });
    expect(() =>
      patchThreadPluginMetadata(db, {
        threadId: thread.id,
        pluginId: "oversized",
        set: { value: "x".repeat(256 * 1024) },
      }),
    ).toThrow(/256 KiB/u);
    expect(getThreadPluginMetadata(db, thread.id, "oversized")).toEqual({
      preserved: true,
    });
  });

  it("rejects a competing file-backed write after the first read while immediate holds the lock", () => {
    const directory = mkdtempSync(join(tmpdir(), "bb-thread-plugin-metadata-"));
    const path = join(directory, "db.sqlite");
    const first = createConnection(path);
    const second = createConnection(path);
    try {
      migrate(first);
      const threadId = "thread-concurrency";
      first.$client.pragma("foreign_keys = OFF");
      first.insert(threadPluginMetadata).values({ threadId, pluginId: "p", metadataJson: JSON.stringify({ initial: true }) }).run();
      second.$client.pragma("busy_timeout = 0");
      let secondWrites = 0;
      const secondPatch = () => {
        secondWrites += 1;
        expect(() => patchThreadPluginMetadata(second, { threadId, pluginId: "p", set: { competing: true } })).toThrow(/locked|busy/u);
      };
      const transactionProxy = new Proxy(first, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver);
          if (property !== "transaction" || typeof value !== "function") {
            return value;
          }
          return (callback: (tx: unknown) => unknown, options?: unknown) =>
            Reflect.apply(value, target, [
              (tx: unknown) =>
                callback(withWriteAfterFirstRead(tx as object, secondPatch)),
              options,
            ]);
        },
      });
      expect(
        patchThreadPluginMetadata(transactionProxy, {
          threadId,
          pluginId: "p",
          set: { first: true },
        }),
      ).toEqual({ initial: true, first: true });
      expect(secondWrites).toBe(1);
      expect(getThreadPluginMetadata(first, threadId, "p")).toEqual({
        initial: true,
        first: true,
      });
    } finally {
      first.$client.close();
      second.$client.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rolls back thread and search state when initial metadata insertion fails", () => {
    const { db, project } = setup("rollback");
    db.$client.exec(`
      CREATE TRIGGER thread_plugin_metadata_before_insert_abort
      BEFORE INSERT ON thread_plugin_metadata
      BEGIN
        SELECT RAISE(ABORT, 'thread plugin metadata insert aborted');
      END;
    `);

    expect(() =>
      createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
        title: "rollback-metadata-title",
        pluginMetadata: { pluginId: "alpha", metadata: {} },
      }),
    ).toThrow(/thread plugin metadata insert aborted/u);
    expect(
      db.$client
        .prepare<[], { count: number }>(
          "SELECT COUNT(*) AS count FROM threads WHERE title = 'rollback-metadata-title'",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      db.$client
        .prepare<[], { count: number }>(
          "SELECT COUNT(*) AS count FROM thread_search_segments WHERE text = 'rollback-metadata-title'",
        )
        .get(),
    ).toEqual({ count: 0 });
  });

  it("keeps metadata out of thread search while retaining title discovery", () => {
    const { db, project } = setup("search");
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      title: "discoverable-metadata-title",
      pluginMetadata: {
        pluginId: "alpha",
        metadata: { marker: "metadata-only-search-marker" },
      },
    });
    expect(
      searchThreadsWithPendingInteractionState(db, {
        query: "discoverable-metadata-title",
        limitPerGroup: 20,
      }).active.results.map((result) => result.thread.id),
    ).toEqual([thread.id]);
    const privateResults = searchThreadsWithPendingInteractionState(db, {
      query: "metadata-only-search-marker",
      limitPerGroup: 20,
    });
    expect(privateResults.active.total).toBe(0);
    expect(privateResults.archived.total).toBe(0);
  });

  it("cascades metadata when its thread is deleted", () => {
    const { db, project } = setup("cascade");
    const thread = createThread(db, noopNotifier, { projectId: project.id, providerId: "codex", pluginMetadata: { pluginId: "p", metadata: {} } });
    expect(deleteThread(db, noopNotifier, thread.id)).toBe(true);
    expect(listThreadPluginMetadata(db, thread.id)).toEqual({});
  });
});
