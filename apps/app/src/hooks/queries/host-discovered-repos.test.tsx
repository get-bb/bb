// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeferredPromise } from "@bb/test-helpers";
import type { HostDiscoveredReposResponse } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useHostDiscoveredRepos } from "./host-queries";

vi.mock("@/lib/sdk", () => ({
  sdk: { hosts: { experimental_discoverRepos: vi.fn() } },
}));

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useHostListRealtimeSubscription: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("guide repo discovery observations", () => {
  it("does not report a discovery failure when leaving cancels the query", async () => {
    let requestSignal: AbortSignal | undefined;
    vi.mocked(sdk.hosts.experimental_discoverRepos).mockImplementation(
      ({ signal }) => {
        requestSignal = signal;
        return new Promise((_, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    );
    const recordOutcome = vi.fn();
    const onRequest = vi.fn(() => recordOutcome);
    const harness = createQueryClientTestHarness();
    const hook = renderHook(
      () => useHostDiscoveredRepos("host_test", { onRequest }),
      { wrapper: harness.wrapper },
    );
    await waitFor(() => expect(onRequest).toHaveBeenCalledOnce());
    await act(async () => hook.unmount());
    expect(requestSignal?.aborted).toBe(true);
    expect(recordOutcome).not.toHaveBeenCalled();
    harness.queryClient.clear();
  });

  it("still reports an actual failed discovery request", async () => {
    const failure = new Error("discovery unavailable");
    vi.mocked(sdk.hosts.experimental_discoverRepos).mockRejectedValue(failure);
    const recordOutcome = vi.fn();
    const onRequest = vi.fn(() => recordOutcome);
    const harness = createQueryClientTestHarness();
    const hook = renderHook(
      () => useHostDiscoveredRepos("host_test", { onRequest }),
      { wrapper: harness.wrapper },
    );
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(hook.result.current.error).toBe(failure);
    expect(onRequest).toHaveBeenCalledOnce();
    expect(recordOutcome).toHaveBeenCalledExactlyOnceWith("failed", null);
    hook.unmount();
    harness.queryClient.clear();
  });
});

it("keeps the actual response callback through observer departure without recounting cached results", async () => {
  const pending = createDeferredPromise<HostDiscoveredReposResponse>();
  vi.mocked(sdk.hosts.experimental_discoverRepos).mockReturnValue(
    pending.promise,
  );
  const recordOutcome = vi.fn();
  const onRequest = vi.fn(() => recordOutcome);
  const harness = createQueryClientTestHarness();
  const view = renderHook(
    ({ observing }) =>
      useHostDiscoveredRepos(
        "host_test",
        observing ? { onRequest } : undefined,
      ),
    {
      initialProps: { observing: true },
      wrapper: harness.wrapper,
    },
  );
  await waitFor(() => expect(onRequest).toHaveBeenCalledOnce());
  view.rerender({ observing: false });
  const response: HostDiscoveredReposResponse = { repos: [], truncated: false };
  await act(async () => pending.resolve(response));
  await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
  expect(recordOutcome).toHaveBeenCalledExactlyOnceWith("succeeded", response);
  view.rerender({ observing: true });
  expect(onRequest).toHaveBeenCalledOnce();
  expect(recordOutcome).toHaveBeenCalledOnce();
  view.unmount();
  harness.queryClient.clear();
});
