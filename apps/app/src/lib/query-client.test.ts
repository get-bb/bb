// @vitest-environment jsdom

import { QueryObserver } from "@tanstack/react-query";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  threadConversationOutlineQueryKey,
  threadDefaultExecutionOptionsQueryKey,
  threadDetailBootstrapQueryKey,
  threadPendingInteractionsQueryKey,
  threadPromptHistoryQueryKey,
  threadQueryKey,
  threadQueuedMessagesQueryKey,
  threadSearchQueryKey,
  threadTimelineQueryKey,
} from "@/hooks/queries/query-keys";
import {
  createAppQueryClient,
  installAppQueryClientBrowserEvents,
} from "./query-client";

interface ObservedQuery {
  queryFn: ReturnType<typeof vi.fn<() => Promise<string>>>;
  unsubscribe: () => void;
}

function observeIdleQuery(
  queryClient: QueryClient,
  queryKey: QueryKey,
): ObservedQuery {
  const queryFn = vi.fn<() => Promise<string>>().mockResolvedValue("loaded");
  const observer = new QueryObserver(queryClient, {
    queryKey,
    queryFn,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  return {
    queryFn,
    unsubscribe: observer.subscribe(() => {}),
  };
}

async function waitForQueryCalls(
  queries: readonly ObservedQuery[],
  expectedCallCount: number,
): Promise<void> {
  await vi.waitFor(() => {
    for (const query of queries) {
      expect(query.queryFn).toHaveBeenCalledTimes(expectedCallCount);
    }
  });
}

describe("createAppQueryClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refetches active failed queries after a mobile history restore", async () => {
    const queryClient = createAppQueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
      showMutationErrorToasts: false,
    });
    queryClient.mount();

    const queryFn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("mobile page restore interrupted fetch"))
      .mockResolvedValueOnce("loaded");
    const observer = new QueryObserver(queryClient, {
      queryKey: ["mobile-restore"],
      queryFn,
      refetchOnWindowFocus: true,
      staleTime: 60_000,
    });
    const unsubscribe = observer.subscribe(() => {});

    await vi.waitFor(() => {
      expect(observer.getCurrentResult().isError).toBe(true);
    });

    window.dispatchEvent(new Event("pageshow"));

    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(2);
      expect(observer.getCurrentResult().data).toBe("loaded");
    });

    unsubscribe();
    queryClient.unmount();
    queryClient.clear();
  });

  it("cancels active query fetches before mobile page suspension can fail them", async () => {
    const queryClient = createAppQueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
      showMutationErrorToasts: false,
    });
    const lifecycleEvents = installAppQueryClientBrowserEvents(queryClient);
    queryClient.mount();

    const signals: AbortSignal[] = [];
    const resolveFetches: Array<(value: string) => void> = [];
    const queryFn = vi.fn(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<string>((resolve, reject) => {
          signals.push(signal);
          resolveFetches.push(resolve);
          signal.addEventListener(
            "abort",
            () => {
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        }),
    );
    const observer = new QueryObserver(queryClient, {
      queryKey: ["mobile-suspend"],
      queryFn,
      refetchOnWindowFocus: true,
      staleTime: 60_000,
    });
    const unsubscribe = observer.subscribe(() => {});

    await vi.waitFor(() => {
      expect(observer.getCurrentResult().fetchStatus).toBe("fetching");
    });

    window.dispatchEvent(new Event("pagehide"));

    await vi.waitFor(() => {
      expect(signals[0]?.aborted).toBe(true);
      expect(observer.getCurrentResult().isError).toBe(false);
      expect(observer.getCurrentResult().fetchStatus).toBe("idle");
    });

    window.dispatchEvent(new Event("pageshow"));

    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(2);
    });

    resolveFetches[1]?.("loaded");

    await vi.waitFor(() => {
      expect(observer.getCurrentResult().data).toBe("loaded");
    });

    unsubscribe();
    lifecycleEvents.cleanup();
    queryClient.unmount();
    queryClient.clear();
  });

  it("refetches the active thread bundle together after a pageshow resume with missed websocket events", async () => {
    const queryClient = createAppQueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
      showMutationErrorToasts: false,
    });
    const lifecycleEvents = installAppQueryClientBrowserEvents(queryClient);
    queryClient.mount();

    const activeThreadQueries = [
      observeIdleQuery(queryClient, threadQueryKey("thread-1")),
      observeIdleQuery(queryClient, threadDetailBootstrapQueryKey("thread-1")),
      observeIdleQuery(
        queryClient,
        threadDefaultExecutionOptionsQueryKey("thread-1"),
      ),
      observeIdleQuery(queryClient, threadQueuedMessagesQueryKey("thread-1")),
      observeIdleQuery(queryClient, threadPromptHistoryQueryKey("thread-1")),
      observeIdleQuery(
        queryClient,
        threadPendingInteractionsQueryKey("thread-1"),
      ),
      observeIdleQuery(queryClient, threadTimelineQueryKey("thread-1")),
      observeIdleQuery(
        queryClient,
        threadConversationOutlineQueryKey("thread-1"),
      ),
    ];
    const unrelatedQuery = observeIdleQuery(
      queryClient,
      threadSearchQueryKey({ limitPerGroup: 20, query: "needle" }),
    );

    await waitForQueryCalls(activeThreadQueries, 1);
    await waitForQueryCalls([unrelatedQuery], 1);

    // Simulates phone lock/backgrounding while websocket events are missed.
    // The active thread bundle catches up as one unit on resume even though
    // each observer has staleTime=Infinity and focus refetch disabled.
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pageshow"));

    await waitForQueryCalls(activeThreadQueries, 2);
    expect(unrelatedQuery.queryFn).toHaveBeenCalledTimes(1);

    for (const query of activeThreadQueries) {
      query.unsubscribe();
    }
    unrelatedQuery.unsubscribe();
    lifecycleEvents.cleanup();
    queryClient.unmount();
    queryClient.clear();
  });

  it("treats focus after browser suspension as an active thread resume signal", async () => {
    const queryClient = createAppQueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
      showMutationErrorToasts: false,
    });
    const lifecycleEvents = installAppQueryClientBrowserEvents(queryClient);
    queryClient.mount();

    const queuedMessagesQuery = observeIdleQuery(
      queryClient,
      threadQueuedMessagesQueryKey("thread-1"),
    );
    const timelineQuery = observeIdleQuery(
      queryClient,
      threadTimelineQueryKey("thread-1"),
    );
    const activeThreadQueries = [queuedMessagesQuery, timelineQuery];

    await waitForQueryCalls(activeThreadQueries, 1);

    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));

    await waitForQueryCalls(activeThreadQueries, 2);

    queuedMessagesQuery.unsubscribe();
    timelineQuery.unsubscribe();
    lifecycleEvents.cleanup();
    queryClient.unmount();
    queryClient.clear();
  });
});
