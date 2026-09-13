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
import {
  getThreadPluginMetadata,
  insertThreadPluginMetadata,
  listThreadPluginMetadataRows,
  patchThreadPluginMetadata,
} from "../../src/data/thread-plugin-metadata.js";
import { noopNotifier } from "../../src/notifier.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";

function setup(name: string) {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, {
    name: `${name}-host`,
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: `${name}-project`,
    source: { type: "local_path", hostId: host.id, path: `/tmp/${name}` },
  });
  return { db, project };
}

describe("thread plugin metadata persistence", () => {
  it("seeds one namespace and returns {} when absent", () => {
    const { db, project } = setup("seed");
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      pluginMetadata: { pluginId: "alpha", metadata: { a: 1, nullable: null } },
    });
    expect(getThreadPluginMetadata(db, thread.id, "alpha")).toEqual({
      metadata: { a: 1, nullable: null },
      corrupt: false,
    });
    expect(getThreadPluginMetadata(db, thread.id, "missing")).toEqual({
      metadata: {},
      corrupt: false,
    });
    insertThreadPluginMetadata(db, {
      threadId: thread.id,
      pluginId: "beta",
      metadata: { b: 2 },
    });
    expect(
      listThreadPluginMetadataRows(db, thread.id, ["alpha", "beta", "gamma"]),
    ).toEqual(
      expect.arrayContaining([
        { pluginId: "alpha", metadataJson: '{"a":1,"nullable":null}' },
        { pluginId: "beta", metadataJson: '{"b":2}' },
      ]),
    );
    expect(listThreadPluginMetadataRows(db, thread.id, ["beta"])).toEqual([
      { pluginId: "beta", metadataJson: '{"b":2}' },
    ]);
    expect(listThreadPluginMetadataRows(db, thread.id, [])).toEqual([]);
  });

  it("stores no row for an empty seed", () => {
    const { db, project } = setup("empty-seed");
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      pluginMetadata: { pluginId: "alpha", metadata: {} },
    });
    expect(listThreadPluginMetadataRows(db, thread.id, ["alpha"])).toEqual([]);
  });

  it("shallow sets then removes atomically, including null and empty deletion", () => {
    const { db, project } = setup("patch");
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    insertThreadPluginMetadata(db, {
      threadId: thread.id,
      pluginId: "p",
      metadata: { nested: { old: true }, keep: 1 },
    });
    expect(
      patchThreadPluginMetadata(db, {
        threadId: thread.id,
        pluginId: "p",
        set: { nested: { next: true }, nullable: null },
        remove: ["keep"],
      }),
    ).toEqual({
      ok: true,
      metadata: { nested: { next: true }, nullable: null },
      replacedCorrupt: false,
    });
    expect(
      patchThreadPluginMetadata(db, {
        threadId: thread.id,
        pluginId: "p",
        set: {},
        remove: ["missing"],
      }),
    ).toEqual({
      ok: true,
      metadata: { nested: { next: true }, nullable: null },
      replacedCorrupt: false,
    });
    expect(
      patchThreadPluginMetadata(db, {
        threadId: thread.id,
        pluginId: "p",
        set: {},
        remove: ["nested", "nullable"],
      }),
    ).toEqual({ ok: true, metadata: {}, replacedCorrupt: false });
    expect(listThreadPluginMetadataRows(db, thread.id, ["p"])).toEqual([]);
  });

  it("reports an oversized merge without changing the stored namespace", () => {
    const { db, project } = setup("oversized");
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    insertThreadPluginMetadata(db, {
      threadId: thread.id,
      pluginId: "p",
      metadata: { preserved: "x".repeat(200 * 1024) },
    });
    expect(
      patchThreadPluginMetadata(db, {
        threadId: thread.id,
        pluginId: "p",
        set: { extra: "y".repeat(100 * 1024) },
        remove: [],
      }),
    ).toEqual({ ok: false, reason: "too_large" });
    expect(getThreadPluginMetadata(db, thread.id, "p")).toEqual({
      metadata: { preserved: "x".repeat(200 * 1024) },
      corrupt: false,
    });
  });

  it("reports a corrupt row as {} and lets a patch replace it", () => {
    const { db, project } = setup("corrupt");
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    for (const metadataJson of ["not-json", "[1,2]", "null"]) {
      db.delete(threadPluginMetadata).run();
      db.insert(threadPluginMetadata)
        .values({ threadId: thread.id, pluginId: "p", metadataJson })
        .run();
      expect(getThreadPluginMetadata(db, thread.id, "p")).toEqual({
        metadata: {},
        corrupt: true,
      });
      expect(
        patchThreadPluginMetadata(db, {
          threadId: thread.id,
          pluginId: "p",
          set: { repaired: true },
          remove: [],
        }),
      ).toEqual({
        ok: true,
        metadata: { repaired: true },
        replacedCorrupt: true,
      });
      expect(getThreadPluginMetadata(db, thread.id, "p")).toEqual({
        metadata: { repaired: true },
        corrupt: false,
      });
    }
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
      first
        .insert(threadPluginMetadata)
        .values({
          threadId,
          pluginId: "p",
          metadataJson: JSON.stringify({ initial: true }),
        })
        .run();
      second.$client.pragma("busy_timeout = 0");
      let secondWrites = 0;
      const secondPatch = () => {
        secondWrites += 1;
        expect(() =>
          patchThreadPluginMetadata(second, {
            threadId,
            pluginId: "p",
            set: { competing: true },
            remove: [],
          }),
        ).toThrow(/locked|busy/u);
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
          remove: [],
        }),
      ).toEqual({
        ok: true,
        metadata: { initial: true, first: true },
        replacedCorrupt: false,
      });
      expect(secondWrites).toBe(1);
      expect(getThreadPluginMetadata(first, threadId, "p")).toEqual({
        metadata: { initial: true, first: true },
        corrupt: false,
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
        pluginMetadata: { pluginId: "alpha", metadata: { seeded: true } },
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
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      pluginMetadata: { pluginId: "p", metadata: { seeded: true } },
    });
    expect(listThreadPluginMetadataRows(db, thread.id, ["p"])).toHaveLength(1);
    expect(deleteThread(db, noopNotifier, thread.id)).toBe(true);
    expect(listThreadPluginMetadataRows(db, thread.id, ["p"])).toEqual([]);
  });
});
