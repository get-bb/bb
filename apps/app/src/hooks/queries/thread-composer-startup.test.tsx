// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useThreadDetailBootstrap } from "./thread-queries";
import { useThreadDefaultExecutionOptions } from "./thread-default-execution-options-query";
import { useThreadQueuedMessages } from "./thread-panel-queries";
import {
  threadDefaultExecutionOptionsQueryKey,
  threadQueuedMessagesQueryKey,
} from "./query-keys";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    threads: {
      get: vi.fn(() => new Promise(() => {})),
      defaultExecutionOptions: vi.fn(async () => null),
      queuedMessages: { list: vi.fn(async () => []) },
    },
  },
}));
vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useThreadDetailRealtimeSubscription: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("starts composer data while bootstrap is unresolved, shares it with late consumers, and refreshes after reopening", async () => {
  const { wrapper, queryClient } = createQueryClientTestHarness();
  const owner = renderHook(() => useThreadDetailBootstrap("thr_startup"), {
    wrapper,
  });
  const defaults = sdk.threads.defaultExecutionOptions;
  const queue = sdk.threads.queuedMessages.list;
  await waitFor(() => {
    expect(defaults).toHaveBeenCalledTimes(1);
    expect(queue).toHaveBeenCalledTimes(1);
    expect(
      queryClient.getQueryData(threadQueuedMessagesQueryKey("thr_startup")),
    ).toEqual([]);
  });
  expect(owner.result.current.isPending).toBe(true);
  const consumer = renderHook(
    () => ({
      defaults: useThreadDefaultExecutionOptions("thr_startup"),
      queue: useThreadQueuedMessages("thr_startup"),
    }),
    { wrapper },
  );
  await act(async () => {});
  expect(consumer.result.current.defaults.data).toBeNull();
  expect(consumer.result.current.queue.data).toEqual([]);
  expect(defaults).toHaveBeenCalledTimes(1);
  expect(queue).toHaveBeenCalledTimes(1);
  await act(async () => {
    await queryClient.invalidateQueries({
      queryKey: threadDefaultExecutionOptionsQueryKey("thr_startup"),
    });
    await queryClient.invalidateQueries({
      queryKey: threadQueuedMessagesQueryKey("thr_startup"),
    });
  });
  expect(defaults).toHaveBeenCalledTimes(2);
  expect(queue).toHaveBeenCalledTimes(2);
  consumer.unmount();
  owner.unmount();
  renderHook(() => useThreadDetailBootstrap("thr_startup"), { wrapper });
  await waitFor(() => {
    expect(defaults).toHaveBeenCalledTimes(3);
    expect(queue).toHaveBeenCalledTimes(3);
  });
});

it("keeps composer requests disabled without an active thread route", async () => {
  const { wrapper } = createQueryClientTestHarness();
  const owner = renderHook(
    ({ id, enabled }) => useThreadDetailBootstrap(id, { enabled }),
    {
      wrapper,
      initialProps: { id: "", enabled: true },
    },
  );
  owner.rerender({ id: "thr_inactive", enabled: false });
  await act(async () => {});
  expect(sdk.threads.get).not.toHaveBeenCalled();
  expect(sdk.threads.defaultExecutionOptions).not.toHaveBeenCalled();
  expect(sdk.threads.queuedMessages.list).not.toHaveBeenCalled();
});
