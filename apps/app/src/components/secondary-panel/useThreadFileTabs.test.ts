// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
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
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";

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
  resetPluginSlotStoreForTest();
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

describe("useThreadFileTabs plugin panel tabs", () => {
  it("opens, focuses identical re-opens (title refreshed), and opens siblings for new params", () => {
    const threadId = "plugin-panel-open";
    const { result } = renderHook(() =>
      useThreadFileTabs({
        threadId,
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
    const { result } = renderHook(() =>
      useThreadFileTabs({
        threadId,
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
      navPanels: [],
      threadPanelActions: [],
      composerAccessories: [],
      fileOpeners: [
        {
          id: "editor",
          title: "Notes editor",
          extensions: ["md"],
          component: NotesEditor,
        },
      ],
    });
  }

  function setDefaultOpener() {
    window.localStorage.setItem(
      "bb.fileOpenerByExtension",
      JSON.stringify({ md: "notes:editor" }),
    );
  }

  it("diverts working-tree markdown opens to the preferred opener tab", () => {
    registerNotesOpener();
    setDefaultOpener();
    const { result } = renderHook(() =>
      useThreadFileTabs({
        threadId: "opener-divert",
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
  });

  it("keeps the built-in preview for ref snapshots and unmatched extensions", () => {
    registerNotesOpener();
    setDefaultOpener();
    const { result } = renderHook(() =>
      useThreadFileTabs({
        threadId: "opener-skip",
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

  it("falls back to the built-in preview when the preferred opener is gone", () => {
    // Preference points at an opener that is not registered (plugin removed).
    setDefaultOpener();
    const { result } = renderHook(() =>
      useThreadFileTabs({
        threadId: "opener-gone",
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
    setDefaultOpener();
    const { result } = renderHook(() =>
      useThreadFileTabs({
        threadId: "opener-override",
        environmentId: "env_1",
        storageFiles: undefined,
        terminalSessions: undefined,
      }),
    );

    // "builtin" override skips the opener default entirely.
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

    // A forced opener applies even with no default preference set.
    window.localStorage.removeItem("bb.fileOpenerByExtension");
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
