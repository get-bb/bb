import {
  focusManager,
  InfiniteQueryObserver,
  notifyManager,
  QueryObserver,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isThreadRead } from "@bb/client-core";
import type { ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
import { BbHttpError } from "@bb/sdk/browser";
import type { ThreadResponse } from "@bb/server-contract";
import {
  makeThreadListEntry,
  makeThreadWithRuntime,
} from "@bb/test-helpers/domain-fixtures";
import { createAppQueryClient } from "@/lib/query-client";
import { bindSdkToPlugin } from "@/lib/plugin-bound-sdk";
import { sdk } from "@/lib/sdk";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { ingestThreadDetailBootstrap } from "./cache-owners/thread-detail-cache-owner";
import { patchThreadEntity } from "./cache-owners/thread-entity-store";
import {
  beginStopThreadTransaction,
  rollbackStopThreadTransaction,
} from "./cache-owners/thread-runtime-cache-owner";
import {
  beginThreadMetadataTransaction,
  rollbackThreadListMutationTransaction,
} from "./cache-owners/thread-state-cache-owner";
import {
  runThreadReadStateCommand,
  type ThreadReadStateCommand,
} from "./mutations/thread-state-mutations";
import {
  archivedThreadsListQueryKey,
  threadDetailBootstrapQueryKey,
  threadListQueryKey,
  threadQueryKey,
} from "./queries/query-keys";

vi.mock("@/lib/sdk", () => ({
  sdk: { threads: { markRead: vi.fn(), markUnread: vi.fn() } },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

const surfaces = {
  core: (queryClient: QueryClient, command: ThreadReadStateCommand) =>
    runThreadReadStateCommand(queryClient, command),
  plugin: (queryClient: QueryClient, command: ThreadReadStateCommand) => {
    const bound = bindSdkToPlugin(sdk, "test", queryClient);
    return command.kind === "read"
      ? bound.threads.markRead({
          experimental_throughAttentionAt: command.throughAttentionAt,
          signal: command.signal,
          threadId: command.threadId,
        })
      : bound.threads.markUnread({
          signal: command.signal,
          threadId: command.threadId,
        });
  },
};

const surfaceNames = Object.keys(surfaces) as (keyof typeof surfaces)[];

function thread(overrides: Partial<ThreadWithRuntime> = {}) {
  return makeThreadWithRuntime({
    id: "A",
    lastReadAt: 10,
    latestAttentionAt: 20,
    ...overrides,
  });
}

function response(overrides: Partial<ThreadResponse> = {}) {
  return makeThreadResponse({
    id: "A",
    lastReadAt: 1000,
    latestAttentionAt: 20,
    ...overrides,
  });
}

function httpError(status: number) {
  return new BbHttpError({ body: null, code: null, message: "", status });
}

function hangUntilAborted({ signal }: { signal?: AbortSignal }) {
  return new Promise<ThreadResponse>((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
}

function transitions(states: readonly boolean[]): number {
  return states.filter(
    (state, index) => index > 0 && state !== states[index - 1],
  ).length;
}

function listEntry(id: string, overrides: Partial<ThreadListEntry> = {}) {
  return makeThreadListEntry({
    id,
    projectId: "p",
    lastReadAt: 10,
    latestAttentionAt: 20,
    ...overrides,
  });
}

function setupList(queryClient: QueryClient, entries: ThreadListEntry[]) {
  const key = threadListQueryKey({ archived: false, projectId: "p" });
  queryClient.setQueryData(key, entries);
  const fetches: ReturnType<typeof deferred<ThreadListEntry[]>>[] = [];
  const list = new QueryObserver(queryClient, {
    queryKey: key,
    queryFn: () => {
      const fetch = deferred<ThreadListEntry[]>();
      fetches.push(fetch);
      return fetch.promise;
    },
    staleTime: Infinity,
  });
  const unsubscribe = list.subscribe(() => {});
  const readAt = (id: string) =>
    queryClient
      .getQueryData<ThreadListEntry[]>(key)
      ?.find((entry) => entry.id === id)?.lastReadAt;
  const settled = () =>
    vi.waitFor(() => expect(list.getCurrentResult().isFetching).toBe(false));
  return { fetches, key, list, readAt, settled, unsubscribe };
}

function setup(cached = thread()) {
  const queryClient = createAppQueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    showMutationErrorToasts: false,
  });
  queryClient.setQueryData(threadQueryKey("A"), cached);
  const fetches: ReturnType<typeof deferred<ThreadWithRuntime>>[] = [];
  const signals: AbortSignal[] = [];
  const observer = new QueryObserver(queryClient, {
    queryKey: threadQueryKey("A"),
    queryFn: ({ signal }) => {
      signals.push(signal);
      const fetch = deferred<ThreadWithRuntime>();
      fetches.push(fetch);
      return fetch.promise;
    },
    staleTime: Infinity,
  });
  const readStates: boolean[] = [];
  const unsubscribe = observer.subscribe(
    notifyManager.batchCalls(() => {
      const data = observer.getCurrentResult().data;
      if (data) readStates.push(isThreadRead(data));
    }),
  );
  const cachedThread = () =>
    queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey("A"));
  const dispose = () => {
    unsubscribe();
    queryClient.clear();
  };
  return {
    cachedThread,
    dispose,
    fetches,
    observer,
    queryClient,
    readStates,
    signals,
    unsubscribe,
  };
}

describe.each(surfaceNames)("thread read state through %s", (surface) => {
  const run = surfaces[surface];

  it("never shows the read thread unread while stale fetches land around the write", async () => {
    const f = setup();
    const write = deferred<ThreadResponse>();
    vi.mocked(sdk.threads.markRead).mockReturnValue(write.promise);
    try {
      void f.observer.refetch();
      const marking = run(f.queryClient, {
        kind: "read",
        threadId: "A",
        throughAttentionAt: 20,
      });
      await vi.waitFor(() => expect(f.cachedThread()?.lastReadAt).toBe(20));
      await vi.waitFor(() =>
        expect(sdk.threads.markRead).toHaveBeenCalledWith(
          expect.objectContaining({
            experimental_throughAttentionAt: 20,
            threadId: "A",
          }),
        ),
      );
      f.fetches[0]?.resolve(thread());
      await vi.waitFor(() =>
        expect(f.observer.getCurrentResult().isFetching).toBe(false),
      );
      expect(f.cachedThread()?.lastReadAt).toBe(20);

      void f.queryClient.invalidateQueries({ queryKey: threadQueryKey("A") });
      await vi.waitFor(() => expect(f.fetches).toHaveLength(2));
      write.resolve(response());
      await marking;
      expect(f.cachedThread()?.lastReadAt).toBe(1000);
      f.fetches[1]?.resolve(thread());
      await vi.waitFor(() =>
        expect(f.observer.getCurrentResult().isFetching).toBe(false),
      );

      expect(f.cachedThread()?.lastReadAt).toBe(1000);
      expect(f.signals[1]?.aborted).toBe(false);
      expect(f.fetches).toHaveLength(2);
      expect(f.readStates).not.toContain(false);
    } finally {
      f.dispose();
    }
  });

  it("keeps the settled read on a fetch that straddles the write for a thread nobody watches", async () => {
    const f = setup();
    const straddling = deferred<ThreadWithRuntime>();
    const write = deferred<ThreadResponse>();
    vi.mocked(sdk.threads.markRead).mockReturnValue(write.promise);
    f.queryClient.setQueryData(threadQueryKey("B"), thread({ id: "B" }));
    try {
      const marking = run(f.queryClient, {
        kind: "read",
        threadId: "B",
        throughAttentionAt: 20,
      });
      await vi.waitFor(() =>
        expect(sdk.threads.markRead).toHaveBeenCalledTimes(1),
      );
      const fetching = f.queryClient.fetchQuery({
        queryKey: threadQueryKey("B"),
        queryFn: () => straddling.promise,
        staleTime: 0,
      });
      write.resolve(response({ id: "B" }));
      await marking;
      straddling.resolve(thread({ id: "B" }));
      await fetching;

      expect(
        f.queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey("B"))
          ?.lastReadAt,
      ).toBe(1000);
    } finally {
      f.dispose();
    }
  });

  it("keeps the settled read when a detail bootstrap that straddles the write lands", async () => {
    const f = setup();
    const write = deferred<ThreadResponse>();
    const stale = deferred<ThreadResponse>();
    vi.mocked(sdk.threads.markRead).mockReturnValue(write.promise);
    try {
      const marking = run(f.queryClient, {
        kind: "read",
        threadId: "A",
        throughAttentionAt: 20,
      });
      await vi.waitFor(() =>
        expect(sdk.threads.markRead).toHaveBeenCalledTimes(1),
      );
      const bootstrap = f.queryClient.fetchQuery({
        queryKey: threadDetailBootstrapQueryKey("A"),
        queryFn: async () => {
          const ingested = await stale.promise;
          ingestThreadDetailBootstrap({
            queryClient: f.queryClient,
            thread: ingested,
          });
          return ingested;
        },
      });
      write.resolve(response());
      await marking;
      stale.resolve(response({ lastReadAt: 10 }));
      await bootstrap;

      expect(f.cachedThread()?.lastReadAt).toBe(1000);
    } finally {
      f.dispose();
    }
  });

  it("keeps an archived page that is loading when a write settles", async () => {
    const f = setup();
    const key = archivedThreadsListQueryKey({});
    const pages: {
      pageParam: number;
      page: ReturnType<typeof deferred<ThreadListEntry[]>>;
    }[] = [];
    const archived = new InfiniteQueryObserver<
      ThreadListEntry[],
      Error,
      InfiniteData<ThreadListEntry[], number>,
      typeof key,
      number
    >(f.queryClient, {
      queryKey: key,
      queryFn: ({ pageParam }) => {
        const page = deferred<ThreadListEntry[]>();
        pages.push({ pageParam, page });
        return page.promise;
      },
      initialPageParam: 0,
      getNextPageParam: (_last, all) => all.length,
      staleTime: Infinity,
    });
    const unsubscribe = archived.subscribe(() => {});
    vi.mocked(sdk.threads.markRead).mockResolvedValue(response());
    try {
      pages[0]?.page.resolve([makeThreadListEntry({ id: "X" })]);
      await vi.waitFor(() =>
        expect(archived.getCurrentResult().data?.pages).toHaveLength(1),
      );
      const loadMore = archived.fetchNextPage();
      await vi.waitFor(() => expect(pages).toHaveLength(2));
      await run(f.queryClient, {
        kind: "read",
        threadId: "A",
        throughAttentionAt: 20,
      });
      pages[1]?.page.resolve([makeThreadListEntry({ id: "Y" })]);
      await loadMore;

      expect(archived.getCurrentResult().data?.pages).toHaveLength(2);
      expect(pages.map(({ pageParam }) => pageParam)).toEqual([0, 1]);
    } finally {
      unsubscribe();
      f.dispose();
    }
  });

  it("never marks attention the reader did not see as read", async () => {
    const f = setup(thread({ latestAttentionAt: 30 }));
    vi.mocked(sdk.threads.markRead).mockResolvedValue(
      response({ lastReadAt: 10, latestAttentionAt: 30 }),
    );
    try {
      await run(f.queryClient, {
        kind: "read",
        threadId: "A",
        throughAttentionAt: 20,
      });
      expect(sdk.threads.markRead).toHaveBeenCalledWith(
        expect.objectContaining({ experimental_throughAttentionAt: 20 }),
      );
      expect(f.readStates).not.toContain(true);
      expect(f.cachedThread()?.lastReadAt).toBe(10);
    } finally {
      f.dispose();
    }
  });

  it("learns the newer attention a declined read reports", async () => {
    const f = setup();
    vi.mocked(sdk.threads.markRead).mockResolvedValue(
      response({ lastReadAt: 10, latestAttentionAt: 30 }),
    );
    try {
      await run(f.queryClient, {
        kind: "read",
        threadId: "A",
        throughAttentionAt: 20,
      });
      expect(f.cachedThread()).toMatchObject({
        lastReadAt: 10,
        latestAttentionAt: 30,
      });
    } finally {
      f.dispose();
    }
  });

  it("sends a later unread after the pending read and ignores the read's result", async () => {
    const f = setup();
    const write = deferred<ThreadResponse>();
    vi.mocked(sdk.threads.markRead).mockReturnValue(write.promise);
    vi.mocked(sdk.threads.markUnread).mockResolvedValue(
      response({ lastReadAt: null }),
    );
    try {
      const reading = run(f.queryClient, {
        kind: "read",
        threadId: "A",
        throughAttentionAt: 20,
      });
      await vi.waitFor(() =>
        expect(sdk.threads.markRead).toHaveBeenCalledTimes(1),
      );
      const unreading = run(f.queryClient, { kind: "unread", threadId: "A" });
      await vi.waitFor(() => expect(f.cachedThread()?.lastReadAt).toBeNull());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(sdk.threads.markUnread).not.toHaveBeenCalled();

      write.resolve(response());
      await reading;
      expect(f.cachedThread()?.lastReadAt).toBeNull();
      await unreading;
      expect(sdk.threads.markUnread).toHaveBeenCalledTimes(1);
      expect(f.cachedThread()?.lastReadAt).toBeNull();
      expect(f.readStates.slice(f.readStates.indexOf(false))).not.toContain(
        true,
      );
    } finally {
      f.dispose();
    }
  });

  it.each([
    { moment: "while it waits to retry", failsAfterSupersede: false },
    { moment: "while its attempt is in flight", failsAfterSupersede: true },
  ])(
    "stops retrying a read superseded $moment so the newer command goes out at once",
    async ({ failsAfterSupersede }) => {
      vi.useFakeTimers();
      const f = setup();
      const attempt = deferred<ThreadResponse>();
      if (failsAfterSupersede) {
        vi.mocked(sdk.threads.markRead).mockReturnValue(attempt.promise);
      } else {
        vi.mocked(sdk.threads.markRead).mockRejectedValue(httpError(503));
      }
      vi.mocked(sdk.threads.markUnread).mockResolvedValue(
        response({ lastReadAt: null }),
      );
      try {
        const reading = run(f.queryClient, {
          kind: "read",
          threadId: "A",
          throughAttentionAt: 20,
        }).catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(10);
        const unreading = run(f.queryClient, { kind: "unread", threadId: "A" });
        await vi.advanceTimersByTimeAsync(10);
        if (failsAfterSupersede) {
          expect(sdk.threads.markUnread).not.toHaveBeenCalled();
          attempt.reject(httpError(503));
          await vi.advanceTimersByTimeAsync(10);
        }

        expect(sdk.threads.markUnread).toHaveBeenCalledTimes(1);
        expect(sdk.threads.markRead).toHaveBeenCalledTimes(1);
        await expect(reading).resolves.toHaveProperty("name", "AbortError");
        await expect(unreading).resolves.toMatchObject({ lastReadAt: null });
        expect(f.cachedThread()?.lastReadAt).toBeNull();
      } finally {
        f.dispose();
      }
    },
  );

  it("sends a command waiting behind another while the page is hidden", async () => {
    const f = setup();
    const attempt = deferred<ThreadResponse>();
    vi.mocked(sdk.threads.markRead).mockReturnValue(attempt.promise);
    vi.mocked(sdk.threads.markUnread).mockResolvedValue(
      response({ lastReadAt: null }),
    );
    focusManager.setFocused(false);
    try {
      const reading = run(f.queryClient, {
        kind: "read",
        threadId: "A",
        throughAttentionAt: 20,
      });
      await vi.waitFor(() =>
        expect(sdk.threads.markRead).toHaveBeenCalledTimes(1),
      );
      const unreading = run(f.queryClient, { kind: "unread", threadId: "A" });

      attempt.resolve(response());
      await reading;
      await expect(unreading).resolves.toMatchObject({ lastReadAt: null });
      expect(sdk.threads.markUnread).toHaveBeenCalledTimes(1);
    } finally {
      focusManager.setFocused(undefined);
      f.dispose();
    }
  });

  it("drops the unconfirmed read from the copies nobody watches when the write fails", async () => {
    const f = setup();
    f.queryClient.setQueryData(
      threadDetailBootstrapQueryKey("A"),
      response({ lastReadAt: 10 }),
    );
    vi.mocked(sdk.threads.markRead).mockRejectedValue(httpError(409));
    try {
      const reading = run(f.queryClient, {
        kind: "read",
        threadId: "A",
        throughAttentionAt: 20,
      }).catch((error: unknown) => error);
      expect(f.cachedThread()?.lastReadAt).toBe(20);
      f.unsubscribe();

      await expect(reading).resolves.toBeInstanceOf(BbHttpError);
      expect(f.queryClient.getQueryData(threadQueryKey("A"))).toBeUndefined();
      expect(
        f.queryClient.getQueryData(threadDetailBootstrapQueryKey("A")),
      ).toBeUndefined();
    } finally {
      f.dispose();
    }
  });

  it("keeps a copy only disabled views watch in step with the shared row after a failed read", async () => {
    const f = setup();
    const disabled = new QueryObserver<ThreadWithRuntime>(f.queryClient, {
      queryKey: threadQueryKey("A"),
      enabled: false,
    });
    const unsubscribeDisabled = disabled.subscribe(() => {});
    vi.mocked(sdk.threads.markRead).mockRejectedValue(httpError(409));
    try {
      const reading = run(f.queryClient, {
        kind: "read",
        threadId: "A",
        throughAttentionAt: 20,
      }).catch((error: unknown) => error);
      f.unsubscribe();

      await expect(reading).resolves.toBeInstanceOf(BbHttpError);
      patchThreadEntity(f.queryClient, "A", { title: "Renamed elsewhere" });
      expect(disabled.getCurrentResult()).toMatchObject({
        status: "success",
        data: { lastReadAt: 20, title: "Renamed elsewhere" },
      });
      f.queryClient.setQueryData(threadQueryKey("A"), thread());
      expect(disabled.getCurrentResult().data?.lastReadAt).toBe(10);
    } finally {
      unsubscribeDisabled();
      f.dispose();
    }
  });

  it("shows the thread unread again when a read of newer output is aborted before it is sent", async () => {
    const f = setup();
    const first = deferred<ThreadResponse>();
    vi.mocked(sdk.threads.markRead).mockReturnValue(first.promise);
    const controller = new AbortController();
    try {
      const reading = run(f.queryClient, {
        kind: "read",
        threadId: "A",
        throughAttentionAt: 20,
      });
      await vi.waitFor(() =>
        expect(sdk.threads.markRead).toHaveBeenCalledTimes(1),
      );
      f.queryClient.setQueryData<ThreadWithRuntime>(
        threadQueryKey("A"),
        (cached) => cached && { ...cached, latestAttentionAt: 30 },
      );
      const newer = run(f.queryClient, {
        kind: "read",
        threadId: "A",
        throughAttentionAt: 30,
        signal: controller.signal,
      }).catch((error: unknown) => error);
      expect(f.cachedThread()?.lastReadAt).toBe(30);

      controller.abort();
      await expect(newer).resolves.toHaveProperty("name", "AbortError");
      await vi.waitFor(() => expect(f.fetches).toHaveLength(1));
      f.fetches[0]?.resolve(thread({ lastReadAt: 10, latestAttentionAt: 30 }));
      await vi.waitFor(() => expect(f.cachedThread()?.lastReadAt).toBe(20));
      await vi.waitFor(() => expect(f.readStates.at(-1)).toBe(false));

      first.resolve(response({ lastReadAt: 10, latestAttentionAt: 30 }));
      await reading;
      expect(f.cachedThread()).toMatchObject({
        lastReadAt: 10,
        latestAttentionAt: 30,
      });
    } finally {
      f.dispose();
    }
  });

  it("corrects a fetch that started before the write and brings a newer change from before it", async () => {
    const f = setup();
    const l = setupList(f.queryClient, [listEntry("A")]);
    vi.mocked(sdk.threads.markRead).mockResolvedValue(
      response({ updatedAt: 200 }),
    );
    try {
      void l.list.refetch();
      await vi.waitFor(() => expect(l.fetches).toHaveLength(1));
      await run(f.queryClient, {
        kind: "read",
        threadId: "A",
        throughAttentionAt: 20,
      });

      l.fetches[0]?.resolve([
        listEntry("A", { title: "Renamed elsewhere", updatedAt: 150 }),
      ]);
      await l.settled();
      expect(l.readAt("A")).toBe(1000);
      expect(f.cachedThread()).toMatchObject({
        lastReadAt: 1000,
        title: "Renamed elsewhere",
      });
    } finally {
      l.unsubscribe();
      f.dispose();
    }
  });

  it("keeps newer server state when a fetch that started before the write lands after it", async () => {
    const f = setup();
    const l = setupList(f.queryClient, [listEntry("A")]);
    vi.mocked(sdk.threads.markRead).mockResolvedValue(
      response({ updatedAt: 200 }),
    );
    try {
      void l.list.refetch();
      await vi.waitFor(() => expect(l.fetches).toHaveLength(1));
      await run(f.queryClient, {
        kind: "read",
        threadId: "A",
        throughAttentionAt: 20,
      });
      void f.observer.refetch();
      await vi.waitFor(() => expect(f.fetches).toHaveLength(1));
      f.fetches[0]?.resolve(thread({ lastReadAt: null, updatedAt: 300 }));
      await vi.waitFor(() => expect(f.cachedThread()?.lastReadAt).toBeNull());

      l.fetches[0]?.resolve([listEntry("A", { updatedAt: 250 })]);
      await l.settled();
      expect([l.readAt("A"), f.cachedThread()?.lastReadAt]).toEqual([
        null,
        null,
      ]);
    } finally {
      l.unsubscribe();
      f.dispose();
    }
  });

  it("sends only the newest of the commands waiting behind a request", async () => {
    const f = setup();
    const attempt = deferred<ThreadResponse>();
    vi.mocked(sdk.threads.markRead)
      .mockReturnValueOnce(attempt.promise)
      .mockResolvedValue(response({ lastReadAt: 2000 }));
    try {
      const first = run(f.queryClient, {
        kind: "read",
        threadId: "A",
        throughAttentionAt: 20,
      });
      await vi.waitFor(() =>
        expect(sdk.threads.markRead).toHaveBeenCalledTimes(1),
      );
      const replaced = run(f.queryClient, {
        kind: "unread",
        threadId: "A",
      }).catch((error: unknown) => error);
      const newest = run(f.queryClient, { kind: "read", threadId: "A" });

      attempt.resolve(response());
      await expect(newest).resolves.toMatchObject({ lastReadAt: 2000 });
      await expect(replaced).resolves.toHaveProperty("name", "AbortError");
      await first;
      expect(sdk.threads.markUnread).not.toHaveBeenCalled();
      expect(sdk.threads.markRead).toHaveBeenCalledTimes(2);
      expect(f.cachedThread()?.lastReadAt).toBe(2000);
    } finally {
      f.dispose();
    }
  });

  it.each([
    { outcome: "a timed out attempt", firstAttempt: hangUntilAborted },
    {
      outcome: "a network failure",
      firstAttempt: () => Promise.reject(new TypeError("Failed to fetch")),
    },
    {
      outcome: "a server error",
      firstAttempt: () => Promise.reject(httpError(503)),
    },
  ])(
    "retries after $outcome without showing the thread unread",
    async ({ firstAttempt }) => {
      vi.useFakeTimers();
      const f = setup();
      vi.mocked(sdk.threads.markRead)
        .mockImplementationOnce(firstAttempt)
        .mockResolvedValueOnce(response());
      try {
        const marking = run(f.queryClient, {
          kind: "read",
          threadId: "A",
          throughAttentionAt: 20,
        });
        await vi.advanceTimersByTimeAsync(12_000);
        await expect(marking).resolves.toMatchObject({ lastReadAt: 1000 });
        expect(sdk.threads.markRead).toHaveBeenCalledTimes(2);
        expect(f.cachedThread()?.lastReadAt).toBe(1000);
        expect(f.readStates).not.toContain(false);
      } finally {
        f.dispose();
      }
    },
  );

  it.each([
    { status: 404, attempts: 1, serverReadAt: 10 },
    { status: 503, attempts: 5, serverReadAt: 1000 },
  ])(
    "keeps the thread as shown after a $status in $attempts attempts until the server answers",
    async ({ status, attempts, serverReadAt }) => {
      vi.useFakeTimers();
      const f = setup();
      vi.mocked(sdk.threads.markRead).mockRejectedValue(httpError(status));
      try {
        const marking = run(f.queryClient, {
          kind: "read",
          threadId: "A",
          throughAttentionAt: 20,
        });
        const shown = f.cachedThread();
        const settled = expect(marking).rejects.toMatchObject({ status });
        await vi.advanceTimersByTimeAsync(60_000);
        await settled;
        expect(sdk.threads.markRead).toHaveBeenCalledTimes(attempts);
        expect(f.cachedThread()).toBe(shown);
        expect(shown?.lastReadAt).toBe(20);
        expect(f.fetches).toHaveLength(1);

        f.fetches[0]?.resolve(thread({ lastReadAt: serverReadAt }));
        await vi.advanceTimersByTimeAsync(10);
        expect(f.cachedThread()?.lastReadAt).toBe(serverReadAt);
        expect(transitions(f.readStates)).toBeLessThanOrEqual(1);
      } finally {
        f.dispose();
      }
    },
  );

  it("keeps a replaced read the server applied when the newer command is aborted before it is sent", async () => {
    const f = setup();
    const read = deferred<ThreadResponse>();
    vi.mocked(sdk.threads.markRead).mockReturnValue(read.promise);
    const controller = new AbortController();
    const stopWatching = f.queryClient.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "success")
        controller.abort();
    });
    try {
      const reading = run(f.queryClient, {
        kind: "read",
        threadId: "A",
        throughAttentionAt: 20,
      });
      await vi.waitFor(() =>
        expect(sdk.threads.markRead).toHaveBeenCalledTimes(1),
      );
      const unreading = run(f.queryClient, {
        kind: "unread",
        signal: controller.signal,
        threadId: "A",
      }).catch((error: unknown) => error);
      expect(f.cachedThread()?.lastReadAt).toBeNull();

      read.resolve(response());
      await expect(reading).resolves.toMatchObject({ lastReadAt: 1000 });
      await expect(unreading).resolves.toHaveProperty("name", "AbortError");
      expect(f.cachedThread()?.lastReadAt).toBe(1000);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(sdk.threads.markUnread).not.toHaveBeenCalled();
    } finally {
      stopWatching();
      f.dispose();
    }
  });

  it("keeps two settled reads that one stale list fetch straddles", async () => {
    const f = setup();
    const l = setupList(f.queryClient, [listEntry("A"), listEntry("B")]);
    vi.mocked(sdk.threads.markRead).mockImplementation(({ threadId }) =>
      Promise.resolve(response({ id: threadId })),
    );
    try {
      void l.list.refetch();
      await vi.waitFor(() => expect(l.fetches).toHaveLength(1));
      for (const threadId of ["A", "B"]) {
        await run(f.queryClient, {
          kind: "read",
          threadId,
          throughAttentionAt: 20,
        });
      }
      l.fetches[0]?.resolve([listEntry("A"), listEntry("B")]);
      await l.settled();

      expect([l.readAt("A"), l.readAt("B")]).toEqual([1000, 1000]);
    } finally {
      l.unsubscribe();
      f.dispose();
    }
  });

  it("keeps a settled read that a stale list fetch straddles while a rename is pending", async () => {
    const f = setup();
    const l = setupList(f.queryClient, [listEntry("A")]);
    vi.mocked(sdk.threads.markRead).mockResolvedValue(response());
    try {
      void l.list.refetch();
      await vi.waitFor(() => expect(l.fetches).toHaveLength(1));
      await run(f.queryClient, {
        kind: "read",
        threadId: "A",
        throughAttentionAt: 20,
      });
      const rename = await beginThreadMetadataTransaction({
        queryClient: f.queryClient,
        threadId: "A",
        title: "Renamed",
      });
      l.fetches[0]?.resolve([listEntry("A")]);
      await l.settled();
      expect(f.cachedThread()).toMatchObject({
        lastReadAt: 1000,
        title: "Renamed",
      });
      rollbackThreadListMutationTransaction({
        queryClient: f.queryClient,
        threadId: "A",
        transaction: rename,
      });

      expect(l.readAt("A")).toBe(1000);
    } finally {
      l.unsubscribe();
      f.dispose();
    }
  });

  it("lets the newer read win over an older unread when a stale fetch lands", async () => {
    const f = setup(thread({ lastReadAt: 25 }));
    const l = setupList(f.queryClient, [listEntry("A", { lastReadAt: 25 })]);
    vi.mocked(sdk.threads.markUnread).mockResolvedValue(
      response({ lastReadAt: null }),
    );
    vi.mocked(sdk.threads.markRead).mockResolvedValue(response());
    try {
      void l.list.refetch();
      await vi.waitFor(() => expect(l.fetches).toHaveLength(1));
      await run(f.queryClient, { kind: "unread", threadId: "A" });
      await run(f.queryClient, {
        kind: "read",
        threadId: "A",
        throughAttentionAt: 20,
      });
      l.fetches[0]?.resolve([listEntry("A", { lastReadAt: 25 })]);
      await l.settled();

      expect([l.readAt("A"), f.cachedThread()?.lastReadAt]).toEqual([
        1000, 1000,
      ]);
    } finally {
      l.unsubscribe();
      f.dispose();
    }
  });

  it("lets fresh data through when the straddling fetch is restarted", async () => {
    const f = setup();
    const l = setupList(f.queryClient, [listEntry("A")]);
    vi.mocked(sdk.threads.markRead).mockResolvedValue(response());
    try {
      void l.list.refetch();
      await vi.waitFor(() => expect(l.fetches).toHaveLength(1));
      await run(f.queryClient, {
        kind: "read",
        threadId: "A",
        throughAttentionAt: 20,
      });
      void f.queryClient.invalidateQueries({ queryKey: l.key });
      await vi.waitFor(() => expect(l.fetches).toHaveLength(2));
      l.fetches[1]?.resolve([listEntry("A", { lastReadAt: null })]);
      await l.settled();
      expect(l.readAt("A")).toBeNull();

      void f.queryClient.invalidateQueries({ queryKey: l.key });
      await vi.waitFor(() => expect(l.fetches).toHaveLength(3));
      l.fetches[2]?.resolve([listEntry("A", { lastReadAt: 5 })]);
      await l.settled();
      expect(l.readAt("A")).toBe(5);
    } finally {
      l.unsubscribe();
      f.dispose();
    }
  });

  it("keeps a pending read when another write restores an older snapshot", async () => {
    const f = setup();
    const l = setupList(f.queryClient, [listEntry("A")]);
    const write = deferred<ThreadResponse>();
    vi.mocked(sdk.threads.markRead).mockReturnValue(write.promise);
    try {
      const stop = await beginStopThreadTransaction({
        queryClient: f.queryClient,
        requestedAt: 1,
        threadId: "A",
      });
      const marking = run(f.queryClient, {
        kind: "read",
        threadId: "A",
        throughAttentionAt: 20,
      });
      await vi.waitFor(() => expect(l.readAt("A")).toBe(20));
      rollbackStopThreadTransaction({
        queryClient: f.queryClient,
        threadId: "A",
        transaction: stop,
      });
      expect([l.readAt("A"), f.cachedThread()?.lastReadAt]).toEqual([20, 20]);

      write.resolve(response());
      await marking;
    } finally {
      l.unsubscribe();
      f.dispose();
    }
  });

  it("keeps an archived page that is loading when a write fails", async () => {
    const f = setup();
    const key = archivedThreadsListQueryKey({});
    const pages: ReturnType<typeof deferred<ThreadListEntry[]>>[] = [];
    const archived = new InfiniteQueryObserver<
      ThreadListEntry[],
      Error,
      InfiniteData<ThreadListEntry[], number>,
      typeof key,
      number
    >(f.queryClient, {
      queryKey: key,
      queryFn: () => {
        const page = deferred<ThreadListEntry[]>();
        pages.push(page);
        return page.promise;
      },
      initialPageParam: 0,
      getNextPageParam: (_last, all) => all.length,
      staleTime: Infinity,
    });
    const unsubscribe = archived.subscribe(() => {});
    vi.mocked(sdk.threads.markRead).mockRejectedValue(httpError(404));
    try {
      pages[0]?.resolve([makeThreadListEntry({ id: "X" })]);
      await vi.waitFor(() =>
        expect(archived.getCurrentResult().data?.pages).toHaveLength(1),
      );
      const loadMore = archived.fetchNextPage();
      await vi.waitFor(() => expect(pages).toHaveLength(2));
      await run(f.queryClient, {
        kind: "read",
        threadId: "A",
        throughAttentionAt: 20,
      }).catch(() => {});
      pages[1]?.resolve([makeThreadListEntry({ id: "Y" })]);
      await loadMore;

      expect(archived.getCurrentResult().data?.pages).toHaveLength(2);
      expect(pages).toHaveLength(2);
    } finally {
      unsubscribe();
      f.dispose();
    }
  });

  it("refetches when the newer of two rejected commands fails", async () => {
    const f = setup();
    const read = deferred<ThreadResponse>();
    vi.mocked(sdk.threads.markRead).mockReturnValue(read.promise);
    vi.mocked(sdk.threads.markUnread).mockRejectedValue(httpError(403));
    try {
      const reading = run(f.queryClient, {
        kind: "read",
        threadId: "A",
        throughAttentionAt: 20,
      }).catch(() => {});
      await vi.waitFor(() =>
        expect(sdk.threads.markRead).toHaveBeenCalledTimes(1),
      );
      const unreading = run(f.queryClient, {
        kind: "unread",
        threadId: "A",
      }).catch(() => {});
      await vi.waitFor(() => expect(f.cachedThread()?.lastReadAt).toBeNull());
      read.reject(httpError(403));
      await reading;
      await unreading;
      expect(f.fetches).toHaveLength(1);

      f.fetches[0]?.resolve(thread());
      await vi.waitFor(() => expect(f.cachedThread()?.lastReadAt).toBe(10));
    } finally {
      f.dispose();
    }
  });

  it("refetches a list first loaded during a write that the server rejected", async () => {
    const f = setup();
    const write = deferred<ThreadResponse>();
    vi.mocked(sdk.threads.markRead).mockReturnValue(write.promise);
    const listKey = threadListQueryKey({ archived: false, projectId: "p" });
    const listFetches: ReturnType<typeof deferred<ThreadListEntry[]>>[] = [];
    const list = new QueryObserver(f.queryClient, {
      queryKey: listKey,
      queryFn: () => {
        const fetch = deferred<ThreadListEntry[]>();
        listFetches.push(fetch);
        return fetch.promise;
      },
      staleTime: Infinity,
    });
    const listReadAt = () =>
      f.queryClient.getQueryData<ThreadListEntry[]>(listKey)?.[0]?.lastReadAt;
    let unsubscribe = () => {};
    try {
      const marking = run(f.queryClient, {
        kind: "read",
        threadId: "A",
        throughAttentionAt: 20,
      }).catch(() => {});
      await vi.waitFor(() =>
        expect(sdk.threads.markRead).toHaveBeenCalledTimes(1),
      );
      unsubscribe = list.subscribe(() => {});
      const serverEntry = makeThreadListEntry({
        id: "A",
        lastReadAt: 10,
        latestAttentionAt: 20,
      });
      listFetches[0]?.resolve([serverEntry]);
      await vi.waitFor(() => expect(listReadAt()).toBe(20));
      write.reject(httpError(404));
      await marking;
      await vi.waitFor(() => expect(listFetches).toHaveLength(2));
      listFetches[1]?.resolve([serverEntry]);
      await vi.waitFor(() => expect(listReadAt()).toBe(10));
    } finally {
      unsubscribe();
      f.dispose();
    }
  });
});

it("lets a plugin abort its read and reconciles from the server instead of guessing", async () => {
  const f = setup();
  vi.mocked(sdk.threads.markRead).mockImplementation(hangUntilAborted);
  const controller = new AbortController();
  try {
    const marking = surfaces.plugin(f.queryClient, {
      kind: "read",
      signal: controller.signal,
      threadId: "A",
      throughAttentionAt: 20,
    });
    await vi.waitFor(() =>
      expect(sdk.threads.markRead).toHaveBeenCalledTimes(1),
    );
    controller.abort();
    await expect(marking).rejects.toBeDefined();
    expect(sdk.threads.markRead).toHaveBeenCalledTimes(1);
    expect(f.cachedThread()?.lastReadAt).toBe(20);
    await vi.waitFor(() => expect(f.fetches).toHaveLength(1));
    f.fetches[0]?.resolve(thread({ lastReadAt: 1000 }));
    await vi.waitFor(() => expect(f.cachedThread()?.lastReadAt).toBe(1000));
  } finally {
    f.dispose();
  }
});

it("drops a queued plugin command at once when it is aborted and restores the pending read", async () => {
  const f = setup();
  const read = deferred<ThreadResponse>();
  vi.mocked(sdk.threads.markRead).mockReturnValue(read.promise);
  const controller = new AbortController();
  try {
    const reading = surfaces.core(f.queryClient, {
      kind: "read",
      threadId: "A",
      throughAttentionAt: 20,
    });
    await vi.waitFor(() =>
      expect(sdk.threads.markRead).toHaveBeenCalledTimes(1),
    );
    const unreading = surfaces.plugin(f.queryClient, {
      kind: "unread",
      signal: controller.signal,
      threadId: "A",
    });
    await vi.waitFor(() => expect(f.cachedThread()?.lastReadAt).toBeNull());
    controller.abort();
    await expect(unreading).rejects.toBeDefined();
    expect(f.cachedThread()?.lastReadAt).toBe(20);

    read.resolve(response());
    await reading;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sdk.threads.markUnread).not.toHaveBeenCalled();
    expect(f.cachedThread()?.lastReadAt).toBe(1000);
  } finally {
    f.dispose();
  }
});
