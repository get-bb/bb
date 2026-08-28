// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  sidebarBootstrapResponseSchema,
  type SidebarBootstrapResponse,
} from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as realtime from "@/hooks/useRealtimeSubscription";
import {
  MAX_CACHED_SIDEBAR_THREADS_PER_PROJECT,
  SIDEBAR_BOOTSTRAP_CACHE_KEY,
  resetSidebarBootstrapCacheForTest,
} from "@/lib/sidebar-bootstrap-cache";
import { makeThreadListEntry } from "@/test/fixtures/thread-list-entries";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useSidebarNavigation } from "./sidebar-navigation-query";

vi.spyOn(realtime, "useEnvironmentListRealtimeSubscription").mockImplementation(
  () => undefined,
);
vi.spyOn(realtime, "useHostListRealtimeSubscription").mockImplementation(
  () => undefined,
);
vi.spyOn(realtime, "useProjectListRealtimeSubscription").mockImplementation(
  () => undefined,
);
vi.spyOn(realtime, "useThreadListRealtimeSubscription").mockImplementation(
  () => undefined,
);

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

let fetchPending = false;
let fetchBootstrap = BOOTSTRAP;
const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
  fetchPending
    ? new Promise<Response>(() => {})
    : Promise.resolve(
        new Response(JSON.stringify(fetchBootstrap), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      ),
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchPending = false;
  fetchBootstrap = BOOTSTRAP;
  window.localStorage.clear();
  resetSidebarBootstrapCacheForTest();
});

describe("useSidebarNavigation", () => {
  it("replays the last bootstrap while the live one loads", async () => {
    sidebarBootstrapResponseSchema.parse(BOOTSTRAP);

    fetchBootstrap = BOOTSTRAP;
    const warmHarness = createQueryClientTestHarness();
    const warm = renderHook(() => useSidebarNavigation(), {
      wrapper: warmHarness.wrapper,
    });
    await waitFor(() => expect(warm.result.current.data).toEqual(BOOTSTRAP));
    warm.unmount();

    fetchPending = true;
    const reloadHarness = createQueryClientTestHarness();
    const { result } = renderHook(() => useSidebarNavigation(), {
      wrapper: reloadHarness.wrapper,
    });
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data?.projects[0]?.name).toBe("Felt walk");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("keeps the cold-profile skeleton: no placeholder without a stored bootstrap", () => {
    fetchPending = true;
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

      fetchBootstrap = large;
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
      fetchPending = true;
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
      fetchBootstrap = BOOTSTRAP;
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
