import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { threadScope } from "@bb/domain";
import {
  abandonThreadBranchInTransaction,
  activateThreadBranch,
  bindThreadBranchProviderSessionInTransaction,
  createConnection,
  createProject,
  createThread,
  getActiveThreadBranch,
  getActiveThreadBranchId,
  getThreadBranch,
  getThreadBranchIdAtOrBeforeSequence,
  getThreadSourceBranchId,
  inspectThreadBranches,
  insertEvents,
  listPendingThreadBranchCleanup,
  listStagedThreadBranches,
  migrate,
  noopNotifier,
  stageThreadBranch,
  threadBranches,
  threadActiveBranches,
  threads,
  events,
} from "../../src/index.js";
import { upsertHost } from "../../src/data/hosts.js";
import { activateThreadBranchInTransaction } from "../../src/data/thread-branches.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "thread-branch-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "thread branch test",
    source: {
      type: "local_path",
      hostId: host.id,
      path: "/tmp/thread-branch",
    },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  return { db, project, thread };
}

describe("thread branches", () => {
  it("creates one active root and stamps appended events with it", () => {
    const { db, thread } = setup();
    const root = getActiveThreadBranch(db, thread.id);

    expect(root).not.toBeNull();
    expect(root).toMatchObject({
      threadId: thread.id,
      parentBranchId: null,
      cutoffSequence: 0,
      providerId: "codex",
      creationReason: "thread-start",
      lifecycle: "active",
    });
    expect(getActiveThreadBranchId(db, thread.id)).toBe(root?.id);

    insertEvents(db, noopNotifier, [
      {
        data: "{}",
        itemId: null,
        itemKind: null,
        scope: threadScope(),
        threadId: thread.id,
        type: "provider/error",
        sequence: 1,
      },
    ]);
    expect(
      db
        .select({ branchId: events.branchId })
        .from(events)
        .where(eq(events.threadId, thread.id))
        .get(),
    ).toEqual({ branchId: root?.id });

    db.$client.close();
  });

  it("stages, activates, and restores branches atomically", () => {
    const { db, thread } = setup();
    const root = getActiveThreadBranch(db, thread.id);
    if (!root) throw new Error("Expected root branch");

    const staged = stageThreadBranch(db, {
      cutoffSequence: 4,
      creationReason: "rewind",
      parentBranchId: root.id,
      providerId: "codex",
      providerThreadId: "codex-fork-1",
      threadId: thread.id,
      now: 100,
    });
    expect(staged.lifecycle).toBe("staged");
    expect(staged.cleanupStatus).toBe("pending");
    expect(getActiveThreadBranchId(db, thread.id)).toBe(root.id);
    expect(listPendingThreadBranchCleanup(db).map((row) => row.id)).toEqual([
      staged.id,
    ]);

    activateThreadBranch(db, { branchId: staged.id, now: 200 });
    expect(getActiveThreadBranchId(db, thread.id)).toBe(staged.id);
    expect(getThreadBranch(db, root.id)).toMatchObject({
      lifecycle: "available",
      deactivatedAt: 200,
    });
    expect(getThreadBranch(db, staged.id)).toMatchObject({
      lifecycle: "active",
      cleanupStatus: "not-needed",
    });

    activateThreadBranch(db, { branchId: root.id, now: 300 });
    expect(getActiveThreadBranchId(db, thread.id)).toBe(root.id);
    expect(getThreadBranch(db, staged.id)).toMatchObject({
      lifecycle: "available",
      deactivatedAt: 300,
    });
    db.$client.close();
  });

  it("rolls back pointer and lifecycle changes together", () => {
    const { db, thread } = setup();
    const root = getActiveThreadBranch(db, thread.id);
    if (!root) throw new Error("Expected root branch");
    const staged = stageThreadBranch(db, {
      cutoffSequence: 2,
      creationReason: "rewind",
      parentBranchId: root.id,
      providerId: "codex",
      providerThreadId: "codex-fork-rollback",
      threadId: thread.id,
    });

    expect(() =>
      db.transaction(
        (tx) => {
          activateThreadBranchInTransaction(tx, { branchId: staged.id });
          throw new Error("simulated activation failure");
        },
        { behavior: "immediate" },
      ),
    ).toThrow("simulated activation failure");
    expect(getActiveThreadBranchId(db, thread.id)).toBe(root.id);
    expect(getThreadBranch(db, root.id)?.lifecycle).toBe("active");
    expect(getThreadBranch(db, staged.id)?.lifecycle).toBe("staged");
    db.$client.close();
  });

  it("keeps a child source branch stable after the parent switches branches", () => {
    const { db, project, thread } = setup();
    const parentBranch = getActiveThreadBranch(db, thread.id);
    if (!parentBranch) throw new Error("Expected parent root branch");
    const child = createThread(db, noopNotifier, {
      originKind: "fork",
      projectId: project.id,
      parentThreadId: thread.id,
      providerId: "codex",
    });
    expect(child.sourceThreadId).toBe(thread.id);
    expect(getThreadSourceBranchId(db, child.id)).toBe(parentBranch.id);

    const replacement = stageThreadBranch(db, {
      cutoffSequence: 3,
      creationReason: "rewind",
      parentBranchId: parentBranch.id,
      providerId: "codex",
      providerThreadId: "codex-fork-source-stable",
      threadId: thread.id,
    });
    activateThreadBranch(db, { branchId: replacement.id });
    expect(getThreadSourceBranchId(db, child.id)).toBe(parentBranch.id);
    db.$client.close();
  });

  it("records the branch that produced an explicitly cut-off source point", () => {
    const { db, project, thread } = setup();
    const root = getActiveThreadBranch(db, thread.id);
    if (!root) throw new Error("Expected parent root branch");

    insertEvents(db, noopNotifier, [
      {
        data: "{}",
        itemId: null,
        itemKind: null,
        scope: threadScope(),
        threadId: thread.id,
        type: "provider/error",
        sequence: 1,
      },
    ]);
    const replacement = stageThreadBranch(db, {
      cutoffSequence: 1,
      creationReason: "rewind",
      parentBranchId: root.id,
      providerId: "codex",
      providerThreadId: "codex-fork-cutoff",
      threadId: thread.id,
    });
    activateThreadBranch(db, { branchId: replacement.id });

    const child = createThread(db, noopNotifier, {
      originKind: "fork",
      projectId: project.id,
      providerId: "codex",
      sourceSequence: 1,
      sourceThreadId: thread.id,
    });

    expect(getThreadSourceBranchId(db, child.id)).toBe(root.id);
    expect(getActiveThreadBranchId(db, thread.id)).toBe(replacement.id);
    db.$client.close();
  });

  it("cascades branch state when a thread is deleted", () => {
    const { db, thread } = setup();
    const root = getActiveThreadBranch(db, thread.id);
    if (!root) throw new Error("Expected root branch");
    const staged = stageThreadBranch(db, {
      cutoffSequence: 1,
      creationReason: "rewind",
      parentBranchId: root.id,
      providerId: "codex",
      providerThreadId: "codex-fork-delete",
      threadId: thread.id,
    });

    db.delete(threads).where(eq(threads.id, thread.id)).run();
    expect(getThreadBranch(db, root.id)).toBeNull();
    expect(getThreadBranch(db, staged.id)).toBeNull();
    expect(
      db
        .select()
        .from(threadActiveBranches)
        .where(eq(threadActiveBranches.threadId, thread.id))
        .get(),
    ).toBeUndefined();
    expect(
      db
        .select()
        .from(threadBranches)
        .where(eq(threadBranches.threadId, thread.id))
        .all(),
    ).toEqual([]);
    db.$client.close();
  });

  it("exposes all immutable branches and the active projection for inspection", () => {
    const { db, thread } = setup();
    const root = getActiveThreadBranch(db, thread.id);
    if (!root) throw new Error("Expected root branch");
    const staged = stageThreadBranch(db, {
      cutoffSequence: 5,
      creationReason: "rewind",
      parentBranchId: root.id,
      providerId: "codex",
      providerThreadId: "codex-fork-inspect",
      threadId: thread.id,
    });

    const inspection = inspectThreadBranches(db, { threadId: thread.id });
    expect(inspection.active?.id).toBe(root.id);
    expect(inspection.branches.map((branch) => branch.id).sort()).toEqual(
      [root.id, staged.id].sort(),
    );
    db.$client.close();
  });

  it("binds a provider session to a staged branch and abandons it cleanup-pending", () => {
    const { db, thread } = setup();
    const root = getActiveThreadBranch(db, thread.id);
    if (!root) throw new Error("Expected root branch");

    const staged = stageThreadBranch(db, {
      cutoffSequence: 1,
      creationReason: "rewind",
      parentBranchId: root.id,
      providerId: "codex",
      threadId: thread.id,
    });
    expect(staged.providerThreadId).toBeNull();
    expect(staged.cleanupStatus).toBe("not-needed");

    const bound = db.transaction(
      (tx) =>
        bindThreadBranchProviderSessionInTransaction(tx, {
          branchId: staged.id,
          providerThreadId: "codex-fork-bound",
          now: 150,
        }),
      { behavior: "immediate" },
    );
    expect(bound).toMatchObject({
      lifecycle: "staged",
      providerThreadId: "codex-fork-bound",
      cleanupStatus: "pending",
    });
    expect(getActiveThreadBranchId(db, thread.id)).toBe(root.id);
    expect(listPendingThreadBranchCleanup(db).map((row) => row.id)).toEqual([
      staged.id,
    ]);

    const abandoned = db.transaction(
      (tx) =>
        abandonThreadBranchInTransaction(tx, {
          branchId: staged.id,
          error: "provider branch rejected",
          now: 200,
        }),
      { behavior: "immediate" },
    );
    expect(abandoned).toMatchObject({
      lifecycle: "abandoned",
      cleanupStatus: "pending",
      providerThreadId: "codex-fork-bound",
      cleanupError: "provider branch rejected",
    });
    expect(getActiveThreadBranchId(db, thread.id)).toBe(root.id);
    expect(listStagedThreadBranches(db)).toEqual([]);
    expect(
      listPendingThreadBranchCleanup(db).map((row) => row.id),
    ).toContain(staged.id);

    expect(() =>
      activateThreadBranch(db, { branchId: staged.id }),
    ).toThrow("Cannot activate an abandoned thread branch");
    db.$client.close();
  });

  it("stamps appended events with the active branch across rewind/restore cycles with gapless sequences", () => {
    const { db, thread } = setup();
    const root = getActiveThreadBranch(db, thread.id);
    if (!root) throw new Error("Expected root branch");

    const seed = (from: number, count: number): number => {
      insertEvents(
        db,
        noopNotifier,
        Array.from({ length: count }, (_, index) => ({
          data: JSON.stringify({ n: from + index }),
          itemId: null,
          itemKind: null,
          scope: threadScope(),
          threadId: thread.id,
          type: "provider/error" as const,
          sequence: from + index,
        })),
      );
      return from + count;
    };

    let next = seed(1, 5);
    const rewound = stageThreadBranch(db, {
      cutoffSequence: 2,
      creationReason: "rewind",
      parentBranchId: root.id,
      providerId: "codex",
      providerThreadId: "codex-fork-cycles",
      threadId: thread.id,
    });
    activateThreadBranch(db, { branchId: rewound.id });
    next = seed(next, 3);
    activateThreadBranch(db, { branchId: root.id });
    seed(next, 1);

    const stamped = db
      .select({ branchId: events.branchId, sequence: events.sequence })
      .from(events)
      .where(eq(events.threadId, thread.id))
      .orderBy(events.sequence)
      .all();
    expect(stamped.map((row) => row.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(stamped.slice(0, 5).map((row) => row.branchId)).toEqual(
      Array.from({ length: 5 }, () => root.id),
    );
    expect(stamped.slice(5, 8).map((row) => row.branchId)).toEqual(
      Array.from({ length: 3 }, () => rewound.id),
    );
    expect(stamped[8]?.branchId).toBe(root.id);

    for (const sequence of [1, 2, 5]) {
      expect(
        getThreadBranchIdAtOrBeforeSequence(db, {
          sequence,
          threadId: thread.id,
        }),
      ).toBe(root.id);
    }
    for (const sequence of [6, 8]) {
      expect(
        getThreadBranchIdAtOrBeforeSequence(db, {
          sequence,
          threadId: thread.id,
        }),
      ).toBe(rewound.id);
    }
    expect(
      getThreadBranchIdAtOrBeforeSequence(db, {
        sequence: 9,
        threadId: thread.id,
      }),
    ).toBe(root.id);
    db.$client.close();
  });
});
