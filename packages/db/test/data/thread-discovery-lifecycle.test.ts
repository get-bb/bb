import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { threadScope, type ThreadLifecycle } from "@bb/domain";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import { threads } from "../../src/schema.js";
import { insertEvents, listEvents } from "../../src/data/events.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import {
  claimQueuedThreadMessage,
  createQueuedThreadMessage,
  deleteQueuedThreadMessage,
  getQueuedThreadMessage,
  listQueuedThreadMessageCountsByThreadIds,
  setQueuedThreadMessageFailureReason,
} from "../../src/data/queued-thread-messages.js";
import {
  archiveThread,
  createThread,
  getThread,
  listThreadsWithPendingInteractionState,
  searchThreadsWithPendingInteractionState,
  unarchiveThread,
} from "../../src/data/threads.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, { name: "lifecycle-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "lifecycle-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/lifecycle" },
  });
  function thread(status: "pending" | "idle" = "pending") {
    return createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status,
      title: "discovery lifecycle",
    });
  }
  function draft(threadId: string, pluginId = "drafts") {
    return createQueuedThreadMessage(db, noopNotifier, {
      threadId,
      content: [{ type: "text", text: "saved message", mentions: [] }],
      model: "gpt-5",
      reasoningLevel: "medium",
      permissionMode: "full",
      serviceTier: "default",
      waitingOn: { kind: "plugin", pluginId, reason: "Draft" },
      sendAt: null,
      payload: { kind: "inline" },
      systemNotice: null,
    });
  }
  function list(lifecycles: readonly ThreadLifecycle[]) {
    return listThreadsWithPendingInteractionState(db, { lifecycles }).map((row) => row.id);
  }
  return { db, host, project, thread, draft, list };
}

describe("derived thread lifecycle discovery", () => {
  it("recognizes live Drafts waits, preserves archive precedence and counts in one grouped pass", () => {
    const { db, thread, draft, list } = setup();
    try {
      const saved = thread();
      const savedRow = draft(saved.id);
      const followup = thread("idle");
      draft(followup.id);
      const other = thread();
      draft(other.id, "scheduler");
      const claimed = thread();
      const claimedRow = draft(claimed.id);
      claimQueuedThreadMessage(db, noopNotifier, claimedRow.id);
      setQueuedThreadMessageFailureReason(db, noopNotifier, {
        threadId: saved.id,
        id: savedRow.id,
        failureReason: "Host unavailable",
      });
      const prepare = vi.spyOn(db.$client, "prepare");
      try {
        expect(listQueuedThreadMessageCountsByThreadIds(db, {
          threadIds: [saved.id, followup.id, other.id, claimed.id],
        })).toEqual(expect.arrayContaining([
          { threadId: saved.id, queuedMessageCount: 1, failedQueuedMessageCount: 1, draftQueuedMessageCount: 1 },
          { threadId: followup.id, queuedMessageCount: 1, failedQueuedMessageCount: 0, draftQueuedMessageCount: 1 },
          { threadId: other.id, queuedMessageCount: 1, failedQueuedMessageCount: 0, draftQueuedMessageCount: 0 },
        ]));
        expect(prepare).toHaveBeenCalledTimes(1);
      } finally {
        prepare.mockRestore();
      }
      expect(list(["draft"])).toEqual([saved.id]);
      expect(new Set(list(["active"]))).toEqual(new Set([followup.id, other.id, claimed.id]));
      archiveThread(db, noopNotifier, saved.id);
      expect(list(["draft"])).toEqual([]);
      expect(list(["archived"])).toEqual([saved.id]);
      unarchiveThread(db, noopNotifier, saved.id);
      expect(list(["draft"])).toEqual([saved.id]);
      expect(getQueuedThreadMessage(db, savedRow.id)?.waitingOn).toContain('"drafts"');
    } finally {
      db.$client.close();
    }
  });

  it("filters before list offsets and search limits while legacy search keeps drafts active", () => {
    const { db, thread, draft } = setup();
    try {
      const first = thread();
      const second = thread();
      draft(first.id);
      draft(second.id);
      db.update(threads).set({ createdAt: 1, updatedAt: 1 }).where(eq(threads.id, first.id)).run();
      db.update(threads).set({ createdAt: 2, updatedAt: 2 }).where(eq(threads.id, second.id)).run();
      for (let index = 0; index < 24; index += 1) thread("idle");
      const archived = thread();
      draft(archived.id);
      archiveThread(db, noopNotifier, archived.id);
      const hidden = thread();
      draft(hidden.id);
      db.update(threads).set({ visibility: "hidden" }).where(eq(threads.id, hidden.id)).run();
      const deleted = thread();
      draft(deleted.id);
      db.update(threads).set({ deletedAt: Date.now() }).where(eq(threads.id, deleted.id)).run();

      expect(listThreadsWithPendingInteractionState(db, {
        lifecycles: ["draft"], limit: 1, offset: 1,
      }).map((row) => row.id)).toEqual([first.id]);
      expect(listThreadsWithPendingInteractionState(db, {
        lifecycles: ["draft"], archived: true,
      })).toEqual([]);
      const legacy = searchThreadsWithPendingInteractionState(db, {
        query: "discovery", limitPerGroup: 50,
      });
      expect(Object.keys(legacy)).toEqual(["active", "archived"]);
      expect(legacy.active.total).toBe(26);
      expect(legacy.active.results.map((result) => result.thread.id)).toContain(first.id);
      const filtered = searchThreadsWithPendingInteractionState(db, {
        query: "discovery", limitPerGroup: 1, lifecycles: ["draft"],
      });
      expect(filtered.active).toEqual({ total: 0, results: [] });
      expect(filtered.archived).toEqual({ total: 0, results: [] });
      expect(filtered.draft?.total).toBe(2);
      expect(filtered.draft?.results.map((result) => result.thread.id)).toEqual([second.id]);
      const all = searchThreadsWithPendingInteractionState(db, {
        query: "discovery", limitPerGroup: 50, lifecycles: ["active", "draft", "archived"],
      });
      expect([all.active.total, all.draft?.total, all.archived.total]).toEqual([24, 2, 1]);
      expect(all.archived.results.map((result) => result.thread.id)).toEqual([archived.id]);
    } finally {
      db.$client.close();
    }
  });

  it("bounds lifecycle lists by global recency without changing legacy project or archive ordering", () => {
    const { db, host, project, draft } = setup();
    try {
      const { project: otherProject } = createProject(db, noopNotifier, {
        name: "other-lifecycle-project",
        source: { type: "local_path", hostId: host.id, path: "/tmp/other-lifecycle" },
      });
      const older = createThread(db, noopNotifier, {
        projectId: project.id < otherProject.id ? project.id : otherProject.id,
        providerId: "codex",
        status: "pending",
      });
      const recent = createThread(db, noopNotifier, {
        projectId: project.id < otherProject.id ? otherProject.id : project.id,
        providerId: "codex",
        status: "pending",
      });
      draft(older.id);
      draft(recent.id);
      db.update(threads).set({ createdAt: 20, updatedAt: 30, pinnedAt: 10 }).where(eq(threads.id, older.id)).run();
      db.update(threads).set({ createdAt: 10, updatedAt: 40 }).where(eq(threads.id, recent.id)).run();

      expect(listThreadsWithPendingInteractionState(db, {
        lifecycles: ["draft"], limit: 1,
      }).map((row) => row.id)).toEqual([recent.id]);
      expect(listThreadsWithPendingInteractionState(db, {
        lifecycles: ["draft"], limit: 1, offset: 1,
      }).map((row) => row.id)).toEqual([older.id]);
      expect(listThreadsWithPendingInteractionState(db, {
        archived: false, limit: 1,
      }).map((row) => row.id)).toEqual([older.id]);

      db.update(threads).set({ archivedAt: 60 }).where(eq(threads.id, older.id)).run();
      db.update(threads).set({ archivedAt: 50 }).where(eq(threads.id, recent.id)).run();
      expect(listThreadsWithPendingInteractionState(db, {
        lifecycles: ["archived"], archived: true, limit: 1,
      }).map((row) => row.id)).toEqual([recent.id]);
      expect(listThreadsWithPendingInteractionState(db, {
        archived: true, limit: 1,
      }).map((row) => row.id)).toEqual([older.id]);
    } finally {
      db.$client.close();
    }
  });

  it("deletes only the held row and preserves its owning fork and inherited history", () => {
    const { db, project, thread, draft, list } = setup();
    try {
      const source = thread("idle");
      const fork = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
        status: "pending",
        sourceThreadId: source.id,
        originKind: "fork",
      });
      insertEvents(db, noopNotifier, [{
        threadId: fork.id,
        sequence: 1,
        type: "item/completed",
        scope: threadScope(),
        itemId: "inherited-message",
        itemKind: "agentMessage",
        parentToolCallId: null,
        data: JSON.stringify({ item: { id: "inherited-message", type: "agentMessage", text: "Inherited response" } }),
      }]);
      const saved = draft(fork.id);
      const before = listEvents(db, { threadId: fork.id });
      expect(list(["draft"])).toEqual([fork.id]);
      expect(deleteQueuedThreadMessage(db, noopNotifier, saved.id)).toBe(true);
      expect(getThread(db, fork.id)).toMatchObject({ sourceThreadId: source.id, deletedAt: null, status: "pending" });
      expect(listEvents(db, { threadId: fork.id })).toEqual(before);
      expect(list(["draft"])).toEqual([]);
      expect(list(["active"])).toContain(fork.id);
    } finally {
      db.$client.close();
    }
  });
});
