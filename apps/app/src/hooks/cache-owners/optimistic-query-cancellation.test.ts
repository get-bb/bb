import {
  MutationObserver,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { cancelOptimisticQueries } from "./optimistic-query-cancellation";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });
  const queryKey = ["queue"];
  queryClient.setQueryData(queryKey, ["delivered"]);
  const interrupted = deferred<string[]>();
  const signals: AbortSignal[] = [];
  const queryFn = vi.fn(({ signal }: { signal: AbortSignal }) => {
    signals.push(signal);
    return signals.length === 1 ? interrupted.promise : Promise.resolve([]);
  });
  const observer = new QueryObserver(queryClient, { queryKey, queryFn });
  const unsubscribe = observer.subscribe(() => {});
  return { queryClient, queryKey, queryFn, signals, unsubscribe, observer };
}

describe("optimistic query cancellation", () => {
  it.each(["success", "error"] as const)(
    "recovers an interrupted refresh after %s callbacks finish",
    async (outcome) => {
      const f = fixture();
      const write = deferred<void>();
      const settlement = deferred<void>();
      const mutation = new MutationObserver(f.queryClient, {
        mutationFn: () => write.promise,
        onMutate: async () => {
          await cancelOptimisticQueries(f.queryClient, {
            queryKey: f.queryKey,
          });
          f.queryClient.setQueryData(f.queryKey, ["optimistic"]);
        },
        onSettled: async () => {
          await settlement.promise;
          f.queryClient.setQueryData(f.queryKey, ["stale snapshot"]);
        },
      });
      try {
        void f.queryClient.invalidateQueries({ queryKey: f.queryKey });
        const result = mutation.mutate().catch((error: Error) => error);
        await vi.waitFor(() =>
          expect(f.queryClient.getQueryData(f.queryKey)).toEqual([
            "optimistic",
          ]),
        );
        expect(f.signals[0]?.aborted).toBe(true);
        if (outcome === "success") write.resolve();
        else write.reject(new Error("write failed"));
        await Promise.resolve();
        expect(f.queryFn).toHaveBeenCalledTimes(1);
        settlement.resolve();
        await result;
        await vi.waitFor(() =>
          expect(f.queryClient.getQueryData(f.queryKey)).toEqual([]),
        );
        expect(f.queryFn).toHaveBeenCalledTimes(2);
      } finally {
        f.unsubscribe();
        f.queryClient.clear();
      }
    },
  );

  it("waits for overlapping mutations of the interrupted query but not later unrelated writes", async () => {
    const f = fixture();
    const first = deferred<void>();
    const second = deferred<void>();
    const unrelated = deferred<void>();
    const write = (completion: Promise<void>) =>
      new MutationObserver(f.queryClient, {
        mutationFn: () => completion,
        onMutate: async () => {
          await cancelOptimisticQueries(f.queryClient, {
            queryKey: f.queryKey,
          });
          f.queryClient.setQueryData(f.queryKey, ["optimistic"]);
        },
        onSettled: () => {
          f.queryClient.setQueryData(f.queryKey, ["stale snapshot"]);
        },
      });
    try {
      void f.queryClient.invalidateQueries({ queryKey: f.queryKey });
      const a = write(first.promise).mutate();
      await vi.waitFor(() => expect(f.signals[0]?.aborted).toBe(true));
      const b = write(second.promise).mutate();
      const c = new MutationObserver(f.queryClient, {
        mutationFn: () => unrelated.promise,
      }).mutate();
      first.resolve();
      await a;
      expect(f.queryFn).toHaveBeenCalledTimes(1);
      second.resolve();
      await b;
      await vi.waitFor(() =>
        expect(f.queryClient.getQueryData(f.queryKey)).toEqual([]),
      );
      expect(f.queryClient.isMutating()).toBe(1);
      unrelated.resolve();
      await c;
      expect(f.queryFn).toHaveBeenCalledTimes(2);
    } finally {
      f.unsubscribe();
      f.queryClient.clear();
    }
  });

  it("marks an inactive interrupted query stale for its next mount", async () => {
    const f = fixture();
    const completion = deferred<void>();
    const mutation = new MutationObserver(f.queryClient, {
      mutationFn: () => completion.promise,
      onMutate: () =>
        cancelOptimisticQueries(f.queryClient, { queryKey: f.queryKey }),
    });
    try {
      void f.queryClient.invalidateQueries({ queryKey: f.queryKey });
      const result = mutation.mutate();
      await vi.waitFor(() => expect(f.signals[0]?.aborted).toBe(true));
      f.unsubscribe();
      completion.resolve();
      await result;
      expect(f.queryFn).toHaveBeenCalledTimes(1);
      expect(f.queryClient.getQueryState(f.queryKey)?.isInvalidated).toBe(true);
      const unsubscribe = f.observer.subscribe(() => {});
      try {
        await vi.waitFor(() =>
          expect(f.queryClient.getQueryData(f.queryKey)).toEqual([]),
        );
      } finally {
        unsubscribe();
      }
    } finally {
      f.unsubscribe();
      f.queryClient.clear();
    }
  });

  it("does not revive a removed query or invalidate its replacement", async () => {
    const f = fixture();
    const completion = deferred<void>();
    try {
      void f.queryClient.invalidateQueries({ queryKey: f.queryKey });
      const result = new MutationObserver(f.queryClient, {
        mutationFn: () => completion.promise,
        onMutate: () =>
          cancelOptimisticQueries(f.queryClient, { queryKey: f.queryKey }),
      }).mutate();
      await vi.waitFor(() => expect(f.signals[0]?.aborted).toBe(true));
      f.unsubscribe();
      f.queryClient.removeQueries({ queryKey: f.queryKey });
      f.queryClient.setQueryData(f.queryKey, ["replacement"]);
      completion.resolve();
      await result;
      expect(f.queryClient.getQueryData(f.queryKey)).toEqual(["replacement"]);
      expect(f.queryClient.getQueryState(f.queryKey)?.isInvalidated).toBe(
        false,
      );
      expect(f.queryFn).toHaveBeenCalledTimes(1);
    } finally {
      f.unsubscribe();
      f.queryClient.clear();
    }
  });

  it("does not refetch queries without an interrupted read", async () => {
    const f = fixture();
    try {
      await new MutationObserver(f.queryClient, {
        mutationFn: async () => {},
        onMutate: () =>
          cancelOptimisticQueries(f.queryClient, { queryKey: f.queryKey }),
      }).mutate();
      expect(f.queryFn).not.toHaveBeenCalled();
      expect(f.queryClient.getQueryData(f.queryKey)).toEqual(["delivered"]);
    } finally {
      f.unsubscribe();
      f.queryClient.clear();
    }
  });
});
