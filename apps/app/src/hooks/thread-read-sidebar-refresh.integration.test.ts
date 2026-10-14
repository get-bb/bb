import { MutationObserver, QueryObserver } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { createAppQueryClient } from "@/lib/query-client";
import { sdk } from "@/lib/sdk";
import {
  makeSidebarBootstrapResponse,
  makeProjectWithThreadsResponse,
} from "@/test/fixtures/projects";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import {
  markThreadReadMutationOptions,
  markThreadUnreadMutationOptions,
} from "./mutations/thread-state-mutations";
import { sidebarNavigationQueryKey } from "./queries/query-keys";
import { createRealtimeCacheEffects } from "./realtime-cache-effects";

vi.mock("@/lib/sdk", () => ({
  sdk: { threads: { markRead: vi.fn(), markUnread: vi.fn() } },
}));

afterEach(() => {
  vi.resetAllMocks();
});

it.each(
  (["read", "unread"] as const).flatMap((mode) =>
    [false, true].flatMap((fails) =>
      [false, true].map((refreshing) => ({ mode, fails, refreshing })),
    ),
  ),
)(
  "preserves sidebar refreshes when marking $mode (fails=$fails, refreshing=$refreshing)",
  async ({ mode, fails, refreshing }) => {
    const queryClient = createAppQueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: Infinity, retry: false },
      },
      showMutationErrorToasts: false,
    });
    const parent = makeThreadListEntry({
      id: "parent",
      projectId: "project",
      lastReadAt: null,
    });
    const child = makeThreadListEntry({
      id: "child",
      projectId: "project",
      parentThreadId: parent.id,
    });
    const bootstrap = (threads: (typeof parent)[]) =>
      makeSidebarBootstrapResponse({
        projects: [makeProjectWithThreadsResponse({ id: "project", threads })],
      });
    queryClient.setQueryData(sidebarNavigationQueryKey(), bootstrap([parent]));
    const signals: AbortSignal[] = [];
    const fetchSidebar = vi.fn(({ signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      return signals.length === 1
        ? new Promise<ReturnType<typeof bootstrap>>(() => {})
        : Promise.resolve(bootstrap([parent, child]));
    });
    vi.mocked(sdk.threads.markRead).mockResolvedValue(
      makeThreadResponse({ id: parent.id, projectId: parent.projectId }),
    );
    vi.mocked(sdk.threads.markUnread).mockResolvedValue(
      makeThreadResponse({
        id: parent.id,
        projectId: parent.projectId,
        lastReadAt: null,
      }),
    );
    const failure = new Error("Read state request failed");
    if (fails) {
      vi.mocked(sdk.threads.markRead).mockRejectedValue(failure);
      vi.mocked(sdk.threads.markUnread).mockRejectedValue(failure);
    }
    const sidebar = new QueryObserver(queryClient, {
      queryKey: sidebarNavigationQueryKey(),
      queryFn: fetchSidebar,
      staleTime: Infinity,
    });
    const unsubscribe = sidebar.subscribe(() => {});
    const mutation = new MutationObserver(
      queryClient,
      mode === "read"
        ? markThreadReadMutationOptions(queryClient)
        : markThreadUnreadMutationOptions(queryClient),
    );
    const effects = createRealtimeCacheEffects({ queryClient });
    try {
      if (refreshing) {
        effects.handleChanged({
          type: "changed",
          entity: "thread",
          id: child.id,
          changes: ["thread-created"],
          metadata: { projectId: parent.projectId },
        });
        await vi.waitFor(() => expect(fetchSidebar).toHaveBeenCalledTimes(1));
      }
      const marking = mutation.mutate({ threadId: parent.id });
      if (fails) await expect(marking).rejects.toBe(failure);
      else await marking;
      if (refreshing) expect(signals[0]?.aborted).toBe(true);
      await vi.waitFor(() =>
        expect(
          sidebar
            .getCurrentResult()
            .data?.projects[0]?.threads.map((thread) => thread.id),
        ).toEqual(refreshing ? [parent.id, child.id] : [parent.id]),
      );
      expect(fetchSidebar).toHaveBeenCalledTimes(refreshing ? 2 : 0);
    } finally {
      effects.dispose();
      unsubscribe();
      queryClient.clear();
    }
  },
);
