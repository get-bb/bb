import { describe, expect, it } from "vitest";
import {
  compareStandardThreads,
  isSidebarProjectThread,
  threadListIndicatorStateForThread,
} from "@bb/client-core";
import { makeSidebarThread } from "./fixtures.js";
import { toSidebarThread } from "./sidebar-thread.js";
import { buildSidebarData, getSidebarData, resetSidebarDataCacheForTest } from "./use-sidebar-data.js";

describe("toSidebarThread", () => {
  it("maps every DTO field onto the ThreadListEntry shape", () => {
    const entry = toSidebarThread(
      makeSidebarThread({
        id: "thr_1",
        projectId: "proj_1",
        title: "Fix @thread:thr_2",
        displayTitle: "Fix Other",
        href: "/projects/proj_1/threads/thr_1",
        status: "active",
        runtimeStatus: "host-reconnecting",
        queuedWork: "failed",
        hasPendingInteraction: true,
        isHidden: true,
        pinnedAt: 5,
        pinSortKey: "a0",
        archivedAt: 9,
        parentThreadId: "thr_parent",
        lifecycleOwnerThreadId: "thr_owner",
        sourceThreadId: "thr_source",
        originKind: "fork",
        originPluginId: "plugin",
        sectionId: "sec_1",
        activity: {
          workflows: 1,
          backgroundAgents: 2,
          backgroundCommands: 3,
          planMode: 4,
          goals: 5,
        },
        environment: {
          id: "env_1",
          name: "Env",
          branchName: "feature",
          path: "/repo",
          isWorktree: true,
          providerId: "worktree",
          workspaceDisplayKind: "managed-worktree",
        },
        host: { id: "host_1", name: "Laptop" },
        createdAt: 10,
        updatedAt: 20,
        lastReadAt: 15,
        latestAttentionAt: 18,
      }),
    );

    expect(entry).toMatchObject({
      id: "thr_1",
      projectId: "proj_1",
      title: "Fix @thread:thr_2",
      displayTitle: "Fix Other",
      href: "/projects/proj_1/threads/thr_1",
      status: "active",
      runtime: { displayStatus: "host-reconnecting", hostReconnectGraceExpiresAt: null },
      queuedWork: "failed",
      hasPendingInteraction: true,
      visibility: "hidden",
      pinnedAt: 5,
      pinSortKey: "a0",
      archivedAt: 9,
      deletedAt: null,
      parentThreadId: "thr_parent",
      lifecycleOwnerThreadId: "thr_owner",
      sourceThreadId: "thr_source",
      originKind: "fork",
      originPluginId: "plugin",
      sectionId: "sec_1",
      activity: {
        activeWorkflowCount: 1,
        activeBackgroundAgentCount: 2,
        activeBackgroundCommandCount: 3,
        activePlanModeCount: 4,
        activeGoalCount: 5,
      },
      environmentId: "env_1",
      environmentName: "Env",
      environmentBranchName: "feature",
      environmentPath: "/repo",
      environmentIsWorktree: true,
      environmentProviderId: "worktree",
      environmentWorkspaceDisplayKind: "managed-worktree",
      environmentHostId: "host_1",
      createdAt: 10,
      updatedAt: 20,
      lastReadAt: 15,
      latestAttentionAt: 18,
    });
  });

  it("fills environment-derived columns with null for a thread without an environment", () => {
    const entry = toSidebarThread(makeSidebarThread({ environment: null, host: null }));
    expect(entry.environmentId).toBeNull();
    expect(entry.environmentHostId).toBeNull();
    expect(entry.environmentName).toBeNull();
    expect(entry.environmentBranchName).toBeNull();
    expect(entry.environmentPath).toBeNull();
    expect(entry.environmentIsWorktree).toBeNull();
    expect(entry.environmentProviderId).toBeNull();
    expect(entry.environmentWorkspaceDisplayKind).toBe("other");
    expect(entry.visibility).toBe("visible");
  });

  it("returns the same entry for the same DTO object and a new one for a replacement", () => {
    const dto = makeSidebarThread();
    const first = toSidebarThread(dto);
    expect(toSidebarThread(dto)).toBe(first);
    const replacement = { ...dto, updatedAt: 2 };
    const second = toSidebarThread(replacement);
    expect(second).not.toBe(first);
    expect(second.updatedAt).toBe(2);
    expect(first.updatedAt).toBe(1);
  });

  it("feeds the client-core helpers unchanged", () => {
    const busy = toSidebarThread(
      makeSidebarThread({
        id: "thr_busy",
        status: "active",
        runtimeStatus: "active",
        updatedAt: 1,
      }),
    );
    const idle = toSidebarThread(
      makeSidebarThread({ id: "thr_idle", updatedAt: 100 }),
    );
    const hidden = toSidebarThread(
      makeSidebarThread({ id: "thr_hidden", isHidden: true }),
    );

    expect(threadListIndicatorStateForThread(busy, false).isRuntimeActive).toBe(true);
    expect(threadListIndicatorStateForThread(idle, true).hasUnsubmittedDraft).toBe(true);
    expect([idle, busy].sort(compareStandardThreads).map((entry) => entry.id)).toEqual([
      "thr_busy",
      "thr_idle",
    ]);
    expect(isSidebarProjectThread(hidden)).toBe(false);
    expect(isSidebarProjectThread(idle)).toBe(true);
  });
});

describe("buildSidebarData", () => {
  it("groups threads by project, resolves the personal project, and collects hosts", () => {
    const projects = [
      {
        id: "proj_a",
        name: "A",
        isPersonal: false,
        href: "/projects/proj_a",
        settingsHref: "/projects/proj_a/settings",
      },
      {
        id: "proj_me",
        name: "Personal",
        isPersonal: true,
        href: "/projects/proj_me",
        settingsHref: "/projects/proj_me/settings",
      },
    ];
    const threads = [
      makeSidebarThread({ id: "t1", projectId: "proj_a", host: { id: "h1", name: "Mac" } }),
      makeSidebarThread({ id: "t2", projectId: "proj_me", host: { id: "h2", name: "Box" } }),
      makeSidebarThread({ id: "t3", projectId: "proj_a", host: { id: "h1", name: "Mac" } }),
      makeSidebarThread({ id: "t4", projectId: "proj_gone" }),
    ];
    const data = buildSidebarData("ready", threads, projects, [
      { id: "sec_1", name: "Later", createdAt: 1, updatedAt: 1 },
    ]);

    expect(data.status).toBe("ready");
    expect(data.sections.map((section) => section.id)).toEqual(["sec_1"]);
    expect(data.projects.map((project) => [project.id, project.threads.map((t) => t.id)])).toEqual([
      ["proj_a", ["t1", "t3"]],
      ["proj_me", ["t2"]],
    ]);
    expect(data.projects[0]).toMatchObject({
      name: "A",
      href: "/projects/proj_a",
      settingsHref: "/projects/proj_a/settings",
      isPersonal: false,
    });
    expect(data.personalProject?.id).toBe("proj_me");
    expect([...data.hostsById.entries()]).toEqual([
      ["h1", { id: "h1", name: "Mac" }],
      ["h2", { id: "h2", name: "Box" }],
    ]);
  });

  it("reports no personal project when none is flagged", () => {
    const data = buildSidebarData("loading", [], [], []);
    expect(data.personalProject).toBeNull();
    expect(data.projects).toEqual([]);
    expect(data.hostsById.size).toBe(0);
  });
});

describe("buildSidebarData structural sharing", () => {
  const projects = [
    { id: "proj_a", name: "A", isPersonal: false, href: "/a", settingsHref: "/a/s" },
    { id: "proj_b", name: "B", isPersonal: false, href: "/b", settingsHref: "/b/s" },
  ];

  it("keeps untouched projects and their thread arrays by identity across updates", () => {
    const a1 = makeSidebarThread({ id: "a1", projectId: "proj_a" });
    const b1 = makeSidebarThread({ id: "b1", projectId: "proj_b" });
    const first = buildSidebarData("ready", [a1, b1], projects, []);
    const b1Changed = makeSidebarThread({ id: "b1", projectId: "proj_b", title: "renamed" });
    const second = buildSidebarData("ready", [a1, b1Changed], projects, [], first);
    expect(second.projects[0]).toBe(first.projects[0]);
    expect(second.projects[0]?.threads).toBe(first.projects[0]?.threads);
    expect(second.projects[1]).not.toBe(first.projects[1]);
    expect(second.projects).not.toBe(first.projects);
    expect(second.hostsById).toBe(first.hostsById);
    const third = buildSidebarData("ready", [a1, b1Changed], projects, [], second);
    expect(third.projects).toBe(second.projects);
  });

  it("serves one grouped result per host payload to every caller", () => {
    resetSidebarDataCacheForTest();
    const state = {
      status: "ready" as const,
      threads: [makeSidebarThread({ id: "a1", projectId: "proj_a" })],
      projects,
      sections: [],
    };
    const data = getSidebarData(state);
    expect(getSidebarData({ ...state })).toBe(data);
    expect(getSidebarData({ ...state, threads: [...state.threads] })).not.toBe(data);
    resetSidebarDataCacheForTest();
  });
});
