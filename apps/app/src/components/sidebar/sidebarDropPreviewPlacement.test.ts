import type { ThreadListEntry } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  buildPinnedSidebarState,
  buildSectionThreadList,
  CHRONOLOGICAL_CONTAINER_ID,
} from "@bb/client-core";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import {
  getSidebarNestParentKey,
  resolveSidebarDropPreviewPlacement,
} from "./sidebarDropPreviewPlacement";
import { PINNED_THREAD_PARENT_KEY } from "./useSectionThreadDnd";

function createThread(overrides: Partial<ThreadListEntry>): ThreadListEntry {
  return makeThreadListEntry({
    id: "thread",
    projectId: "project",
    title: "Thread",
    titleFallback: "Thread",
    lastReadAt: 0,
    latestAttentionAt: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });
}

const SECTIONS = [{ id: "a", name: "Section A" }];
const newest = createThread({ id: "newest", createdAt: 9, updatedAt: 9 });
const middle = createThread({ id: "middle", createdAt: 5, updatedAt: 5 });
const oldest = createThread({ id: "oldest", createdAt: 1, updatedAt: 1 });
const parent = createThread({
  id: "parent",
  sectionId: "a",
  createdAt: 8,
  updatedAt: 8,
});
const childNew = createThread({
  id: "child-new",
  parentThreadId: "parent",
  sectionId: "a",
  createdAt: 7,
  updatedAt: 7,
});
const childOld = createThread({
  id: "child-old",
  parentThreadId: "parent",
  sectionId: "a",
  createdAt: 2,
  updatedAt: 2,
});
const THREADS = [newest, middle, oldest, parent, childNew, childOld];
const NO_DRAFTS = new Set<string>();

function placement(
  activeThread: ThreadListEntry,
  target: Parameters<typeof resolveSidebarDropPreviewPlacement>[0]["target"],
  pinnedRootNodes = buildPinnedSidebarState({ threads: [] }).rootNodes,
) {
  return resolveSidebarDropPreviewPlacement({
    activeThread,
    compareThreads: undefined,
    draftThreadIds: NO_DRAFTS,
    pinnedRootNodes,
    sections: SECTIONS,
    target,
    threads: THREADS,
  });
}

describe("resolveSidebarDropPreviewPlacement", () => {
  it("places a thread moved into Threads by its sort position", () => {
    const moved = createThread({
      id: "moved",
      sectionId: "a",
      createdAt: 4,
      updatedAt: 4,
    });
    expect(
      resolveSidebarDropPreviewPlacement({
        activeThread: moved,
        compareThreads: undefined,
        draftThreadIds: NO_DRAFTS,
        pinnedRootNodes: [],
        sections: SECTIONS,
        target: {
          kind: "container",
          parentKey: CHRONOLOGICAL_CONTAINER_ID,
          sectionId: null,
        },
        threads: [...THREADS, moved],
      }),
    ).toEqual({
      parentKey: CHRONOLOGICAL_CONTAINER_ID,
      beforeItemKey: "thread:oldest",
    });
  });

  it("places the newest thread first and the oldest at the end", () => {
    const sectionKey = buildSectionThreadList(
      THREADS,
      undefined,
      SECTIONS,
    ).find((item) => item.kind === "section");
    expect(sectionKey?.kind).toBe("section");
    const key = sectionKey?.kind === "section" ? sectionKey.group.key : "";
    expect(
      placement(newest, { kind: "container", parentKey: key, sectionId: "a" }),
    ).toEqual({ parentKey: key, beforeItemKey: "thread:parent" });
    expect(
      placement(oldest, { kind: "container", parentKey: key, sectionId: "a" }),
    ).toEqual({ parentKey: key, beforeItemKey: null });
  });

  it("places a nested thread among the parent's children", () => {
    expect(
      placement(middle, { kind: "nest", parentThreadId: "parent" }),
    ).toEqual({
      parentKey: getSidebarNestParentKey("parent"),
      beforeItemKey: "thread:child-old",
    });
    expect(
      placement(oldest, { kind: "nest", parentThreadId: "parent" }),
    ).toEqual({
      parentKey: getSidebarNestParentKey("parent"),
      beforeItemKey: null,
    });
  });

  it("places a newly pinned thread at the top of the pinned list", () => {
    const pinnedRootNodes = buildPinnedSidebarState({
      threads: [
        createThread({ id: "pin-1", pinnedAt: 10, pinSortKey: "1" }),
        createThread({ id: "pin-2", pinnedAt: 9, pinSortKey: "3" }),
      ],
    }).rootNodes;
    expect(
      placement(
        middle,
        { kind: "pinned", parentKey: PINNED_THREAD_PARENT_KEY },
        pinnedRootNodes,
      ),
    ).toEqual({
      parentKey: PINNED_THREAD_PARENT_KEY,
      beforeItemKey: "thread:pin-1",
    });
  });

  it("places a thread nested under a pinned parent among its children", () => {
    const pinnedRootNodes = buildPinnedSidebarState({
      threads: [
        createThread({ id: "pin-1", pinnedAt: 10 }),
        createThread({
          id: "pin-child",
          parentThreadId: "pin-1",
          createdAt: 3,
          updatedAt: 3,
        }),
      ],
    }).rootNodes;
    expect(
      placement(
        middle,
        { kind: "nest", parentThreadId: "pin-1" },
        pinnedRootNodes,
      ),
    ).toEqual({
      parentKey: getSidebarNestParentKey("pin-1"),
      beforeItemKey: "thread:pin-child",
    });
  });
});
