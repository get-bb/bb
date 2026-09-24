import type {
  PluginSidebarProject,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import type { SidebarProject } from "./use-sidebar-data.js";

export type SidebarThreadEnvironment = NonNullable<
  PluginSidebarThread["environment"]
>;

export type SidebarThreadOverrides = Partial<
  Omit<PluginSidebarThread, "activity">
> & {
  activity?: Partial<PluginSidebarThread["activity"]>;
};

function defaultDisplayTitle(
  id: string,
  title: string | null,
  titleFallback: string | null,
): string {
  if (title && title.trim().length > 0) return title;
  if (titleFallback && titleFallback.trim().length > 0) return titleFallback;
  return `Thread ${id.slice(0, 8)}`;
}

export function makeSidebarEnvironment(
  overrides: Partial<SidebarThreadEnvironment> = {},
): SidebarThreadEnvironment {
  return {
    id: "env_test",
    name: null,
    branchName: null,
    path: null,
    isWorktree: null,
    providerId: null,
    workspaceDisplayKind: "other",
    ...overrides,
  };
}

export function makeSidebarThread(
  overrides: SidebarThreadOverrides = {},
): PluginSidebarThread {
  const id = overrides.id ?? "thr_test";
  const projectId = overrides.projectId ?? "proj_test";
  const title = overrides.title === undefined ? "Thread" : overrides.title;
  const titleFallback =
    overrides.titleFallback === undefined ? "Thread" : overrides.titleFallback;
  const lastReadAt =
    overrides.lastReadAt === undefined ? 0 : overrides.lastReadAt;
  const latestAttentionAt = overrides.latestAttentionAt ?? 1;
  const pinnedAt = overrides.pinnedAt ?? null;
  const archivedAt = overrides.archivedAt ?? null;
  return {
    id,
    projectId,
    title,
    titleFallback,
    displayTitle: defaultDisplayTitle(id, title, titleFallback),
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "provider-test",
    model: "gpt-5.5",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    indicator: "none",
    indicatorLabel: null,
    isUnread: (lastReadAt ?? 0) < latestAttentionAt,
    isPinned: pinnedAt !== null,
    pinnedAt,
    pinSortKey: null,
    isArchived: archivedAt !== null,
    archivedAt,
    href: `/projects/${projectId}/threads/${id}`,
    isHidden: false,
    environment: null,
    host: null,
    createdAt: 1,
    updatedAt: 1,
    lastReadAt,
    latestAttentionAt,
    ...overrides,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
      ...overrides.activity,
    },
  };
}

export function sdkResult<T>(value: T): () => Promise<never> {
  return async () => value as never;
}

export function makePluginProject(
  overrides: Partial<PluginSidebarProject> = {},
): PluginSidebarProject {
  const id = overrides.id ?? "proj_test";
  return {
    id,
    name: "Test project",
    isPersonal: false,
    href: `/projects/${id}`,
    settingsHref: `/settings/projects/${id}`,
    ...overrides,
  };
}

export function makeSidebarProject(
  overrides: Partial<SidebarProject> = {},
): SidebarProject {
  return { ...makePluginProject(overrides), threads: [], ...overrides };
}
