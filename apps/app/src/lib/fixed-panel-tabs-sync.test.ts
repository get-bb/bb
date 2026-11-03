// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { replaceNewTabWithSecondaryPanelTabInState } from "@bb/client-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserFixedPanelTab,
  createEmptyFixedPanelTabsState,
  createNewTabFixedPanelTab,
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
import {
  getCachedThreadTabs,
  invalidateCachedThreadTabs,
} from "@/hooks/cache-owners/thread-tabs-cache-owner";
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
  it("automatically saves legacy core tabs as registered entries without changing order", async () => {
    const threadId = "legacy-core-tabs";
    const terminal = createTerminalFixedPanelTab({ terminalId: "keep" });
    const tabs = [
      terminal,
      {
        id: "plugin-fixed:bb--git:diff",
        kind: "plugin-fixed",
        pluginId: "bb--git",
        tabId: "diff",
      },
      {
        id: "plugin-fixed:core:info",
        kind: "plugin-fixed",
        pluginId: "core",
        tabId: "info",
      },
    ];
    apiMocks.getThreadTabs.mockResolvedValue({
      revision: 7,
      tabs: [
        terminal,
        { id: "git-diff:git-diff:none", kind: "git-diff" },
        { id: "thread-info:thread-info:none", kind: "thread-info" },
      ],
    });
    apiMocks.updateThreadTabs.mockResolvedValue({ revision: 8, tabs });
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => useFixedPanelTabsState(threadId, threadId),
      { wrapper: createQueryWrapper(queryClient) },
    );
    await waitFor(() =>
      expect(apiMocks.updateThreadTabs).toHaveBeenCalledWith({
        threadId,
        expectedRevision: 7,
        tabs,
      }),
    );
    await waitFor(() => expect(result.current.secondary.tabs).toEqual(tabs));
    expect(apiMocks.updateThreadTabs).toHaveBeenCalledTimes(1);
  });

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

  it("keeps a newer saved tab list when an older tab fetch lands last", async () => {
    const threadId = "sync-stale-fetch";
    const info = createThreadInfoFixedPanelTab();
    const closedTerminal = createTerminalFixedPanelTab({ terminalId: "old" });
    const newTerminal = createTerminalFixedPanelTab({ terminalId: "new" });
    let resolveStaleFetch: (response: unknown) => void = () => {};
    apiMocks.getThreadTabs
      .mockResolvedValueOnce({ revision: 1, tabs: [info, closedTerminal] })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveStaleFetch = resolve;
        }),
      );
    apiMocks.updateThreadTabs
      .mockResolvedValueOnce({ revision: 2, tabs: [info] })
      .mockResolvedValueOnce({ revision: 3, tabs: [info, newTerminal] });
    const queryClient = createTestQueryClient();
    const { result } = renderHook(
      () => ({
        state: useFixedPanelTabsState(threadId, threadId),
        update: useUpdateFixedPanelTabsState(threadId, threadId),
      }),
      { wrapper: createQueryWrapper(queryClient) },
    );
    await waitFor(() => {
      expect(result.current.state.secondary.tabs).toEqual([
        info,
        closedTerminal,
      ]);
    });

    act(() => {
      result.current.update((current) => ({
        ...current,
        secondary: {
          activeTabId: info.id,
          isOpen: true,
          tabs: [info],
        },
      }));
    });
    await waitFor(() =>
      expect(getCachedThreadTabs(queryClient, threadId)?.revision).toBe(2),
    );
    act(() => invalidateCachedThreadTabs(queryClient, threadId));
    await waitFor(() =>
      expect(apiMocks.getThreadTabs).toHaveBeenCalledTimes(2),
    );

    act(() => {
      result.current.update((current) => ({
        ...current,
        secondary: {
          activeTabId: newTerminal.id,
          isOpen: true,
          tabs: [info, newTerminal],
        },
      }));
    });
    await waitFor(() =>
      expect(getCachedThreadTabs(queryClient, threadId)?.revision).toBe(3),
    );

    act(() => resolveStaleFetch({ revision: 2, tabs: [info] }));
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));

    expect(getCachedThreadTabs(queryClient, threadId)).toEqual({
      revision: 3,
      tabs: [info, newTerminal],
    });
    expect(result.current.state.secondary.tabs).toEqual([info, newTerminal]);
    expect(result.current.state.secondary.activeTabId).toBe(newTerminal.id);
  });

  it.each([1, 2])(
    "keeps a newly opened tab selected after %i concurrent save conflicts",
    async (conflicts) => {
      const threadId = `sync-stale-write-${conflicts}`;
      const originalTab = createThreadInfoFixedPanelTab();
      const localTab = createBrowserFixedPanelTab({
        environmentId: null,
        url: "https://local.example.com",
      });
      const concurrentTab = createBrowserFixedPanelTab({
        environmentId: null,
        url: "https://concurrent.example.com",
      });
      apiMocks.getThreadTabs.mockResolvedValueOnce({
        revision: 1,
        tabs: [originalTab],
      });
      for (let attempt = 1; attempt <= conflicts; attempt++) {
        apiMocks.getThreadTabs.mockResolvedValueOnce({
          revision: attempt + 1,
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
      }
      apiMocks.updateThreadTabs.mockResolvedValueOnce({
        revision: conflicts + 2,
        tabs: [originalTab, concurrentTab, localTab],
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
            activeTabId: localTab.id,
            isOpen: true,
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
        expect(apiMocks.getThreadTabs).toHaveBeenCalledTimes(conflicts + 1);
        expect(result.current.state.secondary.tabs).toEqual([
          originalTab,
          concurrentTab,
          localTab,
        ]);
      });
      expect(result.current.state.secondary.activeTabId).toBe(localTab.id);
      expect(result.current.state.secondary.isOpen).toBe(true);
      expect(apiMocks.updateThreadTabs).toHaveBeenLastCalledWith({
        expectedRevision: conflicts + 1,
        tabs: [originalTab, concurrentTab, localTab],
        threadId,
      });
      expect(apiMocks.updateThreadTabs).toHaveBeenCalledTimes(conflicts + 1);
    },
  );

  it("consumes New tab when native Browser registration races the replacement write", async () => {
    const threadId = "sync-stale-write";
    const originalTab = createThreadInfoFixedPanelTab();
    const placeholder = createNewTabFixedPanelTab();
    const existingTab = createBrowserFixedPanelTab({
      environmentId: null,
      url: "https://existing.example.com",
    });
    const localTab = createBrowserFixedPanelTab({
      environmentId: null,
      url: "",
    });
    const registeredTab = {
      ...localTab,
      desktopTarget: {
        hostId: "host-local",
        instanceId: "desktop-local",
        generation: "generation-local",
      },
    };
    const concurrentTab = createBrowserFixedPanelTab({
      environmentId: null,
      url: "https://concurrent.example.com",
    });
    apiMocks.getThreadTabs
      .mockResolvedValueOnce({
        revision: 1,
        tabs: [originalTab, placeholder, existingTab],
      })
      .mockResolvedValueOnce({
        revision: 2,
        tabs: [
          originalTab,
          placeholder,
          existingTab,
          registeredTab,
          concurrentTab,
        ],
      });
    apiMocks.updateThreadTabs
      .mockRejectedValueOnce(
        new BbHttpError({
          body: null,
          code: "thread_tabs_conflict",
          message: "changed",
          status: 409,
        }),
      )
      .mockResolvedValueOnce({
        revision: 3,
        tabs: [originalTab, registeredTab, existingTab, concurrentTab],
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
      expect(result.current.state.secondary.tabs).toEqual([
        originalTab,
        placeholder,
        existingTab,
      ]);
    });

    act(() => {
      result.current.update((state) =>
        replaceNewTabWithSecondaryPanelTabInState({ state, tab: localTab }),
      );
    });

    await waitFor(() => {
      expect(apiMocks.updateThreadTabs).toHaveBeenNthCalledWith(1, {
        expectedRevision: 1,
        tabs: [originalTab, localTab, existingTab],
        threadId,
      });
    });
    await waitFor(() => {
      expect(apiMocks.getThreadTabs).toHaveBeenCalledTimes(2);
      expect(apiMocks.updateThreadTabs).toHaveBeenNthCalledWith(2, {
        expectedRevision: 2,
        tabs: [originalTab, registeredTab, existingTab, concurrentTab],
        threadId,
      });
      expect(result.current.state.secondary.tabs).toEqual([
        originalTab,
        registeredTab,
        existingTab,
        concurrentTab,
      ]);
    });
    expect(result.current.state.secondary.activeTabId).toBe(localTab.id);
    expect(apiMocks.updateThreadTabs).toHaveBeenCalledTimes(2);
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
              pendingTerminalIds: { closing: new Set(), starting: new Set() },
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
