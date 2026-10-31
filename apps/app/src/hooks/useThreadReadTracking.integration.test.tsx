// @vitest-environment jsdom

import { StrictMode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import type { ThreadWithRuntime } from "@bb/domain";
import { BbHttpError } from "@bb/sdk/browser";
import { makeThreadWithRuntime } from "@bb/test-helpers/domain-fixtures";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  useMarkThreadRead,
  useMarkThreadUnread,
} from "./mutations/thread-state-mutations";
import { threadQueryKey } from "./queries/query-keys";
import { useThreadReadTracking } from "./useThreadReadTracking";

vi.mock("@/lib/sdk", () => ({
  sdk: { threads: { markRead: vi.fn(), markUnread: vi.fn() } },
}));

beforeEach(() => {
  window.dispatchEvent(new KeyboardEvent("keydown"));
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function setup() {
  const harness = createQueryClientTestHarness();
  const requests: {
    signal: AbortSignal | undefined;
    threadId: string;
    throughAttentionAt: number | undefined;
    resolve: () => void;
    reject: (error: Error) => void;
  }[] = [];
  for (const id of ["A", "B"]) {
    harness.queryClient.setQueryData(
      threadQueryKey(id),
      makeThreadWithRuntime({ id, lastReadAt: 10, latestAttentionAt: 20 }),
    );
  }
  vi.mocked(sdk.threads.markRead).mockImplementation(
    ({ experimental_throughAttentionAt, threadId, signal }) =>
      new Promise((resolve, reject) => {
        requests.push({
          signal,
          threadId,
          throughAttentionAt: experimental_throughAttentionAt,
          reject,
          resolve: () =>
            resolve(
              makeThreadResponse({
                id: threadId,
                lastReadAt: 1000 + requests.length,
                latestAttentionAt: experimental_throughAttentionAt,
              }),
            ),
        });
      }),
  );
  const mount = () =>
    renderHook(
      ({ id }) => {
        const query = useQuery<ThreadWithRuntime>({
          queryKey: threadQueryKey(id),
          queryFn: () => new Promise(() => {}),
          staleTime: Infinity,
        });
        useThreadReadTracking({
          thread: query.data,
          markThreadRead: useMarkThreadRead(),
        });
        return {
          read: useMarkThreadRead(),
          thread: query.data,
          unread: useMarkThreadUnread(),
        };
      },
      {
        initialProps: { id: "A" },
        wrapper: ({ children }) => (
          <StrictMode>
            <harness.wrapper>{children}</harness.wrapper>
          </StrictMode>
        ),
      },
    );
  const cachedThread = (id: string) =>
    harness.queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey(id));
  return { ...harness, ...mount(), cachedThread, requests, mount };
}

it("keeps a read going after leaving the thread and does not resend it on return", async () => {
  const { rerender, requests, cachedThread } = setup();
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({ threadId: "A", throughAttentionAt: 20 });
  expect(cachedThread("A")?.lastReadAt).toBe(20);

  rerender({ id: "B" });
  await waitFor(() => expect(requests).toHaveLength(2));
  rerender({ id: "A" });
  await act(async () => {});

  expect(requests).toHaveLength(2);
  expect(requests[0]?.signal?.aborted).toBe(false);
  expect(cachedThread("A")?.lastReadAt).toBe(20);
  await act(async () => requests[0]?.resolve());
  expect(cachedThread("A")?.lastReadAt).toBe(1002);
});

it("finishes a read after unmount, so a new mount finds the thread read", async () => {
  const { unmount, requests, mount, cachedThread } = setup();
  await waitFor(() => expect(requests).toHaveLength(1));
  unmount();
  expect(requests[0]?.signal?.aborted).toBe(false);
  await act(async () => requests[0]?.resolve());
  expect(cachedThread("A")?.lastReadAt).toBe(1001);

  mount();
  await act(async () => {});
  expect(requests).toHaveLength(1);
});

it("keeps a completed read and respects manual unread until new attention", async () => {
  const { requests, result, queryClient } = setup();
  await waitFor(() => expect(requests).toHaveLength(1));
  await act(async () => requests[0]?.resolve());
  vi.mocked(sdk.threads.markUnread).mockResolvedValue(
    makeThreadResponse({ id: "A", lastReadAt: null, latestAttentionAt: 20 }),
  );
  await act(async () => {
    await result.current.unread.mutateAsync({ threadId: "A" });
  });
  act(() => window.dispatchEvent(new Event("pageshow")));
  expect(requests).toHaveLength(1);
  expect(
    queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey("A"))
      ?.lastReadAt,
  ).toBeNull();
  act(() =>
    queryClient.setQueryData<ThreadWithRuntime>(
      threadQueryKey("A"),
      (thread) => thread && { ...thread, latestAttentionAt: 30 },
    ),
  );
  await waitFor(() => expect(requests).toHaveLength(2));
});

it("lets a manual unread made during a pending read win", async () => {
  const { requests, result, cachedThread } = setup();
  await waitFor(() => expect(requests).toHaveLength(1));
  vi.mocked(sdk.threads.markUnread).mockResolvedValue(
    makeThreadResponse({ id: "A", lastReadAt: null, latestAttentionAt: 20 }),
  );
  let unreading: Promise<unknown> | undefined;
  act(() => {
    unreading = result.current.unread.mutateAsync({ threadId: "A" });
  });
  await waitFor(() => expect(cachedThread("A")?.lastReadAt).toBeNull());
  expect(sdk.threads.markUnread).not.toHaveBeenCalled();

  await act(async () => {
    requests[0]?.resolve();
    await unreading;
  });
  act(() => window.dispatchEvent(new Event("pageshow")));

  expect(sdk.threads.markUnread).toHaveBeenCalledTimes(1);
  expect(cachedThread("A")?.lastReadAt).toBeNull();
  expect(requests).toHaveLength(1);
});

it("reads new attention after the pending read and keeps newer thread data", async () => {
  const { requests, queryClient, cachedThread } = setup();
  await waitFor(() => expect(requests).toHaveLength(1));
  act(() =>
    queryClient.setQueryData<ThreadWithRuntime>(
      threadQueryKey("A"),
      (thread) =>
        thread && { ...thread, title: "New title", latestAttentionAt: 30 },
    ),
  );
  await waitFor(() => expect(cachedThread("A")?.lastReadAt).toBe(30));
  expect(requests).toHaveLength(1);

  await act(async () => requests[0]?.resolve());
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]).toMatchObject({ threadId: "A", throughAttentionAt: 30 });
  await act(async () => requests[1]?.resolve());
  await waitFor(() => expect(queryClient.isMutating()).toBe(0));

  expect(cachedThread("A")).toMatchObject({
    title: "New title",
    latestAttentionAt: 30,
    lastReadAt: 1002,
  });
});

it("keeps a manual unread made while the auto-read is retrying", async () => {
  const { requests, result, cachedThread } = setup();
  await waitFor(() => expect(requests).toHaveLength(1));
  vi.mocked(sdk.threads.markUnread).mockResolvedValue(
    makeThreadResponse({ id: "A", lastReadAt: null, latestAttentionAt: 20 }),
  );
  await act(async () =>
    requests[0]?.reject(
      new BbHttpError({ body: null, code: null, message: "", status: 503 }),
    ),
  );
  await act(async () => {
    await result.current.unread.mutateAsync({ threadId: "A" });
  });
  act(() => window.dispatchEvent(new Event("focus")));
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

  expect(requests).toHaveLength(1);
  expect(cachedThread("A")?.lastReadAt).toBeNull();
});

it("reports no error to the caller of a command a newer one replaced", async () => {
  const { requests, result } = setup();
  await waitFor(() => expect(requests).toHaveLength(1));
  vi.mocked(sdk.threads.markUnread).mockResolvedValue(
    makeThreadResponse({ id: "A", lastReadAt: null, latestAttentionAt: 20 }),
  );
  const onReadError = vi.fn();
  const onUnreadError = vi.fn();
  act(() => {
    result.current.read.mutate({ threadId: "A" }, { onError: onReadError });
    result.current.unread.mutate({ threadId: "A" }, { onError: onUnreadError });
  });
  await act(async () =>
    requests[0]?.reject(
      new BbHttpError({ body: null, code: null, message: "", status: 503 }),
    ),
  );
  await waitFor(() => expect(sdk.threads.markUnread).toHaveBeenCalledTimes(1));

  expect(requests).toHaveLength(1);
  expect(onReadError).not.toHaveBeenCalled();
  expect(onUnreadError).not.toHaveBeenCalled();
  expect(result.current.thread?.lastReadAt).toBeNull();
});

it("reads a thread reopened after its read failed while it was closed", async () => {
  const { rerender, requests, queryClient } = setup();
  await waitFor(() => expect(requests).toHaveLength(1));
  rerender({ id: "B" });
  await waitFor(() => expect(requests).toHaveLength(2));
  await act(async () =>
    requests[0]?.reject(
      new BbHttpError({ body: null, code: null, message: "", status: 409 }),
    ),
  );
  expect(queryClient.getQueryData(threadQueryKey("A"))).toBeUndefined();

  rerender({ id: "A" });
  await act(async () => {});
  act(() =>
    queryClient.setQueryData(
      threadQueryKey("A"),
      makeThreadWithRuntime({ id: "A", lastReadAt: 10, latestAttentionAt: 20 }),
    ),
  );
  await waitFor(() =>
    expect(requests.filter(({ threadId }) => threadId === "A")).toHaveLength(2),
  );
});

it("retries on page show a read that failed under a view since replaced", async () => {
  const { requests, mount, unmount, queryClient } = setup();
  await waitFor(() => expect(requests).toHaveLength(1));
  unmount();
  const replacement = mount();
  await act(async () => {});
  expect(requests).toHaveLength(1);

  await act(async () =>
    requests[0]?.reject(
      new BbHttpError({ body: null, code: null, message: "", status: 409 }),
    ),
  );
  act(() =>
    queryClient.setQueryData<ThreadWithRuntime>(
      threadQueryKey("A"),
      (thread) => thread && { ...thread, lastReadAt: 10 },
    ),
  );
  await waitFor(() =>
    expect(replacement.result.current.thread?.lastReadAt).toBe(10),
  );
  act(() => window.dispatchEvent(new Event("pageshow")));
  await waitFor(() => expect(requests).toHaveLength(2));
});

it("keeps a manual unread made after a failed read was retried successfully", async () => {
  const { requests, result, queryClient } = setup();
  await waitFor(() => expect(requests).toHaveLength(1));
  await act(async () =>
    requests[0]?.reject(
      new BbHttpError({ body: null, code: null, message: "", status: 409 }),
    ),
  );
  act(() =>
    queryClient.setQueryData<ThreadWithRuntime>(
      threadQueryKey("A"),
      (thread) => thread && { ...thread, lastReadAt: 10 },
    ),
  );
  await waitFor(() => expect(result.current.thread?.lastReadAt).toBe(10));
  act(() => window.dispatchEvent(new Event("pageshow")));
  await waitFor(() => expect(requests).toHaveLength(2));
  await act(async () => requests[1]?.resolve());
  await waitFor(() => expect(result.current.thread?.lastReadAt).toBe(1002));

  vi.mocked(sdk.threads.markUnread).mockResolvedValue(
    makeThreadResponse({ id: "A", lastReadAt: null, latestAttentionAt: 20 }),
  );
  await act(async () => {
    await result.current.unread.mutateAsync({ threadId: "A" });
  });
  act(() => window.dispatchEvent(new Event("pageshow")));
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

  expect(requests).toHaveLength(2);
  expect(result.current.thread?.lastReadAt).toBeNull();
});

it("keeps an unread another device made after reading a thread whose read failed here", async () => {
  const { requests, result, queryClient } = setup();
  await waitFor(() => expect(requests).toHaveLength(1));
  await act(async () =>
    requests[0]?.reject(
      new BbHttpError({ body: null, code: null, message: "", status: 409 }),
    ),
  );
  for (const lastReadAt of [10, 30, null]) {
    act(() =>
      queryClient.setQueryData<ThreadWithRuntime>(
        threadQueryKey("A"),
        (thread) => thread && { ...thread, lastReadAt },
      ),
    );
    await waitFor(() =>
      expect(result.current.thread?.lastReadAt).toBe(lastReadAt),
    );
  }
  act(() => window.dispatchEvent(new Event("pageshow")));
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

  expect(requests).toHaveLength(1);
  expect(result.current.thread?.lastReadAt).toBeNull();
});

it("retries on page show a read that failed while a refresh was loading", async () => {
  const { requests, result, queryClient } = setup();
  await waitFor(() => expect(requests).toHaveLength(1));
  act(() => {
    void queryClient.invalidateQueries({ queryKey: threadQueryKey("A") });
  });
  await waitFor(() =>
    expect(queryClient.isFetching({ queryKey: threadQueryKey("A") })).toBe(1),
  );
  await act(async () =>
    requests[0]?.reject(
      new BbHttpError({ body: null, code: null, message: "", status: 409 }),
    ),
  );
  act(() => window.dispatchEvent(new Event("pageshow")));
  expect(result.current.thread?.lastReadAt).toBe(20);
  act(() =>
    queryClient.setQueryData<ThreadWithRuntime>(
      threadQueryKey("A"),
      (thread) => thread && { ...thread, lastReadAt: 10 },
    ),
  );
  await waitFor(() => expect(result.current.thread?.lastReadAt).toBe(10));
  act(() => window.dispatchEvent(new Event("pageshow")));
  await waitFor(() => expect(requests).toHaveLength(2));
});

it("retries a rejected read when the page is shown again, not in a loop", async () => {
  const { requests, result, queryClient } = setup();
  await waitFor(() => expect(result.current.thread?.lastReadAt).toBe(20));
  await act(async () =>
    requests[0]?.reject(
      new BbHttpError({ body: null, code: null, message: "", status: 409 }),
    ),
  );
  act(() =>
    queryClient.setQueryData<ThreadWithRuntime>(
      threadQueryKey("A"),
      (thread) => thread && { ...thread, lastReadAt: 10 },
    ),
  );
  await waitFor(() => expect(result.current.thread?.lastReadAt).toBe(10));
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  expect(requests).toHaveLength(1);

  act(() => window.dispatchEvent(new Event("pageshow")));
  await waitFor(() => expect(requests).toHaveLength(2));
});
