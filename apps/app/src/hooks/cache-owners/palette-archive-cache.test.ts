import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { threadListQueryKey } from "../queries/query-keys";
import {
  getCachedGlobalThreadListInvalidationQueryKeys,
  optimisticallyInsertThread,
} from "./query-cache";

describe("palette archive cache", () => {
  it("keeps bounded recents server-owned and included in list invalidation", () => {
    const queryClient = new QueryClient();
    const key = threadListQueryKey({ archived: true, limit: 20 });
    const archived = Array.from({ length: 20 }, (_, index) =>
      makeThreadListEntry({ id: `archived-${index}`, archivedAt: 1 }),
    );
    queryClient.setQueryData(key, archived);
    optimisticallyInsertThread(queryClient, makeThreadResponse({ id: "new" }));
    expect(queryClient.getQueryData(key)).toEqual(archived);
    expect(
      getCachedGlobalThreadListInvalidationQueryKeys({ queryClient }),
    ).toContainEqual(key);
  });
});
