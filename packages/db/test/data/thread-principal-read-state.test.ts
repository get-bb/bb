import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi, type Mock } from "vitest";
import { createConnection } from "../../src/connection.js";
import type { DbConnection } from "../../src/connection.js";
import { createProject } from "../../src/data/projects.js";
import {
  createThread,
  deleteThread,
  getThread,
} from "../../src/data/threads.js";
import {
  THREAD_READ_STATE_LOCAL_OWNER_PRINCIPAL_ID,
  getThreadLastReadAtForPrincipal,
  getThreadPrincipalReadStateRow,
  listThreadLastReadAtByThreadIdsForPrincipal,
  setThreadReadStateForPrincipal,
} from "../../src/data/thread-principal-read-state.js";
import { upsertHost } from "../../src/data/hosts.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier, type DbNotifier } from "../../src/notifier.js";
import { threadPrincipalReadState, threads } from "../../src/schema.js";

const ALICE = "human:alice";
const BOB = "human:bob";
const LOCAL_OWNER = THREAD_READ_STATE_LOCAL_OWNER_PRINCIPAL_ID;

function setup(): {
  db: DbConnection;
  project: { id: string };
} {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  return { db, project };
}

function createSpyNotifier(): DbNotifier & {
  notifyThread: Mock<DbNotifier["notifyThread"]>;
} {
  return {
    notifyThread: vi.fn(),
    notifyEnvironment: vi.fn(),
    notifyHost: vi.fn(),
    notifyProject: vi.fn(),
    notifySystem: vi.fn(),
  };
}

describe("thread principal read state", () => {
  it("keeps A/B signed principals independent for read and unread", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const { db, project } = setup();
      const thread = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      // Force a known global value that signed principals must never inherit.
      db.update(threads)
        .set({ lastReadAt: 9_999, updatedAt: 1_000 })
        .where(eq(threads.id, thread.id))
        .run();

      vi.setSystemTime(2_000);
      const aliceRead = setThreadReadStateForPrincipal(db, noopNotifier, {
        threadId: thread.id,
        principalId: ALICE,
        lastReadAt: 2_000,
      });
      expect(aliceRead).toMatchObject({
        changed: true,
        lastReadAt: 2_000,
        threadId: thread.id,
      });

      vi.setSystemTime(3_000);
      const bobRead = setThreadReadStateForPrincipal(db, noopNotifier, {
        threadId: thread.id,
        principalId: BOB,
        lastReadAt: 3_000,
      });
      expect(bobRead?.lastReadAt).toBe(3_000);

      expect(
        getThreadLastReadAtForPrincipal(db, {
          threadId: thread.id,
          principalId: ALICE,
          globalLastReadAt: getThread(db, thread.id)!.lastReadAt,
        }),
      ).toBe(2_000);
      expect(
        getThreadLastReadAtForPrincipal(db, {
          threadId: thread.id,
          principalId: BOB,
          globalLastReadAt: getThread(db, thread.id)!.lastReadAt,
        }),
      ).toBe(3_000);
      // Global compatibility column is untouched by signed principals.
      expect(getThread(db, thread.id)?.lastReadAt).toBe(9_999);

      vi.setSystemTime(4_000);
      setThreadReadStateForPrincipal(db, noopNotifier, {
        threadId: thread.id,
        principalId: ALICE,
        lastReadAt: null,
      });
      expect(
        getThreadLastReadAtForPrincipal(db, {
          threadId: thread.id,
          principalId: ALICE,
          globalLastReadAt: getThread(db, thread.id)!.lastReadAt,
        }),
      ).toBeNull();
      expect(
        getThreadLastReadAtForPrincipal(db, {
          threadId: thread.id,
          principalId: BOB,
          globalLastReadAt: getThread(db, thread.id)!.lastReadAt,
        }),
      ).toBe(3_000);
      expect(getThread(db, thread.id)?.lastReadAt).toBe(9_999);
    } finally {
      vi.useRealTimers();
    }
  });

  it("projects null for a signed principal with no durable row", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    expect(thread.lastReadAt).toBeTypeOf("number");

    expect(
      getThreadLastReadAtForPrincipal(db, {
        threadId: thread.id,
        principalId: ALICE,
        globalLastReadAt: thread.lastReadAt,
      }),
    ).toBeNull();
    expect(
      getThreadPrincipalReadStateRow(db, {
        threadId: thread.id,
        principalId: ALICE,
      }),
    ).toBeNull();
  });

  it("keeps local-owner on the global compatibility column and syncs its row", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const { db, project } = setup();
      const spy = createSpyNotifier();
      const thread = createThread(db, spy, {
        projectId: project.id,
        providerId: "codex",
      });

      vi.setSystemTime(2_000);
      const marked = setThreadReadStateForPrincipal(db, spy, {
        threadId: thread.id,
        principalId: LOCAL_OWNER,
        lastReadAt: 2_000,
      });
      expect(marked).toMatchObject({
        changed: true,
        lastReadAt: 2_000,
      });
      expect(getThread(db, thread.id)?.lastReadAt).toBe(2_000);
      expect(
        getThreadLastReadAtForPrincipal(db, {
          threadId: thread.id,
          principalId: LOCAL_OWNER,
          globalLastReadAt: getThread(db, thread.id)!.lastReadAt,
        }),
      ).toBe(2_000);
      expect(
        getThreadPrincipalReadStateRow(db, {
          threadId: thread.id,
          principalId: LOCAL_OWNER,
        }),
      ).toMatchObject({
        lastReadAt: 2_000,
        principalId: LOCAL_OWNER,
      });
      expect(spy.notifyThread).toHaveBeenCalledWith(
        thread.id,
        ["read-state-changed"],
        { projectId: project.id },
      );

      vi.setSystemTime(3_000);
      setThreadReadStateForPrincipal(db, spy, {
        threadId: thread.id,
        principalId: LOCAL_OWNER,
        lastReadAt: null,
      });
      expect(getThread(db, thread.id)?.lastReadAt).toBeNull();
      expect(
        getThreadPrincipalReadStateRow(db, {
          threadId: thread.id,
          principalId: LOCAL_OWNER,
        })?.lastReadAt,
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps parent and child thread read state independent per principal", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const { db, project } = setup();
      const parent = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      const child = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
        parentThreadId: parent.id,
      });

      vi.setSystemTime(2_000);
      setThreadReadStateForPrincipal(db, noopNotifier, {
        threadId: child.id,
        principalId: ALICE,
        lastReadAt: 2_000,
      });

      expect(
        getThreadLastReadAtForPrincipal(db, {
          threadId: child.id,
          principalId: ALICE,
          globalLastReadAt: getThread(db, child.id)!.lastReadAt,
        }),
      ).toBe(2_000);
      expect(
        getThreadLastReadAtForPrincipal(db, {
          threadId: parent.id,
          principalId: ALICE,
          globalLastReadAt: getThread(db, parent.id)!.lastReadAt,
        }),
      ).toBeNull();
      expect(getThread(db, parent.id)?.lastReadAt).toBe(1_000);
      expect(getThread(db, child.id)?.lastReadAt).toBe(1_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cascade-deletes principal read state with the thread", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    setThreadReadStateForPrincipal(db, noopNotifier, {
      threadId: thread.id,
      principalId: ALICE,
      lastReadAt: 5_000,
    });
    setThreadReadStateForPrincipal(db, noopNotifier, {
      threadId: thread.id,
      principalId: LOCAL_OWNER,
      lastReadAt: 6_000,
    });

    expect(
      db
        .select()
        .from(threadPrincipalReadState)
        .where(eq(threadPrincipalReadState.threadId, thread.id))
        .all(),
    ).toHaveLength(2);

    deleteThread(db, noopNotifier, thread.id);

    expect(
      db
        .select()
        .from(threadPrincipalReadState)
        .where(eq(threadPrincipalReadState.threadId, thread.id))
        .all(),
    ).toHaveLength(0);
  });

  it("batch-projects lastReadAt for list overlays without reordering", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const { db, project } = setup();
      const first = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      vi.setSystemTime(2_000);
      const second = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      vi.setSystemTime(3_000);
      const third = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });

      setThreadReadStateForPrincipal(db, noopNotifier, {
        threadId: second.id,
        principalId: ALICE,
        lastReadAt: 3_500,
      });
      // third intentionally has no signed row.

      const threadIds = [third.id, first.id, second.id];
      const globalLastReadAtByThreadId = new Map(
        [first, second, third].map((thread) => [
          thread.id,
          getThread(db, thread.id)!.lastReadAt,
        ]),
      );

      const signedOverlay = listThreadLastReadAtByThreadIdsForPrincipal(db, {
        principalId: ALICE,
        threadIds,
        globalLastReadAtByThreadId,
      });
      expect([...signedOverlay.keys()]).toEqual(threadIds);
      expect(signedOverlay.get(third.id)).toBeNull();
      expect(signedOverlay.get(first.id)).toBeNull();
      expect(signedOverlay.get(second.id)).toBe(3_500);

      const localOverlay = listThreadLastReadAtByThreadIdsForPrincipal(db, {
        principalId: LOCAL_OWNER,
        threadIds,
        globalLastReadAtByThreadId,
      });
      expect(localOverlay.get(first.id)).toBe(1_000);
      expect(localOverlay.get(second.id)).toBe(2_000);
      expect(localOverlay.get(third.id)).toBe(3_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not notify when local-owner or signed read state is unchanged", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const { db, project } = setup();
      const spy = createSpyNotifier();
      const thread = createThread(db, spy, {
        projectId: project.id,
        providerId: "codex",
      });
      spy.notifyThread.mockClear();

      setThreadReadStateForPrincipal(db, spy, {
        threadId: thread.id,
        principalId: ALICE,
        lastReadAt: 1_000,
      });
      expect(spy.notifyThread).toHaveBeenCalledTimes(1);
      spy.notifyThread.mockClear();

      setThreadReadStateForPrincipal(db, spy, {
        threadId: thread.id,
        principalId: ALICE,
        lastReadAt: 1_000,
      });
      expect(spy.notifyThread).not.toHaveBeenCalled();

      setThreadReadStateForPrincipal(db, spy, {
        threadId: thread.id,
        principalId: LOCAL_OWNER,
        lastReadAt: thread.lastReadAt,
      });
      // createThread already set global lastReadAt to the same value.
      expect(spy.notifyThread).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("thread principal read state migration", () => {
  it("creates the table on a fresh migrate", () => {
    const db = createConnection(":memory:");
    migrate(db);

    const names = db.$client
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'thread_principal_read_state'",
      )
      .all() as { name: string }[];
    expect(names).toEqual([{ name: "thread_principal_read_state" }]);

    const columns = db.$client
      .prepare(
        "SELECT name FROM pragma_table_info('thread_principal_read_state') ORDER BY cid",
      )
      .all() as { name: string }[];
    expect(columns.map((column) => column.name)).toEqual([
      "thread_id",
      "principal_id",
      "last_read_at",
      "read_cursor",
      "updated_at",
    ]);

    const fks = db.$client
      .prepare(
        "SELECT * FROM pragma_foreign_key_list('thread_principal_read_state')",
      )
      .all() as {
      table: string;
      from: string;
      to: string;
      on_delete: string;
    }[];
    expect(fks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "threads",
          from: "thread_id",
          to: "id",
          on_delete: "CASCADE",
        }),
      ]),
    );
  });

  it("backfills only local-owner rows from threads.last_read_at including null", () => {
    const db = createConnection(":memory:");
    migrate(db);

    const host = upsertHost(db, noopNotifier, {
      name: "legacy-host",
      type: "persistent",
    });
    const { project } = createProject(db, noopNotifier, {
      name: "legacy-project",
      source: { type: "local_path", hostId: host.id, path: "/tmp/legacy" },
    });

    const withRead = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const unread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    db.update(threads)
      .set({ lastReadAt: null, updatedAt: Date.now() })
      .where(eq(threads.id, unread.id))
      .run();

    // Recreate the exact pre-0091 shape, then execute the shipped migration
    // file itself. This test must fail if generated SQL and the asserted
    // upgrade behavior ever drift apart.
    db.$client.exec("DROP TABLE thread_principal_read_state");
    const migrationSql = readFileSync(
      new URL(
        "../../drizzle/0091_thread_principal_read_state.sql",
        import.meta.url,
      ),
      "utf8",
    );
    for (const statement of migrationSql
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean)) {
      db.$client.exec(statement);
    }

    const rows = db
      .select()
      .from(threadPrincipalReadState)
      .all()
      .sort((a, b) => a.threadId.localeCompare(b.threadId));

    expect(rows.every((row) => row.principalId === LOCAL_OWNER)).toBe(true);
    expect(rows).toHaveLength(2);

    const byThreadId = new Map(rows.map((row) => [row.threadId, row]));
    expect(byThreadId.get(withRead.id)?.lastReadAt).toBe(withRead.lastReadAt);
    expect(byThreadId.get(unread.id)?.lastReadAt).toBeNull();
    expect(
      rows.some((row) => row.principalId === ALICE || row.principalId === BOB),
    ).toBe(false);
  });
});
