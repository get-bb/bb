// @vitest-environment jsdom
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOST_DERIVED_QUERY_POLICY } from "../queries/query-policies";
import {
  HOST_DERIVED_REFRESH_INTERVAL_MS,
  installHostDerivedStateRefresh,
  invalidateHostDerivedState,
} from "./host-derived-state-owner";

interface ObservedQuery {
  calls: () => number;
  stop: () => void;
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
}

function observe(
  queryClient: QueryClient,
  key: string,
  options: { hostDerived: boolean; staleTime?: number },
): ObservedQuery {
  let calls = 0;
  const observer = new QueryObserver(queryClient, {
    queryKey: [key],
    queryFn: () => {
      calls += 1;
      return calls;
    },
    ...(options.hostDerived ? HOST_DERIVED_QUERY_POLICY : {}),
    ...(options.staleTime === undefined
      ? {}
      : { staleTime: options.staleTime }),
  });
  const unsubscribe = observer.subscribe(() => {});
  return { calls: () => calls, stop: unsubscribe };
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe("host-derived state owner", () => {
  let queryClient: QueryClient;
  let cleanup: () => void;
  const observed: ObservedQuery[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { refetchOnWindowFocus: false, retry: false },
      },
    });
    cleanup = installHostDerivedStateRefresh(queryClient).cleanup;
  });

  afterEach(() => {
    for (const query of observed.splice(0)) query.stop();
    cleanup();
    queryClient.clear();
    vi.useRealTimers();
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("refetches stale host-derived queries when the user returns", async () => {
    const stale = observe(queryClient, "cli-status", { hostDerived: true });
    const fresh = observe(queryClient, "fresh-host", {
      hostDerived: true,
      staleTime: 10 * 60_000,
    });
    const server = observe(queryClient, "threads", {
      hostDerived: false,
      staleTime: 0,
    });
    observed.push(stale, fresh, server);
    await settle();
    await vi.advanceTimersByTimeAsync(31_000);

    window.dispatchEvent(new Event("focus"));
    await settle();

    expect([stale.calls(), fresh.calls(), server.calls()]).toEqual([2, 1, 1]);
  });

  it("refetches on a bounded interval only while the page is visible", async () => {
    const query = observe(queryClient, "cli-status", { hostDerived: true });
    observed.push(query);
    await settle();

    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(HOST_DERIVED_REFRESH_INTERVAL_MS);
    expect(query.calls()).toBe(1);

    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(HOST_DERIVED_REFRESH_INTERVAL_MS);
    expect(query.calls()).toBe(2);
  });

  it("refetches fresh host-derived queries on a host-side change", async () => {
    const host = observe(queryClient, "cli-status", { hostDerived: true });
    const server = observe(queryClient, "threads", { hostDerived: false });
    observed.push(host, server);
    await settle();

    await invalidateHostDerivedState(queryClient);

    expect([host.calls(), server.calls()]).toEqual([2, 1]);
  });
});
