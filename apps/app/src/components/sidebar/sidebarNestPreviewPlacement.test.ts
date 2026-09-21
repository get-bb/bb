import { describe, expect, it } from "vitest";
import type { ThreadListEntry } from "@bb/domain";
import { buildPinnedSidebarState } from "@bb/client-core";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { resolveSidebarNestPreviewBeforeKey } from "./sidebarNestPreviewPlacement";

function makeThread(overrides: Partial<ThreadListEntry>): ThreadListEntry {
  return makeThreadListEntry({ status: "idle", ...overrides });
}

const parent = makeThread({ id: "thr_parent", latestAttentionAt: 500 });
const newerChild = makeThread({
  id: "thr_newer",
  parentThreadId: "thr_parent",
  latestAttentionAt: 300,
});
const olderChild = makeThread({
  id: "thr_older",
  parentThreadId: "thr_parent",
  latestAttentionAt: 100,
});

function resolve(dragged: ThreadListEntry, threads: ThreadListEntry[]) {
  return resolveSidebarNestPreviewBeforeKey({
    activeThread: dragged,
    compareThreads: undefined,
    draftThreadIds: new Set(),
    parentThreadId: "thr_parent",
    pinnedRootNodes: [],
    sections: [],
    threads,
  });
}

describe("resolveSidebarNestPreviewBeforeKey", () => {
  it("names the sibling the dragged thread would sort ahead of", () => {
    const dragged = makeThread({ id: "thr_dragged", latestAttentionAt: 200 });

    expect(resolve(dragged, [parent, newerChild, olderChild, dragged])).toBe(
      "thread:thr_older",
    );
  });

  it("reports the end of the list when the dragged thread sorts last", () => {
    const dragged = makeThread({ id: "thr_dragged", latestAttentionAt: 50 });

    expect(resolve(dragged, [parent, newerChild, olderChild, dragged])).toBe(
      null,
    );
  });

  it("places the thread among a childless parent's new children", () => {
    const dragged = makeThread({ id: "thr_dragged", latestAttentionAt: 50 });

    expect(resolve(dragged, [parent, dragged])).toBe(null);
  });

  it("uses the pinned tree when the parent is pinned", () => {
    const pinnedParent = makeThread({
      id: "thr_parent",
      latestAttentionAt: 500,
      pinnedAt: 1,
    });
    const dragged = makeThread({ id: "thr_dragged", latestAttentionAt: 200 });
    const pinnedRootNodes = buildPinnedSidebarState({
      threads: [pinnedParent, newerChild, olderChild],
    }).rootNodes;

    expect(
      resolveSidebarNestPreviewBeforeKey({
        activeThread: dragged,
        compareThreads: undefined,
        draftThreadIds: new Set(),
        parentThreadId: "thr_parent",
        pinnedRootNodes,
        sections: [],
        threads: [pinnedParent, newerChild, olderChild, dragged],
      }),
    ).toBe("thread:thr_older");
  });
});
