import type { ThreadListEntry } from "@bb/domain";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import { buildPinnedSidebarState } from "../src/sidebar/pinnedSidebarThreads.js";

type ThreadListEntryOverrides = Partial<ThreadListEntry>;

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

describe("buildPinnedSidebarState", () => {
  it("moves every descendant with a pinned parent regardless of type", () => {
    const state = buildPinnedSidebarState({
      threads: [
        createThread({
          id: "standard-parent",
          pinnedAt: 1_000,
          pinSortKey: "a",
        }),
        createThread({
          id: "manager-child",
          parentThreadId: "standard-parent",
        }),
        createThread({
          id: "standard-grandchild",
          parentThreadId: "manager-child",
        }),
        createThread({
          id: "root",
        }),
      ],
    });

    expect([...state.effectivePinnedThreadIds].sort()).toEqual([
      "manager-child",
      "standard-grandchild",
      "standard-parent",
    ]);
  });

  it("keeps an unpinned parent out when only its child is pinned", () => {
    const state = buildPinnedSidebarState({
      threads: [
        createThread({ id: "parent" }),
        createThread({
          id: "child",
          parentThreadId: "parent",
          pinnedAt: 1_000,
          pinSortKey: "a",
        }),
      ],
    });

    expect([...state.effectivePinnedThreadIds]).toEqual(["child"]);
  });

  it("does not pull source-derived forks in as pinned descendants", () => {
    const state = buildPinnedSidebarState({
      threads: [
        createThread({
          id: "parent",
          pinnedAt: 1_000,
          pinSortKey: "a",
        }),
        createThread({
          id: "fork",
          sourceThreadId: "parent",
          originKind: "fork",
        }),
      ],
    });

    expect([...state.effectivePinnedThreadIds]).toEqual(["parent"]);
  });
});
