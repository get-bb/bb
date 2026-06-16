import type { ThreadListEntry } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  buildProjectThreadGroups,
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
    automationId: null,
    providerId: "codex",
    title: "Thread",
    titleFallback: "Thread",
    status: "idle",
    parentThreadId: null,
    childOrigin: null,
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    stopRequestedAt: null,
    deletedAt: null,
    lastReadAt: 0,
    latestAttentionAt: 2,
    createdAt: 1,
    updatedAt: 2,
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
        childOrigin: null,
        createdAt: 20,
      }),
      createThread({
        id: "standard-grandchild",
        parentThreadId: "standard-child",
        childOrigin: null,
        createdAt: 30,
      }),
      createThread({
        id: "manager-grandchild",
        parentThreadId: "standard-grandchild",
        childOrigin: null,
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

  it("excludes side-chat children from the tree but keeps forks nested", () => {
    const items = buildProjectThreadGroups([
      createThread({ id: "thr_parent", createdAt: 10 }),
      createThread({
        id: "thr_fork",
        parentThreadId: "thr_parent",
        childOrigin: "fork",
        createdAt: 20,
      }),
      createThread({
        id: "thr_sidechat",
        parentThreadId: "thr_parent",
        childOrigin: "side-chat",
        createdAt: 30,
      }),
    ]);

    // The fork nests under its parent; the side chat (panel-only) never appears
    // in the sidebar tree.
    expect(summarizeItems(items)).toEqual([
      { id: "thr_parent", children: ["thr_fork"] },
    ]);
    expect(findNode(items, "thr_sidechat")).toBeNull();
  });

  it("keeps orphaned children as project roots", () => {
    const rootItems = buildProjectThreadGroups([
      createThread({
        id: "orphan-child",
        parentThreadId: "missing-parent",
        childOrigin: null,
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
        childOrigin: null,
        createdAt: 10,
      }),
      createThread({
        id: "cycle-b",
        parentThreadId: "cycle-a",
        childOrigin: null,
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
        childOrigin: null,
        environmentId: "env_shared",
        environmentWorkspaceDisplayKind: "managed-worktree",
        createdAt: 10,
        latestAttentionAt: 100,
      }),
      createThread({
        id: "worktree-b",
        parentThreadId: "parent",
        childOrigin: null,
        environmentId: "env_shared",
        environmentWorkspaceDisplayKind: "managed-worktree",
        createdAt: 20,
        latestAttentionAt: 200,
      }),
      createThread({
        id: "loose-child",
        parentThreadId: "parent",
        childOrigin: null,
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

  it("groups a solo worktree thread into a single-child environment group", () => {
    const rootItems = buildProjectThreadGroups([
      createThread({
        id: "worktree-solo",
        environmentId: "env_solo",
        environmentWorkspaceDisplayKind: "managed-worktree",
        createdAt: 10,
      }),
      createThread({
        id: "plain-root",
        createdAt: 20,
      }),
    ]);

    expect(summarizeItems(rootItems)).toEqual([
      "plain-root",
      { env: "env_solo", threads: ["worktree-solo"] },
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
        childOrigin: null,
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
        childOrigin: null,
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
        childOrigin: null,
        createdAt: 40,
        latestAttentionAt: 900,
      }),
      createThread({
        id: "idle-older-attention",
        parentThreadId: "root",
        childOrigin: null,
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
        childOrigin: null,
      }),
      createThread({
        id: "busy-grandchild",
        parentThreadId: "quiet-child",
        childOrigin: null,
        status: "active",
        runtime: {
          displayStatus: "active",
          hostReconnectGraceExpiresAt: null,
        },
      }),
      createThread({
        id: "pending-grandchild",
        parentThreadId: "quiet-child",
        childOrigin: null,
        hasPendingInteraction: true,
      }),
    ]);

    expect(findNode(rootItems, "parent")?.stats).toEqual({
      childActivity: {
        pending: true,
        working: true,
        unread: false,
        unreadError: false,
      },
      childCount: 3,
    });
    expect(findNode(rootItems, "quiet-child")?.stats).toEqual({
      childActivity: {
        pending: true,
        working: true,
        unread: false,
        unreadError: false,
      },
      childCount: 2,
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
