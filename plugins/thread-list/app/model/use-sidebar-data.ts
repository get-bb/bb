import { useMemo } from "react";
import type { Host } from "@bb/domain";
import {
  experimental_useSidebarThreads,
  type PluginSidebarProject,
  type PluginSidebarSection,
  type PluginSidebarThread,
  type PluginSidebarThreadsState,
} from "@get-bb/plugin-sdk/app";
import { toSidebarThread, type SidebarThread } from "./sidebar-thread.js";

export interface SidebarProject {
  id: string;
  name: string;
  href: string;
  settingsHref: string;
  isPersonal: boolean;
  threads: SidebarThread[];
}

export interface SidebarHost {
  id: string;
  name: string;
}

export interface SidebarData {
  status: PluginSidebarThreadsState["status"];
  sections: readonly PluginSidebarSection[];
  projects: SidebarProject[];
  personalProject: SidebarProject | null;
  hostsById: ReadonlyMap<string, SidebarHost>;
}

export function buildSidebarData(
  status: PluginSidebarThreadsState["status"],
  threads: readonly PluginSidebarThread[],
  projects: readonly PluginSidebarProject[],
  sections: readonly PluginSidebarSection[],
): SidebarData {
  const threadsByProjectId = new Map<string, SidebarThread[]>();
  const hostsById = new Map<string, SidebarHost>();
  for (const thread of threads) {
    const entry = toSidebarThread(thread);
    const bucket = threadsByProjectId.get(entry.projectId);
    if (bucket === undefined) {
      threadsByProjectId.set(entry.projectId, [entry]);
    } else {
      bucket.push(entry);
    }
    if (thread.host !== null && !hostsById.has(thread.host.id)) {
      hostsById.set(thread.host.id, thread.host);
    }
  }
  const groupedProjects = projects.map<SidebarProject>((project) => ({
    id: project.id,
    name: project.name,
    href: project.href,
    settingsHref: project.settingsHref,
    isPersonal: project.isPersonal,
    threads: threadsByProjectId.get(project.id) ?? [],
  }));
  return {
    status,
    sections,
    projects: groupedProjects,
    personalProject:
      groupedProjects.find((project) => project.isPersonal) ?? null,
    hostsById,
  };
}

export function useSidebarProjectName(
  projectId: string | null,
): string | undefined {
  const { projects } = experimental_useSidebarThreads();
  return projectId === null
    ? undefined
    : projects.find((project) => project.id === projectId)?.name;
}

export function useSidebarData(): SidebarData {
  const { status, threads, projects, sections } =
    experimental_useSidebarThreads();
  return useMemo(
    () => buildSidebarData(status, threads, projects, sections),
    [status, threads, projects, sections],
  );
}

export function toMachineHosts(
  hostsById: ReadonlyMap<string, SidebarHost>,
): Host[] {
  return [...hostsById.values()].map(
    (host) => ({ id: host.id, name: host.name }) as Host,
  );
}

export function useSidebarMachineHosts(
  hostsById: ReadonlyMap<string, SidebarHost>,
): Host[] {
  return useMemo(() => toMachineHosts(hostsById), [hostsById]);
}
