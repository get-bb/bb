import { describe, expect, it } from "vitest";
import type {
  PluginSidebarProject,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import {
  buildWorkspaceSidebarModel,
  findWorkspaceKeyForThread,
  formatLineCount,
  resolveOpenThread,
} from "./model.js";

function project(
  id: string,
  overrides: Partial<PluginSidebarProject> = {},
): PluginSidebarProject {
  return {
    id,
    name: id,
    isPersonal: false,
    href: `/projects/${id}`,
    settingsHref: `/projects/${id}/settings`,
    ...overrides,
  };
}

function thread(
  id: string,
  options: {
    projectId?: string;
    environmentId?: string | null;
    createdAt?: number;
    parentThreadId?: string | null;
    isHidden?: boolean;
    isArchived?: boolean;
    pinnedAt?: number | null;
  } = {},
): PluginSidebarThread {
  const environmentId =
    options.environmentId === undefined ? `env-${id}` : options.environmentId;
  const pinnedAt = options.pinnedAt ?? null;
  return {
    id,
    projectId: options.projectId ?? "p1",
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
    isPinned: pinnedAt !== null,
    pinnedAt,
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
            branchName: `branch-${environmentId}`,
            path: `/w/${environmentId}`,
            isWorktree: true,
            providerId: "worktree",
            workspaceDisplayKind: null,
          },
    host: null,
    createdAt: options.createdAt ?? 0,
    updatedAt: options.createdAt ?? 0,
    lastReadAt: null,
    latestAttentionAt: 0,
  };
}

describe("buildWorkspaceSidebarModel", () => {
  it("groups threads that share an environment into one workspace titled by its first chat", () => {
    const model = buildWorkspaceSidebarModel(
      [
        thread("second-tab", { environmentId: "env-a", createdAt: 20 }),
        thread("first-tab", { environmentId: "env-a", createdAt: 10 }),
        thread("subagent", {
          environmentId: "env-a",
          createdAt: 5,
          parentThreadId: "first-tab",
        }),
        thread("side-chat", {
          environmentId: "env-a",
          createdAt: 30,
          isHidden: true,
        }),
      ],
      [project("p1")],
    );
    const [workspace] = model.projects[0]?.workspaces ?? [];
    expect(workspace?.primary.id).toBe("first-tab");
    expect(workspace?.chats.map((chat) => chat.id)).toEqual([
      "first-tab",
      "second-tab",
    ]);
    expect(workspace?.threads).toHaveLength(4);
    expect(model.projects[0]?.workspaces).toHaveLength(1);
  });

  it("gives each environment-less thread its own workspace and lists newest first", () => {
    const model = buildWorkspaceSidebarModel(
      [
        thread("old", { environmentId: null, createdAt: 1 }),
        thread("new", { environmentId: null, createdAt: 2 }),
      ],
      [project("p1")],
    );
    expect(
      model.projects[0]?.workspaces.map((workspace) => workspace.key),
    ).toEqual(["thread:new", "thread:old"]);
  });

  it("moves pinned workspaces out of their project and drops archived threads", () => {
    const model = buildWorkspaceSidebarModel(
      [
        thread("pinned", { pinnedAt: 50 }),
        thread("plain", { createdAt: 3 }),
        thread("gone", { isArchived: true }),
      ],
      [project("p1")],
    );
    expect(model.pinned.map((workspace) => workspace.primary.id)).toEqual([
      "pinned",
    ]);
    expect(
      model.projects[0]?.workspaces.map((workspace) => workspace.primary.id),
    ).toEqual(["plain"]);
  });

  it("keeps empty projects but hides an empty personal project and puts it last", () => {
    const projects = [
      project("personal", { isPersonal: true }),
      project("empty"),
      project("busy"),
    ];
    const empty = buildWorkspaceSidebarModel([], projects);
    expect(empty.projects.map((group) => group.project.id)).toEqual([
      "empty",
      "busy",
    ]);
    const withPersonal = buildWorkspaceSidebarModel(
      [thread("mine", { projectId: "personal" })],
      projects,
    );
    expect(withPersonal.projects.map((group) => group.project.id)).toEqual([
      "empty",
      "busy",
      "personal",
    ]);
  });
});

describe("workspace navigation", () => {
  const model = buildWorkspaceSidebarModel(
    [
      thread("a1", { environmentId: "env-a", createdAt: 1 }),
      thread("a2", { environmentId: "env-a", createdAt: 2 }),
    ],
    [project("p1")],
  );
  const workspace = model.projects[0]?.workspaces[0];

  it("finds the workspace holding the routed thread", () => {
    expect(findWorkspaceKeyForThread(model, "a2")).toBe("env:env-a");
    expect(findWorkspaceKeyForThread(model, "missing")).toBeNull();
  });

  it("reopens the last chat the user had open, falling back to the first", () => {
    if (workspace === undefined) throw new Error("missing workspace");
    expect(resolveOpenThread(workspace, "a2").id).toBe("a2");
    expect(resolveOpenThread(workspace, "archived-one").id).toBe("a1");
    expect(resolveOpenThread(workspace, undefined).id).toBe("a1");
  });
});

describe("formatLineCount", () => {
  it("abbreviates thousands the way Conductor does", () => {
    expect(formatLineCount(527)).toBe("527");
    expect(formatLineCount(3100)).toBe("3.1k");
    expect(formatLineCount(4000)).toBe("4k");
    expect(formatLineCount(123456)).toBe("123k");
  });
});
