import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  sidebarNavigationQueryKey,
  threadListQueryKey,
  threadPendingInteractionsQueryKey,
} from "@/lib/query/query-keys";
import {
  approvalInteraction,
  project,
  sidebarBootstrap,
  threadListEntry,
  userQuestionInteraction,
} from "../test/fixtures";
import { getCachedSidebarThreads } from "../threads/thread-list-cache";
import { applyInteractionResult } from "./interaction-cache";
import {
  collectChildThreadPendingAttention,
  pendingChildThreadIds,
} from "./child-thread-pending-interactions";

function seed() {
  const queryClient = new QueryClient();
  const a = approvalInteraction({ id: "ia", createdAt: 10 });
  const q = userQuestionInteraction({ id: "iq", createdAt: 20 });
  queryClient.setQueryData(threadPendingInteractionsQueryKey("t1"), [a, q]);
  const entry = threadListEntry({ id: "t1", hasPendingInteraction: true });
  queryClient.setQueryData(threadListQueryKey({ archived: false }), [entry]);
  queryClient.setQueryData(
    sidebarNavigationQueryKey(),
    sidebarBootstrap({
      projects: [project({ id: "proj_1", threads: [entry] })],
    }),
  );
  return { queryClient, a, q };
}

describe("applyInteractionResult", () => {
  it("replaces a resolving interaction in place", () => {
    const { queryClient, a, q } = seed();
    applyInteractionResult(queryClient, {
      ...a,
      status: "resolving",
      resolution: { decision: "allow_once", grantedPermissions: null },
    });
    const list = queryClient.getQueryData<(typeof a)[]>(
      threadPendingInteractionsQueryKey("t1"),
    );
    expect(list?.map((i) => [i.id, i.status])).toEqual([
      ["ia", "resolving"],
      ["iq", "pending"],
    ]);
    expect(getCachedSidebarThreads(queryClient)[0]?.hasPendingInteraction).toBe(
      true,
    );
    expect(q.status).toBe("pending");
  });

  it("removes a resolved interaction and clears the list flag once none remain", () => {
    const { queryClient, a, q } = seed();
    applyInteractionResult(queryClient, { ...a, status: "resolved" });
    expect(getCachedSidebarThreads(queryClient)[0]?.hasPendingInteraction).toBe(
      true,
    );
    applyInteractionResult(queryClient, { ...q, status: "interrupted" });
    expect(
      queryClient.getQueryData(threadPendingInteractionsQueryKey("t1")),
    ).toEqual([]);
    expect(getCachedSidebarThreads(queryClient)[0]?.hasPendingInteraction).toBe(
      false,
    );
    expect(
      queryClient.getQueryData<{ hasPendingInteraction: boolean }[]>(
        threadListQueryKey({ archived: false }),
      )?.[0]?.hasPendingInteraction,
    ).toBe(false);
  });

  it("leaves an unloaded list alone", () => {
    const queryClient = new QueryClient();
    applyInteractionResult(
      queryClient,
      approvalInteraction({ id: "x", status: "resolving" }),
    );
    expect(
      queryClient.getQueryData(threadPendingInteractionsQueryKey("t1")),
    ).toBeUndefined();
  });
});

describe("child thread pending attention", () => {
  it("only fetches flagged children and picks their latest interaction", () => {
    const children = [
      { id: "c1", title: "Child 1", hasPendingInteraction: true },
      { id: "c2", title: "Child 2", hasPendingInteraction: false },
      { id: "c3", title: "Child 3", hasPendingInteraction: true },
    ];
    expect(pendingChildThreadIds(children)).toEqual(["c1", "c3"]);
    const older = approvalInteraction({
      id: "old",
      threadId: "c1",
      createdAt: 1,
    });
    const newer = userQuestionInteraction({
      id: "new",
      threadId: "c1",
      createdAt: 2,
    });
    const items = collectChildThreadPendingAttention(
      children,
      new Map([
        ["c1", [older, newer]],
        ["c3", undefined],
      ]),
    );
    expect(items).toEqual([
      { childThreadId: "c1", childTitle: "Child 1", interaction: newer },
    ]);
  });
});
