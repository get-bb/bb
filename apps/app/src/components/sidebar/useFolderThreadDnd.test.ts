import type { ThreadListEntry } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  buildFolderThreadList,
  CHRONOLOGICAL_CONTAINER_ID,
} from "./projectThreadGroups";
import {
  collectFolderThreadDndLookup,
  PINNED_THREAD_PARENT_KEY,
  resolveFolderThreadDropDecision,
  resolveFolderThreadDropTarget,
  resolveFolderThreadSectionOverId,
  resolveProjectedFolderThreadDropTarget,
} from "./useFolderThreadDnd";

function createThread(overrides: Partial<ThreadListEntry>): ThreadListEntry {
  return {
    id: "thread",
    projectId: "project",
    environmentId: null,
    providerId: "codex",
    title: "Thread",
    titleFallback: "Thread",
    folderId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    childOrigin: null,
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: 0,
    latestAttentionAt: 2,
    createdAt: 1,
    updatedAt: 2,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
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

function createLookup() {
  return collectFolderThreadDndLookup(
    buildFolderThreadList(
      [
        createThread({ id: "in-a", folderId: "a" }),
        createThread({ id: "loose", createdAt: 2 }),
      ],
      undefined,
      [
        { id: "a", name: "Folder A" },
        { id: "b", name: "Empty Folder B" },
      ],
    ),
    CHRONOLOGICAL_CONTAINER_ID,
  );
}

function createLookupWithPinnedThread(
  overrides: Partial<ThreadListEntry> = {},
) {
  return collectFolderThreadDndLookup(
    buildFolderThreadList(
      [
        createThread({ id: "in-a", folderId: "a" }),
        createThread({ id: "loose", createdAt: 2 }),
      ],
      undefined,
      [
        { id: "a", name: "Folder A" },
        { id: "b", name: "Empty Folder B" },
      ],
    ),
    CHRONOLOGICAL_CONTAINER_ID,
    [
      createThread({
        id: "pinned-1",
        folderId: "a",
        pinnedAt: 10,
        ...overrides,
      }),
      createThread({ id: "pinned-2", pinnedAt: 9 }),
    ],
  );
}

describe("folder thread drop targets", () => {
  it("moves a loose thread onto an empty folder header", () => {
    const lookup = createLookup();
    const folderBKey = lookup.folderParentKeyBySectionId.get("folder:b");

    expect(folderBKey).toBeDefined();
    expect(
      resolveFolderThreadDropTarget(lookup, "loose", folderBKey ?? null),
    ).toEqual({
      activeId: "loose",
      fromParentKey: CHRONOLOGICAL_CONTAINER_ID,
      toParentKey: folderBKey,
    });
  });

  it("accepts an empty folder section itself as a target", () => {
    const lookup = createLookup();
    const folderBKey = lookup.folderParentKeyBySectionId.get("folder:b");

    expect(resolveFolderThreadDropTarget(lookup, "loose", "folder:b")).toEqual({
      activeId: "loose",
      fromParentKey: CHRONOLOGICAL_CONTAINER_ID,
      toParentKey: folderBKey,
    });
  });

  it("moves a folder thread back to the loose Threads section", () => {
    const lookup = createLookup();
    const folderAKey = lookup.folderParentKeyBySectionId.get("folder:a");

    expect(resolveFolderThreadDropTarget(lookup, "in-a", "threads")).toEqual({
      activeId: "in-a",
      fromParentKey: folderAKey,
      toParentKey: CHRONOLOGICAL_CONTAINER_ID,
    });
  });

  it("preserves a projected destination through self-collision", () => {
    const lookup = createLookup();
    const folderBKey = lookup.folderParentKeyBySectionId.get("folder:b");

    expect(folderBKey).toBeDefined();
    expect(
      resolveProjectedFolderThreadDropTarget(
        lookup,
        "loose",
        folderBKey ?? null,
      ),
    ).toEqual({
      activeId: "loose",
      fromParentKey: CHRONOLOGICAL_CONTAINER_ID,
      toParentKey: folderBKey,
    });
  });

  it("rejects same-parent and non-thread moves", () => {
    const lookup = createLookup();
    const folderAKey = lookup.folderParentKeyBySectionId.get("folder:a");

    expect(
      resolveFolderThreadDropTarget(lookup, "in-a", folderAKey ?? null),
    ).toBeNull();
    expect(
      resolveFolderThreadDropTarget(
        lookup,
        folderAKey ?? "folder:a",
        "threads",
      ),
    ).toBeNull();
  });
});

describe("folder thread section drop targets", () => {
  it("resolves a folder section", () => {
    const lookup = createLookup();
    const folderAKey = lookup.folderParentKeyBySectionId.get("folder:a");

    expect(folderAKey).toBeDefined();
    expect(
      resolveFolderThreadSectionOverId(lookup, folderAKey ?? "folder:a"),
    ).toBe("folder:a");
  });

  it("resolves a thread inside a folder", () => {
    expect(resolveFolderThreadSectionOverId(createLookup(), "in-a")).toBe(
      "folder:a",
    );
  });

  it("resolves the chronological container to the Threads section", () => {
    expect(
      resolveFolderThreadSectionOverId(
        createLookup(),
        CHRONOLOGICAL_CONTAINER_ID,
      ),
    ).toBe("threads");
  });

  it("preserves another top-level section id", () => {
    expect(resolveFolderThreadSectionOverId(createLookup(), "pinned")).toBe(
      "pinned",
    );
  });
});

describe("folder thread pin drop decisions", () => {
  it("pins an unpinned thread dropped on the Pinned container", () => {
    expect(
      resolveFolderThreadDropDecision(
        createLookupWithPinnedThread(),
        "loose",
        "pinned",
      ),
    ).toEqual({ kind: "pin", activeId: "loose" });
  });

  it("preserves a projected Pinned destination through self-collision", () => {
    expect(
      resolveFolderThreadDropDecision(
        createLookupWithPinnedThread(),
        "loose",
        "loose",
        PINNED_THREAD_PARENT_KEY,
      ),
    ).toEqual({ kind: "pin", activeId: "loose" });
  });

  it("unpins a pinned thread into Threads and clears its section", () => {
    expect(
      resolveFolderThreadDropDecision(
        createLookupWithPinnedThread(),
        "pinned-1",
        "threads",
      ),
    ).toEqual({
      kind: "unpin",
      activeId: "pinned-1",
      folderId: null,
      move: true,
    });
  });

  it("unpins a pinned thread into a section without a redundant move", () => {
    expect(
      resolveFolderThreadDropDecision(
        createLookupWithPinnedThread(),
        "pinned-1",
        "folder:a",
      ),
    ).toEqual({
      kind: "unpin",
      activeId: "pinned-1",
      folderId: "a",
      move: false,
    });
  });

  it("keeps reorder-within-Pinned as a pinned reorder", () => {
    expect(
      resolveFolderThreadDropDecision(
        createLookupWithPinnedThread(),
        "pinned-1",
        "pinned-2",
      ),
    ).toEqual({
      kind: "reorder-pinned",
      activeId: "pinned-1",
      overId: "pinned-2",
    });
  });
});
