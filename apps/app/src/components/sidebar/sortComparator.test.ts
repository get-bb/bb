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

// The item comparator only reads node.thread for thread-kind items.
function threadItem(entry: ThreadListEntry): ProjectThreadItem {
  return {
    kind: "thread",
    node: { thread: entry },
  } as unknown as ProjectThreadItem;
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
  it("created lists newest first", () => {
    expect(
      order(getSidebarThreadComparator("created"), [apple, banana, cherry]),
    ).toEqual(["thr_c", "thr_b", "thr_a"]);
  });

  it("updated lists most recent first", () => {
    expect(
      order(getSidebarThreadComparator("updated"), [apple, banana, cherry]),
    ).toEqual(["thr_c", "thr_b", "thr_a"]);
  });

  it("alphabetical lists A→Z", () => {
    expect(
      order(getSidebarThreadComparator("alpha"), [cherry, apple, banana]),
    ).toEqual(["thr_a", "thr_b", "thr_c"]);
  });

  // Regression: leaf threads and mixed folder/thread items must both sort A→Z.
  it("alphabetical leaf and item comparators agree", () => {
    const comparator = getSidebarThreadComparator("alpha");
    expect(comparator.compareItems).toBeDefined();
    const leafSign = Math.sign(comparator(apple, banana));
    const itemSign = Math.sign(
      comparator.compareItems!(threadItem(apple), threadItem(banana)),
    );
    expect(itemSign).toBe(leafSign);
  });
});

describe("getSelectedThreadSidebarExpansion", () => {
  it("expands the personal threads section in project mode", () => {
    expect(
      getSelectedThreadSidebarExpansion({
        organizationMode: "project",
        isPinned: false,
        selectedThread: thread({ projectId: PERSONAL_PROJECT_ID }),
      }),
    ).toEqual({ sidebarSectionId: "threads" });
  });

  it("expands the owning project in project mode", () => {
    expect(
      getSelectedThreadSidebarExpansion({
        organizationMode: "project",
        isPinned: false,
        selectedThread: thread({ projectId: "proj_app" }),
      }),
    ).toEqual({ projectId: "proj_app", sidebarSectionId: "projects" });
  });

  it("expands the threads section for unfiled project threads in folders mode", () => {
    expect(
      getSelectedThreadSidebarExpansion({
        organizationMode: "chronological",
        isPinned: false,
        selectedThread: thread({ folderId: null, projectId: "proj_app" }),
      }),
    ).toEqual({ sidebarSectionId: "threads" });
  });

  it("expands the containing folder for foldered threads in folders mode", () => {
    expect(
      getSelectedThreadSidebarExpansion({
        organizationMode: "chronological",
        isPinned: false,
        selectedThread: thread({ folderId: "fld_work", projectId: "proj_app" }),
      }),
    ).toEqual({
      folderKey: `${CHRONOLOGICAL_CONTAINER_ID}::fld_work`,
      sidebarSectionId: "folders",
    });
  });

  it("expands the owning machine group in machine mode", () => {
    expect(
      getSelectedThreadSidebarExpansion({
        organizationMode: "machine",
        isPinned: false,
        selectedThread: thread({
          projectId: "proj_app",
          environmentHostId: "host_a",
        }),
      }),
    ).toEqual({ machineKey: "host_a" });
    expect(
      getSelectedThreadSidebarExpansion({
        organizationMode: "machine",
        isPinned: false,
        selectedThread: thread({ projectId: "proj_app" }),
      }),
    ).toEqual({ machineKey: "no-machine" });
  });

  it("expands the pinned section for pinned threads", () => {
    expect(
      getSelectedThreadSidebarExpansion({
        organizationMode: "chronological",
        isPinned: true,
        selectedThread: thread({ folderId: null, projectId: "proj_app" }),
      }),
    ).toEqual({ sidebarSectionId: "pinned" });
  });
});
