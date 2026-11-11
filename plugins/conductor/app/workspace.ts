import type {
  PluginSidebarProject,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { workspaceChats } from "./tabs/model.js";

export interface WorkspaceSummary {
  environmentId: string;
  projectId: string;
  projectName: string;
  label: string;
  branchName: string | null;
  chats: PluginSidebarThread[];
}

const THREAD_ID_SUFFIX = /-thr_[a-z0-9]+$/;

export function shortBranchName(branchName: string): string {
  const leaf = branchName.slice(branchName.lastIndexOf("/") + 1);
  const trimmed = leaf.replace(THREAD_ID_SUFFIX, "");
  return trimmed.length > 0 ? trimmed : leaf;
}

function pathLeaf(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.at(-1) ?? path;
}

export function workspaceLabel(
  environment: NonNullable<PluginSidebarThread["environment"]>,
): string | null {
  if (environment.name !== null && environment.name.trim().length > 0) {
    return environment.name;
  }
  if (environment.branchName !== null) {
    return shortBranchName(environment.branchName);
  }
  return environment.path === null ? null : pathLeaf(environment.path);
}

export function projectDisplayName(project: PluginSidebarProject): string {
  return project.isPersonal ? "Personal" : project.name;
}

export function findWorkspace(
  threads: readonly PluginSidebarThread[],
  projects: readonly PluginSidebarProject[],
  environmentId: string,
  currentThreadId: string | null,
): WorkspaceSummary | null {
  const chats = workspaceChats(threads, environmentId, currentThreadId);
  const anchor =
    chats[0] ??
    threads.find((thread) => thread.environment?.id === environmentId);
  if (anchor === undefined || anchor.environment === null) return null;
  const project = projects.find((entry) => entry.id === anchor.projectId);
  return {
    environmentId,
    projectId: anchor.projectId,
    projectName:
      project === undefined ? anchor.projectId : projectDisplayName(project),
    label: workspaceLabel(anchor.environment) ?? environmentId,
    branchName: anchor.environment.branchName,
    chats,
  };
}
