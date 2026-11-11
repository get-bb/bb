import { describe, expect, it } from "vitest";
import type {
  ExperimentalPanelTab,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { findDiffTabKey, workspaceChats } from "./model.js";

function thread(
  id: string,
  options: {
    environmentId?: string | null;
    createdAt?: number;
    parentThreadId?: string | null;
    isHidden?: boolean;
    isArchived?: boolean;
  } = {},
): PluginSidebarThread {
  const environmentId =
    options.environmentId === undefined ? "env-a" : options.environmentId;
  return {
    id,
    projectId: "p1",
    title: id,
    titleFallback: null,
    displayTitle: id,
    parentThreadId: options.parentThreadId ?? null,
    lifecycleOwnerThreadId: null,
    parentNotifications: "auto",
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: options.isArchived ?? false,
    archivedAt: options.isArchived ? 1 : null,
    href: `/threads/${id}`,
    isHidden: options.isHidden ?? false,
    environment:
      environmentId === null
        ? null
        : {
            id: environmentId,
            name: null,
            branchName: null,
            path: null,
            isWorktree: true,
            providerId: "git-worktree",
            workspaceDisplayKind: null,
          },
    host: null,
    createdAt: options.createdAt ?? 0,
    updatedAt: 0,
    lastReadAt: null,
    latestAttentionAt: 0,
  };
}

describe("workspaceChats", () => {
  const threads = [
    thread("later", { createdAt: 2 }),
    thread("first", { createdAt: 1 }),
    thread("other-env", { environmentId: "env-b" }),
    thread("subagent", { parentThreadId: "first" }),
    thread("side-chat", { isHidden: true }),
    thread("closed", { isArchived: true }),
  ];

  it("lists the environment's visible top-level chats oldest first", () => {
    expect(
      workspaceChats(threads, "env-a", "first").map((chat) => chat.id),
    ).toEqual(["first", "later"]);
  });

  it("keeps the open thread as a tab even when it is a sub-agent or hidden", () => {
    expect(
      workspaceChats(threads, "env-a", "side-chat").map((chat) => chat.id),
    ).toEqual(["side-chat", "first", "later"]);
  });

  it("has no tabs without an environment", () => {
    expect(workspaceChats(threads, null, "first")).toEqual([]);
  });
});

describe("findDiffTabKey", () => {
  const info: ExperimentalPanelTab = {
    key: "plugin-fixed:core:info",
    title: "Info",
    status: null,
    closable: false,
    detail: { kind: "info" },
  };
  const diff: ExperimentalPanelTab = {
    key: "plugin-fixed:bb--git:diff",
    title: "Diff",
    status: null,
    closable: false,
    detail: {
      kind: "plugin",
      pluginId: "bb--git",
      tab: { id: "diff", context: { kind: "thread" }, availability: "fixed" },
      params: null,
    },
  };

  it("finds the Git plugin's Diff tab by plugin and tab id", () => {
    expect(findDiffTabKey([info, diff])).toBe("plugin-fixed:bb--git:diff");
  });

  it("returns null when the Git plugin is off", () => {
    expect(findDiffTabKey([info])).toBeNull();
  });
});
