import type { ThreadListEntry } from "@bb/domain";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import {
  buildChronologicalThreadList,
  resolveSidebarProjectId,
  type ProjectThreadItem,
  type ProjectThreadNode,
  type ThreadComparator,
} from "../src/sidebar/projectThreadGroups.js";

type ThreadListEntryOverrides = Partial<ThreadListEntry>;
type TreeSummary = string | { id: string; children: TreeSummary[] };

const compareByAttentionDescending: ThreadComparator = (left, right) =>
  right.latestAttentionAt - left.latestAttentionAt;

function buildList(threads: readonly ThreadListEntry[]): ProjectThreadItem[] {
  return buildChronologicalThreadList(threads, compareByAttentionDescending);
}

function createThread(
  overrides: ThreadListEntryOverrides = {},
): ThreadListEntry {
  return makeThreadListEntry({
    id: "thr_1",
    projectId: "proj_1",
    title: "Thread",
    titleFallback: "Thread",
    lastReadAt: 0,
    latestAttentionAt: 2,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  });
}

function summarizeNode(node: ProjectThreadNode): TreeSummary {
  if (node.children.length === 0) {
    return node.thread.id;
  }

  return {
    id: node.thread.id,
    children: summarizeItems(node.children),
  };
}

function summarizeItems(items: readonly ProjectThreadItem[]): TreeSummary[] {
  return items.map((item) => summarizeNode(item.node));
}

function findNode(
  items: readonly ProjectThreadItem[],
  threadId: string,
): ProjectThreadNode | null {
  for (const { node } of items) {
    if (node.thread.id === threadId) {
      return node;
    }
    const childNode = findNode(node.children, threadId);
    if (childNode) {
      return childNode;
    }
  }

  return null;
}

describe("buildChronologicalThreadList", () => {
  it("nests threads recursively from parentThreadId regardless of thread type", () => {
    const rootItems = buildList([
      createThread({
        id: "manager-root",
        createdAt: 10,
      }),
      createThread({
        id: "standard-child",
        parentThreadId: "manager-root",
        createdAt: 20,
      }),
      createThread({
        id: "standard-grandchild",
        parentThreadId: "standard-child",
        createdAt: 30,
      }),
      createThread({
        id: "manager-grandchild",
        parentThreadId: "standard-grandchild",
        createdAt: 40,
      }),
    ]);

    expect(summarizeItems(rootItems)).toEqual([
      {
        id: "manager-root",
        children: [
          {
            id: "standard-child",
            children: [
              {
                id: "standard-grandchild",
                children: ["manager-grandchild"],
              },
            ],
          },
        ],
      },
    ]);
    expect(findNode(rootItems, "manager-grandchild")?.depth).toBe(3);
  });

  it("renders forks as roots and excludes side chats", () => {
    const rootItems = buildList([
      createThread({
        id: "thr_parent",
        createdAt: 10,
        latestAttentionAt: 30,
      }),
      createThread({
        id: "thr_fork",
        sourceThreadId: "thr_parent",
        originKind: "fork",
        createdAt: 20,
        latestAttentionAt: 20,
      }),
      createThread({
        id: "thr_sidechat",
        sourceThreadId: "thr_parent",
        visibility: "hidden",
        createdAt: 30,
        latestAttentionAt: 40,
      }),
    ]);

    expect(summarizeItems(rootItems)).toEqual(["thr_parent", "thr_fork"]);
    expect(findNode(rootItems, "thr_parent")?.children).toEqual([]);
    expect(findNode(rootItems, "thr_fork")?.depth).toBe(0);
    expect(findNode(rootItems, "thr_sidechat")).toBeNull();
  });

  it("keeps orphaned children as project roots", () => {
    const rootItems = buildList([
      createThread({
        id: "orphan-child",
        parentThreadId: "missing-parent",
        createdAt: 20,
        latestAttentionAt: 20,
      }),
      createThread({
        id: "root-thread",
        createdAt: 10,
        latestAttentionAt: 10,
      }),
    ]);

    expect(summarizeItems(rootItems)).toEqual(["orphan-child", "root-thread"]);
  });

  it("cuts cycles without duplicating or dropping every cycle member", () => {
    const rootItems = buildList([
      createThread({
        id: "cycle-a",
        parentThreadId: "cycle-b",
        createdAt: 10,
      }),
      createThread({
        id: "cycle-b",
        parentThreadId: "cycle-a",
        createdAt: 20,
      }),
    ]);

    expect(summarizeItems(rootItems)).toEqual([
      {
        id: "cycle-a",
        children: ["cycle-b"],
      },
    ]);
  });

  it("rolls collapsed child activity up from all descendants", () => {
    const rootItems = buildList([
      createThread({
        id: "parent",
      }),
      createThread({
        id: "quiet-child",
        parentThreadId: "parent",
      }),
      createThread({
        id: "busy-grandchild",
        parentThreadId: "quiet-child",
        status: "active",
        runtime: {
          displayStatus: "active",
        },
      }),
      createThread({
        id: "pending-grandchild",
        parentThreadId: "quiet-child",
        hasPendingInteraction: true,
      }),
    ]);

    expect(findNode(rootItems, "parent")?.stats).toEqual({
      childActivity: {
        pending: true,
        working: true,
        hasUnsubmittedDraft: false,
        runtimeWorking: true,
        workflow: false,
        backgroundAgent: false,
        backgroundCommand: false,
        planMode: false,
        goal: false,
        unread: false,
        unreadError: false,
      },
      childCount: 3,
    });
    expect(findNode(rootItems, "quiet-child")?.stats).toEqual({
      childActivity: {
        pending: true,
        working: true,
        hasUnsubmittedDraft: false,
        runtimeWorking: true,
        workflow: false,
        backgroundAgent: false,
        backgroundCommand: false,
        planMode: false,
        goal: false,
        unread: false,
        unreadError: false,
      },
      childCount: 2,
    });
  });

  it("nests parent/child threads under globally sorted roots", () => {
    const items = buildList([
      createThread({ id: "parent", createdAt: 10, latestAttentionAt: 10 }),
      createThread({
        id: "child",
        parentThreadId: "parent",
        createdAt: 30,
        latestAttentionAt: 30,
      }),
      createThread({ id: "other", createdAt: 20, latestAttentionAt: 20 }),
    ]);

    expect(summarizeItems(items)).toEqual([
      "other",
      { id: "parent", children: ["child"] },
    ]);
  });

  it("keeps worktree siblings as thread rows", () => {
    const items = buildList([
      createThread({ id: "parent", createdAt: 100 }),
      createThread({
        id: "worktree-a",
        parentThreadId: "parent",
        environmentId: "env_shared",
        queuedWork: "none",
        createdAt: 10,
        latestAttentionAt: 100,
      }),
      createThread({
        id: "worktree-b",
        parentThreadId: "parent",
        environmentId: "env_shared",
        queuedWork: "none",
        createdAt: 20,
        latestAttentionAt: 200,
      }),
    ]);

    expect(summarizeItems(items)).toEqual([
      {
        id: "parent",
        children: ["worktree-b", "worktree-a"],
      },
    ]);
  });

  it("excludes side chats", () => {
    const items = buildList([
      createThread({ id: "root", createdAt: 10 }),
      createThread({
        id: "side",
        parentThreadId: "root",
        visibility: "hidden",
        createdAt: 20,
      }),
    ]);

    expect(summarizeItems(items)).toEqual(["root"]);
  });
});

describe("resolveSidebarProjectId", () => {
  it("files a child from another project under its root ancestor's project", () => {
    const root = createThread({ id: "thr_root", projectId: "proj_a" });
    const child = createThread({
      id: "thr_child",
      parentThreadId: "thr_root",
      projectId: "proj_b",
    });
    const grandchild = createThread({
      id: "thr_grandchild",
      parentThreadId: "thr_child",
      projectId: "proj_c",
    });
    const threadById = new Map(
      [root, child, grandchild].map((thread) => [thread.id, thread]),
    );

    expect(resolveSidebarProjectId(root, threadById)).toBe("proj_a");
    expect(resolveSidebarProjectId(child, threadById)).toBe("proj_a");
    expect(resolveSidebarProjectId(grandchild, threadById)).toBe("proj_a");
  });

  it("falls back to the thread's own project when the parent is not listed", () => {
    const orphan = createThread({
      id: "thr_orphan",
      parentThreadId: "thr_missing",
      projectId: "proj_b",
    });
    expect(
      resolveSidebarProjectId(orphan, new Map([[orphan.id, orphan]])),
    ).toBe("proj_b");
  });

  it("stops at a cycle instead of looping", () => {
    const left = createThread({
      id: "thr_left",
      parentThreadId: "thr_right",
      projectId: "proj_a",
    });
    const right = createThread({
      id: "thr_right",
      parentThreadId: "thr_left",
      projectId: "proj_b",
    });
    const threadById = new Map([
      [left.id, left],
      [right.id, right],
    ]);
    expect(resolveSidebarProjectId(left, threadById)).toBe("proj_b");
  });
});
