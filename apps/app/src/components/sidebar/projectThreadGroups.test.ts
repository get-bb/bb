import type { ThreadListEntry } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  bucketIntoFolders,
  buildChronologicalThreadList,
  buildProjectThreadGroups,
  compareByCreatedAtDescending,
  compareStandardThreads,
  pruneManualOrderForChildren,
  type ProjectThreadItem,
  type ProjectThreadNode,
  type ThreadComparator,
} from "./projectThreadGroups";

type ThreadListEntryOverrides = Partial<ThreadListEntry>;
type TreeSummary =
  | string
  | { id: string; children: TreeSummary[] }
  | { env: string; threads: TreeSummary[] }
  | { folder: string; name: string; items: TreeSummary[] };

function getItemAlphaLabel(item: ProjectThreadItem): string {
  switch (item.kind) {
    case "folder":
      return item.group.name;
    case "thread":
      return item.node.thread.title ?? item.node.thread.titleFallback ?? "";
    case "environment":
      return (
        item.group.nodes[0]?.thread.title ??
        item.group.nodes[0]?.thread.titleFallback ??
        ""
      );
  }
}

const compareAlphaDescending = ((left, right) =>
  (right.title ?? right.titleFallback ?? "").localeCompare(
    left.title ?? left.titleFallback ?? "",
  )) as ThreadComparator;
compareAlphaDescending.compareItems = (left, right) =>
  getItemAlphaLabel(right).localeCompare(getItemAlphaLabel(left));

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
    folderId: null,
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
  return items.map((item) => {
    switch (item.kind) {
      case "thread":
        return summarizeNode(item.node);
      case "environment":
        return {
          env: item.group.environmentId,
          threads: item.group.nodes.map(summarizeNode),
        };
      case "folder":
        return {
          folder: item.group.key,
          name: item.group.name,
          items: summarizeItems(item.group.items),
        };
    }
  });
}

function findNode(
  items: readonly ProjectThreadItem[],
  threadId: string,
): ProjectThreadNode | null {
  for (const item of items) {
    if (item.kind === "folder") {
      const folderNode = findNode(item.group.items, threadId);
      if (folderNode) {
        return folderNode;
      }
      continue;
    }
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

describe("manual order (Sort by: None)", () => {
  it("orders a flat project section by stored manual order with new items at the top", () => {
    const items = buildProjectThreadGroups(
      [
        createThread({ id: "new", latestAttentionAt: 30 }),
        createThread({ id: "stored-b", latestAttentionAt: 20 }),
        createThread({ id: "stored-a", latestAttentionAt: 10 }),
      ],
      compareStandardThreads,
      {
        groupBy: "none",
        containerId: "proj_1",
        manualOrder: {
          proj_1: ["stored-a", "stored-b"],
        },
      },
    );

    expect(summarizeItems(items)).toEqual(["new", "stored-a", "stored-b"]);
  });

  it("lets manual folder mode order threads inside a folder", () => {
    const items = buildProjectThreadGroups(
      [
        createThread({
          id: "a",
          title: "A",
          folderId: "fld_work",
          latestAttentionAt: 30,
        }),
        createThread({
          id: "b",
          title: "B",
          folderId: "fld_work",
          latestAttentionAt: 20,
        }),
        createThread({ id: "loose", title: "Loose", latestAttentionAt: 10 }),
      ],
      compareStandardThreads,
      {
        groupBy: "folder",
        containerId: "proj_1",
        folders: [{ id: "fld_work", name: "Work" }],
        manualOrder: {
          proj_1: ["loose", "proj_1::fld_work"],
          "proj_1::fld_work": ["b", "a"],
        },
      },
    );

    expect(summarizeItems(items)).toEqual([
      { folder: "proj_1::fld_work", name: "Work", items: ["b", "a"] },
      "loose",
    ]);
  });

  it("prunes stale and duplicate stored ids on read", () => {
    expect(
      pruneManualOrderForChildren(
        ["missing", "b", "b", "a"],
        new Set(["a", "b"]),
      ),
    ).toEqual(["b", "a"]);
  });
});

const FOLDER_OPTIONS = { groupBy: "folder", containerId: "proj_1" } as const;

describe("folder bucketing", () => {
  it("buckets threads into flat folders by folder id, folders above loose threads", () => {
    const items = buildProjectThreadGroups(
      [
        createThread({ id: "a", title: "Plan", folderId: "fld_work_q3" }),
        createThread({ id: "b", title: "Notes", folderId: "fld_work_q3" }),
        createThread({ id: "c", title: "Q4", folderId: "fld_work" }),
        createThread({ id: "d", title: "Standalone" }),
      ],
      compareStandardThreads,
      {
        ...FOLDER_OPTIONS,
        folders: [
          { id: "fld_work", name: "Work" },
          { id: "fld_work_q3", name: "Work/Q3" },
        ],
      },
    );

    // Same idle/attention threads tie-break on codepoint id; flat folders render
    // as a block above the loose "Standalone" thread.
    expect(summarizeItems(items)).toEqual([
      { folder: "proj_1::fld_work", name: "Work", items: ["c"] },
      {
        folder: "proj_1::fld_work_q3",
        name: "Work/Q3",
        items: ["a", "b"],
      },
      "d",
    ]);
  });

  it("does not derive folders from slashes in titles", () => {
    const items = buildProjectThreadGroups(
      [
        createThread({ id: "a", title: "Work/Q3/Plan" }),
        createThread({ id: "b", title: "Work/Notes" }),
      ],
      compareStandardThreads,
      FOLDER_OPTIONS,
    );

    expect(summarizeItems(items)).toEqual(["a", "b"]);
  });

  it("renders explicit empty folders without a thread using that id", () => {
    const items = buildProjectThreadGroups(
      [createThread({ id: "a", title: "Standalone" })],
      compareStandardThreads,
      {
        ...FOLDER_OPTIONS,
        folders: [{ id: "fld_work_q3", name: "Work/Q3" }],
      },
    );

    expect(summarizeItems(items)).toEqual([
      {
        folder: "proj_1::fld_work_q3",
        name: "Work/Q3",
        items: [],
      },
      "a",
    ]);
  });

  it("keeps a folder thread's own children nested under it and ignores child folders", () => {
    const items = buildProjectThreadGroups(
      [
        createThread({
          id: "parent",
          title: "Project",
          folderId: "fld_work",
        }),
        createThread({
          id: "child",
          parentThreadId: "parent",
          title: "Path",
          folderId: "fld_ignored",
        }),
      ],
      compareStandardThreads,
      {
        ...FOLDER_OPTIONS,
        folders: [
          { id: "fld_work", name: "Work" },
          { id: "fld_ignored", name: "Ignored/Child" },
        ],
      },
    );

    // Only the top-level parent picks the bucket; the child stays nested under it
    // and does not create a second folder row.
    expect(summarizeItems(items)).toEqual([
      {
        folder: "proj_1::fld_work",
        name: "Work",
        items: [{ id: "parent", children: ["child"] }],
      },
      { folder: "proj_1::fld_ignored", name: "Ignored/Child", items: [] },
    ]);
  });

  it("places a worktree environment group inside a folder by its representative", () => {
    const items = buildProjectThreadGroups(
      [
        createThread({
          id: "w1",
          title: "Alpha",
          folderId: "fld_work",
          environmentId: "env_shared",
          environmentWorkspaceDisplayKind: "managed-worktree",
        }),
        createThread({
          id: "w2",
          title: "Beta",
          folderId: "fld_work",
          environmentId: "env_shared",
          environmentWorkspaceDisplayKind: "managed-worktree",
        }),
      ],
      compareStandardThreads,
      {
        ...FOLDER_OPTIONS,
        folders: [{ id: "fld_work", name: "Work" }],
      },
    );

    expect(summarizeItems(items)).toEqual([
      {
        folder: "proj_1::fld_work",
        name: "Work",
        items: [{ env: "env_shared", threads: ["w1", "w2"] }],
      },
    ]);
  });

  it("orders explicit folders by name rather than descendant recency", () => {
    const threads = [
      createThread({
        id: "old-active",
        title: "x",
        folderId: "fld_archive",
        status: "active",
        createdAt: 10,
        latestAttentionAt: 5,
        runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
      }),
      createThread({
        id: "new-idle",
        title: "y",
        folderId: "fld_work",
        status: "idle",
        createdAt: 50,
        latestAttentionAt: 5,
      }),
    ];

    const options = {
      ...FOLDER_OPTIONS,
      folders: [
        { id: "fld_archive", name: "Archive" },
        { id: "fld_empty", name: "Empty" },
        { id: "fld_work", name: "Work" },
      ],
    };

    expect(
      summarizeItems(
        buildProjectThreadGroups(threads, compareStandardThreads, options),
      ),
    ).toEqual([
      {
        folder: "proj_1::fld_archive",
        name: "Archive",
        items: ["old-active"],
      },
      { folder: "proj_1::fld_empty", name: "Empty", items: [] },
      { folder: "proj_1::fld_work", name: "Work", items: ["new-idle"] },
    ]);

    expect(
      summarizeItems(
        buildProjectThreadGroups(
          threads,
          compareByCreatedAtDescending,
          options,
        ),
      ),
    ).toEqual([
      {
        folder: "proj_1::fld_archive",
        name: "Archive",
        items: ["old-active"],
      },
      { folder: "proj_1::fld_empty", name: "Empty", items: [] },
      { folder: "proj_1::fld_work", name: "Work", items: ["new-idle"] },
    ]);
  });

  it("applies alpha descending order to folder rows", () => {
    const items = buildProjectThreadGroups([], compareAlphaDescending, {
      ...FOLDER_OPTIONS,
      folders: [
        { id: "fld_archive", name: "Archive" },
        { id: "fld_empty", name: "Empty" },
        { id: "fld_work", name: "Work" },
      ],
    });

    expect(summarizeItems(items)).toEqual([
      { folder: "proj_1::fld_work", name: "Work", items: [] },
      { folder: "proj_1::fld_empty", name: "Empty", items: [] },
      { folder: "proj_1::fld_archive", name: "Archive", items: [] },
    ]);
  });

  it("rolls descendant count + activity up onto the folder group", () => {
    const items = bucketIntoFolders(
      buildProjectThreadGroups([
        createThread({
          id: "busy",
          title: "Busy",
          folderId: "fld_work",
          hasPendingInteraction: true,
        }),
        createThread({ id: "quiet", title: "Quiet", folderId: "fld_work" }),
      ]),
      "proj_1",
      compareStandardThreads,
      undefined,
      [{ id: "fld_work", name: "Work" }],
    );

    expect(items).toHaveLength(1);
    const folder = items[0];
    if (folder.kind !== "folder") {
      throw new Error("expected a folder item");
    }
    expect(folder.group.threadCount).toBe(2);
    expect(folder.group.activity.pending).toBe(true);
  });

  it("folds the chronological list into folders too", () => {
    const items = buildChronologicalThreadList(
      [
        createThread({
          id: "a",
          title: "One",
          folderId: "fld_work",
          createdAt: 20,
        }),
        createThread({
          id: "b",
          title: "Two",
          folderId: "fld_personal",
          createdAt: 10,
        }),
      ],
      compareByCreatedAtDescending,
      {
        groupBy: "folder",
        containerId: "chronological",
        folders: [
          { id: "fld_personal", name: "Personal" },
          { id: "fld_work", name: "Work" },
        ],
      },
    );

    expect(summarizeItems(items)).toEqual([
      { folder: "chronological::fld_personal", name: "Personal", items: ["b"] },
      { folder: "chronological::fld_work", name: "Work", items: ["a"] },
    ]);
  });

  it("nests a child thread under its parent root inside a folder", () => {
    const items = buildChronologicalThreadList(
      [
        createThread({
          id: "parent",
          title: "Parent",
          folderId: "fld_work",
          createdAt: 20,
        }),
        createThread({
          id: "child",
          parentThreadId: "parent",
          title: "Child",
          createdAt: 10,
        }),
      ],
      compareByCreatedAtDescending,
      {
        groupBy: "folder",
        containerId: "chronological",
        folders: [{ id: "fld_work", name: "Work" }],
      },
    );

    // The child follows its parent into the folder as a nested row rather than
    // splitting out as a loose top-level thread.
    expect(summarizeItems(items)).toEqual([
      {
        folder: "chronological::fld_work",
        name: "Work",
        items: [{ id: "parent", children: ["child"] }],
      },
    ]);
  });

  it("combines threads from different projects that share the same folder id", () => {
    const items = buildChronologicalThreadList(
      [
        createThread({
          id: "a",
          projectId: "proj_1",
          title: "One",
          folderId: "fld_work",
          createdAt: 20,
        }),
        createThread({
          id: "b",
          projectId: "proj_2",
          title: "Two",
          folderId: "fld_work",
          createdAt: 10,
        }),
      ],
      compareByCreatedAtDescending,
      {
        groupBy: "folder",
        containerId: "chronological",
        folders: [{ id: "fld_work", name: "Work" }],
      },
    );

    expect(summarizeItems(items)).toEqual([
      { folder: "chronological::fld_work", name: "Work", items: ["a", "b"] },
    ]);
  });

  describe("regression: Group by: None is unchanged", () => {
    const slashFixture = [
      createThread({ id: "a", title: "Work/Q3/Plan", createdAt: 30 }),
      createThread({ id: "b", title: "Work/Notes", createdAt: 20 }),
      createThread({ id: "c", title: "Standalone", createdAt: 10 }),
    ];

    it("returns output deep-equal to the pre-change builder for '/'-titled threads", () => {
      const baseline = buildProjectThreadGroups(slashFixture);
      const withNone = buildProjectThreadGroups(
        slashFixture,
        compareStandardThreads,
        { groupBy: "none", containerId: "proj_1" },
      );
      expect(withNone).toEqual(baseline);
    });

    it("never enters the folder branch (no folder items even with slashes)", () => {
      const withNone = buildProjectThreadGroups(
        slashFixture,
        compareStandardThreads,
        { groupBy: "none", containerId: "proj_1" },
      );
      expect(withNone.some((item) => item.kind === "folder")).toBe(false);
      expect(summarizeItems(withNone)).toEqual(["a", "b", "c"]);
    });
  });
});
