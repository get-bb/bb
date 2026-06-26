// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { TerminalSession } from "@bb/server-contract";
import { afterEach, describe, expect, it } from "vitest";
import {
  createEmptyFixedPanelTabsState,
  createHostFilePreviewFixedPanelTab,
  createTerminalFixedPanelTab,
  createThreadStorageFilePreviewFixedPanelTab,
  getFixedPanelTabsStateStorageKey,
  serializeFixedPanelTabsState,
  FIXED_PANEL_TABS_STATE_STORAGE_VERSION,
} from "@/lib/fixed-panel-tabs-state";
import { useThreadFileTabs } from "./useThreadFileTabs";

type TerminalSessionOverrides = Partial<TerminalSession>;

function terminalSession(
  overrides: TerminalSessionOverrides,
): TerminalSession {
  return {
    id: "term_1",
    threadId: "thr_1",
    environmentId: "env_1",
    hostId: "host_1",
    title: "Terminal",
    initialCwd: "/workspace",
    cols: 100,
    rows: 30,
    status: "running",
    exitCode: null,
    closeReason: null,
    createdAt: 1,
    updatedAt: 1,
    lastUserInputAt: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("useThreadFileTabs terminal pruning", () => {
  it("drops disconnected terminal tabs when not retained", async () => {
    const threadId = "terminal-prune-unretained";
    const disconnectedTab = createTerminalFixedPanelTab({
      terminalId: "term_disconnected",
    });
    const runningTab = createTerminalFixedPanelTab({
      terminalId: "term_running",
    });
    const state = createEmptyFixedPanelTabsState({
      secondary: {
        activeTabId: runningTab.id,
        isOpen: true,
        tabs: [disconnectedTab, runningTab],
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
        storageFiles: undefined,
        terminalSessions: [
          terminalSession({
            id: "term_disconnected",
            status: "disconnected",
          }),
          terminalSession({ id: "term_running" }),
        ],
      }),
    );

    await waitFor(() => {
      expect(
        result.current.orderedSecondaryFileTabs.map((tab) => tab.id),
      ).toEqual([runningTab.id]);
    });
  });

  it("keeps a retained disconnected terminal tab", async () => {
    const threadId = "terminal-prune-retained";
    const disconnectedTab = createTerminalFixedPanelTab({
      terminalId: "term_disconnected",
    });
    const runningTab = createTerminalFixedPanelTab({
      terminalId: "term_running",
    });
    window.localStorage.setItem(
      getFixedPanelTabsStateStorageKey({ threadId }),
      serializeFixedPanelTabsState({
        state: createEmptyFixedPanelTabsState({
          secondary: {
            activeTabId: disconnectedTab.id,
            isOpen: true,
            tabs: [disconnectedTab, runningTab],
          },
          lastUsedAt: Date.now(),
        }),
      }),
    );

    const { result } = renderHook(() =>
      useThreadFileTabs({
        threadId,
        environmentId: "env_current",
        retainedTerminalId: "term_disconnected",
        storageFiles: undefined,
        terminalSessions: [
          terminalSession({
            id: "term_disconnected",
            status: "disconnected",
          }),
          terminalSession({ id: "term_running" }),
        ],
      }),
    );

    await waitFor(() => {
      expect(
        result.current.orderedSecondaryFileTabs.map((tab) => tab.id),
      ).toEqual([disconnectedTab.id, runningTab.id]);
    });
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
