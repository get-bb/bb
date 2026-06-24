import { describe, expect, it } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  archivedThreadsListQueryKey,
  threadListQueryKey,
} from "../queries/query-keys";
import {
  getCachedGlobalThreadListInvalidationQueryKeys,
  getCachedProjectThreadListInvalidationQueryKeys,
} from "./query-cache";

describe("query cache thread list invalidation keys", () => {
  it("includes archived folder and unfiled lists in global invalidation", () => {
    const { queryClient } = createQueryClientTestHarness();
    const folderArchivedKey = archivedThreadsListQueryKey({
      folderId: "fld_work",
    });
    const unfiledArchivedKey = archivedThreadsListQueryKey({ unfiled: true });
    const projectArchivedKey = archivedThreadsListQueryKey({
      projectId: "proj_1",
    });

    queryClient.setQueryData(folderArchivedKey, { pages: [], pageParams: [] });
    queryClient.setQueryData(unfiledArchivedKey, { pages: [], pageParams: [] });
    queryClient.setQueryData(projectArchivedKey, { pages: [], pageParams: [] });

    const queryKeys = getCachedGlobalThreadListInvalidationQueryKeys({
      queryClient,
    });

    expect(queryKeys).toContainEqual(folderArchivedKey);
    expect(queryKeys).toContainEqual(unfiledArchivedKey);
    expect(queryKeys).not.toContainEqual(projectArchivedKey);
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
