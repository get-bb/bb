// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BbDesktopBrowserState } from "@bb/desktop-contract";
import type {
  BrowserAutomationCloseMessage,
  BrowserAutomationOpenMessage,
} from "@bb/server-contract";
import { createNoopDesktopBrowserApi } from "@/test/bb-desktop-test-utils";
import {
  createBrowserAutomationClient,
  type BrowserAutomationTransport,
} from "@/lib/browser-automation-client";
import type {
  BrowserAutomationClientReply,
  WebSocketConnectedEvent,
} from "@/lib/ws";
import { resetPluginSlotStoreForTest } from "@/lib/plugin-slots";
import {
  resetRecentlyClosedPanelTabsForTest,
  useThreadFileTabs,
} from "./useThreadFileTabs";
import { useBrowserAutomationThreadHost } from "./useBrowserAutomationThreadHost";

vi.mock("@/hooks/queries/thread-tabs-query", () => ({
  useThreadTabs: () => ({ data: undefined }),
}));

vi.mock("@/lib/thread-tabs-sync", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/thread-tabs-sync")>();
  return {
    ...actual,
    hasPendingThreadTabsWrite: () => false,
    scheduleLocalThreadTabsMigration: () => {},
    scheduleThreadTabsPersistence: () => {},
  };
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function QueryWrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

interface Transport extends BrowserAutomationTransport {
  emitClose(message: BrowserAutomationCloseMessage): void;
  emitOpen(message: BrowserAutomationOpenMessage): void;
  replies: BrowserAutomationClientReply[];
}

function createTransport(): Transport {
  const openListeners = new Set<
    (message: BrowserAutomationOpenMessage) => void
  >();
  const closeListeners = new Set<
    (message: BrowserAutomationCloseMessage) => void
  >();
  const replies: BrowserAutomationClientReply[] = [];
  return {
    replies,
    clearCapability() {},
    onCancel() {
      return () => {};
    },
    onCommand() {
      return () => {};
    },
    onOpen(callback) {
      openListeners.add(callback);
      return () => {
        openListeners.delete(callback);
      };
    },
    onClose(callback) {
      closeListeners.add(callback);
      return () => {
        closeListeners.delete(callback);
      };
    },
    onConnected(_callback: (event: WebSocketConnectedEvent) => void) {
      return () => {};
    },
    onDisconnected() {
      return () => {};
    },
    sendReply(message) {
      replies.push(message);
    },
    setCapability() {},
    emitOpen(message) {
      for (const listener of openListeners) {
        listener(message);
      }
    },
    emitClose(message) {
      for (const listener of closeListeners) {
        listener(message);
      }
    },
  };
}

function createStatefulDesktopBrowser() {
  const listeners = new Set<(state: BbDesktopBrowserState) => void>();
  return {
    api: {
      ...createNoopDesktopBrowserApi(),
      onState(listener: (state: BbDesktopBrowserState) => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    emitState(state: BbDesktopBrowserState) {
      for (const listener of [...listeners]) {
        listener(state);
      }
    },
  };
}

afterEach(() => {
  cleanup();
  queryClient.clear();
  window.localStorage.clear();
  resetRecentlyClosedPanelTabsForTest();
  resetPluginSlotStoreForTest();
});

describe("useBrowserAutomationThreadHost", () => {
  it("opens and activates a fresh Browser tab through the thread's tab state, acknowledges it, and removes it on close", async () => {
    const transport = createTransport();
    const desktop = createStatefulDesktopBrowser();
    const client = createBrowserAutomationClient({
      desktopBrowser: desktop.api,
      resolveWindowIdentity: () => Promise.resolve({ windowId: "window-a" }),
      transport,
    });
    const stopClient = client.start();
    await act(async () => {
      await Promise.resolve();
    });
    const reveal = vi.fn();

    const { result } = renderHook(
      () => {
        const tabs = useThreadFileTabs({
          panelStateId: "thr_automation",
          syncThreadId: null,
          environmentId: "env_1",
          storageFiles: undefined,
          terminalSessions: undefined,
        });
        useBrowserAutomationThreadHost({
          browserTabs: tabs.browserTabs,
          client,
          closeTab: tabs.closeTab,
          enabled: true,
          openTab: tabs.openTab,
          reveal,
          threadId: "thr_automation",
        });
        return tabs;
      },
      { wrapper: QueryWrapper },
    );

    act(() => {
      result.current.openTab({
        kind: "browser",
        url: "https://user.example/",
      });
    });
    const userTabId = result.current.activeBrowserTab?.id ?? "";
    expect(userTabId).not.toBe("");

    act(() => {
      transport.emitOpen({
        type: "browser-automation.open",
        requestId: "req-1",
        targetId: "bt_1",
        threadId: "thr_automation",
        url: "https://agent.example/",
      });
    });

    const automationTab = result.current.activeBrowserTab;
    expect(automationTab).not.toBeNull();
    expect(automationTab?.id).not.toBe(userTabId);
    expect(automationTab?.url).toBe("https://agent.example/");
    expect(result.current.browserTabs.map((tab) => tab.id)).toEqual([
      userTabId,
      automationTab?.id,
    ]);
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(transport.replies).toEqual([]);

    act(() => {
      desktop.emitState({
        tabId: automationTab?.id ?? "",
        url: "https://agent.example/",
        title: "Agent page",
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        errorText: null,
      });
    });
    await vi.waitFor(() => {
      expect(transport.replies).toEqual([
        {
          type: "browser-automation.open-ready",
          requestId: "req-1",
          targetId: "bt_1",
          windowId: "window-a",
          tabId: automationTab?.id,
          url: "https://agent.example/",
        },
      ]);
    });

    act(() => {
      transport.emitClose({ type: "browser-automation.close", targetId: "bt_1" });
    });
    expect(result.current.browserTabs.map((tab) => tab.id)).toEqual([
      userTabId,
    ]);
    expect(transport.replies).toHaveLength(1);
    stopClient();
  });

  it("reports an automation tab the user closes from the panel", async () => {
    const transport = createTransport();
    const desktop = createStatefulDesktopBrowser();
    const client = createBrowserAutomationClient({
      desktopBrowser: desktop.api,
      resolveWindowIdentity: () => Promise.resolve({ windowId: "window-a" }),
      transport,
    });
    const stopClient = client.start();
    await act(async () => {
      await Promise.resolve();
    });

    const { result } = renderHook(
      () => {
        const tabs = useThreadFileTabs({
          panelStateId: "thr_user_close",
          syncThreadId: null,
          environmentId: "env_1",
          storageFiles: undefined,
          terminalSessions: undefined,
        });
        useBrowserAutomationThreadHost({
          browserTabs: tabs.browserTabs,
          client,
          closeTab: tabs.closeTab,
          enabled: true,
          openTab: tabs.openTab,
          reveal: () => {},
          threadId: "thr_user_close",
        });
        return tabs;
      },
      { wrapper: QueryWrapper },
    );

    act(() => {
      transport.emitOpen({
        type: "browser-automation.open",
        requestId: "req-2",
        targetId: "bt_2",
        threadId: "thr_user_close",
        url: "https://agent.example/",
      });
    });
    const automationTabId = result.current.activeBrowserTab?.id ?? "";
    expect(automationTabId).not.toBe("");

    act(() => {
      result.current.closeTab(automationTabId);
    });
    expect(result.current.browserTabs).toEqual([]);
    expect(transport.replies).toEqual([
      {
        type: "browser-automation.open-failed",
        requestId: "req-2",
        targetId: "bt_2",
        code: "tab_unavailable",
      },
    ]);
    stopClient();
  });
});
