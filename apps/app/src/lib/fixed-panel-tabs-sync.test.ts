// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserFixedPanelTab,
  createEmptyFixedPanelTabsState,
  createTerminalFixedPanelTab,
  createThreadInfoFixedPanelTab,
  FIXED_PANEL_TABS_IDLE_EXPIRY_MS,
  getFixedPanelTabsStateStorageKey,
  serializeFixedPanelTabsState,
} from "./fixed-panel-tabs-state";
import {
  resetFixedPanelTabsStorageMaintenanceForTest,
  useFixedPanelTabsState,
  useFixedPanelTabsStorageMaintenance,
  useSetFixedSecondaryPanelTab,
  useSetFixedRightTerminalActiveTerminal,
  useRemoveFixedRightTerminalTab,
  useUpdateFixedPanelTabsState,
} from "./fixed-panel-tabs";
import { BbHttpError } from "./sdk";
import { syncTerminalTabsInFixedPanelState } from "@/components/secondary-panel/terminalPanelTabs";
import { useThreadSecondaryPanelDrawerVisibility } from "@/views/thread-detail/useThreadSecondaryPanelVisibility";

const apiMocks = vi.hoisted(() => ({
  getThreadTabs: vi.fn(),
  updateThreadTabs: vi.fn(),
}));

vi.mock("./sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sdk")>();
  return {
    ...actual,
    sdk: {
      threads: {
        tabs: {
          get: apiMocks.getThreadTabs,
          update: apiMocks.updateThreadTabs,
        },
      },
    },
  };
});

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
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("fixed panel tab server sync", () => {
  it("does not let another window's stored presentation overwrite live tab history", () => {
    const panelStateId = "window-local-history";
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        state: useFixedPanelTabsState(panelStateId, null),
        activate: useSetFixedRightTerminalActiveTerminal(panelStateId, null),
        close: useRemoveFixedRightTerminalTab(panelStateId, null),
      }),
      { wrapper: createQueryWrapper(queryClient) },
    );
    act(() => result.current.activate("source"));
    act(() => result.current.activate("detour"));
    const live = result.current.state;

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: getFixedPanelTabsStateStorageKey({ threadId: panelStateId }),
          newValue: serializeFixedPanelTabsState({
            state: {
              ...live,
              secondary: {
                ...live.secondary,
                activeTabId: createTerminalFixedPanelTab({
                  terminalId: "source",
                }).id,
              },
            },
          }),
          storageArea: window.localStorage,
        }),
      );
    });

    expect(result.current.state).toBe(live);
    act(() => result.current.close("detour"));
    expect(result.current.state.secondary.activeTabId).toBe(
      createTerminalFixedPanelTab({ terminalId: "source" }).id,
    );
  });

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

  it("uses server tabs when local migration is stale", async () => {
    const threadId = "sync-stale-migration";
    const localTab = createBrowserFixedPanelTab({
      environmentId: null,
      url: "https://local.example.com",
    });
    const serverTab = createBrowserFixedPanelTab({
      environmentId: null,
      url: "https://server.example.com",
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
    apiMocks.getThreadTabs
      .mockResolvedValueOnce({ revision: 0, tabs: [] })
      .mockResolvedValueOnce({ revision: 1, tabs: [serverTab] });
    apiMocks.updateThreadTabs.mockRejectedValueOnce(
      new BbHttpError({
        body: null,
        code: "thread_tabs_conflict",
        message: "changed",
        status: 409,
      }),
    );
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => useFixedPanelTabsState(threadId, threadId),
      { wrapper: createQueryWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(apiMocks.updateThreadTabs).toHaveBeenCalledWith({
        expectedRevision: 0,
        tabs: [localTab],
        threadId,
      });
    });
    await waitFor(() => {
      expect(apiMocks.getThreadTabs).toHaveBeenCalledTimes(2);
      expect(result.current.secondary.tabs).toEqual([serverTab]);
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
      expect(apiMocks.updateThreadTabs).toHaveBeenCalledWith({
        expectedRevision: 2,
        tabs: [savedTab],
        threadId,
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

  it("refreshes from the server after a stale local write", async () => {
    const threadId = "sync-stale-write";
    const originalTab = createThreadInfoFixedPanelTab();
    const localTab = createBrowserFixedPanelTab({
      environmentId: null,
      url: "https://local.example.com",
    });
    const concurrentTab = createBrowserFixedPanelTab({
      environmentId: null,
      url: "https://concurrent.example.com",
    });
    apiMocks.getThreadTabs
      .mockResolvedValueOnce({ revision: 1, tabs: [originalTab] })
      .mockResolvedValueOnce({
        revision: 2,
        tabs: [originalTab, concurrentTab],
      });
    apiMocks.updateThreadTabs.mockRejectedValueOnce(
      new BbHttpError({
        body: null,
        code: "thread_tabs_conflict",
        message: "changed",
        status: 409,
      }),
    );
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
      expect(apiMocks.updateThreadTabs).toHaveBeenCalledWith({
        expectedRevision: 1,
        tabs: [originalTab, localTab],
        threadId,
      });
    });
    await waitFor(() => {
      expect(apiMocks.getThreadTabs).toHaveBeenCalledTimes(2);
      expect(result.current.state.secondary.tabs).toEqual([
        originalTab,
        concurrentTab,
      ]);
    });
    expect(apiMocks.updateThreadTabs).toHaveBeenCalledTimes(1);
  });
});

describe("fixed panel tab storage churn", () => {
  it("keeps panel selection in memory when localStorage rejects the write", () => {
    const threadId = "storage-write-failure";
    const storageKey = getFixedPanelTabsStateStorageKey({ threadId });
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        selectPanel: useSetFixedSecondaryPanelTab(threadId, null),
        state: useFixedPanelTabsState(threadId, null),
      }),
      { wrapper: createQueryWrapper(queryClient) },
    );
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation((key) => {
        if (key === storageKey) {
          throw new DOMException("quota", "QuotaExceededError");
        }
      });

    act(() => result.current.selectPanel("thread-info"));

    expect(result.current.state.secondary).toMatchObject({
      activeTabId: createThreadInfoFixedPanelTab().id,
      isOpen: true,
    });
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(setItem).toHaveBeenCalledWith(storageKey, expect.any(String));
  });

  it("schedules the storage prune once per page load, off the mount task", () => {
    vi.useFakeTimers();
    resetFixedPanelTabsStorageMaintenanceForTest();
    try {
      const now = Date.now();
      const expiredBlob = serializeFixedPanelTabsState({
        state: createEmptyFixedPanelTabsState({
          lastUsedAt: now - FIXED_PANEL_TABS_IDLE_EXPIRY_MS - 1,
        }),
      });
      const firstKey = getFixedPanelTabsStateStorageKey({ threadId: "one" });
      window.localStorage.setItem(firstKey, expiredBlob);

      const first = renderHook(() => useFixedPanelTabsStorageMaintenance());
      expect(window.localStorage.getItem(firstKey)).not.toBeNull();
      act(() => {
        vi.runAllTimers();
      });
      expect(window.localStorage.getItem(firstKey)).toBeNull();
      first.unmount();

      const secondKey = getFixedPanelTabsStateStorageKey({ threadId: "two" });
      window.localStorage.setItem(secondKey, expiredBlob);
      renderHook(() => useFixedPanelTabsStorageMaintenance());
      act(() => {
        vi.runAllTimers();
      });
      expect(window.localStorage.getItem(secondKey)).not.toBeNull();
    } finally {
      vi.useRealTimers();
      resetFixedPanelTabsStorageMaintenanceForTest();
    }
  });
});

describe("terminal activation history", () => {
  it.each([false, true])(
    "dismisses the empty compact panel after terminal close (sessions synchronized first: %s)",
    (syncBeforeClose) => {
      const panelId = `terminal-close-drawer-${syncBeforeClose}`;
      const queryClient = createTestQueryClient();
      const { result } = renderHook(
        () => {
          const drawer = useThreadSecondaryPanelDrawerVisibility({
            isCompactViewport: true,
            threadId: panelId,
          });
          return {
            drawer,
            state: useFixedPanelTabsState(panelId, null),
            update: useUpdateFixedPanelTabsState(panelId, null),
            activate: useSetFixedRightTerminalActiveTerminal(panelId, null),
            close: useRemoveFixedRightTerminalTab(
              panelId,
              null,
              drawer.closeDrawer,
            ),
          };
        },
        { wrapper: createQueryWrapper(queryClient) },
      );
      act(() => {
        result.current.activate("closing-terminal");
        result.current.drawer.openDrawer();
      });
      expect(result.current.drawer.isDrawerVisible).toBe(true);
      if (syncBeforeClose) {
        act(() =>
          result.current.update((state) =>
            syncTerminalTabsInFixedPanelState({
              state,
              terminalSessions: [],
            }),
          ),
        );
      }
      act(() => result.current.close("closing-terminal"));
      expect(result.current.state.secondary.tabs).toEqual([]);
      expect(result.current.drawer.isDrawerVisible).toBe(false);
    },
  );

  it("returns to the prior tab through the terminal-specific hooks", () => {
    const panelId = "terminal-history";
    const source = createBrowserFixedPanelTab({
      environmentId: null,
      url: "https://source.example.com",
    });
    const neighbor = createBrowserFixedPanelTab({
      environmentId: null,
      url: "https://neighbor.example.com",
    });
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        state: useFixedPanelTabsState(panelId, null),
        update: useUpdateFixedPanelTabsState(panelId, null),
        activate: useSetFixedRightTerminalActiveTerminal(panelId, null),
        close: useRemoveFixedRightTerminalTab(panelId, null),
      }),
      { wrapper: createQueryWrapper(queryClient) },
    );
    act(() =>
      result.current.update(() =>
        createEmptyFixedPanelTabsState({
          secondary: {
            tabs: [source, neighbor],
            activeTabId: source.id,
            isOpen: true,
          },
        }),
      ),
    );
    act(() => result.current.activate("terminal-history"));
    act(() => result.current.close("terminal-history"));
    expect(result.current.state.secondary.activeTabId).toBe(source.id);
  });
});
