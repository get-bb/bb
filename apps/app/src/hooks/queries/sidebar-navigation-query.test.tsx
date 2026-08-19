// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  sidebarBootstrapResponseSchema,
  type SidebarBootstrapResponse,
} from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "@/lib/api";
import {
  MAX_CACHED_SIDEBAR_THREADS_PER_PROJECT,
  SIDEBAR_BOOTSTRAP_CACHE_KEY,
  resetSidebarBootstrapCacheForTest,
} from "@/lib/sidebar-bootstrap-cache";
import { makeThreadListEntry } from "@/test/fixtures/thread-list-entries";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useSidebarNavigation } from "./sidebar-navigation-query";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, request: vi.fn() };
});

vi.mock("@/lib/api-server", () => ({
  apiClient: { "sidebar-bootstrap": { $get: vi.fn(() => ({})) } },
}));

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useEnvironmentListRealtimeSubscription: vi.fn(),
  useHostListRealtimeSubscription: vi.fn(),
  useProjectListRealtimeSubscription: vi.fn(),
  useThreadListRealtimeSubscription: vi.fn(),
}));

const PERSONAL_PROJECT: SidebarBootstrapResponse["personalProject"] = {
  id: "proj_personal",
  kind: "personal",
  name: "Personal",
  gitRemoteUrl: null,
  createdAt: 1,
  updatedAt: 1,
  sources: [],
  threads: [],
  defaultExecutionOptions: null,
};

const BOOTSTRAP: SidebarBootstrapResponse = {
  sections: [],
  projects: [
    {
      ...PERSONAL_PROJECT,
      id: "proj_felt",
      kind: "standard",
      name: "Felt walk",
    },
  ],
  personalProject: PERSONAL_PROJECT,
};

/** A request that never settles, so the pre-fetch render is observable. */
const pendingForever = () => new Promise<never>(() => {});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
  resetSidebarBootstrapCacheForTest();
});

describe("useSidebarNavigation", () => {
  it("replays the last bootstrap while the live one loads", async () => {
    // The cache validates reads against the wire schema, so the fixture must
    // be a real response shape; fail here, not silently in the replay.
    sidebarBootstrapResponseSchema.parse(BOOTSTRAP);

    vi.mocked(request).mockResolvedValue(BOOTSTRAP);
    const warmHarness = createQueryClientTestHarness();
    const warm = renderHook(() => useSidebarNavigation(), {
      wrapper: warmHarness.wrapper,
    });
    await waitFor(() => expect(warm.result.current.data).toEqual(BOOTSTRAP));
    warm.unmount();

    // A full page load starts from an empty query cache; only the profile's
    // last-known bootstrap can fill the rail before the network answers.
    vi.mocked(request).mockImplementation(pendingForever);
    const reloadHarness = createQueryClientTestHarness();
    const { result } = renderHook(() => useSidebarNavigation(), {
      wrapper: reloadHarness.wrapper,
    });
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data?.projects[0]?.name).toBe("Felt walk");
    await waitFor(() => expect(request).toHaveBeenCalled());
  });

  it("keeps the cold-profile skeleton: no placeholder without a stored bootstrap", () => {
    vi.mocked(request).mockImplementation(pendingForever);
    const harness = createQueryClientTestHarness();
    const { result } = renderHook(() => useSidebarNavigation(), {
      wrapper: harness.wrapper,
    });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPlaceholderData).toBe(false);
    expect(result.current.isPending).toBe(true);
  });

  it("stores a bounded copy off the critical path and replays it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const manyThreads = Array.from(
        { length: MAX_CACHED_SIDEBAR_THREADS_PER_PROJECT + 20 },
        (_, index) =>
          makeThreadListEntry({ id: `thr_${index}`, projectId: "proj_felt" }),
      );
      const large: SidebarBootstrapResponse = {
        ...BOOTSTRAP,
        projects: [{ ...BOOTSTRAP.projects[0]!, threads: manyThreads }],
        personalProject: { ...PERSONAL_PROJECT, threads: manyThreads },
      };
      sidebarBootstrapResponseSchema.parse(large);

      vi.mocked(request).mockResolvedValue(large);
      const warmHarness = createQueryClientTestHarness();
      const warm = renderHook(() => useSidebarNavigation(), {
        wrapper: warmHarness.wrapper,
      });
      await waitFor(() => expect(warm.result.current.data).toEqual(large));
      // The live query holds the full response; the store is not written
      // synchronously with it.
      expect(
        window.localStorage.getItem(SIDEBAR_BOOTSTRAP_CACHE_KEY),
      ).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      const stored = sidebarBootstrapResponseSchema.parse(
        JSON.parse(window.localStorage.getItem(SIDEBAR_BOOTSTRAP_CACHE_KEY)!),
      );
      expect(stored.projects[0]!.threads).toHaveLength(
        MAX_CACHED_SIDEBAR_THREADS_PER_PROJECT,
      );
      expect(stored.projects[0]!.threads[0]!.id).toBe("thr_0");
      expect(stored.personalProject.threads).toHaveLength(
        MAX_CACHED_SIDEBAR_THREADS_PER_PROJECT,
      );
      warm.unmount();

      resetSidebarBootstrapCacheForTest();
      vi.mocked(request).mockImplementation(pendingForever);
      const reloadHarness = createQueryClientTestHarness();
      const { result } = renderHook(() => useSidebarNavigation(), {
        wrapper: reloadHarness.wrapper,
      });
      expect(result.current.isPlaceholderData).toBe(true);
      expect(result.current.data?.projects[0]?.threads).toHaveLength(
        MAX_CACHED_SIDEBAR_THREADS_PER_PROJECT,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fail the fetch when storage rejects the write", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });
    try {
      vi.mocked(request).mockResolvedValue(BOOTSTRAP);
      const harness = createQueryClientTestHarness();
      const { result } = renderHook(() => useSidebarNavigation(), {
        wrapper: harness.wrapper,
      });
      await waitFor(() => expect(result.current.data).toEqual(BOOTSTRAP));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(setItem).toHaveBeenCalled();
      // The fetch stayed successful and nothing was stored.
      expect(result.current.isError).toBe(false);
      expect(
        window.localStorage.getItem(SIDEBAR_BOOTSTRAP_CACHE_KEY),
      ).toBeNull();
    } finally {
      setItem.mockRestore();
      vi.useRealTimers();
    }
  });
});
