// @vitest-environment jsdom

import { QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAppQueryClient,
  installAppQueryClientBrowserEvents,
} from "./query-client";

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
});
