import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { archivedThreadsListQueryKey } from "../queries/query-keys";
import {
  beginUnarchiveThreadTransaction,
  rollbackThreadListMutationTransaction,
} from "./thread-state-cache-owner";

describe("sidebar archive cache", () => {
  it("restores archived hierarchy metadata after an unsuccessful optimistic restore", async () => {
    const queryClient = new QueryClient();
    const archivedKey = archivedThreadsListQueryKey({});
    const archived = makeThreadListEntry({
      id: "archived",
      projectId: "project-1",
      archivedAt: 1,
      sectionId: "section-1",
      pinnedAt: 1,
      pinSortKey: "a0",
      environmentId: "environment-1",
      environmentHostId: "host-1",
    });
    const pages = { pages: [[archived]], pageParams: [0] };
    queryClient.setQueryData(archivedKey, pages);
    const transaction = await beginUnarchiveThreadTransaction({
      queryClient,
      threadId: archived.id,
    });
    expect(queryClient.getQueryData(archivedKey)).toMatchObject({ pages: [[]] });
    rollbackThreadListMutationTransaction({
      queryClient,
      threadId: archived.id,
      transaction,
    });
    expect(queryClient.getQueryData(archivedKey)).toEqual(pages);
  });
});
