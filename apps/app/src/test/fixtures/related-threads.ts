import type { QueryClient } from "@tanstack/react-query";
import type { ThreadListEntry } from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { sidebarNavigationQueryKey } from "@/hooks/queries/query-keys";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";

export interface RelatedThreadFixture {
  threadId: string;
  projectId: string;
  related: { id: string; title: string; relationship: "parent" | "fork" };
}

export function addSidebarThreads(
  queryClient: QueryClient,
  projectId: string,
  threads: readonly ThreadListEntry[],
): void {
  queryClient.setQueryData<SidebarBootstrapResponse>(
    sidebarNavigationQueryKey(),
    (current) => {
      const base =
        current ?? makeSidebarBootstrapResponse({ projects: [] });
      const ids = new Set(threads.map((thread) => thread.id));
      const existing = base.projects.find(
        (project) => project.id === projectId,
      );
      const project = makeProjectWithThreadsResponse({
        ...existing,
        id: projectId,
        threads: [
          ...(existing?.threads ?? []).filter((thread) => !ids.has(thread.id)),
          ...threads,
        ],
      });
      return {
        ...base,
        projects: [
          ...base.projects.filter((candidate) => candidate.id !== projectId),
          project,
        ],
      };
    },
  );
}

export function seedRelatedThread(
  queryClient: QueryClient,
  { threadId, projectId, related }: RelatedThreadFixture,
): void {
  const isFork = related.relationship === "fork";
  addSidebarThreads(queryClient, projectId, [
    makeThreadListEntry({
      id: threadId,
      projectId,
      parentThreadId: isFork ? null : related.id,
      sourceThreadId: isFork ? related.id : null,
      originKind: isFork ? "fork" : null,
    }),
    makeThreadListEntry({ id: related.id, projectId, title: related.title }),
  ]);
}
