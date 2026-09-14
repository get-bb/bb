// @vitest-environment jsdom

import { StrictMode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import type { ThreadWithRuntime } from "@bb/domain";
import { makeThreadWithRuntime } from "@bb/test-helpers/domain-fixtures";
import { afterEach, expect, it, vi } from "vitest";
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

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function setup(deferAbort = false) {
  const harness = createQueryClientTestHarness();
  const requests: {
    signal: AbortSignal | undefined;
    threadId: string;
    resolve: () => void;
    reject: () => void;
  }[] = [];
  for (const id of ["A", "B"]) {
    harness.queryClient.setQueryData(
      threadQueryKey(id),
      makeThreadWithRuntime({ id, lastReadAt: 10, latestAttentionAt: 20 }),
    );
  }
  vi.mocked(sdk.threads.markRead).mockImplementation(
    ({ threadId, signal }) =>
      new Promise((resolve, reject) => {
        signal?.throwIfAborted();
        requests.push({
          signal,
          threadId,
          reject: () => reject(new DOMException("Aborted", "AbortError")),
          resolve: () =>
            resolve(
              makeThreadResponse({
                id: threadId,
                lastReadAt: 20,
                latestAttentionAt: 20,
              }),
            ),
        });
        if (!deferAbort)
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
      }),
  );
  const mount = () =>
    renderHook(
      ({ id }) => {
        const query = useQuery<ThreadWithRuntime>({
          queryKey: threadQueryKey(id),
          enabled: false,
        });
        useThreadReadTracking({
          thread: query.data,
          markThreadRead: useMarkThreadRead(),
        });
        return useMarkThreadUnread();
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
  return { ...harness, ...mount(), requests, mount };
}

it("cancels optimistic reads on departure and retries after reopening", async () => {
  const { rerender, requests, queryClient } = setup();
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(
    queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey("A"))
      ?.lastReadAt,
  ).toBeGreaterThan(20);
  rerender({ id: "B" });
  await waitFor(() => expect(requests[0]?.signal?.aborted).toBe(true));
  await waitFor(() => expect(requests).toHaveLength(2));
  rerender({ id: "A" });
  await waitFor(() => expect(requests).toHaveLength(3));
  expect(requests[1]?.signal?.aborted).toBe(true);
  expect(requests[2]?.threadId).toBe("A");
  expect(requests[2]?.signal?.aborted).toBe(false);
});

it("rolls back an optimistic read after unmount so a new mount can retry", async () => {
  const { unmount, requests, queryClient, mount } = setup();
  await waitFor(() => expect(requests).toHaveLength(1));
  unmount();
  await waitFor(() => expect(requests[0]?.signal?.aborted).toBe(true));
  await waitFor(() =>
    expect(
      queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey("A"))
        ?.lastReadAt,
    ).toBe(10),
  );
  mount();
  await waitFor(() => expect(requests).toHaveLength(2));
});

it("keeps a completed read and respects manual unread until new attention", async () => {
  const { requests, result, queryClient } = setup();
  await waitFor(() => expect(requests).toHaveLength(1));
  await act(async () => requests[0]?.resolve());
  vi.mocked(sdk.threads.markUnread).mockResolvedValue(
    makeThreadResponse({ id: "A", lastReadAt: null, latestAttentionAt: 20 }),
  );
  await act(async () => {
    await result.current.mutateAsync({ threadId: "A" });
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

it("does not undo a newer manual unread when an older read is cancelled", async () => {
  const { requests, result, rerender, queryClient } = setup();
  await waitFor(() => expect(requests).toHaveLength(1));
  vi.mocked(sdk.threads.markUnread).mockResolvedValue(
    makeThreadResponse({ id: "A", lastReadAt: null, latestAttentionAt: 20 }),
  );
  await act(async () => {
    await result.current.mutateAsync({ threadId: "A" });
  });
  rerender({ id: "B" });
  await waitFor(() => expect(requests[0]?.signal?.aborted).toBe(true));
  await waitFor(() => expect(queryClient.isMutating()).toBe(1));
  expect(
    queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey("A"))
      ?.lastReadAt,
  ).toBeNull();
});

it("cancels every attention request without rolling back newer thread data", async () => {
  const { requests, queryClient, unmount } = setup();
  await waitFor(() => expect(requests).toHaveLength(1));
  act(() =>
    queryClient.setQueryData<ThreadWithRuntime>(
      threadQueryKey("A"),
      (thread) =>
        thread && {
          ...thread,
          title: "New title",
          latestAttentionAt: Date.now() + 1000,
        },
    ),
  );
  await waitFor(() => expect(requests).toHaveLength(2));
  const attention = queryClient.getQueryData<ThreadWithRuntime>(
    threadQueryKey("A"),
  )?.latestAttentionAt;
  unmount();
  await waitFor(() => expect(queryClient.isMutating()).toBe(0));
  expect(requests.every((request) => request.signal?.aborted)).toBe(true);
  expect(
    queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey("A")),
  ).toMatchObject({ title: "New title", latestAttentionAt: attention });
});

it("retries after returning before the cancelled request has finished", async () => {
  const { requests, rerender } = setup(true);
  await waitFor(() => expect(requests).toHaveLength(1));
  rerender({ id: "B" });
  await waitFor(() => expect(requests).toHaveLength(2));
  rerender({ id: "A" });
  expect(requests[0]?.signal?.aborted).toBe(true);
  await act(async () => requests[0]?.reject());
  await waitFor(() => expect(requests).toHaveLength(3));
  expect(requests[2]?.threadId).toBe("A");
  await act(async () => requests[1]?.reject());
  expect(requests[2]?.signal?.aborted).toBe(false);
});
