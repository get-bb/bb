import type { QueryKey } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  ARCHIVED_THREADS_LIST_KIND,
  THREADS_QUERY_KEY,
  archivedThreadsListQueryKey,
  threadListQueryKey,
} from "../queries/query-keys";
import {
  getCachedGlobalThreadListInvalidationQueryKeys,
  getCachedProjectThreadListInvalidationQueryKeys,
} from "./query-cache";

describe("query cache thread list invalidation keys", () => {
  it("includes global archived lists in global invalidation", () => {
    const { queryClient } = createQueryClientTestHarness();
    const projectArchivedKey = archivedThreadsListQueryKey({
      projectId: "proj_1",
    });
    const globalArchivedKey = archivedThreadsListQueryKey({});
    const globalChildArchivedKey = archivedThreadsListQueryKey({
      kind: "child",
    });

    queryClient.setQueryData(projectArchivedKey, { pages: [], pageParams: [] });
    queryClient.setQueryData(globalArchivedKey, { pages: [], pageParams: [] });
    queryClient.setQueryData(globalChildArchivedKey, {
      pages: [],
      pageParams: [],
    });

    const queryKeys = getCachedGlobalThreadListInvalidationQueryKeys({
      queryClient,
    });

    expect(queryKeys).toContainEqual(globalArchivedKey);
    expect(queryKeys).toContainEqual(globalChildArchivedKey);
    expect(queryKeys).not.toContainEqual(projectArchivedKey);
  });

  it("excludes archived list keys with unsupported scope filters", () => {
    const { queryClient } = createQueryClientTestHarness();
    const folderArchivedKey: QueryKey = [
      THREADS_QUERY_KEY,
      ARCHIVED_THREADS_LIST_KIND,
      { folderId: "fld_work" },
    ];
    const unfiledArchivedKey: QueryKey = [
      THREADS_QUERY_KEY,
      ARCHIVED_THREADS_LIST_KIND,
      { unfiled: true },
    ];

    queryClient.setQueryData(folderArchivedKey, { pages: [], pageParams: [] });
    queryClient.setQueryData(unfiledArchivedKey, { pages: [], pageParams: [] });

    const queryKeys = getCachedGlobalThreadListInvalidationQueryKeys({
      queryClient,
    });

    expect(queryKeys).not.toContainEqual(folderArchivedKey);
    expect(queryKeys).not.toContainEqual(unfiledArchivedKey);
  });

  it("includes archived project lists in project invalidation", () => {
    const { queryClient } = createQueryClientTestHarness();
    const projectArchivedKey = archivedThreadsListQueryKey({
      projectId: "proj_1",
    });
    const projectThreadListKey = threadListQueryKey({
      archived: false,
      projectId: "proj_1",
    });
    const otherProjectArchivedKey = archivedThreadsListQueryKey({
      projectId: "proj_2",
    });

    queryClient.setQueryData(projectArchivedKey, { pages: [], pageParams: [] });
    queryClient.setQueryData(projectThreadListKey, []);
    queryClient.setQueryData(otherProjectArchivedKey, {
      pages: [],
      pageParams: [],
    });

    const queryKeys = getCachedProjectThreadListInvalidationQueryKeys({
      projectId: "proj_1",
      queryClient,
    });

    expect(queryKeys).toContainEqual(projectArchivedKey);
    expect(queryKeys).toContainEqual(projectThreadListKey);
    expect(queryKeys).not.toContainEqual(otherProjectArchivedKey);
  });
});
