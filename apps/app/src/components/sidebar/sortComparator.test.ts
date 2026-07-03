import { describe, expect, it } from "vitest";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import {
  getSelectedThreadSidebarExpansion,
  getSidebarThreadComparator,
} from "./ProjectList";
import {
  CHRONOLOGICAL_CONTAINER_ID,
  type ProjectThreadItem,
  type ThreadComparator,
} from "./projectThreadGroups";

function thread(overrides: Partial<ThreadListEntry>): ThreadListEntry {
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
    originPluginId: null,
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

// The item comparator only reads node.thread for thread-kind items.
function threadItem(entry: ThreadListEntry): ProjectThreadItem {
  return { kind: "thread", node: { thread: entry } } as unknown as ProjectThreadItem;
}

const apple = thread({
  id: "thr_a",
  title: "Apple",
  createdAt: 100,
  latestAttentionAt: 100,
});
const banana = thread({
  id: "thr_b",
  title: "Banana",
  createdAt: 200,
  latestAttentionAt: 200,
});
const cherry = thread({
  id: "thr_c",
  title: "Cherry",
  createdAt: 300,
  latestAttentionAt: 300,
});

function order(comparator: ThreadComparator, entries: ThreadListEntry[]) {
  return [...entries].sort(comparator).map((entry) => entry.id);
}

describe("getSidebarThreadComparator", () => {
  it("created: desc lists newest first, asc lists oldest first", () => {
    expect(
      order(getSidebarThreadComparator({ sort: "created", direction: "desc" }), [
        apple,
        banana,
        cherry,
      ]),
    ).toEqual(["thr_c", "thr_b", "thr_a"]);
    expect(
      order(getSidebarThreadComparator({ sort: "created", direction: "asc" }), [
        apple,
        banana,
        cherry,
      ]),
    ).toEqual(["thr_a", "thr_b", "thr_c"]);
  });

  it("updated: desc lists most recent first, asc inverts", () => {
    expect(
      order(getSidebarThreadComparator({ sort: "updated", direction: "desc" }), [
        apple,
        banana,
        cherry,
      ]),
    ).toEqual(["thr_c", "thr_b", "thr_a"]);
    expect(
      order(getSidebarThreadComparator({ sort: "updated", direction: "asc" }), [
        apple,
        banana,
        cherry,
      ]),
    ).toEqual(["thr_a", "thr_b", "thr_c"]);
  });

  it("alpha: asc is A→Z and desc is Z→A", () => {
    expect(
      order(getSidebarThreadComparator({ sort: "alpha", direction: "asc" }), [
        cherry,
        apple,
        banana,
      ]),
    ).toEqual(["thr_a", "thr_b", "thr_c"]);
    expect(
      order(getSidebarThreadComparator({ sort: "alpha", direction: "desc" }), [
        apple,
        cherry,
        banana,
      ]),
    ).toEqual(["thr_c", "thr_b", "thr_a"]);
  });

  // Regression: leaf threads and mixed folder/thread items must sort the same
  // direction, or folders and threads appear in opposite alphabetical order.
  it("alpha: leaf and item comparators agree in direction", () => {
    for (const direction of ["asc", "desc"] as const) {
      const comparator = getSidebarThreadComparator({ sort: "alpha", direction });
      expect(comparator.compareItems).toBeDefined();
      const leafSign = Math.sign(comparator(apple, banana));
      const itemSign = Math.sign(
        comparator.compareItems!(threadItem(apple), threadItem(banana)),
      );
      expect(itemSign).toBe(leafSign);
    }
  });
});

describe("getSelectedThreadSidebarExpansion", () => {
  it("expands the personal threads section in project mode", () => {
    expect(
      getSelectedThreadSidebarExpansion({
        isFolderOrganizationMode: false,
        isPinned: false,
        selectedThread: thread({ projectId: PERSONAL_PROJECT_ID }),
      }),
    ).toEqual({ sidebarSectionId: "threads" });
  });

  it("expands the owning project in project mode", () => {
    expect(
      getSelectedThreadSidebarExpansion({
        isFolderOrganizationMode: false,
        isPinned: false,
        selectedThread: thread({ projectId: "proj_app" }),
      }),
    ).toEqual({ projectId: "proj_app", sidebarSectionId: "projects" });
  });

  it("expands the threads section for unfiled project threads in folders mode", () => {
    expect(
      getSelectedThreadSidebarExpansion({
        isFolderOrganizationMode: true,
        isPinned: false,
        selectedThread: thread({ folderId: null, projectId: "proj_app" }),
      }),
    ).toEqual({ sidebarSectionId: "threads" });
  });

  it("expands the containing folder for foldered threads in folders mode", () => {
    expect(
      getSelectedThreadSidebarExpansion({
        isFolderOrganizationMode: true,
        isPinned: false,
        selectedThread: thread({ folderId: "fld_work", projectId: "proj_app" }),
      }),
    ).toEqual({ folderKey: `${CHRONOLOGICAL_CONTAINER_ID}::fld_work` });
  });

  it("does not expand non-pinned sections for pinned threads", () => {
    expect(
      getSelectedThreadSidebarExpansion({
        isFolderOrganizationMode: true,
        isPinned: true,
        selectedThread: thread({ folderId: null, projectId: "proj_app" }),
      }),
    ).toEqual({});
  });
});
