// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserFixedPanelTab,
  createEmptyFixedPanelTabsState,
  createSideChatFixedPanelTab,
  createThreadInfoFixedPanelTab,
  getFixedPanelTabsStateStorageKey,
  serializeFixedPanelTabsState,
} from "./fixed-panel-tabs-state";
import {
  useFixedPanelTabsState,
  useUpdateFixedPanelTabsState,
} from "./fixed-panel-tabs";
import { HttpError } from "./api";

const apiMocks = vi.hoisted(() => ({
  getThreadTabs: vi.fn(),
  updateThreadTabs: vi.fn(),
}));

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    getThreadTabs: apiMocks.getThreadTabs,
    updateThreadTabs: apiMocks.updateThreadTabs,
  };
});

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useThreadDetailRealtimeSubscription: vi.fn(),
}));

function createQueryWrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

afterEach(() => {
  cleanup();
  apiMocks.getThreadTabs.mockReset();
  apiMocks.updateThreadTabs.mockReset();
  window.localStorage.clear();
});

describe("fixed panel tab server sync", () => {
  it("keeps non-thread panel tabs local", () => {
    const panelStateId = "root-compose";
    const localTab = createThreadInfoFixedPanelTab();
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        state: useFixedPanelTabsState(panelStateId, null),
        update: useUpdateFixedPanelTabsState(panelStateId, null),
      }),
      { wrapper: createQueryWrapper(queryClient) },
    );

    act(() => {
      result.current.update((current) => ({
        ...current,
        secondary: {
          activeTabId: localTab.id,
          isOpen: true,
          tabs: [localTab],
        },
      }));
    });

    expect(result.current.state.secondary.tabs).toEqual([localTab]);
    expect(apiMocks.getThreadTabs).not.toHaveBeenCalled();
    expect(apiMocks.updateThreadTabs).not.toHaveBeenCalled();
  });

  it("adopts server tabs while keeping presentation state local", async () => {
    const threadId = "sync-remote-tabs";
    const localTab = createThreadInfoFixedPanelTab();
    const lastUsedAt = Date.now();
    const remoteTab = createSideChatFixedPanelTab({
      sourceMessageText: "Remote message",
      title: "Remote chat",
    });
    window.localStorage.setItem(
      getFixedPanelTabsStateStorageKey({ threadId }),
      serializeFixedPanelTabsState({
        state: createEmptyFixedPanelTabsState({
          lastUsedAt,
          secondary: {
            activeTabId: localTab.id,
            isOpen: true,
            tabs: [localTab],
          },
        }),
      }),
    );
    apiMocks.getThreadTabs.mockResolvedValue({
      revision: 4,
      tabs: [remoteTab],
    });
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => useFixedPanelTabsState(threadId, threadId),
      {
        wrapper: createQueryWrapper(queryClient),
      },
    );

    await waitFor(() => {
      expect(result.current.secondary.tabs).toEqual([remoteTab]);
    });
    expect(result.current).toMatchObject({
      lastUsedAt,
      secondary: { activeTabId: null, isOpen: true },
    });
  });

  it("migrates existing local tabs when the server has no tab row", async () => {
    const threadId = "sync-local-migration";
    const localTab = createBrowserFixedPanelTab({
      environmentId: null,
      url: "https://example.com",
    });
    window.localStorage.setItem(
      getFixedPanelTabsStateStorageKey({ threadId }),
      serializeFixedPanelTabsState({
        state: createEmptyFixedPanelTabsState({
          lastUsedAt: Date.now(),
          secondary: {
            activeTabId: localTab.id,
            isOpen: true,
            tabs: [localTab],
          },
        }),
      }),
    );
    apiMocks.getThreadTabs.mockResolvedValue({ revision: 0, tabs: [] });
    apiMocks.updateThreadTabs.mockResolvedValue({
      revision: 1,
      tabs: [localTab],
    });
    const queryClient = createTestQueryClient();
    renderHook(() => useFixedPanelTabsState(threadId, threadId), {
      wrapper: createQueryWrapper(queryClient),
    });

    await waitFor(() => {
      expect(apiMocks.updateThreadTabs).toHaveBeenCalledWith(threadId, {
        expectedRevision: 0,
        tabs: [localTab],
      });
    });
  });

  it("persists tab-list changes but not presentation-only changes", async () => {
    const threadId = "sync-local-updates";
    apiMocks.getThreadTabs.mockResolvedValue({ revision: 2, tabs: [] });
    const savedTab = createThreadInfoFixedPanelTab();
    apiMocks.updateThreadTabs.mockResolvedValue({
      revision: 3,
      tabs: [savedTab],
    });
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        state: useFixedPanelTabsState(threadId, threadId),
        update: useUpdateFixedPanelTabsState(threadId, threadId),
      }),
      { wrapper: createQueryWrapper(queryClient) },
    );
    await waitFor(() => expect(apiMocks.getThreadTabs).toHaveBeenCalled());

    act(() => {
      result.current.update((current) => ({
        ...current,
        secondary: {
          activeTabId: savedTab.id,
          isOpen: true,
          tabs: [savedTab],
        },
      }));
    });
    await waitFor(() => {
      expect(apiMocks.updateThreadTabs).toHaveBeenCalledWith(threadId, {
        expectedRevision: 2,
        tabs: [savedTab],
      });
    });

    apiMocks.updateThreadTabs.mockClear();
    act(() => {
      result.current.update((current) => ({
        ...current,
        secondary: { ...current.secondary, isOpen: false },
      }));
    });
    expect(apiMocks.updateThreadTabs).not.toHaveBeenCalled();
  });

  it("rebases a local tab change after a concurrent remote write", async () => {
    const threadId = "sync-conflict-rebase";
    const originalTab = createThreadInfoFixedPanelTab();
    const localTab = createBrowserFixedPanelTab({
      environmentId: null,
      url: "https://local.example.com",
    });
    const concurrentTab = createSideChatFixedPanelTab({
      sourceMessageText: "Concurrent message",
      title: "Concurrent chat",
    });
    apiMocks.getThreadTabs
      .mockResolvedValueOnce({ revision: 1, tabs: [originalTab] })
      .mockResolvedValueOnce({
        revision: 2,
        tabs: [originalTab, concurrentTab],
      });
    apiMocks.updateThreadTabs
      .mockRejectedValueOnce(
        new HttpError({
          code: "thread_tabs_conflict",
          message: "changed",
          status: 409,
        }),
      )
      .mockResolvedValueOnce({
        revision: 3,
        tabs: [originalTab, localTab, concurrentTab],
      });
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        state: useFixedPanelTabsState(threadId, threadId),
        update: useUpdateFixedPanelTabsState(threadId, threadId),
      }),
      { wrapper: createQueryWrapper(queryClient) },
    );
    await waitFor(() => {
      expect(result.current.state.secondary.tabs).toEqual([originalTab]);
    });

    act(() => {
      result.current.update((current) => ({
        ...current,
        secondary: {
          ...current.secondary,
          tabs: [...current.secondary.tabs, localTab],
        },
      }));
    });

    await waitFor(() => {
      expect(apiMocks.updateThreadTabs).toHaveBeenNthCalledWith(2, threadId, {
        expectedRevision: 2,
        tabs: [originalTab, concurrentTab, localTab],
      });
    });
  });
});
