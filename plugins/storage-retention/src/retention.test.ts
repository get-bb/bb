import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { createColdStorage } from "./cold-storage.js";
import type { ColdThreadCursor } from "./contract.js";
import { selectCandidates, type RetentionThread } from "./policy.js";
import plugin from "./server.js";

const DAY = 86400000;
const NOW = 100 * DAY;
function thread(
  id: string,
  overrides: Partial<RetentionThread> = {},
): RetentionThread {
  return {
    id,
    updatedAt: DAY,
    archivedAt: null,
    pinnedAt: null,
    deletedAt: null,
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    visibility: "visible",
    environmentId: "env_test",
    status: "idle",
    ...overrides,
  };
}

describe("retention eligibility", () => {
  it("keeps a whole archive group when a child, hidden source, or lifecycle dependent is recent or pinned", () => {
    for (const relationship of [
      "parentThreadId",
      "sourceThreadId",
      "lifecycleOwnerThreadId",
    ] as const) {
      for (const exemption of [{ updatedAt: NOW }, { pinnedAt: DAY }]) {
        const result = selectCandidates(
          [
            thread("root"),
            thread("child", {
              [relationship]: "root",
              visibility: "hidden",
              ...exemption,
            }),
            thread("independent"),
          ],
          {
            archiveAfterDays: 30,
            coldStoreAfterDays: null,
            deleteAfterDays: null,
          },
          NOW,
        );
        expect(result.archive.map((group) => group.rootId)).toEqual([
          "independent",
        ]);
      }
    }
  });
  it("deletes only fully old archived lifecycle groups, while ordinary children have independent deletion lifetimes", () => {
    const result = selectCandidates(
      [
        thread("live-dependent-root", { archivedAt: DAY }),
        thread("live-dependent", {
          lifecycleOwnerThreadId: "live-dependent-root",
        }),
        thread("recent-dependent-root", { archivedAt: DAY }),
        thread("recent-dependent", {
          lifecycleOwnerThreadId: "recent-dependent-root",
          archivedAt: NOW - DAY,
        }),
        thread("eligible", { archivedAt: DAY }),
        thread("ordinary-child", { parentThreadId: "eligible" }),
        thread("owned", {
          lifecycleOwnerThreadId: "eligible",
          archivedAt: DAY,
        }),
        thread("pinned", { archivedAt: DAY, pinnedAt: DAY }),
      ],
      { archiveAfterDays: null, coldStoreAfterDays: null, deleteAfterDays: 30 },
      NOW,
    );
    expect(
      result.delete.map((group) => ({
        root: group.rootId,
        members: group.memberIds,
      })),
    ).toEqual([{ root: "eligible", members: ["eligible", "owned"] }]);
  });
  it("does not archive provisioning threads or count shared descendants twice in a group", () => {
    const result = selectCandidates(
      [
        thread("provisioning", { environmentId: null, status: "starting" }),
        thread("root"),
        thread("child", {
          parentThreadId: "root",
          lifecycleOwnerThreadId: "root",
        }),
        thread("deleted", { deletedAt: DAY }),
      ],
      { archiveAfterDays: 30, coldStoreAfterDays: null, deleteAfterDays: null },
      NOW,
    );
    expect(result.archive.map((group) => group.memberIds)).toEqual([
      ["root", "child"],
    ]);
  });
});

describe("retention plugin", () => {
  it("defaults to Never, previews without mutation, and requires CLI confirmation", async () => {
    const host = createFakePluginHost({
      pluginId: "storage-retention",
      sdk: {
        threads: {
          list: async () => [
            makeThreadResponse({ id: "thr_old", updatedAt: 1 }),
          ],
          archive: async ({ threadId }) => ({ archivedThreadIds: [threadId] }),
        },
      },
    });
    try {
      plugin(host.bb);
      await host.harness.runSchedule("retention");
      expect(host.harness.sdk.callsTo("threads.list")).toHaveLength(0);
      const preview = await host.harness.callRpc("preview", {
        archiveAfterDays: 30,
        deleteAfterDays: null,
      });
      expect(preview).toEqual({
        archiveCount: 1,
        coldStoreCount: 0,
        deleteCount: 0,
      });
      expect(host.harness.sdk.callsTo("threads.archive")).toHaveLength(0);
      const refused = await host.harness.runCli([
        "retention",
        "--archive-after",
        "30",
        "--save",
      ]);
      expect(refused.exitCode).toBe(1);
      const saved = await host.harness.runCli([
        "retention",
        "--archive-after",
        "30",
        "--save",
        "--yes",
      ]);
      expect(saved.exitCode).toBe(0);
      await host.harness.runSchedule("retention");
      expect(host.harness.sdk.callsTo("threads.archive")).toHaveLength(1);
      expect(await host.harness.callRpc("state", null)).toMatchObject({
        policy: {
          archiveAfterDays: 30,
          coldStoreAfterDays: null,
          deleteAfterDays: null,
        },
        lastRun: { archivedCount: 1 },
      });
    } finally {
      await host.harness.dispose();
    }
  });
  it("reads beyond one page before acting and bounds each hourly action while continuing past failures", async () => {
    const rows = Array.from({ length: 501 }, (_, i) =>
      makeThreadResponse({
        id: `thr_${String(i).padStart(3, "0")}`,
        updatedAt: 1,
      }),
    );
    rows[500] = makeThreadResponse({
      id: "thr_recent_child",
      parentThreadId: "thr_000",
      updatedAt: Date.now(),
    });
    const host = createFakePluginHost({
      pluginId: "storage-retention",
      sdk: {
        threads: {
          list: async ({ offset = 0, limit }) =>
            rows.slice(offset, offset + limit),
          archive: async ({ threadId }) => {
            if (threadId === "thr_001") throw new Error("offline");
            return { archivedThreadIds: ["thr_archived"] };
          },
        },
      },
    });
    try {
      plugin(host.bb);
      await host.harness.callRpc("configure", {
        archiveAfterDays: 30,
        deleteAfterDays: null,
      });
      await host.harness.runSchedule("retention");
      expect(host.harness.sdk.callsTo("threads.archive")).toHaveLength(50);
      expect(
        host.harness.sdk.callsTo("threads.archive").flat(),
      ).not.toContainEqual({ threadId: "thr_000" });
      expect(await host.harness.callRpc("state", null)).toMatchObject({
        lastRun: { archivedCount: 49, failedCount: 1 },
      });
    } finally {
      await host.harness.dispose();
    }
  });
  it("moves only old archived threads that nothing else points at to cold storage", () => {
    const result = selectCandidates(
      [
        thread("old", { archivedAt: DAY }),
        thread("recent", { archivedAt: NOW - DAY }),
        thread("pinned", { archivedAt: DAY, pinnedAt: DAY }),
        thread("parent", { archivedAt: DAY }),
        thread("child", { archivedAt: DAY, parentThreadId: "parent" }),
        thread("running", { archivedAt: DAY, status: "active" }),
        thread("live"),
      ],
      { archiveAfterDays: null, coldStoreAfterDays: 30, deleteAfterDays: null },
      NOW,
    );
    expect(result.coldStore.map((candidate) => candidate.rootId)).toEqual([
      "child",
      "old",
    ]);
  });
  it("holds the end of a cold-stored thread's delete until its file is written, then restores it from the file", async () => {
    const file = new Uint8Array([1, 2, 3, 4]);
    let deleted = false;
    const host = createFakePluginHost({
      pluginId: "storage-retention",
      sdk: {
        threads: {
          list: async () => [
            makeThreadResponse({
              id: "thr_old",
              archivedAt: 1,
              title: "Old investigation",
              deletedAt: deleted ? 2 : null,
            }),
          ],
          delete: async () => {
            deleted = true;
            return { ok: true };
          },
          experimental_export: async () => file,
          experimental_import: async () => ({ threadId: "thr_old", rows: 4 }),
        },
      },
    });
    try {
      plugin(host.bb);
      const beforeDeleteFinalize =
        host.harness.registrations.hooks["thread.delete_finalize"];
      if (beforeDeleteFinalize === null)
        throw new Error("thread.delete_finalize not registered");
      await host.harness.callRpc("configure", {
        archiveAfterDays: null,
        coldStoreAfterDays: 30,
        deleteAfterDays: null,
      });
      await host.harness.runSchedule("retention");
      expect(host.harness.sdk.callsTo("threads.delete")).toEqual([
        [{ threadId: "thr_old", childThreadsConfirmed: false }],
      ]);
      expect(
        await beforeDeleteFinalize({
          threadId: "thr_other",
          projectId: "proj_test",
        }),
      ).toEqual({ action: "proceed" });

      const context = { threadId: "thr_old", projectId: "proj_test" };
      expect(await beforeDeleteFinalize(context)).toEqual({ action: "wait" });
      await vi.waitFor(async () =>
        expect(
          await host.harness.callRpc("coldThreads", {
            projectId: null,
            search: null,
            limit: 50,
            after: null,
          }),
        ).toMatchObject({
          threads: [
            {
              threadId: "thr_old",
              title: "Old investigation",
              state: "stored",
              fileBytes: 4,
            },
          ],
        }),
      );
      expect(await beforeDeleteFinalize(context)).toEqual({
        action: "proceed",
      });
      expect(host.harness.sdk.callsTo("threads.experimental_export")).toEqual([
        [{ threadId: "thr_old" }],
      ]);
      const directory = join(
        dirname(host.bb.storage.database().name),
        "cold-storage",
      );
      expect(readdirSync(directory)).toEqual(["thr_old.jsonl.zst"]);
      expect(
        new Uint8Array(readFileSync(join(directory, "thr_old.jsonl.zst"))),
      ).toEqual(file);

      expect(
        await host.harness.callRpc("restoreColdThread", {
          threadId: "thr_old",
        }),
      ).toEqual({ threadId: "thr_old", restoredThreadIds: ["thr_old"] });
      expect(host.harness.sdk.callsTo("threads.experimental_import")).toEqual([
        [{ file: Buffer.from(file) }],
      ]);
      expect(existsSync(join(directory, "thr_old.jsonl.zst"))).toBe(false);
      expect(
        await host.harness.callRpc("coldThreads", {
          projectId: null,
          search: null,
          limit: 50,
          after: null,
        }),
      ).toEqual({
        threads: [],
        hasMore: false,
        totalCount: 0,
        totalBytes: 0,
        movingCount: 0,
        lastStoredAt: null,
      });
    } finally {
      await host.harness.dispose();
    }
  });
  it("keeps waiting while the file can't be written, and asks for it again", async () => {
    let failures = 1;
    const host = createFakePluginHost({
      pluginId: "storage-retention",
      sdk: {
        threads: {
          list: async () => [
            makeThreadResponse({ id: "thr_old", archivedAt: 1 }),
          ],
          delete: async () => ({ ok: true }),
          experimental_export: async () => {
            if (failures-- > 0) throw new Error("disk full");
            return new Uint8Array([1]);
          },
        },
      },
    });
    try {
      plugin(host.bb);
      const beforeDeleteFinalize =
        host.harness.registrations.hooks["thread.delete_finalize"];
      if (beforeDeleteFinalize === null)
        throw new Error("thread.delete_finalize not registered");
      await host.harness.callRpc("configure", {
        archiveAfterDays: null,
        coldStoreAfterDays: 30,
        deleteAfterDays: null,
      });
      await host.harness.runSchedule("retention");
      const context = { threadId: "thr_old", projectId: "proj_test" };
      expect(await beforeDeleteFinalize(context)).toEqual({ action: "wait" });
      await vi.waitFor(() =>
        expect(
          host.harness.sdk.callsTo("threads.experimental_export"),
        ).toHaveLength(1),
      );
      await new Promise((resolve) => setImmediate(resolve));
      expect(await beforeDeleteFinalize(context)).toEqual({ action: "wait" });
      await vi.waitFor(async () =>
        expect(await beforeDeleteFinalize(context)).toEqual({
          action: "proceed",
        }),
      );
      expect(
        host.harness.sdk.callsTo("threads.experimental_export"),
      ).toHaveLength(2);
    } finally {
      await host.harness.dispose();
    }
  });
  it("forgets a move whose delete failed or whose thread was removed without it", async () => {
    let present = true;
    const host = createFakePluginHost({
      pluginId: "storage-retention",
      sdk: {
        threads: {
          list: async () =>
            present
              ? [
                  makeThreadResponse({
                    id: "thr_old",
                    archivedAt: 1,
                    deletedAt: 2,
                  }),
                ]
              : [],
          delete: async () => {
            throw new Error("thread is busy");
          },
        },
      },
    });
    try {
      plugin(host.bb);
      const coldStorage = createColdStorage(host.bb);
      await expect(
        coldStorage.store(
          makeThreadResponse({ id: "thr_old", archivedAt: 1 }),
          [],
        ),
      ).rejects.toThrow("thread is busy");
      expect(
        coldStorage.list({
          projectId: null,
          search: null,
          limit: 50,
          after: null,
        }),
      ).toEqual({
        threads: [],
        hasMore: false,
        totalCount: 0,
        totalBytes: 0,
        movingCount: 0,
        lastStoredAt: null,
      });

      host.bb.storage
        .database()
        .prepare(
          `INSERT INTO cold_threads (thread_id, project_id, provider_id, thread_created_at, requested_at)
           VALUES ('thr_old', 'proj_test', 'codex', 1, 1)`,
        )
        .run();
      await coldStorage.reconcile();
      expect(
        coldStorage.list({
          projectId: null,
          search: null,
          limit: 50,
          after: null,
        }).threads,
      ).toHaveLength(1);
      present = false;
      await coldStorage.reconcile();
      expect(
        coldStorage.list({
          projectId: null,
          search: null,
          limit: 50,
          after: null,
        }).threads,
      ).toEqual([]);
    } finally {
      await host.harness.dispose();
    }
  });
  it("writes a fresh file when a thread brought back outside the plugin is moved again, and drops its old entry", async () => {
    const live = new Set<string>(["thr_old"]);
    let version = 1;
    const host = createFakePluginHost({
      pluginId: "storage-retention",
      sdk: {
        threads: {
          list: async () => [
            makeThreadResponse({
              id: "thr_old",
              archivedAt: 1,
              title: `Version ${version}`,
              deletedAt: live.has("thr_old") ? null : 2,
            }),
          ],
          delete: async () => {
            live.delete("thr_old");
            return { ok: true };
          },
          experimental_export: async () => new Uint8Array([version]),
        },
      },
    });
    try {
      plugin(host.bb);
      const coldStorage = createColdStorage(host.bb);
      const directory = join(
        dirname(host.bb.storage.database().name),
        "cold-storage",
      );
      const moveAndWrite = async () => {
        const threads = await host.bb.sdk.threads.list({ limit: 100 });
        const [thread] = threads;
        if (thread === undefined) throw new Error("no thread");
        await coldStorage.store(thread, threads);
        const context = { threadId: "thr_old", projectId: "proj_test" };
        expect(coldStorage.beforeDeleteFinalize(context)).toEqual({
          action: "wait",
        });
        await vi.waitFor(() =>
          expect(coldStorage.beforeDeleteFinalize(context)).toEqual({
            action: "proceed",
          }),
        );
      };
      const listed = () =>
        coldStorage.list({
          projectId: null,
          search: null,
          limit: 50,
          after: null,
        });

      await moveAndWrite();
      live.add("thr_old");
      version = 2;
      await moveAndWrite();
      expect(
        new Uint8Array(readFileSync(join(directory, "thr_old.jsonl.zst"))),
      ).toEqual(new Uint8Array([2]));
      expect(listed().threads).toMatchObject([
        { threadId: "thr_old", title: "Version 2", state: "stored" },
      ]);

      live.add("thr_old");
      await coldStorage.reconcile();
      expect(listed().threads).toEqual([]);
      expect(existsSync(join(directory, "thr_old.jsonl.zst"))).toBe(false);
    } finally {
      await host.harness.dispose();
    }
  });
  it("restores the cold-stored threads a thread links to first, and only forgets one that is already back", async () => {
    const live = new Set<string>(["thr_parent", "thr_child"]);
    const files: Record<string, Uint8Array> = {
      thr_parent: new Uint8Array([1]),
      thr_child: new Uint8Array([2]),
    };
    const threadList = () => [
      makeThreadResponse({
        id: "thr_parent",
        archivedAt: 1,
        deletedAt: live.has("thr_parent") ? null : 2,
      }),
      makeThreadResponse({
        id: "thr_child",
        archivedAt: 1,
        parentThreadId: "thr_parent",
        deletedAt: live.has("thr_child") ? null : 2,
      }),
    ];
    const host = createFakePluginHost({
      pluginId: "storage-retention",
      sdk: {
        threads: {
          list: async (args) =>
            threadList().filter(
              (thread) =>
                args?.threadIds === undefined ||
                args.threadIds.includes(thread.id),
            ),
          delete: async ({ threadId }) => {
            live.delete(threadId);
            return { ok: true };
          },
          experimental_export: async ({ threadId }) => {
            const file = files[threadId];
            if (file === undefined) throw new Error("unknown thread");
            return file;
          },
          experimental_import: async ({ file }) => {
            const threadId =
              Buffer.from(file as Uint8Array)[0] === 1
                ? "thr_parent"
                : "thr_child";
            live.add(threadId);
            return { threadId, rows: 1 };
          },
        },
      },
    });
    try {
      plugin(host.bb);
      const coldStorage = createColdStorage(host.bb);
      for (const thread of threadList().reverse()) {
        await coldStorage.store(thread, threadList());
        const context = { threadId: thread.id, projectId: "proj_test" };
        coldStorage.beforeDeleteFinalize(context);
        await vi.waitFor(() =>
          expect(coldStorage.beforeDeleteFinalize(context)).toEqual({
            action: "proceed",
          }),
        );
      }

      expect(await coldStorage.restore("thr_child")).toEqual({
        threadId: "thr_child",
        restoredThreadIds: ["thr_parent", "thr_child"],
      });
      expect(host.harness.sdk.callsTo("threads.experimental_import")).toEqual([
        [{ file: Buffer.from([1]) }],
        [{ file: Buffer.from([2]) }],
      ]);

      live.delete("thr_child");
      const [parent] = threadList();
      if (parent === undefined) throw new Error("no parent");
      await coldStorage.store(parent, threadList());
      const context = { threadId: "thr_parent", projectId: "proj_test" };
      coldStorage.beforeDeleteFinalize(context);
      await vi.waitFor(() =>
        expect(coldStorage.beforeDeleteFinalize(context)).toEqual({
          action: "proceed",
        }),
      );
      live.add("thr_parent");
      expect(await coldStorage.restore("thr_parent")).toEqual({
        threadId: "thr_parent",
        restoredThreadIds: [],
      });
      expect(
        host.harness.sdk.callsTo("threads.experimental_import"),
      ).toHaveLength(2);
      expect(
        coldStorage.list({
          projectId: null,
          search: null,
          limit: 50,
          after: null,
        }).threads,
      ).toEqual([]);
    } finally {
      await host.harness.dispose();
    }
  });
  it("refuses to cold-store a thread that a live child, fork or lifecycle dependent points at, so its delete can't take them along", async () => {
    const live = new Set<string>([
      "thr_parent",
      "thr_child",
      "thr_fork",
      "thr_owned",
    ]);
    const threadList = () =>
      [
        makeThreadResponse({ id: "thr_parent", archivedAt: 1 }),
        makeThreadResponse({
          id: "thr_child",
          archivedAt: 1,
          parentThreadId: "thr_parent",
        }),
        makeThreadResponse({
          id: "thr_fork",
          archivedAt: 1,
          sourceThreadId: "thr_parent",
        }),
        makeThreadResponse({
          id: "thr_owned",
          archivedAt: 1,
          lifecycleOwnerThreadId: "thr_parent",
        }),
      ].map((thread) => ({
        ...thread,
        deletedAt: live.has(thread.id) ? null : 2,
      }));
    const host = createFakePluginHost({
      pluginId: "storage-retention",
      sdk: {
        threads: {
          list: async () => threadList(),
          delete: async ({ threadId }) => {
            live.delete(threadId);
            return { ok: true };
          },
          experimental_export: async () => new Uint8Array([1]),
        },
      },
    });
    const coldList = () =>
      host.harness.callRpc("coldThreads", {
        projectId: null,
        search: null,
        limit: 50,
        after: null,
      });
    try {
      plugin(host.bb);
      for (const dependent of ["thr_child", "thr_fork", "thr_owned"]) {
        const refused = await host.harness.runCli([
          "cold-store",
          "--thread",
          "thr_parent",
          "--yes",
        ]);
        expect(refused.exitCode).toBe(1);
        expect(refused.stderr).toContain(dependent);
        expect(host.harness.sdk.callsTo("threads.delete")).toEqual([]);
        expect(await coldList()).toMatchObject({ threads: [], totalCount: 0 });
        live.delete(dependent);
      }

      const moved = await host.harness.runCli([
        "cold-store",
        "--thread",
        "thr_parent",
        "--yes",
      ]);
      expect(moved.exitCode).toBe(0);
      expect(host.harness.sdk.callsTo("threads.delete")).toEqual([
        [{ threadId: "thr_parent", childThreadsConfirmed: false }],
      ]);
      expect(await coldList()).toMatchObject({
        threads: [{ threadId: "thr_parent" }],
      });
    } finally {
      await host.harness.dispose();
    }
  });
  it("pages cold storage by cursor without skipping or repeating rows, with totals and literal search", async () => {
    const host = createFakePluginHost({ pluginId: "storage-retention" });
    try {
      const coldStorage = createColdStorage(host.bb);
      const insert = host.bb.storage
        .database()
        .prepare<[string, string, number | null, number | null]>(
          `INSERT INTO cold_threads (thread_id, project_id, title, provider_id, thread_created_at, requested_at, stored_at, file_bytes)
           VALUES (?, 'proj_test', ?, 'codex', 1, 1, ?, ?)`,
        );
      insert.run("thr_m1", "moving one", null, null);
      insert.run("thr_m2", "moving two", null, null);
      insert.run("thr_a", "100%_done", 50, 10);
      insert.run("thr_b", "100xxdone", 50, 20);
      insert.run("thr_c", "third", 40, 30);
      insert.run("thr_d", "fourth", 30, 40);
      insert.run("thr_e", "fifth", 20, 50);
      const all = [
        "thr_m2",
        "thr_m1",
        "thr_b",
        "thr_a",
        "thr_c",
        "thr_d",
        "thr_e",
      ];
      const seen: string[] = [];
      let after: ColdThreadCursor | null = null;
      for (;;) {
        const page = coldStorage.list({
          projectId: null,
          search: null,
          limit: 2,
          after,
        });
        expect(page).toMatchObject({
          totalCount: 7,
          totalBytes: 150,
          movingCount: 2,
          lastStoredAt: 50,
        });
        seen.push(...page.threads.map((entry) => entry.threadId));
        const last = page.threads.at(-1);
        if (!page.hasMore || last === undefined) break;
        after = { storedAt: last.storedAt, threadId: last.threadId };
      }
      expect(seen).toEqual(all);
      expect(
        coldStorage.list({
          projectId: null,
          search: "100%_",
          limit: 50,
          after: null,
        }),
      ).toMatchObject({
        threads: [{ threadId: "thr_a" }],
        totalCount: 1,
        totalBytes: 10,
      });
    } finally {
      await host.harness.dispose();
    }
  });
  it("runs deletion through the SDK and persists its run summary", async () => {
    const host = createFakePluginHost({
      pluginId: "storage-retention",
      sdk: {
        threads: {
          list: async () => [
            makeThreadResponse({ id: "thr_old", archivedAt: 1 }),
            makeThreadResponse({
              id: "thr_owned",
              lifecycleOwnerThreadId: "thr_old",
              archivedAt: 1,
            }),
            makeThreadResponse({ id: "thr_keep", archivedAt: 1, pinnedAt: 1 }),
          ],
          delete: async () => ({ ok: true }),
        },
      },
    });
    try {
      plugin(host.bb);
      await host.harness.callRpc("configure", {
        archiveAfterDays: null,
        deleteAfterDays: 30,
      });
      await host.harness.runSchedule("retention");
      expect(host.harness.sdk.callsTo("threads.delete")).toEqual([
        [{ threadId: "thr_old", childThreadsConfirmed: true }],
      ]);
      expect(await host.harness.callRpc("state", null)).toMatchObject({
        lastRun: { deletedCount: 2, archivedCount: 0, failedCount: 0 },
      });
    } finally {
      await host.harness.dispose();
    }
  });

  it("skips a group that was pinned or unarchived after the sweep selected it", async () => {
    let reads = 0;
    const host = createFakePluginHost({
      pluginId: "storage-retention",
      sdk: {
        threads: {
          list: async () => {
            reads++;
            return [
              makeThreadResponse({
                id: "thr_pinned",
                archivedAt: 1,
                pinnedAt: reads > 1 ? Date.now() : null,
              }),
              makeThreadResponse({
                id: "thr_unarchived",
                archivedAt: reads > 1 ? null : 1,
              }),
              makeThreadResponse({ id: "thr_old", archivedAt: 1 }),
            ];
          },
          delete: async () => ({ ok: true }),
        },
      },
    });
    try {
      plugin(host.bb);
      await host.harness.callRpc("configure", {
        archiveAfterDays: null,
        deleteAfterDays: 30,
      });
      await host.harness.runSchedule("retention");
      expect(host.harness.sdk.callsTo("threads.delete")).toEqual([
        [{ threadId: "thr_old", childThreadsConfirmed: true }],
      ]);
      expect(await host.harness.callRpc("state", null)).toMatchObject({
        lastRun: { deletedCount: 1, failedCount: 0 },
      });
    } finally {
      await host.harness.dispose();
    }
  });

  it("stops a running batch after the plugin is disposed", async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host = createFakePluginHost({
      pluginId: "storage-retention",
      sdk: {
        threads: {
          list: async () => [
            makeThreadResponse({ id: "thr_a", updatedAt: 1 }),
            makeThreadResponse({ id: "thr_b", updatedAt: 1 }),
          ],
          archive: async () => {
            entered();
            await blocked;
            return { archivedThreadIds: ["thr_archived"] };
          },
        },
      },
    });
    plugin(host.bb);
    await host.harness.callRpc("configure", {
      archiveAfterDays: 30,
      deleteAfterDays: null,
    });
    const run = host.harness.runSchedule("retention");
    await started;
    await host.harness.dispose();
    release();
    await run;
    expect(host.harness.sdk.callsTo("threads.archive")).toHaveLength(1);
  });
});
