import type { Host, ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
import type {
  ProjectResponse,
  SidebarBootstrapResponse,
  ThreadSectionResponse,
} from "@bb/server-contract";
import type { QueryClient } from "@tanstack/react-query";
import {
  allThreadQueryKeyPrefix,
  hostQueryKey,
  hostsQueryKey,
  projectsQueryKey,
  sidebarNavigationQueryKey,
  threadsQueryKey,
} from "../queries/query-keys";
import { applyToCachedThreadListsAndSidebarNavigation } from "./query-cache";
import {
  getCachedThreadLists,
  iterateThreadListCacheEntries,
  restoreCachedThreadLists,
} from "./thread-list-cache-data";

type GroupMutation =
  | { kind: "project" | "section"; id: string; name: string | null }
  | { kind: "host"; id: string; name: string };

function entryMutation<T extends { id: string; name: string }>(
  previous: readonly T[] | undefined,
  id: string,
  name: string | null,
) {
  const index = previous?.findIndex((entry) => entry.id === id) ?? -1;
  const original = previous?.[index];
  return {
    apply: (entries: T[] | undefined) =>
      name === null
        ? entries?.filter((entry) => entry.id !== id)
        : entries?.map((entry) =>
            entry.id === id ? { ...entry, name } : entry,
          ),
    rollback: (entries: T[] | undefined): T[] | undefined => {
      if (!entries || !original) return entries;
      if (name !== null)
        return entries.map((entry) =>
          entry.id === id && entry.name === name
            ? { ...entry, name: original.name }
            : entry,
        );
      if (entries.some((entry) => entry.id === id)) return entries;
      const restored = [...entries];
      restored.splice(Math.min(index, restored.length), 0, original);
      return restored;
    },
  };
}

export async function beginSidebarGroupTransaction({
  queryClient,
  mutation,
}: {
  queryClient: QueryClient;
  mutation: GroupMutation;
}): Promise<{ rollback: () => void; settle: () => void }> {
  const { kind, id, name } = mutation;
  const keys =
    kind === "host"
      ? [hostsQueryKey(), hostQueryKey(id)]
      : [
          sidebarNavigationQueryKey(),
          ...(kind === "project" ? [projectsQueryKey()] : []),
          ...(name === null
            ? [threadsQueryKey(), allThreadQueryKeyPrefix()]
            : []),
        ];
  await Promise.all(
    keys.map((queryKey) => queryClient.cancelQueries({ queryKey })),
  );
  const sidebarKey = sidebarNavigationQueryKey();
  const sidebar =
    queryClient.getQueryData<SidebarBootstrapResponse>(sidebarKey);
  const projects = entryMutation(
    queryClient.getQueryData<ProjectResponse[]>(projectsQueryKey()),
    id,
    name,
  );
  const sidebarProjects = entryMutation(sidebar?.projects, id, name);
  const sections = entryMutation(sidebar?.sections, id, name);
  const hostLists = queryClient
    .getQueriesData<Host[]>({ queryKey: hostsQueryKey() })
    .map(([queryKey, hosts]) => ({
      queryKey,
      mutation: entryMutation(hosts, id, name),
    }));
  const previousHost = queryClient.getQueryData<Host>(hostQueryKey(id));
  const previousLists =
    name === null
      ? getCachedThreadLists(queryClient, {
          queryKey: threadsQueryKey(),
        })
      : [];
  const affectedThreads = new Map<string, ThreadListEntry>();
  if (name === null) {
    for (const thread of [
      ...previousLists.flatMap(({ data }) => [
        ...iterateThreadListCacheEntries(data),
      ]),
      ...(sidebar?.personalProject.threads ?? []),
      ...(sidebar?.projects.flatMap((project) => project.threads) ?? []),
    ]) {
      if (
        kind === "section" ? thread.sectionId === id : thread.projectId === id
      )
        affectedThreads.set(thread.id, thread);
    }
  }
  const previousDetails =
    kind === "section" && name === null
      ? queryClient
          .getQueriesData<ThreadWithRuntime>({
            queryKey: allThreadQueryKeyPrefix(),
          })
          .filter(([, thread]) => thread?.sectionId === id)
      : [];
  const updateGroup = (rollback: boolean) => {
    const operation = rollback ? "rollback" : "apply";
    if (kind === "host") {
      for (const list of hostLists)
        queryClient.setQueryData<Host[]>(
          list.queryKey,
          list.mutation[operation],
        );
      queryClient.setQueryData<Host>(hostQueryKey(id), (host) => {
        if (!host) return host;
        if (!rollback) return { ...host, name };
        return previousHost && host.name === name
          ? { ...host, name: previousHost.name }
          : host;
      });
      return;
    }
    if (kind === "project")
      queryClient.setQueryData<ProjectResponse[]>(
        projectsQueryKey(),
        projects[operation],
      );
    queryClient.setQueryData<SidebarBootstrapResponse>(sidebarKey, (current) =>
      current
        ? {
            ...current,
            ...(kind === "project"
              ? {
                  projects:
                    sidebarProjects[operation](current.projects) ??
                    current.projects,
                }
              : {
                  sections:
                    sections[operation](current.sections) ?? current.sections,
                }),
          }
        : current,
    );
  };
  updateGroup(false);
  if (name === null) {
    applyToCachedThreadListsAndSidebarNavigation(queryClient, (list) =>
      kind === "project"
        ? list.filter((thread) => thread.projectId !== id)
        : list.map((thread) =>
            thread.sectionId === id ? { ...thread, sectionId: null } : thread,
          ),
    );
    for (const [queryKey] of previousDetails)
      queryClient.setQueryData<ThreadWithRuntime>(queryKey, (thread) =>
        thread ? { ...thread, sectionId: null } : thread,
      );
  }
  return {
    rollback: () => {
      updateGroup(true);
      if (name !== null) return;
      if (kind === "project")
        restoreCachedThreadLists(
          queryClient,
          previousLists,
          new Set(affectedThreads.keys()),
        );
      else {
        applyToCachedThreadListsAndSidebarNavigation(queryClient, (list) =>
          list.map((thread) =>
            affectedThreads.has(thread.id) && thread.sectionId === null
              ? { ...thread, sectionId: id }
              : thread,
          ),
        );
        for (const [queryKey] of previousDetails)
          queryClient.setQueryData<ThreadWithRuntime>(queryKey, (thread) =>
            thread?.sectionId === null ? { ...thread, sectionId: id } : thread,
          );
      }
    },
    settle: () => {
      for (const queryKey of keys)
        void queryClient.invalidateQueries({ queryKey });
    },
  };
}

export function applySidebarSectionCreateResult({
  queryClient,
  section,
}: {
  queryClient: QueryClient;
  section: ThreadSectionResponse;
}): void {
  queryClient.setQueryData<SidebarBootstrapResponse>(
    sidebarNavigationQueryKey(),
    (sidebar) =>
      sidebar
        ? {
            ...sidebar,
            sections: sidebar.sections.some(
              (current) => current.id === section.id,
            )
              ? sidebar.sections.map((current) =>
                  current.id === section.id ? section : current,
                )
              : [...sidebar.sections, section],
          }
        : sidebar,
  );
  void queryClient.invalidateQueries({ queryKey: sidebarNavigationQueryKey() });
}
