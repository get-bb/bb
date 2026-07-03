import type { ThreadListEntry } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  buildParentSelectorOptions,
  isRootThread,
} from "./threadParentSelectorOptions";

type ThreadListEntryOverrides = Partial<ThreadListEntry>;

function makeThread(overrides: ThreadListEntryOverrides = {}): ThreadListEntry {
  return {
    activity: { activeWorkflowCount: 0 },
    archivedAt: null,
    childOrigin: null,
    createdAt: 1,
    deletedAt: null,
    environmentBranchName: null,
    environmentHostId: null,
    environmentId: null,
    environmentName: null,
    environmentWorkspaceDisplayKind: "other",
    hasPendingInteraction: false,
    id: "thr_1",
    lastReadAt: null,
    latestAttentionAt: 1,
    parentThreadId: null,
    pinnedAt: null,
    pinSortKey: null,
    projectId: "proj_1",
    providerId: "codex",
    originKind: null,
    originPluginId: null,
    sourceThreadId: null,
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    status: "idle",
    title: "Thread",
    titleFallback: "Thread",
    folderId: null,
    updatedAt: 1,
    ...overrides,
  };
}

describe("thread parent selector options", () => {
  it("allows threads as parent candidates", () => {
    const options = buildParentSelectorOptions({
      currentThreadId: "thr_child",
      parentThreadDisplayName: null,
      parentThreadId: null,
      parentThreads: [
        makeThread({ id: "thr_standard_parent", title: "Standard parent" }),
        makeThread({
          id: "thr_review_parent",
          title: "Review parent",
        }),
      ],
    });

    expect(options).toEqual([
      { value: "none", label: "None" },
      { value: "thr_standard_parent", label: "Standard parent" },
      { value: "thr_review_parent", label: "Review parent" },
    ]);
  });

  it("excludes the current thread and descendants from parent candidates", () => {
    const options = buildParentSelectorOptions({
      currentThreadId: "thr_parent",
      parentThreadDisplayName: null,
      parentThreadId: null,
      parentThreads: [
        makeThread({ id: "thr_parent", title: "Current thread" }),
        makeThread({
          id: "thr_child",
          parentThreadId: "thr_parent",
          title: "Child",
        }),
        makeThread({
          id: "thr_grandchild",
          parentThreadId: "thr_child",
          title: "Grandchild",
        }),
        makeThread({ id: "thr_sibling", title: "Sibling" }),
      ],
    });

    expect(options).toEqual([
      { value: "none", label: "None" },
      { value: "thr_sibling", label: "Sibling" },
    ]);
  });

  it("excludes side chats from parent candidates", () => {
    const options = buildParentSelectorOptions({
      currentThreadId: "thr_child",
      parentThreadDisplayName: null,
      parentThreadId: null,
      parentThreads: [
        makeThread({ id: "thr_parent", title: "Parent" }),
        makeThread({
          id: "thr_side_chat",
          originKind: "side-chat",
          title: "Side chat",
        }),
        makeThread({
          id: "thr_legacy_side_chat",
          childOrigin: "side-chat",
          title: "Legacy side chat",
        }),
      ],
    });

    expect(options).toEqual([
      { value: "none", label: "None" },
      { value: "thr_parent", label: "Parent" },
    ]);
  });

  it("only marks root threads as assignable", () => {
    expect(isRootThread(makeThread({ parentThreadId: null }))).toBe(true);
    expect(isRootThread(makeThread({ parentThreadId: "thr_parent" }))).toBe(
      false,
    );
    expect(isRootThread(makeThread({ originKind: "side-chat" }))).toBe(false);
  });
});
