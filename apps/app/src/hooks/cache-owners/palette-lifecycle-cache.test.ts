import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import {
  threadListQueryKey,
  threadSearchQueryKey,
} from "../queries/query-keys";
import {
  getCachedGlobalThreadListInvalidationQueryKeys,
  optimisticallyInsertThread,
} from "./query-cache";
import {
  applyQueuedMessageDeleteResult,
  applyThreadGoalClearResult,
} from "./thread-runtime-cache-owner";

const draftKey = threadListQueryKey({
  archived: false,
  lifecycles: ["draft"],
  limit: 20,
});

describe("palette lifecycle caches", () => {
  it("leaves bounded recent populations to the server instead of injecting an optimistic thread", () => {
    const queryClient = new QueryClient();
    const drafts = Array.from({ length: 20 }, (_, index) =>
      makeThreadListEntry({ id: `draft-${index}`, lifecycle: "draft" }),
    );
    queryClient.setQueryData(draftKey, drafts);
    const thread = makeThreadResponse({
      id: "new-thread",
      status: "pending",
      queuedMessageCount: 1,
    });
    optimisticallyInsertThread(queryClient, thread);
    optimisticallyInsertThread(queryClient, thread, "draft");
    expect(queryClient.getQueryData(draftKey)).toEqual(drafts);
  });

  it("includes recent lifecycle lists in global and queued-message membership refreshes", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(draftKey, []);
    expect(
      getCachedGlobalThreadListInvalidationQueryKeys({ queryClient }),
    ).toContainEqual(draftKey);
    applyQueuedMessageDeleteResult({ queryClient, threadId: "draft" });
    expect(queryClient.getQueryState(draftKey)?.isInvalidated).toBe(true);
  });

  it("preserves the draft search group when another result's goal is cleared", () => {
    const queryClient = new QueryClient();
    const key = threadSearchQueryKey({
      query: "match",
      lifecycles: ["active", "draft"],
      limitPerGroup: 20,
    });
    const draft = {
      total: 1,
      results: [
        {
          thread: makeThreadListEntry({ id: "draft", lifecycle: "draft" }),
          matches: [],
        },
      ],
    };
    queryClient.setQueryData(key, {
      active: {
        total: 1,
        results: [
          { thread: makeThreadListEntry({ id: "active" }), matches: [] },
        ],
      },
      draft,
      archived: { total: 0, results: [] },
    });
    applyThreadGoalClearResult({ queryClient, threadId: "active" });
    expect(queryClient.getQueryData(key)).toMatchObject({ draft });
  });
});
