import type {
  PluginSidebarProject,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

export interface Workspace {
  key: string;
  projectId: string;
  environmentId: string | null;
  branchName: string | null;
  primary: PluginSidebarThread;
  chats: readonly PluginSidebarThread[];
  threads: readonly PluginSidebarThread[];
  isPinned: boolean;
  createdAt: number;
  pinSortAt: number;
}

export interface ProjectGroup {
  project: PluginSidebarProject;
  workspaces: readonly Workspace[];
}

export interface WorkspaceSidebarModel {
  pinned: readonly Workspace[];
  projects: readonly ProjectGroup[];
}

export function workspaceKey(thread: PluginSidebarThread): string {
  const environmentId = thread.environment?.id ?? null;
  return environmentId === null
    ? `thread:${thread.id}`
    : `env:${environmentId}`;
}

function byCreatedAt(
  left: PluginSidebarThread,
  right: PluginSidebarThread,
): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

function buildWorkspace(
  key: string,
  threads: PluginSidebarThread[],
): Workspace | null {
  const visible = threads.filter((thread) => !thread.isHidden);
  const chats = visible
    .filter((thread) => thread.parentThreadId === null)
    .sort(byCreatedAt);
  const primary = chats[0] ?? visible.sort(byCreatedAt)[0];
  if (primary === undefined) return null;
  const pinnedAt = chats.reduce<number | null>(
    (latest, thread) =>
      thread.pinnedAt === null
        ? latest
        : Math.max(latest ?? 0, thread.pinnedAt),
    null,
  );
  return {
    key,
    projectId: primary.projectId,
    environmentId: primary.environment?.id ?? null,
    branchName:
      threads.find((thread) => thread.environment?.branchName)?.environment
        ?.branchName ?? null,
    primary,
    chats: chats.length > 0 ? chats : [primary],
    threads,
    isPinned: chats.some((thread) => thread.isPinned),
    createdAt: primary.createdAt,
    pinSortAt: pinnedAt ?? primary.createdAt,
  };
}

export function buildWorkspaceSidebarModel(
  threads: readonly PluginSidebarThread[],
  projects: readonly PluginSidebarProject[],
): WorkspaceSidebarModel {
  const buckets = new Map<string, PluginSidebarThread[]>();
  for (const thread of threads) {
    if (thread.isArchived) continue;
    const key = workspaceKey(thread);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [thread]);
    else bucket.push(thread);
  }
  const workspaces: Workspace[] = [];
  for (const [key, bucket] of buckets) {
    const workspace = buildWorkspace(key, bucket);
    if (workspace !== null) workspaces.push(workspace);
  }
  const newestFirst = (left: Workspace, right: Workspace) =>
    right.createdAt - left.createdAt || left.key.localeCompare(right.key);
  const pinned = workspaces
    .filter((workspace) => workspace.isPinned)
    .sort(
      (left, right) =>
        right.pinSortAt - left.pinSortAt || left.key.localeCompare(right.key),
    );
  const byProject = new Map<string, Workspace[]>();
  for (const workspace of workspaces) {
    if (workspace.isPinned) continue;
    const list = byProject.get(workspace.projectId);
    if (list === undefined) byProject.set(workspace.projectId, [workspace]);
    else list.push(workspace);
  }
  const groups = projects.map<ProjectGroup>((project) => ({
    project,
    workspaces: (byProject.get(project.id) ?? []).sort(newestFirst),
  }));
  const ordered = [
    ...groups.filter((group) => !group.project.isPersonal),
    ...groups.filter(
      (group) => group.project.isPersonal && group.workspaces.length > 0,
    ),
  ];
  return { pinned, projects: ordered };
}

export function findWorkspaceKeyForThread(
  model: WorkspaceSidebarModel,
  threadId: string | null,
): string | null {
  if (threadId === null) return null;
  const all = [
    ...model.pinned,
    ...model.projects.flatMap((group) => group.workspaces),
  ];
  return (
    all.find((workspace) =>
      workspace.threads.some((thread) => thread.id === threadId),
    )?.key ?? null
  );
}

export function resolveOpenThread(
  workspace: Workspace,
  lastActiveThreadId: string | undefined,
): PluginSidebarThread {
  return (
    workspace.chats.find((thread) => thread.id === lastActiveThreadId) ??
    workspace.primary
  );
}

export function formatLineCount(count: number): string {
  if (count < 1000) return String(count);
  const thousands = count / 1000;
  return `${thousands >= 100 ? Math.round(thousands) : Number(thousands.toFixed(1))}k`;
}
