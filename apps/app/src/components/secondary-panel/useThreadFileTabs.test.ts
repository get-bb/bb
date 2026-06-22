// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  createEmptyFixedPanelTabsState,
  createHostFilePreviewFixedPanelTab,
  createTerminalFixedPanelTab,
  createThreadInfoFixedPanelTab,
  createThreadStorageFilePreviewFixedPanelTab,
  type FixedPanelTab,
  getFixedPanelTabsStateStorageKey,
  serializeFixedPanelTabsState,
  FIXED_PANEL_TABS_STATE_STORAGE_VERSION,
} from "@/lib/fixed-panel-tabs-state";
import { pruneTerminalTabs, useThreadFileTabs } from "./useThreadFileTabs";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("pruneTerminalTabs", () => {
  it("removes terminal tabs that no longer have visible sessions", () => {
    const infoTab = createThreadInfoFixedPanelTab();
    const staleTerminalTab = createTerminalFixedPanelTab({
      terminalId: "term_exited",
    });
    const currentTerminalTab = createTerminalFixedPanelTab({
      terminalId: "term_running",
    });
    const tabs: readonly FixedPanelTab[] = [
      infoTab,
      staleTerminalTab,
      currentTerminalTab,
    ];

    const nextTabs = pruneTerminalTabs({
      knownTerminalIds: new Set(["term_running"]),
      tabs,
    });

    expect(nextTabs).toEqual([infoTab, currentTerminalTab]);
  });

  it("preserves tab array identity when every terminal tab is still visible", () => {
    const tabs: readonly FixedPanelTab[] = [
      createThreadInfoFixedPanelTab(),
      createTerminalFixedPanelTab({ terminalId: "term_running" }),
    ];

    const nextTabs = pruneTerminalTabs({
      knownTerminalIds: new Set(["term_running"]),
      tabs,
    });

    expect(nextTabs).toBe(tabs);
  });
});

describe("useThreadFileTabs active owners", () => {
  it("returns owner ids for an active restored host file tab", () => {
    const threadId = "root-compose-ownerful";
    const hostTab = createHostFilePreviewFixedPanelTab({
      environmentId: "env_file",
      tab: {
        lineRange: null,
        path: "/tmp/log.txt",
      },
      threadId: "thr_file",
    });
    const state = createEmptyFixedPanelTabsState({
      secondary: {
        activeTabId: hostTab.id,
        isOpen: true,
        tabs: [hostTab],
      },
      lastUsedAt: Date.now(),
    });
    window.localStorage.setItem(
      getFixedPanelTabsStateStorageKey({ threadId }),
      serializeFixedPanelTabsState({ state }),
    );

    const { result } = renderHook(() =>
      useThreadFileTabs({
        threadId,
        environmentId: "env_current",
        fileOwnerThreadId: "thr_current",
        preserveWorkspaceTabsAcrossContexts: true,
        storageFiles: undefined,
        terminalSessions: undefined,
      }),
    );

    expect(result.current.activeHostFilePath).toBe("/tmp/log.txt");
    expect(result.current.activeHostFileThreadId).toBe("thr_file");
    expect(result.current.activeHostFileEnvironmentId).toBe("env_file");
  });

  it("backfills owner ids for an active legacy storage file tab", async () => {
    const threadId = "root-compose-legacy-storage";
    const legacyStorageTab = {
      id: "thread-storage-file-preview:artifact.txt:none",
      isPinned: false,
      kind: "thread-storage-file-preview",
      lineRange: null,
      path: "artifact.txt",
    };
    window.localStorage.setItem(
      getFixedPanelTabsStateStorageKey({ threadId }),
      JSON.stringify({
        version: FIXED_PANEL_TABS_STATE_STORAGE_VERSION,
        secondary: {
          activeTabId: legacyStorageTab.id,
          isOpen: true,
          tabs: [legacyStorageTab],
        },
        lastUsedAt: Date.now(),
      }),
    );

    const { result } = renderHook(() =>
      useThreadFileTabs({
        threadId,
        environmentId: "env_root",
        fileOwnerThreadId: "thr_root",
        preserveWorkspaceTabsAcrossContexts: true,
        storageFiles: undefined,
        terminalSessions: undefined,
      }),
    );

    await waitFor(() => {
      expect(result.current.activeStorageFilePath).toBe("artifact.txt");
      expect(result.current.activeStorageFileThreadId).toBe("thr_root");
      expect(result.current.activeStorageFileEnvironmentId).toBe("env_root");
    });
  });

  it("returns owner ids for an active restored storage file tab", () => {
    const threadId = "root-compose-ownerful-storage";
    const storageTab = createThreadStorageFilePreviewFixedPanelTab({
      environmentId: "env_file",
      isPinned: false,
      tab: {
        lineRange: null,
        path: "artifact.txt",
      },
      threadId: "thr_file",
    });
    const state = createEmptyFixedPanelTabsState({
      secondary: {
        activeTabId: storageTab.id,
        isOpen: true,
        tabs: [storageTab],
      },
      lastUsedAt: Date.now(),
    });
    window.localStorage.setItem(
      getFixedPanelTabsStateStorageKey({ threadId }),
      serializeFixedPanelTabsState({ state }),
    );

    const { result } = renderHook(() =>
      useThreadFileTabs({
        threadId,
        environmentId: "env_current",
        fileOwnerThreadId: "thr_current",
        preserveWorkspaceTabsAcrossContexts: true,
        storageFiles: undefined,
        terminalSessions: undefined,
      }),
    );

    expect(result.current.activeStorageFilePath).toBe("artifact.txt");
    expect(result.current.activeStorageFileThreadId).toBe("thr_file");
    expect(result.current.activeStorageFileEnvironmentId).toBe("env_file");
  });
});
