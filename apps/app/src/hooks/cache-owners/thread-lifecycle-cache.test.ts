import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
import { archivedThreadsListQueryKey, sidebarNavigationQueryKey } from "../queries/query-keys";
import {
  beginUnarchiveThreadTransaction,
  rollbackThreadListMutationTransaction,
} from "./thread-state-cache-owner";

describe("sidebar archive cache", () => {
  it.each(["project-1", "proj_personal"])(
    "keeps a restored row in its sidebar hierarchy before the server responds (%s)",
    async (projectId) => {
      const queryClient = new QueryClient();
      const archivedKey = archivedThreadsListQueryKey({});
      const archived = makeThreadListEntry({
        id: "archived",
        projectId,
        archivedAt: 100,
        parentThreadId: "parent",
        sectionId: "section-1",
        pinnedAt: 10,
        pinSortKey: "a0",
        environmentId: "environment-1",
        environmentHostId: "host-1",
        latestAttentionAt: 20,
        createdAt: 5,
      });
      const neighbor = makeThreadListEntry({ id: "parent", projectId });
      const navigation = makeSidebarBootstrapResponse({
        projects: [makeProjectWithThreadsResponse({
          id: "project-1",
          threads: projectId === "project-1" ? [neighbor] : [],
        })],
        personalProject: makeProjectWithThreadsResponse({
          id: "proj_personal",
          kind: "personal",
          threads: projectId === "proj_personal" ? [neighbor] : [],
        }),
      });
      const pages = { pages: [[archived]], pageParams: [0] };
      queryClient.setQueryData(archivedKey, pages);
      queryClient.setQueryData(sidebarNavigationQueryKey(), navigation);

      const transaction = await beginUnarchiveThreadTransaction({
        queryClient,
        threadId: archived.id,
      });

      const next = queryClient.getQueryData<typeof navigation>(sidebarNavigationQueryKey())!;
      const destination = projectId === "proj_personal" ? next.personalProject : next.projects[0];
      const other = projectId === "proj_personal" ? next.projects[0] : next.personalProject;
      expect(destination?.threads).toEqual([neighbor, { ...archived, archivedAt: null }]);
      expect(other?.threads).toEqual([]);
      expect(queryClient.getQueryData(archivedKey)).toMatchObject({ pages: [[]] });

      rollbackThreadListMutationTransaction({ queryClient, threadId: archived.id, transaction });
      expect(queryClient.getQueryData(sidebarNavigationQueryKey())).toEqual(navigation);
      expect(queryClient.getQueryData(archivedKey)).toEqual(pages);
    },
  );
});
