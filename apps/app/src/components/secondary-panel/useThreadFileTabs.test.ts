// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TerminalSession } from "@bb/server-contract";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserFixedPanelTab,
  createEmptyFixedPanelTabsState,
  createHostFilePreviewFixedPanelTab,
  createTerminalFixedPanelTab,
  createThreadStorageFilePreviewFixedPanelTab,
  getFixedPanelTabsStateStorageKey,
  serializeFixedPanelTabsState,
  FIXED_PANEL_TABS_STATE_STORAGE_VERSION,
} from "@/lib/fixed-panel-tabs-state";
import { useThreadFileTabs } from "./useThreadFileTabs";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";

const syncMocks = vi.hoisted(() => ({
  scheduleLocalThreadTabsMigration: vi.fn(),
  scheduleThreadTabsPersistence: vi.fn(),
  useThreadTabs: vi.fn(() => ({ data: undefined })),
}));

vi.mock("@/hooks/queries/thread-tabs-query", () => ({
  useThreadTabs: syncMocks.useThreadTabs,
}));

vi.mock("@/lib/thread-tabs-sync", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/thread-tabs-sync")>();
  return {
    ...actual,
    hasPendingThreadTabsWrite: () => false,
    scheduleLocalThreadTabsMigration:
      syncMocks.scheduleLocalThreadTabsMigration,
    scheduleThreadTabsPersistence: syncMocks.scheduleThreadTabsPersistence,
  };
});

type TerminalSessionOverrides = Partial<TerminalSession>;

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function QueryWrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

function renderThreadHook<Result>(hook: () => Result) {
  return renderHook(hook, { wrapper: QueryWrapper });
}

function terminalSession(overrides: TerminalSessionOverrides): TerminalSession {
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
  queryClient.clear();
  window.localStorage.clear();
  resetPluginSlotStoreForTest();
  syncMocks.scheduleLocalThreadTabsMigration.mockClear();
  syncMocks.scheduleThreadTabsPersistence.mockClear();
  syncMocks.useThreadTabs.mockClear();
});

describe("useThreadFileTabs terminal pruning", () => {
  it("keeps root-compose file tabs local", () => {
    const { result } = renderThreadHook(() =>
      useThreadFileTabs({
        panelStateId: "root-compose",
        syncThreadId: null,
        environmentId: "env_root",
        storageFiles: undefined,
        terminalSessions: undefined,
      }),
    );

    act(() => {
      result.current.openTab({ kind: "new-tab" });
    });

    expect(syncMocks.useThreadTabs).toHaveBeenCalledWith("", {
      enabled: false,
    });
    expect(syncMocks.scheduleLocalThreadTabsMigration).not.toHaveBeenCalled();
    expect(syncMocks.scheduleThreadTabsPersistence).not.toHaveBeenCalled();
  });

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

    const { result } = renderThreadHook(() =>
      useThreadFileTabs({
        panelStateId: threadId,
        syncThreadId: threadId,
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

    const { result } = renderThreadHook(() =>
      useThreadFileTabs({
        panelStateId: threadId,
        syncThreadId: threadId,
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

    const { result } = renderThreadHook(() =>
      useThreadFileTabs({
        panelStateId: threadId,
        syncThreadId: threadId,
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

    const { result } = renderThreadHook(() =>
      useThreadFileTabs({
        panelStateId: threadId,
        syncThreadId: threadId,
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

    const { result } = renderThreadHook(() =>
      useThreadFileTabs({
        panelStateId: threadId,
        syncThreadId: threadId,
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

describe("useThreadFileTabs plugin panel tabs", () => {
  it("opens, focuses identical re-opens (title refreshed), and opens siblings for new params", () => {
    const threadId = "plugin-panel-open";
    const { result } = renderThreadHook(() =>
      useThreadFileTabs({
        panelStateId: threadId,
        syncThreadId: threadId,
        environmentId: "env_1",
        storageFiles: undefined,
        terminalSessions: undefined,
      }),
    );

    act(() =>
      result.current.openPluginPanel({
        pluginId: "demo",
        actionId: "issue",
        title: "Issue #1",
        paramsJson: '{"n":1}',
      }),
    );
    expect(result.current.orderedSecondaryFileTabs).toHaveLength(1);
    const firstTab = result.current.activePluginPanelTab;
    expect(firstTab).toMatchObject({
      kind: "plugin-panel",
      pluginId: "demo",
      actionId: "issue",
      title: "Issue #1",
      paramsJson: '{"n":1}',
    });

    // Identical params: no new tab, but the title refreshes.
    act(() =>
      result.current.openPluginPanel({
        pluginId: "demo",
        actionId: "issue",
        title: "Issue #1 (renamed)",
        paramsJson: '{"n":1}',
      }),
    );
    expect(result.current.orderedSecondaryFileTabs).toHaveLength(1);
    expect(result.current.activePluginPanelTab?.id).toBe(firstTab?.id);
    expect(result.current.activePluginPanelTab?.title).toBe(
      "Issue #1 (renamed)",
    );

    // Different params: a sibling tab opens and becomes active.
    act(() =>
      result.current.openPluginPanel({
        pluginId: "demo",
        actionId: "issue",
        title: "Issue #2",
        paramsJson: '{"n":2}',
      }),
    );
    expect(result.current.orderedSecondaryFileTabs).toHaveLength(2);
    expect(result.current.activePluginPanelTab?.paramsJson).toBe('{"n":2}');
  });

  it("replaces a transient new-tab like the other launchers", () => {
    const threadId = "plugin-panel-replace-new-tab";
    const { result } = renderThreadHook(() =>
      useThreadFileTabs({
        panelStateId: threadId,
        syncThreadId: threadId,
        environmentId: "env_1",
        storageFiles: undefined,
        terminalSessions: undefined,
      }),
    );
    act(() => result.current.openTab({ kind: "new-tab" }));
    expect(result.current.isNewTabActive).toBe(true);
    act(() =>
      result.current.openPluginPanel({
        pluginId: "demo",
        actionId: "issue",
        title: "Issue",
        paramsJson: null,
      }),
    );
    expect(result.current.isNewTabActive).toBe(false);
    expect(
      result.current.orderedSecondaryFileTabs.map((tab) => tab.kind),
    ).toEqual(["plugin-panel"]);
  });
});

describe("useThreadFileTabs file opener diversion", () => {
  function NotesEditor() {
    return null;
  }

  function registerNotesOpener() {
    setPluginSlotRegistrations("notes", {
      homepageSections: [],
      settingsSections: [],
      navPanels: [],
      threadPanelActions: [],
      sidebarFooterActions: [],
      fileOpeners: [
        {
          id: "editor",
          title: "Notes editor",
          extensions: ["md"],
          component: NotesEditor,
        },
      ],
      messageDirectives: [],
    });
  }

  it("automatically diverts matching working-tree files to the opener tab", () => {
    registerNotesOpener();
    const { result } = renderThreadHook(() =>
      useThreadFileTabs({
        panelStateId: "opener-divert",
        syncThreadId: "opener-divert",
        environmentId: "env_1",
        storageFiles: undefined,
        terminalSessions: undefined,
      }),
    );

    act(() =>
      result.current.openTab({
        kind: "workspace-file-preview",
        tab: {
          lineRange: { startLineNumber: 7, endLineNumber: 9 },
          path: "notes/todo.md",
          source: { kind: "working-tree" },
          statusLabel: null,
        },
      }),
    );

    expect(result.current.activePluginPanelTab).toMatchObject({
      kind: "plugin-panel",
      pluginId: "notes",
      actionId: "file-opener:editor",
      title: "todo.md",
    });
    const params = JSON.parse(
      result.current.activePluginPanelTab?.paramsJson ?? "null",
    ) as {
      path: string;
      source: { kind: string; environmentId: string | null };
    };
    expect(params.path).toBe("notes/todo.md");
    expect(params.source).toMatchObject({
      kind: "workspace",
      environmentId: "env_1",
    });
    expect(result.current.activePluginPanelTab?.fileOpenerOwner).toMatchObject({
      kind: "workspace-file-preview",
      tab: {
        lineRange: { startLineNumber: 7, endLineNumber: 9 },
      },
    });
    expect(result.current.activeFileOpenerOwner).toBe(
      result.current.activePluginPanelTab?.fileOpenerOwner,
    );
    expect(result.current.activeWorkspaceFilePath).toBe("notes/todo.md");
    expect(result.current.activeWorkspaceFileLineRange).toEqual({
      startLineNumber: 7,
      endLineNumber: 9,
    });

    const firstTabId = result.current.activePluginPanelTab?.id;
    act(() =>
      result.current.openTab({
        kind: "workspace-file-preview",
        tab: {
          lineRange: { startLineNumber: 15, endLineNumber: 15 },
          path: "notes/todo.md",
          source: { kind: "working-tree" },
          statusLabel: null,
        },
      }),
    );
    expect(result.current.activePluginPanelTab?.id).toBe(firstTabId);
    expect(result.current.activeWorkspaceFileLineRange).toEqual({
      startLineNumber: 15,
      endLineNumber: 15,
    });
  });

  it("preserves native host and thread-storage preview state", () => {
    registerNotesOpener();
    const { result } = renderThreadHook(() =>
      useThreadFileTabs({
        panelStateId: "opener-owner-context",
        syncThreadId: "thr_owner",
        environmentId: "env_1",
        storageFiles: undefined,
        terminalSessions: undefined,
      }),
    );

    act(() =>
      result.current.openTab({
        kind: "host-file-preview",
        tab: {
          lineRange: { startLineNumber: 11, endLineNumber: 12 },
          path: "/tmp/readme.md",
        },
      }),
    );
    expect(result.current.activeFileOpenerOwner).toEqual({
      kind: "host-file-preview",
      environmentId: "env_1",
      hostId: null,
      tab: {
        lineRange: { startLineNumber: 11, endLineNumber: 12 },
        path: "/tmp/readme.md",
      },
      threadId: "thr_owner",
    });
    expect(result.current.activeHostFilePath).toBe("/tmp/readme.md");
    expect(result.current.activeHostFileLineRange).toEqual({
      startLineNumber: 11,
      endLineNumber: 12,
    });

    act(() =>
      result.current.openTab({
        kind: "thread-storage-file-preview",
        tab: {
          lineRange: { startLineNumber: 2, endLineNumber: 5 },
          path: "artifacts/report.md",
        },
      }),
    );
    expect(result.current.activeFileOpenerOwner).toEqual({
      kind: "thread-storage-file-preview",
      environmentId: "env_1",
      tab: {
        lineRange: { startLineNumber: 2, endLineNumber: 5 },
        path: "artifacts/report.md",
      },
      threadId: "thr_owner",
    });
    expect(result.current.activeStorageFilePath).toBe("artifacts/report.md");
    expect(result.current.activeStorageFileLineRange).toEqual({
      startLineNumber: 2,
      endLineNumber: 5,
    });
  });

  it("keeps the built-in preview for ref snapshots and unmatched extensions", () => {
    registerNotesOpener();
    const { result } = renderThreadHook(() =>
      useThreadFileTabs({
        panelStateId: "opener-skip",
        syncThreadId: "opener-skip",
        environmentId: "env_1",
        storageFiles: undefined,
        terminalSessions: undefined,
      }),
    );

    // A git-ref snapshot never diverts, even for a matching extension.
    act(() =>
      result.current.openTab({
        kind: "workspace-file-preview",
        tab: {
          lineRange: null,
          path: "notes/todo.md",
          source: { kind: "head" },
          statusLabel: null,
        },
      }),
    );
    expect(result.current.activePluginPanelTab).toBeNull();
    expect(result.current.activeWorkspaceFilePath).toBe("notes/todo.md");

    // Unmatched extension stays built-in too.
    act(() =>
      result.current.openTab({
        kind: "workspace-file-preview",
        tab: {
          lineRange: null,
          path: "src/index.ts",
          source: { kind: "working-tree" },
          statusLabel: null,
        },
      }),
    );
    expect(result.current.activePluginPanelTab).toBeNull();
    expect(result.current.activeWorkspaceFilePath).toBe("src/index.ts");
  });

  // The file search builds its tab through its own path (it replaces the
  // new-tab screen rather than appending a tab), so diversion has to be
  // applied there too. It was not, and every file picked from the "+" screen
  // silently got the built-in preview while links and `bb thread open`
  // diverted correctly.
  it("diverts a workspace file picked from the file search", () => {
    registerNotesOpener();
    const { result } = renderThreadHook(() =>
      useThreadFileTabs({
        panelStateId: "opener-search",
        syncThreadId: "opener-search",
        environmentId: "env_1",
        storageFiles: undefined,
        terminalSessions: undefined,
      }),
    );

    act(() => result.current.openTab({ kind: "new-tab" }));
    act(() =>
      result.current.selectFileSearchResult({
        source: "workspace",
        path: "notes/todo.md",
      }),
    );

    expect(result.current.activePluginPanelTab).toMatchObject({
      kind: "plugin-panel",
      pluginId: "notes",
      actionId: "file-opener:editor",
      title: "todo.md",
    });
    const params = JSON.parse(
      result.current.activePluginPanelTab?.paramsJson ?? "null",
    ) as { path: string; source: { kind: string; environmentId: string | null } };
    expect(params.path).toBe("notes/todo.md");
    expect(params.source).toMatchObject({
      kind: "workspace",
      environmentId: "env_1",
    });
    // The new-tab screen is replaced, not appended to.
    expect(result.current.isNewTabActive).toBe(false);
    expect(
      result.current.orderedSecondaryFileTabs.map((tab) => tab.kind),
    ).toEqual(["plugin-panel"]);
  });

  it("keeps the built-in preview for an unmatched file search extension", () => {
    registerNotesOpener();
    const { result } = renderThreadHook(() =>
      useThreadFileTabs({
        panelStateId: "opener-search-unmatched",
        syncThreadId: "opener-search-unmatched",
        environmentId: "env_1",
        storageFiles: undefined,
        terminalSessions: undefined,
      }),
    );

    act(() => result.current.openTab({ kind: "new-tab" }));
    act(() =>
      result.current.selectFileSearchResult({
        source: "workspace",
        path: "src/main.rs",
      }),
    );

    expect(result.current.activePluginPanelTab).toBeNull();
    expect(result.current.activeWorkspaceFilePath).toBe("src/main.rs");
  });

  it("honors a pinned built-in preference from the file search", () => {
    window.localStorage.setItem(
      "bb.fileOpenerByExtension",
      JSON.stringify({ md: "__builtin__" }),
    );
    registerNotesOpener();
    const { result } = renderThreadHook(() =>
      useThreadFileTabs({
        panelStateId: "opener-search-pinned",
        syncThreadId: "opener-search-pinned",
        environmentId: "env_1",
        storageFiles: undefined,
        terminalSessions: undefined,
      }),
    );

    act(() => result.current.openTab({ kind: "new-tab" }));
    act(() =>
      result.current.selectFileSearchResult({
        source: "workspace",
        path: "notes/todo.md",
      }),
    );

    expect(result.current.activePluginPanelTab).toBeNull();
    expect(result.current.activeWorkspaceFilePath).toBe("notes/todo.md");
  });

  it("falls back to the built-in preview when no opener is registered", () => {
    const { result } = renderThreadHook(() =>
      useThreadFileTabs({
        panelStateId: "opener-gone",
        syncThreadId: "opener-gone",
        environmentId: "env_1",
        storageFiles: undefined,
        terminalSessions: undefined,
      }),
    );

    act(() =>
      result.current.openTab({
        kind: "workspace-file-preview",
        tab: {
          lineRange: null,
          path: "notes/todo.md",
          source: { kind: "working-tree" },
          statusLabel: null,
        },
      }),
    );
    expect(result.current.activePluginPanelTab).toBeNull();
    expect(result.current.activeWorkspaceFilePath).toBe("notes/todo.md");
  });

  it("keeps the built-in preview when Settings pins it", () => {
    window.localStorage.setItem(
      "bb.fileOpenerByExtension",
      JSON.stringify({ md: "__builtin__" }),
    );
    registerNotesOpener();
    const { result } = renderThreadHook(() =>
      useThreadFileTabs({
        panelStateId: "opener-built-in",
        syncThreadId: "opener-built-in",
        environmentId: "env_1",
        storageFiles: undefined,
        terminalSessions: undefined,
      }),
    );

    act(() =>
      result.current.openTab({
        kind: "workspace-file-preview",
        tab: {
          lineRange: null,
          path: "notes/todo.md",
          source: { kind: "working-tree" },
          statusLabel: null,
        },
      }),
    );

    expect(result.current.activePluginPanelTab).toBeNull();
    expect(result.current.activeWorkspaceFilePath).toBe("notes/todo.md");
  });

  it("honors per-open viewer overrides in both directions", () => {
    registerNotesOpener();
    const { result } = renderThreadHook(() =>
      useThreadFileTabs({
        panelStateId: "opener-override",
        syncThreadId: "opener-override",
        environmentId: "env_1",
        storageFiles: undefined,
        terminalSessions: undefined,
      }),
    );

    // "builtin" override skips the automatic opener entirely.
    act(() =>
      result.current.openTab(
        {
          kind: "workspace-file-preview",
          tab: {
            lineRange: null,
            path: "notes/todo.md",
            source: { kind: "working-tree" },
            statusLabel: null,
          },
        },
        { viewer: "builtin" },
      ),
    );
    expect(result.current.activePluginPanelTab).toBeNull();
    expect(result.current.activeWorkspaceFilePath).toBe("notes/todo.md");

    // A forced opener can still select a registered provider explicitly.
    act(() =>
      result.current.openTab(
        {
          kind: "workspace-file-preview",
          tab: {
            lineRange: null,
            path: "notes/other.md",
            source: { kind: "working-tree" },
            statusLabel: null,
          },
        },
        { viewer: { pluginId: "notes", openerId: "editor" } },
      ),
    );
    expect(result.current.activePluginPanelTab).toMatchObject({
      pluginId: "notes",
      actionId: "file-opener:editor",
      title: "other.md",
    });
  });
});

describe("useThreadFileTabs legacy side-chat tabs", () => {
  // The native side chat is gone. Its persisted tabs must not reappear in the
  // strip, and they must not break the rest of a thread's stored tabs.
  it("drops tabs persisted before the native side chat was removed", () => {
    const threadId = "legacy-side-chat";
    const browserTab = createBrowserFixedPanelTab({
      environmentId: "env_current",
      url: "https://example.com",
    });
    window.localStorage.setItem(
      getFixedPanelTabsStateStorageKey({ threadId }),
      JSON.stringify({
        version: FIXED_PANEL_TABS_STATE_STORAGE_VERSION,
        lastUsedAt: Date.now(),
        secondary: {
          activeTabId: "side-chat:legacy",
          isOpen: true,
          tabs: [
            browserTab,
            {
              id: "side-chat:legacy",
              kind: "side-chat",
              sourceMessageText: "anchor message",
              sourceSeqEnd: null,
              threadId: "thr_child",
              title: "Side chat",
            },
          ],
        },
      }),
    );

    const { result } = renderHook(
      () =>
        useThreadFileTabs({
          panelStateId: threadId,
          syncThreadId: threadId,
          environmentId: "env_current",
          storageFiles: undefined,
          terminalSessions: undefined,
        }),
      { wrapper: QueryWrapper },
    );

    expect(
      result.current.orderedSecondaryFileTabs.map((tab) => tab.id),
    ).toEqual([browserTab.id]);
  });
});
