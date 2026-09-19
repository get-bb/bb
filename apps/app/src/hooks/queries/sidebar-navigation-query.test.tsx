// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  sidebarBootstrapResponseSchema,
  type SidebarBootstrapResponse,
} from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeferredPromise } from "@bb/test-helpers";
import { request } from "@/lib/api";
import {
  MAX_CACHED_SIDEBAR_THREADS_PER_PROJECT,
  SIDEBAR_BOOTSTRAP_CACHE_KEY,
  resetSidebarBootstrapCacheForTest,
} from "@/lib/sidebar-bootstrap-cache";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  useProjectDisplayName,
  useSidebarNavigation,
} from "./sidebar-navigation-query";
import { sidebarNavigationQueryKey } from "./query-keys";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";

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

const PERSONAL_PROJECT: SidebarBootstrapResponse["personalProject"] =
  makeProjectWithThreadsResponse({
    id: "proj_personal",
    kind: "personal",
    name: "Personal",
    createdAt: 1,
    updatedAt: 1,
  });

const BOOTSTRAP: SidebarBootstrapResponse = makeSidebarBootstrapResponse({
  projects: [
    makeProjectWithThreadsResponse({
      id: "proj_felt",
      kind: "standard",
      name: "Felt walk",
      createdAt: 1,
      updatedAt: 1,
    }),
  ],
  personalProject: PERSONAL_PROJECT,
});

const pendingForever = () => new Promise<never>(() => {});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
  resetSidebarBootstrapCacheForTest();
});

describe("useSidebarNavigation", () => {
  it("shares persisted page data and replaces it after a background refresh", async () => {
    window.localStorage.setItem(
      SIDEBAR_BOOTSTRAP_CACHE_KEY,
      JSON.stringify(BOOTSTRAP),
    );
    const refresh = createDeferredPromise<SidebarBootstrapResponse>();
    vi.mocked(request).mockReturnValue(refresh.promise);
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => ({
        navigation: useSidebarNavigation(),
        name: useProjectDisplayName("proj_felt"),
      }),
      { wrapper },
    );
    expect(result.current.navigation.data).toEqual(BOOTSTRAP);
    expect(result.current.name).toBe("Felt walk");
    expect(result.current.navigation.isFetching).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    const updated = {
      ...BOOTSTRAP,
      projects: [{ ...BOOTSTRAP.projects[0]!, name: "Refreshed project" }],
    };
    await act(async () => {
      refresh.resolve(updated);
    });
    await waitFor(() => expect(result.current.name).toBe("Refreshed project"));
    expect(queryClient.getQueryData(sidebarNavigationQueryKey())).toEqual(
      updated,
    );
  });

  it("keeps persisted content after refresh failure and recovers on retry", async () => {
    window.localStorage.setItem(
      SIDEBAR_BOOTSTRAP_CACHE_KEY,
      JSON.stringify(BOOTSTRAP),
    );
    vi.mocked(request).mockRejectedValue(new Error("refresh failed"));
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => useSidebarNavigation(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toEqual(BOOTSTRAP);
    expect(result.current.isLoadingError).toBe(false);
    vi.mocked(request).mockResolvedValue(BOOTSTRAP);
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.isError).toBe(false));
    expect(result.current.data).toEqual(BOOTSTRAP);
  });

  it("prefers newer query data to persistence and honors invalidation", async () => {
    window.localStorage.setItem(
      SIDEBAR_BOOTSTRAP_CACHE_KEY,
      JSON.stringify(BOOTSTRAP),
    );
    const current = { ...BOOTSTRAP, projects: [] };
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData(sidebarNavigationQueryKey(), current);
    vi.mocked(request).mockResolvedValue(BOOTSTRAP);
    const { result } = renderHook(() => useSidebarNavigation(), { wrapper });
    expect(result.current.data).toEqual(current);
    expect(request).not.toHaveBeenCalled();
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: sidebarNavigationQueryKey(),
      });
    });
    await waitFor(() => expect(result.current.data).toEqual(BOOTSTRAP));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("preserves errors on a cache miss", async () => {
    vi.mocked(request).mockRejectedValue(new Error("load failed"));
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => useSidebarNavigation(), { wrapper });
    await waitFor(() => expect(result.current.isLoadingError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("replays the last bootstrap while the live one loads", async () => {
    sidebarBootstrapResponseSchema.parse(BOOTSTRAP);

    vi.mocked(request).mockResolvedValue(BOOTSTRAP);
    const warmHarness = createQueryClientTestHarness();
    const warm = renderHook(() => useSidebarNavigation(), {
      wrapper: warmHarness.wrapper,
    });
    await waitFor(() => expect(warm.result.current.data).toEqual(BOOTSTRAP));
    warm.unmount();

    vi.mocked(request).mockImplementation(pendingForever);
    const reloadHarness = createQueryClientTestHarness();
    const { result } = renderHook(() => useSidebarNavigation(), {
      wrapper: reloadHarness.wrapper,
    });
    expect(result.current.isPlaceholderData).toBe(false);
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
      expect(result.current.isPlaceholderData).toBe(false);
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
