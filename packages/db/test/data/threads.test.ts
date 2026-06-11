import { describe, expect, it, vi } from "vitest";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import type { DbNotifier } from "../../src/notifier.js";
import {
  createThread,
  countLiveThreadsInEnvironment,
  countNonDeletedAssignedChildThreads,
  getThread,
  getThreadExecutionOverride,
  setThreadExecutionOverride,
  hasPendingThreadShutdownInEnvironment,
  listHostThreadIds,
  listStopRequestedThreads,
  listActiveVisiblePinnedThreadRoots,
  listThreadEnvironmentAssignmentsOnHost,
  listTrackedThreadStorageTargetsOnHost,
  listThreads,
  listThreadsWithPendingInteractionState,
  updateThread,
  deleteThread,
  archiveThread,
  clearThreadStopRequested,
  markThreadDeleted,
  markThreadAttentionRequested,
  markThreadStopRequested,
  pinThread,
  reorderPinnedThread,
  unpinThread,
  unarchiveThread,
  transitionThreadStatus,
  InvalidThreadStatusTransitionError,
  ALLOWED_TRANSITIONS,
} from "../../src/data/threads.js";
import { createProject } from "../../src/data/projects.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createEnvironment } from "../../src/data/environments.js";

function setup() {
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
  return { db, host, project };
}

describe("threads", () => {
  it("creates and retrieves a thread", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    expect(thread.id).toMatch(/^thr_/);
    expect(thread.status).toBe("created");
    expect(thread.projectId).toBe(project.id);
    expect(thread.stopRequestedAt).toBeNull();
    expect(thread.deletedAt).toBeNull();
    expect(thread.lastReadAt).toBe(thread.latestAttentionAt);

    const fetched = getThread(db, thread.id);
    expect(fetched).toMatchObject({ id: thread.id });
  });

  it("persists, reads, and clears the thread execution override", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "claude-code",
    });

    // No override on a fresh thread.
    expect(getThreadExecutionOverride(db, thread.id)).toEqual({
      modelOverride: null,
      reasoningLevelOverride: null,
    });

    setThreadExecutionOverride(db, {
      threadId: thread.id,
      modelOverride: "claude-opus-4-8",
      reasoningLevelOverride: "high",
    });
    expect(getThreadExecutionOverride(db, thread.id)).toEqual({
      modelOverride: "claude-opus-4-8",
      reasoningLevelOverride: "high",
    });

    // Presence-sensitive: an omitted field is left unchanged.
    setThreadExecutionOverride(db, {
      threadId: thread.id,
      reasoningLevelOverride: "max",
    });
    expect(getThreadExecutionOverride(db, thread.id)).toEqual({
      modelOverride: "claude-opus-4-8",
      reasoningLevelOverride: "max",
    });

    // Explicit null clears.
    setThreadExecutionOverride(db, {
      threadId: thread.id,
      modelOverride: null,
      reasoningLevelOverride: null,
    });
    expect(getThreadExecutionOverride(db, thread.id)).toEqual({
      modelOverride: null,
      reasoningLevelOverride: null,
    });
  });

  it("pins and unpins threads with durable pin order keys", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const { db, project } = setup();
      const spy: DbNotifier = {
        notifyThread: vi.fn(),
        notifyEnvironment: vi.fn(),
        notifyHost: vi.fn(),
        notifyProject: vi.fn(),
        notifySystem: vi.fn(),
      };
      const thread = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });

      const pinned = pinThread(db, spy, {
        pinnedAt: 2_000,
        threadId: thread.id,
      });

      expect(pinned?.pinnedAt).toBe(2_000);
      expect(pinned?.pinSortKey).not.toBeNull();
      expect(spy.notifyThread).toHaveBeenCalledWith(
        thread.id,
        ["pin-state-changed"],
        { projectId: project.id },
      );

      const pinnedAgain = pinThread(db, spy, { threadId: thread.id });
      expect(pinnedAgain?.pinSortKey).toBe(pinned?.pinSortKey);
      expect(spy.notifyThread).toHaveBeenCalledTimes(1);

      const unpinned = unpinThread(db, spy, { threadId: thread.id });
      expect(unpinned?.pinnedAt).toBeNull();
      expect(unpinned?.pinSortKey).toBeNull();
      expect(spy.notifyThread).toHaveBeenCalledTimes(2);

      unpinThread(db, spy, { threadId: thread.id });
      expect(spy.notifyThread).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("orders pinned threads before unpinned siblings", () => {
    vi.useFakeTimers();
    try {
      const { db, project } = setup();
      vi.setSystemTime(1_000);
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
      vi.setSystemTime(4_000);
      const fourth = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });

      pinThread(db, noopNotifier, { threadId: first.id });
      pinThread(db, noopNotifier, { threadId: third.id });

      expect(
        listThreads(db, { projectId: project.id }).map((thread) => thread.id),
      ).toEqual([third.id, first.id, fourth.id, second.id]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reorders active visible pinned roots globally", () => {
    const { db, host, project } = setup();
    const { project: otherProject } = createProject(db, noopNotifier, {
      name: "other-project",
      source: { type: "local_path", hostId: host.id, path: "/tmp/other" },
    });
    const first = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const second = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const third = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const otherProjectThread = createThread(db, noopNotifier, {
      projectId: otherProject.id,
      providerId: "codex",
    });
    pinThread(db, noopNotifier, { threadId: first.id });
    pinThread(db, noopNotifier, { threadId: second.id });
    pinThread(db, noopNotifier, { threadId: third.id });
    pinThread(db, noopNotifier, { threadId: otherProjectThread.id });

    expect(listActiveVisiblePinnedThreadRoots(db).map((thread) => thread.id))
      .toEqual([otherProjectThread.id, third.id, second.id, first.id]);

    const result = reorderPinnedThread({
      db,
      notifier: noopNotifier,
      threadId: first.id,
      previousThreadId: null,
      nextThreadId: otherProjectThread.id,
    });

    expect(result.kind).toBe("reordered");
    expect(listActiveVisiblePinnedThreadRoots(db).map((thread) => thread.id))
      .toEqual([first.id, otherProjectThread.id, third.id, second.id]);
  });

  it("rejects pinned reorder for unpinned threads, stale neighbors, and hidden child pins", () => {
    const { db, project } = setup();
    const pinned = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const unpinned = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const pinnedParent = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const pinnedChild = createThread(db, noopNotifier, {
      parentThreadId: pinnedParent.id,
      projectId: project.id,
      providerId: "codex",
    });
    pinThread(db, noopNotifier, { threadId: pinned.id });
    pinThread(db, noopNotifier, { threadId: pinnedParent.id });
    pinThread(db, noopNotifier, { threadId: pinnedChild.id });

    expect(
      reorderPinnedThread({
        db,
        notifier: noopNotifier,
        threadId: unpinned.id,
        previousThreadId: null,
        nextThreadId: pinned.id,
      }).kind,
    ).toBe("not_pinned");
    expect(
      reorderPinnedThread({
        db,
        notifier: noopNotifier,
        threadId: pinned.id,
        previousThreadId: unpinned.id,
        nextThreadId: null,
      }).kind,
    ).toBe("stale_neighbor");
    expect(
      reorderPinnedThread({
        db,
        notifier: noopNotifier,
        threadId: pinned.id,
        previousThreadId: pinnedChild.id,
        nextThreadId: null,
      }).kind,
    ).toBe("stale_neighbor");
    expect(
      reorderPinnedThread({
        db,
        notifier: noopNotifier,
        threadId: pinnedChild.id,
        previousThreadId: null,
        nextThreadId: pinned.id,
      }).kind,
    ).toBe("stale_neighbor");
  });

  it("lists threads by project", () => {
    const { db, project } = setup();
    createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    expect(listThreads(db, { projectId: project.id })).toHaveLength(2);
  });

  it("isolates threads by project", () => {
    const { db, host, project } = setup();
    const { project: otherProject } = createProject(db, noopNotifier, {
      name: "other-project",
      source: { type: "local_path", hostId: host.id, path: "/tmp/other" },
    });
    createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    createThread(db, noopNotifier, {
      projectId: otherProject.id,
      providerId: "codex",
    });

    expect(listThreads(db, { projectId: project.id })).toHaveLength(1);
    expect(listThreads(db, { projectId: otherProject.id })).toHaveLength(1);
  });

  it("filters threads by parent thread and archived state", () => {
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
    createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    archiveThread(db, noopNotifier, child.id);

    expect(
      listThreads(db, { projectId: project.id, parentThreadId: parent.id }),
    ).toHaveLength(1);
    expect(
      listThreads(db, { projectId: project.id, archived: true }),
    ).toHaveLength(1);
    expect(
      listThreads(db, { projectId: project.id, archived: false }),
    ).toHaveLength(2);
  });

  it("filters threads by parent presence", () => {
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
    createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });

    const childThreads = listThreads(db, {
      projectId: project.id,
      hasParent: true,
    });
    expect(childThreads).toHaveLength(1);
    expect(childThreads[0]?.id).toBe(child.id);

    const rootThreads = listThreads(db, {
      projectId: project.id,
      hasParent: false,
    });
    expect(rootThreads).toHaveLength(2);
    expect(rootThreads.map((thread) => thread.id)).toContain(parent.id);
  });

  it("paginates archived threads ordered by archive recency", async () => {
    const { db, project } = setup();
    const created: { id: string }[] = [];
    for (let index = 0; index < 5; index += 1) {
      const thread = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      created.push(thread);
    }
    // Archive in a specific order so the most recently archived is "thr_4".
    for (const thread of created) {
      archiveThread(db, noopNotifier, thread.id);
      // Sqlite Date.now() resolution can collapse archives within a tick;
      // use a tiny delay to keep archivedAt strictly increasing.
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const archivedFirstPage = listThreads(db, {
      projectId: project.id,
      archived: true,
      limit: 3,
    });
    expect(archivedFirstPage.map((thread) => thread.id)).toEqual([
      created[4]?.id,
      created[3]?.id,
      created[2]?.id,
    ]);

    const archivedSecondPage = listThreads(db, {
      projectId: project.id,
      archived: true,
      limit: 3,
      offset: 3,
    });
    expect(archivedSecondPage.map((thread) => thread.id)).toEqual([
      created[1]?.id,
      created[0]?.id,
    ]);
  });

  it("counts active assigned child threads", () => {
    const { db, project } = setup();
    const parent = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      parentThreadId: parent.id,
    });

    expect(
      countNonDeletedAssignedChildThreads(db, {
        parentThreadId: parent.id,
      }),
    ).toBe(1);
  });

  it("counts archived assigned child threads", () => {
    const { db, project } = setup();
    const parent = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const archivedChild = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      parentThreadId: parent.id,
    });

    archiveThread(db, noopNotifier, archivedChild.id);

    expect(
      countNonDeletedAssignedChildThreads(db, {
        parentThreadId: parent.id,
      }),
    ).toBe(1);
  });

  it("excludes deleted assigned child threads", () => {
    const { db, project } = setup();
    const parent = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const deletedChild = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      parentThreadId: parent.id,
    });

    markThreadDeleted(db, noopNotifier, { threadId: deletedChild.id });

    expect(
      countNonDeletedAssignedChildThreads(db, {
        parentThreadId: parent.id,
      }),
    ).toBe(0);
  });

  it("excludes assigned child threads under a different parent", () => {
    const { db, project } = setup();
    const parent = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const otherParent = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      parentThreadId: otherParent.id,
    });

    expect(
      countNonDeletedAssignedChildThreads(db, {
        parentThreadId: parent.id,
      }),
    ).toBe(0);
  });

  it("lists thread environment workspace display kind without per-thread lookups", () => {
    const { db, host, project } = setup();
    const directEnvironment = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      workspaceProvisionType: "unmanaged",
      isGitRepo: true,
      isWorktree: false,
      branchName: "main",
    });
    const worktreeEnvironment = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      name: "Review workspace",
      workspaceProvisionType: "managed-worktree",
      isWorktree: true,
      branchName: "bb/worktree",
    });
    const personalEnvironment = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      workspaceProvisionType: "personal",
      isGitRepo: false,
      isWorktree: false,
    });
    const directThread = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: directEnvironment.id,
      providerId: "codex",
    });
    const worktreeThread = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: worktreeEnvironment.id,
      providerId: "codex",
    });
    const personalThread = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: personalEnvironment.id,
      providerId: "codex",
    });

    const displayKindsByThreadId = new Map(
      listThreadsWithPendingInteractionState(db, { projectId: project.id }).map(
        (thread) => [thread.id, thread.environmentWorkspaceDisplayKind],
      ),
    );

    expect(displayKindsByThreadId.get(directThread.id)).toBe("other");
    expect(displayKindsByThreadId.get(worktreeThread.id)).toBe(
      "managed-worktree",
    );
    expect(displayKindsByThreadId.get(personalThread.id)).toBe("other");

    const environmentIdentityByThreadId = new Map(
      listThreadsWithPendingInteractionState(db, { projectId: project.id }).map(
        (thread) => [
          thread.id,
          {
            environmentBranchName: thread.environmentBranchName,
            environmentHostId: thread.environmentHostId,
            environmentName: thread.environmentName,
          },
        ],
      ),
    );

    expect(environmentIdentityByThreadId.get(directThread.id)).toEqual({
      environmentBranchName: "main",
      environmentHostId: host.id,
      environmentName: null,
    });
    expect(environmentIdentityByThreadId.get(worktreeThread.id)).toEqual({
      environmentBranchName: "bb/worktree",
      environmentHostId: host.id,
      environmentName: "Review workspace",
    });
  });

  it("updates thread title", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const updated = updateThread(db, noopNotifier, thread.id, {
      title: "New title",
    });
    expect(updated?.title).toBe("New title");
  });

  it("notifies when a thread parent changes", () => {
    const { db, project } = setup();
    const spy: DbNotifier = {
      notifyThread: vi.fn(),
      notifyEnvironment: vi.fn(),
      notifyHost: vi.fn(),
      notifyProject: vi.fn(),
      notifySystem: vi.fn(),
    };
    const parentThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const childThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });

    updateThread(db, spy, childThread.id, {
      parentThreadId: parentThread.id,
    });

    expect(spy.notifyThread).toHaveBeenCalledWith(
      childThread.id,
      ["parent-changed"],
      { projectId: project.id },
    );
  });

  it("preserves read state when renaming a read thread", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const { db, project } = setup();
      const thread = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      updateThread(db, noopNotifier, thread.id, {
        lastReadAt: thread.latestAttentionAt,
      });

      vi.setSystemTime(2_000);
      const updated = updateThread(db, noopNotifier, thread.id, {
        title: "New title",
      });

      expect(updated?.title).toBe("New title");
      expect(updated?.updatedAt).toBe(2_000);
      expect(updated?.lastReadAt).toBe(1_000);
      expect(updated?.latestAttentionAt).toBe(1_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps unread threads unread when renaming", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const { db, project } = setup();
      const thread = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      updateThread(db, noopNotifier, thread.id, {
        lastReadAt: null,
      });

      vi.setSystemTime(2_000);
      const updated = updateThread(db, noopNotifier, thread.id, {
        title: "New title",
      });

      expect(updated?.updatedAt).toBe(2_000);
      expect(updated?.lastReadAt).toBeNull();
      expect(updated?.latestAttentionAt).toBe(1_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks a thread as needing attention without changing read position", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const { db, project } = setup();
      const spy: DbNotifier = {
        notifyThread: vi.fn(),
        notifyEnvironment: vi.fn(),
        notifyHost: vi.fn(),
        notifyProject: vi.fn(),
        notifySystem: vi.fn(),
      };
      const thread = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      updateThread(db, noopNotifier, thread.id, {
        lastReadAt: thread.latestAttentionAt,
      });

      vi.setSystemTime(2_000);
      const updated = markThreadAttentionRequested(db, spy, {
        threadId: thread.id,
      });

      expect(updated?.updatedAt).toBe(2_000);
      expect(updated?.lastReadAt).toBe(1_000);
      expect(updated?.latestAttentionAt).toBe(2_000);
      expect(spy.notifyThread).toHaveBeenCalledWith(
        thread.id,
        ["read-state-changed"],
        { projectId: project.id },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("deletes a thread", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    expect(deleteThread(db, noopNotifier, thread.id)).toBe(true);
    expect(getThread(db, thread.id)).toBeNull();
    expect(deleteThread(db, noopNotifier, thread.id)).toBe(false);
  });

  it("marks a thread deleted and hides it from public list queries", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });

    const deleted = markThreadDeleted(db, noopNotifier, {
      threadId: thread.id,
    });

    expect(deleted?.deletedAt).toBeTypeOf("number");
    expect(getThread(db, thread.id)?.deletedAt).toBeTypeOf("number");
    expect(listThreads(db, { projectId: project.id })).toHaveLength(0);
  });

  it("archives a thread", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const archived = archiveThread(db, noopNotifier, thread.id);
    expect(archived?.archivedAt).toBeTypeOf("number");
  });

  it("unarchives a thread", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    archiveThread(db, noopNotifier, thread.id);

    const unarchived = unarchiveThread(db, noopNotifier, thread.id);
    expect(unarchived?.archivedAt).toBeNull();
    expect(unarchived?.latestAttentionAt).toBe(thread.latestAttentionAt);
  });

  it("tracks stop requests independently from runtime status", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "active",
    });

    const stopRequested = markThreadStopRequested(db, noopNotifier, {
      threadId: thread.id,
      requestedAt: 123,
    });
    expect(stopRequested?.stopRequestedAt).toBe(123);
    expect(getThread(db, thread.id)?.status).toBe("active");

    const cleared = clearThreadStopRequested(db, noopNotifier, thread.id);
    expect(cleared?.stopRequestedAt).toBeNull();
  });

  it("lists stop-requested threads in deterministic bounded batches", () => {
    const { db, host, project } = setup();
    const environment = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/thread-stop-requested-batch",
      workspaceProvisionType: "unmanaged",
      status: "ready",
    });
    const firstTie = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: environment.id,
      providerId: "codex",
      status: "active",
    });
    const secondTie = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: environment.id,
      providerId: "codex",
      status: "active",
    });
    const later = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: environment.id,
      providerId: "codex",
      status: "active",
    });
    const unrequested = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: environment.id,
      providerId: "codex",
      status: "active",
    });

    markThreadStopRequested(db, noopNotifier, {
      threadId: firstTie.id,
      requestedAt: 100,
    });
    markThreadStopRequested(db, noopNotifier, {
      threadId: secondTie.id,
      requestedAt: 100,
    });
    markThreadStopRequested(db, noopNotifier, {
      threadId: later.id,
      requestedAt: 200,
    });

    const expectedTieIds = [firstTie.id, secondTie.id].sort((a, b) =>
      a.localeCompare(b),
    );
    const batch = listStopRequestedThreads(db, { limit: 2 });

    expect(batch.map((thread) => thread.threadId)).toEqual(expectedTieIds);
    expect(batch.map((thread) => thread.stopRequestedAt)).toEqual([100, 100]);
    expect(batch).toEqual([
      expect.objectContaining({
        environmentId: environment.id,
        hostId: host.id,
        status: "active",
      }),
      expect.objectContaining({
        environmentId: environment.id,
        hostId: host.id,
        status: "active",
      }),
    ]);
    expect(batch.map((thread) => thread.threadId)).not.toContain(later.id);
    expect(batch.map((thread) => thread.threadId)).not.toContain(
      unrequested.id,
    );
  });

  it("counts only non-archived, non-deleted threads as live", () => {
    const { db, project, host } = setup();
    const environment = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/thread-live-count",
      workspaceProvisionType: "unmanaged",
      status: "ready",
    });
    const liveThread = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: environment.id,
      providerId: "codex",
      status: "idle",
    });
    const archivedThread = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: environment.id,
      providerId: "codex",
      status: "idle",
    });
    const deletedThread = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: environment.id,
      providerId: "codex",
      status: "idle",
    });

    archiveThread(db, noopNotifier, archivedThread.id);
    markThreadDeleted(db, noopNotifier, { threadId: deletedThread.id });

    expect(
      countLiveThreadsInEnvironment(db, { environmentId: environment.id }),
    ).toBe(1);
    expect(
      countLiveThreadsInEnvironment(db, {
        environmentId: environment.id,
        excludeThreadId: liveThread.id,
      }),
    ).toBe(0);
  });

  it("lists canonical thread environments for a host", () => {
    const { db, project, host } = setup();
    const otherHost = upsertHost(db, noopNotifier, {
      name: "other-host",
      type: "persistent",
    });
    const environment = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/thread-host-match",
      workspaceProvisionType: "unmanaged",
      status: "ready",
    });
    const otherEnvironment = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: otherHost.id,
      path: "/tmp/thread-host-other",
      workspaceProvisionType: "unmanaged",
      status: "ready",
    });
    const matchingThread = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: environment.id,
      providerId: "codex",
    });
    const otherThread = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: otherEnvironment.id,
      providerId: "codex",
    });

    expect(
      listThreadEnvironmentAssignmentsOnHost(db, {
        hostId: host.id,
        threadIds: [matchingThread.id, otherThread.id],
      }),
    ).toEqual([
      {
        threadId: matchingThread.id,
        environmentId: environment.id,
      },
    ]);
  });

  it("lists host thread ids and detects pending shutdowns by environment", () => {
    const { db, project, host } = setup();
    const otherHost = upsertHost(db, noopNotifier, {
      name: "other-host",
      type: "persistent",
    });
    const environment = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/thread-host-match",
      workspaceProvisionType: "unmanaged",
      status: "ready",
    });
    const otherEnvironment = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: otherHost.id,
      path: "/tmp/thread-host-other",
      workspaceProvisionType: "unmanaged",
      status: "ready",
    });
    const activeThread = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: environment.id,
      providerId: "codex",
    });
    const stoppingThread = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: environment.id,
      providerId: "codex",
    });
    createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: otherEnvironment.id,
      providerId: "codex",
    });
    markThreadStopRequested(db, noopNotifier, {
      threadId: stoppingThread.id,
      requestedAt: 123,
    });

    expect(listHostThreadIds(db, { hostId: host.id })).toEqual([
      activeThread.id,
      stoppingThread.id,
    ]);
    expect(
      hasPendingThreadShutdownInEnvironment(db, {
        environmentId: environment.id,
      }),
    ).toBe(true);
    expect(
      hasPendingThreadShutdownInEnvironment(db, {
        environmentId: otherEnvironment.id,
      }),
    ).toBe(false);
  });

  it("tracks storage targets only for live threads on non-destroyed environments", () => {
    const { db, project, host } = setup();
    const environment = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/thread-storage-targets",
      workspaceProvisionType: "unmanaged",
      status: "ready",
    });
    const destroyedEnvironment = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/destroyed-thread-storage-targets",
      workspaceProvisionType: "managed-worktree",
      status: "destroyed",
    });
    const activeThread = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: environment.id,
      providerId: "codex",
    });
    const destroyedEnvironmentThread = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: destroyedEnvironment.id,
      providerId: "codex",
    });
    const archivedThread = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: environment.id,
      providerId: "codex",
    });
    const deletedThread = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: environment.id,
      providerId: "codex",
    });
    archiveThread(db, noopNotifier, archivedThread.id);
    markThreadDeleted(db, noopNotifier, { threadId: deletedThread.id });

    expect(
      listTrackedThreadStorageTargetsOnHost(db, { hostId: host.id }),
    ).toEqual([{ threadId: activeThread.id, environmentId: environment.id }]);
    expect(
      [...listHostThreadIds(db, { hostId: host.id })].sort(),
    ).toEqual(
      [
        activeThread.id,
        archivedThread.id,
        deletedThread.id,
        destroyedEnvironmentThread.id,
      ].sort(),
    );
  });
});

describe("transitionThreadStatus", () => {
  it("allows valid transitions", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "created",
    });

    // created → idle
    const t1 = transitionThreadStatus(db, noopNotifier, thread.id, "idle");
    expect(t1.status).toBe("idle");

    // idle → provisioning
    const t2 = transitionThreadStatus(
      db,
      noopNotifier,
      thread.id,
      "provisioning",
    );
    expect(t2.status).toBe("provisioning");

    // provisioning → idle
    const t3 = transitionThreadStatus(db, noopNotifier, thread.id, "idle");
    expect(t3.status).toBe("idle");

    // idle → active
    const t4 = transitionThreadStatus(db, noopNotifier, thread.id, "active");
    expect(t4.status).toBe("active");

    // active → idle
    const t5 = transitionThreadStatus(db, noopNotifier, thread.id, "idle");
    expect(t5.status).toBe("idle");

    // idle → error
    const t6 = transitionThreadStatus(db, noopNotifier, thread.id, "error");
    expect(t6.status).toBe("error");

    // error → active
    const t7 = transitionThreadStatus(db, noopNotifier, thread.id, "active");
    expect(t7.status).toBe("active");
  });

  it("allows created to error when provisioning fails before activation", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "created",
    });

    const updated = transitionThreadStatus(
      db,
      noopNotifier,
      thread.id,
      "error",
    );
    expect(updated.status).toBe("error");
  });

  it("rejects invalid transitions", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "created",
    });

    // created → provisioning is allowed, so move through an invalid edge after that
    transitionThreadStatus(db, noopNotifier, thread.id, "provisioning");

    // provisioning → created is not allowed
    expect(() =>
      transitionThreadStatus(db, noopNotifier, thread.id, "created"),
    ).toThrow("Invalid thread status transition: provisioning → created");
    expect(() =>
      transitionThreadStatus(db, noopNotifier, thread.id, "created"),
    ).toThrow(InvalidThreadStatusTransitionError);

    // provisioning → active is allowed, so move to active before checking an invalid edge
    transitionThreadStatus(db, noopNotifier, thread.id, "active");

    // active → created is not allowed
    expect(() =>
      transitionThreadStatus(db, noopNotifier, thread.id, "created"),
    ).toThrow("Invalid thread status transition: active → created");
  });

  it("rejects transition for non-existent thread", () => {
    const { db } = setup();
    expect(() =>
      transitionThreadStatus(db, noopNotifier, "thr_nonexistent", "idle"),
    ).toThrow("Thread not found");
  });

  it("verifies all transitions in ALLOWED_TRANSITIONS map", () => {
    // Verify the transitions match the current state machine
    expect(ALLOWED_TRANSITIONS.created).toEqual([
      "provisioning",
      "active",
      "idle",
      "error",
    ]);
    expect(ALLOWED_TRANSITIONS.provisioning).toEqual([
      "active",
      "idle",
      "error",
    ]);
    expect(ALLOWED_TRANSITIONS.idle).toEqual([
      "provisioning",
      "active",
      "error",
    ]);
    expect(ALLOWED_TRANSITIONS.active).toEqual(["idle", "error"]);
    expect(ALLOWED_TRANSITIONS.error).toEqual([
      "provisioning",
      "active",
      "idle",
    ]);
  });

  it("allows created and provisioning to move active when startup work begins", () => {
    const { db, project } = setup();
    const createdThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "created",
    });
    const provisioningThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "provisioning",
    });

    expect(
      transitionThreadStatus(db, noopNotifier, createdThread.id, "active")
        .status,
    ).toBe("active");
    expect(
      transitionThreadStatus(db, noopNotifier, provisioningThread.id, "active")
        .status,
    ).toBe("active");
  });

  it("only attention-worthy status transitions make a read thread unread", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const { db, project } = setup();
      const activeThread = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
        status: "active",
      });
      updateThread(db, noopNotifier, activeThread.id, {
        lastReadAt: activeThread.latestAttentionAt,
      });

      vi.setSystemTime(2_000);
      const idleThread = transitionThreadStatus(
        db,
        noopNotifier,
        activeThread.id,
        "idle",
      );
      expect(idleThread.updatedAt).toBe(2_000);
      expect(idleThread.latestAttentionAt).toBe(2_000);
      expect(idleThread.lastReadAt).toBe(1_000);

      updateThread(db, noopNotifier, activeThread.id, {
        lastReadAt: idleThread.latestAttentionAt,
      });
      vi.setSystemTime(3_000);
      const activeAgainThread = transitionThreadStatus(
        db,
        noopNotifier,
        activeThread.id,
        "active",
      );
      expect(activeAgainThread.updatedAt).toBe(3_000);
      expect(activeAgainThread.latestAttentionAt).toBe(2_000);
      expect(activeAgainThread.lastReadAt).toBe(2_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not mark child thread completion as unread by itself", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const { db, project } = setup();
      const parentThread = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
      });
      const childThread = createThread(db, noopNotifier, {
        parentThreadId: parentThread.id,
        projectId: project.id,
        providerId: "codex",
        status: "active",
      });
      updateThread(db, noopNotifier, childThread.id, {
        lastReadAt: childThread.latestAttentionAt,
      });

      vi.setSystemTime(2_000);
      const idleThread = transitionThreadStatus(
        db,
        noopNotifier,
        childThread.id,
        "idle",
      );

      expect(idleThread.updatedAt).toBe(2_000);
      expect(idleThread.latestAttentionAt).toBe(1_000);
      expect(idleThread.lastReadAt).toBe(1_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves read state for non-attention error transitions", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const { db, project } = setup();
      const createdThread = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
        status: "created",
      });
      updateThread(db, noopNotifier, createdThread.id, {
        lastReadAt: createdThread.latestAttentionAt,
      });

      vi.setSystemTime(2_000);
      const erroredThread = transitionThreadStatus(
        db,
        noopNotifier,
        createdThread.id,
        "error",
      );
      expect(erroredThread.updatedAt).toBe(2_000);
      expect(erroredThread.latestAttentionAt).toBe(1_000);
      expect(erroredThread.lastReadAt).toBe(1_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("notifies on status change", () => {
    const { db, project } = setup();
    const spy: DbNotifier = {
      notifyThread: vi.fn(),
      notifyEnvironment: vi.fn(),
      notifyHost: vi.fn(),
      notifyProject: vi.fn(),
      notifySystem: vi.fn(),
    };
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "created",
    });

    transitionThreadStatus(db, spy, thread.id, "idle");
    expect(spy.notifyThread).toHaveBeenCalledWith(
      thread.id,
      ["status-changed"],
      { projectId: project.id },
    );
  });
});
