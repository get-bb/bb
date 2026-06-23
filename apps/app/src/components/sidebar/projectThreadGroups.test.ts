import type { ThreadListEntry } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  buildChronologicalThreadList,
  buildProjectThreadGroups,
  compareByCreatedAtDescending,
  type ProjectThreadItem,
  type ProjectThreadNode,
} from "./projectThreadGroups";

type ThreadListEntryOverrides = Partial<ThreadListEntry>;
type TreeSummary =
  | string
  | { id: string; children: TreeSummary[] }
  | { env: string; threads: TreeSummary[] };

function createThread(
  overrides: ThreadListEntryOverrides = {},
): ThreadListEntry {
  return {
    id: "thr_1",
    projectId: "proj_1",
    environmentId: null,
    providerId: "codex",
    title: "Thread",
    titleFallback: "Thread",
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    childOrigin: null,
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: 0,
    latestAttentionAt: 2,
    createdAt: 1,
    updatedAt: 2,
    activity: { activeWorkflowCount: 0 },
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  };
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
  return items.map((item) =>
    item.kind === "thread"
      ? summarizeNode(item.node)
      : {
          env: item.group.environmentId,
          threads: item.group.nodes.map(summarizeNode),
        },
  );
}

function findNode(
  items: readonly ProjectThreadItem[],
  threadId: string,
): ProjectThreadNode | null {
  for (const item of items) {
    const nodes = item.kind === "thread" ? [item.node] : item.group.nodes;
    for (const node of nodes) {
      if (node.thread.id === threadId) {
        return node;
      }
      const childNode = findNode(node.children, threadId);
      if (childNode) {
        return childNode;
      }
    }
  }

  return null;
}

describe("buildProjectThreadGroups", () => {
  it("nests threads recursively from parentThreadId regardless of thread type", () => {
    const rootItems = buildProjectThreadGroups([
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
    const rootItems = buildProjectThreadGroups([
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
        originKind: "side-chat",
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
    const rootItems = buildProjectThreadGroups([
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
    const rootItems = buildProjectThreadGroups([
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

  it("groups shared worktree environments at nested sibling levels", () => {
    const rootItems = buildProjectThreadGroups([
      createThread({
        id: "parent",
        createdAt: 100,
      }),
      createThread({
        id: "worktree-a",
        parentThreadId: "parent",
        environmentId: "env_shared",
        environmentWorkspaceDisplayKind: "managed-worktree",
        createdAt: 10,
        latestAttentionAt: 100,
      }),
      createThread({
        id: "worktree-b",
        parentThreadId: "parent",
        environmentId: "env_shared",
        environmentWorkspaceDisplayKind: "managed-worktree",
        createdAt: 20,
        latestAttentionAt: 200,
      }),
      createThread({
        id: "loose-child",
        parentThreadId: "parent",
        createdAt: 5,
        latestAttentionAt: 50,
      }),
    ]);

    expect(summarizeItems(rootItems)).toEqual([
      {
        id: "parent",
        children: [
          { env: "env_shared", threads: ["worktree-b", "worktree-a"] },
          "loose-child",
        ],
      },
    ]);
  });

  it("sorts siblings with active rows first, then inactive attention recency", () => {
    const rootItems = buildProjectThreadGroups([
      createThread({
        id: "root",
      }),
      createThread({
        id: "active-older-created",
        parentThreadId: "root",
        status: "active",
        createdAt: 10,
        latestAttentionAt: 2_000,
        runtime: {
          displayStatus: "active",
          hostReconnectGraceExpiresAt: null,
        },
      }),
      createThread({
        id: "active-newer-created",
        parentThreadId: "root",
        status: "active",
        createdAt: 20,
        latestAttentionAt: 1_500,
        runtime: {
          displayStatus: "active",
          hostReconnectGraceExpiresAt: null,
        },
      }),
      createThread({
        id: "idle-newer-attention",
        parentThreadId: "root",
        createdAt: 40,
        latestAttentionAt: 900,
      }),
      createThread({
        id: "idle-older-attention",
        parentThreadId: "root",
        createdAt: 30,
        latestAttentionAt: 750,
      }),
    ]);

    expect(summarizeItems(rootItems)).toEqual([
      {
        id: "root",
        children: [
          "active-newer-created",
          "active-older-created",
          "idle-newer-attention",
          "idle-older-attention",
        ],
      },
    ]);
  });

  it("rolls collapsed child activity up from all descendants", () => {
    const rootItems = buildProjectThreadGroups([
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
          hostReconnectGraceExpiresAt: null,
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
        runtimeWorking: true,
        workflow: false,
        unread: false,
        unreadError: false,
      },
      childCount: 3,
    });
    expect(findNode(rootItems, "quiet-child")?.stats).toEqual({
      childActivity: {
        pending: true,
        working: true,
        runtimeWorking: true,
        workflow: false,
        unread: false,
        unreadError: false,
      },
      childCount: 2,
    });
  });

  it("orders roots by literal createdAt when given the created comparator", () => {
    const threads = [
      createThread({
        id: "active-old",
        status: "active",
        createdAt: 10,
        latestAttentionAt: 5,
        runtime: {
          displayStatus: "active",
          hostReconnectGraceExpiresAt: null,
        },
      }),
      createThread({
        id: "idle-new",
        status: "idle",
        createdAt: 50,
        latestAttentionAt: 5,
      }),
    ];

    // Default heuristic pins active rows ahead of idle ones.
    expect(summarizeItems(buildProjectThreadGroups(threads))).toEqual([
      "active-old",
      "idle-new",
    ]);

    // The created comparator ignores status and sorts purely by createdAt desc.
    expect(
      summarizeItems(
        buildProjectThreadGroups(threads, compareByCreatedAtDescending),
      ),
    ).toEqual(["idle-new", "active-old"]);
  });

  describe("buildChronologicalThreadList", () => {
    it("nests parent/child threads under globally sorted roots", () => {
      const items = buildChronologicalThreadList(
        [
          createThread({ id: "parent", createdAt: 10, latestAttentionAt: 10 }),
          createThread({
            id: "child",
            parentThreadId: "parent",
            createdAt: 30,
            latestAttentionAt: 30,
          }),
          createThread({ id: "other", createdAt: 20, latestAttentionAt: 20 }),
        ],
        compareByCreatedAtDescending,
      );

      expect(summarizeItems(items)).toEqual([
        "other",
        { id: "parent", children: ["child"] },
      ]);
    });

    it("keeps worktree siblings as thread rows", () => {
      const items = buildChronologicalThreadList(
        [
          createThread({ id: "parent", createdAt: 100 }),
          createThread({
            id: "worktree-a",
            parentThreadId: "parent",
            environmentId: "env_shared",
            environmentWorkspaceDisplayKind: "managed-worktree",
            createdAt: 10,
            latestAttentionAt: 100,
          }),
          createThread({
            id: "worktree-b",
            parentThreadId: "parent",
            environmentId: "env_shared",
            environmentWorkspaceDisplayKind: "managed-worktree",
            createdAt: 20,
            latestAttentionAt: 200,
          }),
        ],
        compareByCreatedAtDescending,
      );

      expect(summarizeItems(items)).toEqual([
        {
          id: "parent",
          children: ["worktree-b", "worktree-a"],
        },
      ]);
    });

    it("excludes side chats", () => {
      const items = buildChronologicalThreadList([
        createThread({ id: "root", createdAt: 10 }),
        createThread({
          id: "side",
          parentThreadId: "root",
          originKind: "side-chat",
          createdAt: 20,
        }),
      ]);

      expect(summarizeItems(items)).toEqual(["root"]);
    });
  });

  it("sorts top-level manager roots with the regular root ordering", () => {
    const rootItems = buildProjectThreadGroups([
      createThread({
        id: "root-thread",
        createdAt: 100,
        latestAttentionAt: 100,
      }),
      createThread({
        id: "manager-old",
        createdAt: 10,
        latestAttentionAt: 10,
      }),
      createThread({
        id: "manager-new",
        createdAt: 20,
        latestAttentionAt: 20,
      }),
    ]);

    expect(summarizeItems(rootItems)).toEqual([
      "root-thread",
      "manager-new",
      "manager-old",
    ]);
  });
});
