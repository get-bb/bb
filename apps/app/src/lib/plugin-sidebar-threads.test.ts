import type { ThreadListEntry } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { toPluginSidebarThread } from "./plugin-sidebar-threads";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";

function makeThread(overrides: Partial<ThreadListEntry> = {}): ThreadListEntry {
  return makeThreadListEntry({
    id: "thr_1",
    projectId: "proj_1",
    title: "A thread",
    titleFallback: "A thread",
    lastReadAt: 10,
    latestAttentionAt: 5,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  });
}

describe("toPluginSidebarThread", () => {
  it("resolves the display title through the same rules bb's row uses", () => {
    expect(toPluginSidebarThread(makeThread()).displayTitle).toBe("A thread");
    expect(
      toPluginSidebarThread(makeThread({ title: null, titleFallback: "Fallback" }))
        .displayTitle,
    ).toBe("Fallback");
    expect(
      toPluginSidebarThread(
        makeThread({ id: "thr_abcdefghij", title: null, titleFallback: null }),
      ).displayTitle,
    ).toBe("Thread thr_abcd");

    const resources = {
      sectionNamesById: new Map([["sec_slop", "Slop Cop"]]),
      projectNamesById: new Map([["proj_1", "bb"]]),
      threadById: new Map(),
    };
    expect(
      toPluginSidebarThread(
        makeThread({ title: "Review @section:sec_slop in @project:proj_1" }),
        new Map(),
        resources,
      ).displayTitle,
    ).toBe("Review Slop Cop in bb");
  });

  it("maps activity counts onto the plugin-facing names", () => {
    const mapped = toPluginSidebarThread(
      makeThread({
        activity: {
          activeWorkflowCount: 2,
          activeBackgroundAgentCount: 3,
          activeBackgroundCommandCount: 4,
          activePlanModeCount: 5,
          activeGoalCount: 6,
        },
      }),
    );
    expect(mapped.activity).toEqual({
      workflows: 2,
      backgroundAgents: 3,
      backgroundCommands: 4,
      planMode: 5,
      goals: 6,
    });
  });

  it("resolves the indicator with the host's precedence", () => {
    expect(
      toPluginSidebarThread(
        makeThread({
          hasPendingInteraction: true,
          runtime: {
            displayStatus: "active",
          },
        }),
      ).indicator,
    ).toBe("waiting-for-input");

    expect(
      toPluginSidebarThread(
        makeThread({
          runtime: {
            displayStatus: "active",
          },
        }),
      ).indicator,
    ).toBe("runtime");

    expect(
      toPluginSidebarThread(
        makeThread({
          activity: {
            activeWorkflowCount: 1,
            activeBackgroundAgentCount: 0,
            activeBackgroundCommandCount: 0,
            activePlanModeCount: 0,
            activeGoalCount: 0,
          },
        }),
      ).indicator,
    ).toBe("workflow");
  });

  it("carries the host's accessible label, and null for none", () => {
    expect(
      toPluginSidebarThread(makeThread({ hasPendingInteraction: true }))
        .indicatorLabel,
    ).toBe("Thread needs user input");
    const idle = toPluginSidebarThread(makeThread());
    expect(idle.indicator).toBe("none");
    expect(idle.indicatorLabel).toBeNull();
  });

  it("reports an unread failure as an error indicator", () => {
    const mapped = toPluginSidebarThread(
      makeThread({ status: "error", lastReadAt: 1, latestAttentionAt: 9 }),
    );
    expect(mapped.indicator).toBe("unread-error");
    expect(mapped.isUnread).toBe(true);
  });

  it("reports unread child threads as unread", () => {
    const mapped = toPluginSidebarThread(
      makeThread({
        parentThreadId: "thr_parent",
        lastReadAt: 1,
        latestAttentionAt: 9,
      }),
    );
    expect(mapped.isUnread).toBe(true);
    expect(mapped.indicator).toBe("none");
  });

  it("treats a never-read thread as unread", () => {
    expect(
      toPluginSidebarThread(makeThread({ lastReadAt: null })).isUnread,
    ).toBe(true);
  });

  it("maps pin, archive, and environment fields", () => {
    const mapped = toPluginSidebarThread(
      makeThread({
        pinnedAt: 12,
        pinSortKey: "a0",
        archivedAt: 13,
        environmentId: "env_1",
        environmentName: "Worktree",
        environmentBranchName: "bb/feature",
        environmentPath: "/repos/bb/.worktrees/feature",
        environmentIsWorktree: true,
        environmentProviderId: "git-worktree",
        environmentWorkspaceDisplayKind: "managed-worktree",
        queuedWork: "none",
      }),
    );
    expect(mapped.isPinned).toBe(true);
    expect(mapped.pinnedAt).toBe(12);
    expect(mapped.pinSortKey).toBe("a0");
    expect(mapped.isArchived).toBe(true);
    expect(mapped.archivedAt).toBe(13);
    expect(mapped.href).toBe("/projects/proj_1/threads/thr_1");
    expect(mapped.environment).toEqual({
      id: "env_1",
      name: "Worktree",
      branchName: "bb/feature",
      path: "/repos/bb/.worktrees/feature",
      isWorktree: true,
      providerId: "git-worktree",
      workspaceDisplayKind: "managed-worktree",
    });
  });

  it("carries status, runtime status, and lineage the list sorts and groups by", () => {
    const mapped = toPluginSidebarThread(
      makeThread({
        status: "active",
        runtime: {
          displayStatus: "waiting-for-host",
        },
        lifecycleOwnerThreadId: "thr_owner",
        sourceThreadId: "thr_source",
        originKind: "fork",
      }),
    );
    expect(mapped.status).toBe("active");
    expect(mapped.runtimeStatus).toBe("waiting-for-host");
    expect(mapped.lifecycleOwnerThreadId).toBe("thr_owner");
    expect(mapped.sourceThreadId).toBe("thr_source");
  });

  it("exposes hidden threads with a flag instead of dropping them", () => {
    expect(toPluginSidebarThread(makeThread()).isHidden).toBe(false);
    expect(
      toPluginSidebarThread(makeThread({ visibility: "hidden" })).isHidden,
    ).toBe(true);
  });

  it("reports queued work as its own indicators", () => {
    const failed = toPluginSidebarThread(makeThread({ queuedWork: "failed" }));
    expect(failed.queuedWork).toBe("failed");
    expect(failed.indicator).toBe("queued-failed");
    expect(failed.indicatorLabel).toBe("Queued message failed to send");

    const waiting = toPluginSidebarThread(
      makeThread({ queuedWork: "waiting" }),
    );
    expect(waiting.queuedWork).toBe("waiting");
    expect(waiting.indicator).toBe("queued-waiting");

    const unreadAndFailed = toPluginSidebarThread(
      makeThread({ queuedWork: "failed", lastReadAt: 1, latestAttentionAt: 9 }),
    );
    expect(unreadAndFailed.indicator).toBe("queued-failed");
  });

  it("reports no environment when the thread has none", () => {
    expect(toPluginSidebarThread(makeThread()).environment).toBeNull();
  });

  it("carries the provider so a row can draw an agent glyph", () => {
    expect(toPluginSidebarThread(makeThread()).providerId).toBe("codex");
  });

  it("resolves the machine name for the thread's host", () => {
    const mapped = toPluginSidebarThread(
      makeThread({ environmentHostId: "host_1" }),
      new Map([["host_1", "Sawyer's MacBook"]]),
    );
    expect(mapped.host).toEqual({ id: "host_1", name: "Sawyer's MacBook" });
  });

  it("falls back to the host id when the machine is unknown", () => {
    const mapped = toPluginSidebarThread(
      makeThread({ environmentHostId: "host_gone" }),
      new Map(),
    );
    expect(mapped.host).toEqual({ id: "host_gone", name: "host_gone" });
  });

  it("reports no host when the thread has none", () => {
    expect(toPluginSidebarThread(makeThread()).host).toBeNull();
  });
});
