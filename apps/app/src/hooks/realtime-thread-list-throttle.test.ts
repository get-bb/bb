import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { createRealtimeCacheEffects } from "./realtime-cache-effects";
import {
  sidebarNavigationQueryKey,
  threadListQueryKey,
} from "./queries/query-keys";

afterEach(() => {
  vi.useRealTimers();
});

it.each([
  "thread-created",
  "thread-deleted",
  "history-rewritten",
  "title-changed",
  "queue-changed",
  "archived-changed",
  "pin-state-changed",
  "parent-changed",
  "environment-changed",
  "read-state-changed",
  "events-appended",
] as const)(
  "coalesces %s list reads with a trailing refresh",
  async (change) => {
    vi.useFakeTimers();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    });
    const effects = createRealtimeCacheEffects({ queryClient });
    let revision = 0;
    const keys = [
      sidebarNavigationQueryKey(),
      threadListQueryKey({ archived: false }),
      threadListQueryKey({ archived: false, projectId: "project-1" }),
      threadListQueryKey({
        archived: false,
        projectId: "project-1",
        sourceThreadId: "thr_parent",
        originKind: "fork",
      }),
    ];
    const reads = keys.map(() => vi.fn(async () => revision));
    const observers = keys.map(
      (queryKey, index) =>
        new QueryObserver(queryClient, {
          queryKey,
          queryFn: reads[index],
          staleTime: Infinity,
        }),
    );
    const stops = observers.map((observer) => observer.subscribe(() => {}));
    const inactiveKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
      sourceThreadId: "thr_inactive",
    });
    queryClient.setQueryData(inactiveKey, 0);
    try {
      await vi.advanceTimersByTimeAsync(0);
      for (const read of reads) {
        read.mockClear();
      }
      for (revision = 1; revision <= 4; revision += 1) {
        effects.handleChanged({
          type: "changed",
          entity: "thread",
          id: "thr_child",
          changes: [change],
          metadata: { projectId: "project-1", backgroundActivityChanged: true },
        });
        await vi.advanceTimersByTimeAsync(200);
      }
      for (const read of reads) {
        expect(read).toHaveBeenCalledTimes(1);
      }
      expect(queryClient.getQueryState(inactiveKey)?.isInvalidated).toBe(true);
      await vi.advanceTimersByTimeAsync(300);
      for (const read of reads) {
        expect(read).toHaveBeenCalledTimes(2);
      }
      for (const observer of observers) {
        expect(observer.getCurrentResult().data).toBe(revision);
      }
      revision += 1;
      effects.handleChanged({
        type: "changed",
        entity: "thread",
        id: "thr_child",
        changes: [change],
        metadata: { projectId: "project-1", backgroundActivityChanged: true },
      });
      await vi.advanceTimersByTimeAsync(200);
      effects.dispose();
      await vi.advanceTimersByTimeAsync(2_000);
      for (const read of reads) {
        expect(read).toHaveBeenCalledTimes(2);
      }
    } finally {
      for (const stop of stops) {
        stop();
      }
      effects.dispose();
      queryClient.clear();
    }
  },
);
