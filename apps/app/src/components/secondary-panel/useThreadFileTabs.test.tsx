// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { Provider as JotaiProvider } from "jotai";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  EnvironmentFilePreviewSource,
  FilePreviewLineRange,
  HostFileTabState,
  ThreadStorageFileTabState,
  WorkspaceFileTabState,
  WorkspaceFilePreviewStatusLabel,
} from "@/lib/file-preview";
import {
  createEmptyFixedPanelTabsState,
  getFixedPanelTabsStateStorageKey,
  parseFixedPanelTabsState,
  serializeFixedPanelTabsState,
  type FixedPanelTab,
  type FixedPanelTabsState,
  type HostFilePreviewFixedPanelTab,
  type SecondaryFileFixedPanelTab,
  type ThreadStorageFilePreviewFixedPanelTab,
  type WorkspaceFilePreviewFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import { useFixedPanelTabsState } from "@/lib/fixed-panel-tabs";
import { useThreadFileTabs } from "./useThreadFileTabs";
import { useThreadRecentItems } from "./threadRecentItems";

const NOW = 1_700_000_000_000;
const WORKING_TREE_SOURCE: EnvironmentFilePreviewSource = {
  kind: "working-tree",
};
const MERGE_BASE_SOURCE: EnvironmentFilePreviewSource = {
  kind: "merge-base",
  ref: "abc1234",
};
const DELETED_STATUS_LABEL: WorkspaceFilePreviewStatusLabel = "deleted";

interface TestWrapperProps {
  children: ReactNode;
}

interface HookProps {
  environmentId: string | null | undefined;
  storageFiles: readonly { path: string }[] | undefined;
  threadId: string;
}

interface BuildWorkspaceFileTabArgs {
  lineRange: FilePreviewLineRange | null;
  path: string;
  source?: EnvironmentFilePreviewSource;
  statusLabel?: WorkspaceFilePreviewStatusLabel | null;
}

interface BuildStorageFileTabArgs {
  lineRange?: FilePreviewLineRange | null;
  path: string;
}

interface BuildTestLineRangeArgs {
  endLineNumber?: number;
  startLineNumber: number;
}

function buildTestLineRange({
  endLineNumber,
  startLineNumber,
}: BuildTestLineRangeArgs): FilePreviewLineRange {
  return {
    endLineNumber: endLineNumber ?? startLineNumber,
    startLineNumber,
  };
}

function buildWorkspaceFileTab({
  lineRange,
  path,
  source = WORKING_TREE_SOURCE,
  statusLabel = null,
}: BuildWorkspaceFileTabArgs): WorkspaceFileTabState {
  return {
    lineRange,
    path,
    source,
    statusLabel,
  };
}

function clearWorkspaceFileTabLineRange(
  tab: WorkspaceFileTabState,
): WorkspaceFileTabState {
  return {
    ...tab,
    lineRange: null,
  };
}

function buildStorageFileTab({
  lineRange = null,
  path,
}: BuildStorageFileTabArgs): ThreadStorageFileTabState {
  return {
    lineRange,
    path,
  };
}

function TestWrapper({ children }: TestWrapperProps) {
  return (
    <JotaiProvider>
      <MemoryRouter>{children}</MemoryRouter>
    </JotaiProvider>
  );
}

function renderThreadFileTabsHook(initialProps: HookProps) {
  return renderHook(
    (props: HookProps) => {
      const fileTabs = useThreadFileTabs(props);
      const fixedPanelTabsState = useFixedPanelTabsState(props.threadId);
      const recentItems = useThreadRecentItems(props.threadId);
      return {
        ...fileTabs,
        fixedPanelTabsState,
        recentItems,
      };
    },
    {
      initialProps,
      wrapper: TestWrapper,
    },
  );
}

function isWorkspaceFilePreviewTab(
  tab: FixedPanelTab,
): tab is WorkspaceFilePreviewFixedPanelTab {
  return tab.kind === "workspace-file-preview";
}

function isStorageFilePreviewTab(
  tab: FixedPanelTab,
): tab is ThreadStorageFilePreviewFixedPanelTab {
  return tab.kind === "thread-storage-file-preview";
}

function isHostFilePreviewTab(
  tab: FixedPanelTab,
): tab is HostFilePreviewFixedPanelTab {
  return tab.kind === "host-file-preview";
}

function workspaceFileStates(
  tabs: readonly SecondaryFileFixedPanelTab[],
): WorkspaceFileTabState[] {
  return tabs.filter(isWorkspaceFilePreviewTab).map((tab) => ({
    lineRange: tab.lineRange,
    path: tab.path,
    source: tab.source,
    statusLabel: tab.statusLabel,
  }));
}

function hostFileStates(
  tabs: readonly SecondaryFileFixedPanelTab[],
): HostFileTabState[] {
  return tabs.filter(isHostFilePreviewTab).map((tab) => ({
    lineRange: tab.lineRange,
    path: tab.path,
  }));
}

function storageFilePaths(
  tabs: readonly SecondaryFileFixedPanelTab[],
): string[] {
  return tabs.filter(isStorageFilePreviewTab).map((tab) => tab.path);
}

function storageFileStates(
  tabs: readonly SecondaryFileFixedPanelTab[],
): ThreadStorageFileTabState[] {
  return tabs.filter(isStorageFilePreviewTab).map((tab) => ({
    lineRange: tab.lineRange,
    path: tab.path,
  }));
}

function tabIds(tabs: readonly SecondaryFileFixedPanelTab[]): string[] {
  return tabs.map((tab) => tab.id);
}

function workspaceFileTabId(path: string): string {
  return `workspace-file-preview:${encodeURIComponent(path)}`;
}

function storageFileTabId(path: string): string {
  return `thread-storage-file-preview:${encodeURIComponent(path)}`;
}

function hostFileTabId(path: string): string {
  return `host-file-preview:${encodeURIComponent(path)}`;
}

function newTabId(): string {
  return "new-tab";
}

function createStoredWorkspaceTab(
  environmentId: string | null,
  tab: WorkspaceFileTabState,
): WorkspaceFilePreviewFixedPanelTab {
  return {
    environmentId,
    id: workspaceFileTabId(tab.path),
    kind: "workspace-file-preview",
    lineRange: tab.lineRange,
    path: tab.path,
    source: tab.source,
    statusLabel: tab.statusLabel,
  };
}

function createStoredStorageTab(
  path: string,
): ThreadStorageFilePreviewFixedPanelTab {
  return {
    id: storageFileTabId(path),
    isPinned: false,
    kind: "thread-storage-file-preview",
    lineRange: null,
    path,
  };
}

function readStoredState(threadId: string): FixedPanelTabsState {
  return parseFixedPanelTabsState({
    initialValue: createEmptyFixedPanelTabsState(),
    now: Date.now(),
    storedValue: window.localStorage.getItem(
      getFixedPanelTabsStateStorageKey({ threadId }),
    ),
  });
}

function seedStoredState(threadId: string, state: FixedPanelTabsState): void {
  window.localStorage.setItem(
    getFixedPanelTabsStateStorageKey({ threadId }),
    serializeFixedPanelTabsState({ state }),
  );
}

function getStoredWorkspaceTabs(
  state: FixedPanelTabsState,
): WorkspaceFileTabState[] {
  return state.secondary.tabs.filter(isWorkspaceFilePreviewTab).map((tab) => ({
    lineRange: tab.lineRange,
    path: tab.path,
    source: tab.source,
    statusLabel: tab.statusLabel,
  }));
}

function getStoredStoragePaths(state: FixedPanelTabsState): string[] {
  return state.secondary.tabs
    .filter(isStorageFilePreviewTab)
    .map((tab) => tab.path);
}

function getStoredSecondaryTabIds(state: FixedPanelTabsState): string[] {
  return state.secondary.tabs.map((tab) => tab.id);
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("useThreadFileTabs", () => {
  it("records opened working-tree and storage files as thread recents", () => {
    const { result } = renderThreadFileTabsHook({
      environmentId: "env-recent",
      storageFiles: [],
      threadId: "thr-recent-record",
    });

    act(() => {
      result.current.openWorkspaceFile(
        buildWorkspaceFileTab({ lineRange: null, path: "src/app.ts" }),
      );
    });
    act(() => {
      result.current.openStorageFile(
        buildStorageFileTab({ path: "plans/swap-model.md" }),
      );
    });

    // Newest-first, deduped, tagged by panel source.
    expect(
      result.current.recentItems.map(({ source, path }) => ({ source, path })),
    ).toEqual([
      { source: "thread-storage", path: "plans/swap-model.md" },
      { source: "workspace", path: "src/app.ts" },
    ]);
  });

  it("does not record diff-only (non-working-tree) workspace previews as recents", () => {
    const { result } = renderThreadFileTabsHook({
      environmentId: "env-recent",
      storageFiles: undefined,
      threadId: "thr-recent-diff",
    });

    act(() => {
      result.current.openWorkspaceFile(
        buildWorkspaceFileTab({
          lineRange: null,
          path: "src/diff.ts",
          source: MERGE_BASE_SOURCE,
        }),
      );
    });

    expect(result.current.recentItems).toEqual([]);
  });

  it("persists workspace tabs for the current thread", () => {
    const { result } = renderThreadFileTabsHook({
      environmentId: "env-one",
      storageFiles: undefined,
      threadId: "thr-one",
    });
    const workspaceTab = buildWorkspaceFileTab({
      lineRange: buildTestLineRange({ startLineNumber: 42 }),
      path: "src/app.ts",
    });

    act(() => {
      result.current.openWorkspaceFile(workspaceTab);
    });

    expect(
      workspaceFileStates(result.current.orderedSecondaryFileTabs),
    ).toEqual([workspaceTab]);
    expect(result.current.activeWorkspaceFilePath).toBe("src/app.ts");
    expect(result.current.activeWorkspaceFileSource).toEqual(
      WORKING_TREE_SOURCE,
    );
    expect(result.current.activeWorkspaceFileStatusLabel).toBeNull();
    expect(getStoredWorkspaceTabs(readStoredState("thr-one"))).toEqual([
      clearWorkspaceFileTabLineRange(workspaceTab),
    ]);
    expect(readStoredState("thr-one").secondary.isOpen).toBe(true);
  });

  it("keeps file tabs isolated by thread id", () => {
    const { result, rerender } = renderThreadFileTabsHook({
      environmentId: "env-one",
      storageFiles: undefined,
      threadId: "thr-one",
    });
    const workspaceTab = buildWorkspaceFileTab({
      lineRange: null,
      path: "src/one.ts",
    });

    act(() => {
      result.current.openWorkspaceFile(workspaceTab);
    });

    rerender({
      environmentId: "env-two",
      storageFiles: undefined,
      threadId: "thr-two",
    });

    expect(
      workspaceFileStates(result.current.orderedSecondaryFileTabs),
    ).toEqual([]);
    expect(result.current.activeWorkspaceFilePath).toBeNull();

    rerender({
      environmentId: "env-one",
      storageFiles: undefined,
      threadId: "thr-one",
    });

    expect(
      workspaceFileStates(result.current.orderedSecondaryFileTabs),
    ).toEqual([workspaceTab]);
    expect(result.current.activeWorkspaceFilePath).toBe("src/one.ts");
  });

  it("keeps workspace and storage active tabs mutually exclusive", () => {
    const { result } = renderThreadFileTabsHook({
      environmentId: "env-one",
      storageFiles: [{ path: "notes.md" }],
      threadId: "thr-manager",
    });

    act(() => {
      result.current.openWorkspaceFile(
        buildWorkspaceFileTab({
          lineRange: null,
          path: "src/workspace.ts",
        }),
      );
    });
    expect(result.current.activeWorkspaceFilePath).toBe("src/workspace.ts");
    expect(result.current.activeStorageFilePath).toBeNull();

    act(() => {
      result.current.openStorageFile(buildStorageFileTab({ path: "notes.md" }));
    });
    expect(result.current.activeWorkspaceFilePath).toBeNull();
    expect(result.current.activeStorageFilePath).toBe("notes.md");
  });

  it("opens, activates, and closes host-file tabs", () => {
    const { result } = renderThreadFileTabsHook({
      environmentId: "env-one",
      storageFiles: undefined,
      threadId: "thr-host-files",
    });
    const firstTab = {
      lineRange: buildTestLineRange({ startLineNumber: 12 }),
      path: "/Users/me/notes/plan.md",
    };
    const secondTab = {
      lineRange: null,
      path: "/Users/me/notes/todo.md",
    };

    act(() => {
      result.current.openHostFile(firstTab);
      result.current.openHostFile(secondTab);
    });

    expect(hostFileStates(result.current.orderedSecondaryFileTabs)).toEqual([
      firstTab,
      secondTab,
    ]);
    expect(result.current.activeHostFilePath).toBe(secondTab.path);
    expect(result.current.activeHostFileLineRange).toBeNull();
    expect(readStoredState("thr-host-files").secondary.isOpen).toBe(true);

    act(() => {
      result.current.activateHostFileTab(firstTab.path);
    });
    expect(result.current.activeHostFilePath).toBe(firstTab.path);
    expect(result.current.activeHostFileLineRange).toEqual(
      buildTestLineRange({ startLineNumber: 12 }),
    );

    act(() => {
      result.current.closeHostFileTab(firstTab.path);
    });
    expect(hostFileStates(result.current.orderedSecondaryFileTabs)).toEqual([
      secondTab,
    ]);
    expect(result.current.activeHostFilePath).toBeNull();
  });

  it("orders file tabs by open order", () => {
    const { result } = renderThreadFileTabsHook({
      environmentId: "env-one",
      storageFiles: [{ path: "notes.md" }],
      threadId: "thr-manager-open-order",
    });

    act(() => {
      result.current.openWorkspaceFile(
        buildWorkspaceFileTab({ lineRange: null, path: "src/app.ts" }),
      );
      result.current.openStorageFile(buildStorageFileTab({ path: "notes.md" }));
      result.current.openHostFile({ lineRange: null, path: "/tmp/host.md" });
    });

    expect(tabIds(result.current.orderedSecondaryFileTabs)).toEqual([
      workspaceFileTabId("src/app.ts"),
      storageFileTabId("notes.md"),
      hostFileTabId("/tmp/host.md"),
    ]);
  });

  it("persists reordered file tabs", () => {
    const threadId = "thr-manager-reorder";
    const { result } = renderThreadFileTabsHook({
      environmentId: "env-one",
      storageFiles: [{ path: "notes.md" }],
      threadId,
    });

    act(() => {
      result.current.openWorkspaceFile(
        buildWorkspaceFileTab({ lineRange: null, path: "src/app.ts" }),
      );
      result.current.openStorageFile(buildStorageFileTab({ path: "notes.md" }));
      result.current.openHostFile({ lineRange: null, path: "/tmp/host.md" });
    });

    act(() => {
      result.current.reorderFileTab({
        activeTabId: hostFileTabId("/tmp/host.md"),
        overTabId: workspaceFileTabId("src/app.ts"),
      });
    });

    expect(tabIds(result.current.orderedSecondaryFileTabs)).toEqual([
      hostFileTabId("/tmp/host.md"),
      workspaceFileTabId("src/app.ts"),
      storageFileTabId("notes.md"),
    ]);
    expect(getStoredSecondaryTabIds(readStoredState(threadId))).toEqual([
      hostFileTabId("/tmp/host.md"),
      workspaceFileTabId("src/app.ts"),
      storageFileTabId("notes.md"),
    ]);
    expect(result.current.activeHostFilePath).toBe("/tmp/host.md");
  });

  it("opens the transient new tab once and does not persist it", () => {
    const { result } = renderThreadFileTabsHook({
      environmentId: "env-one",
      storageFiles: undefined,
      threadId: "thr-new-tab",
    });

    act(() => {
      result.current.openNewTab();
      result.current.openNewTab();
    });

    expect(result.current.isNewTabActive).toBe(true);
    expect(result.current.fixedPanelTabsState.secondary.tabs).toEqual([
      {
        id: newTabId(),
        kind: "new-tab",
      },
    ]);
    expect(readStoredState("thr-new-tab").secondary.tabs).toEqual([]);
  });

  it("clears an active new tab when fixed panel tabs are cleared", () => {
    const { result } = renderThreadFileTabsHook({
      environmentId: "env-one",
      storageFiles: undefined,
      threadId: "thr-new-tab-clear",
    });

    act(() => {
      result.current.openNewTab();
    });
    expect(result.current.isNewTabActive).toBe(true);

    act(() => {
      result.current.clearActiveFileTabs();
    });

    expect(
      result.current.fixedPanelTabsState.secondary.tabs.some(
        (tab) => tab.kind === "new-tab",
      ),
    ).toBe(true);
    expect(result.current.isNewTabActive).toBe(false);
    expect(result.current.fixedPanelTabsState.secondary.activeTabId).toBeNull();
  });

  it("replaces the new tab with a selected workspace preview", () => {
    const { result } = renderThreadFileTabsHook({
      environmentId: "env-one",
      storageFiles: undefined,
      threadId: "thr-new-tab-workspace",
    });

    act(() => {
      result.current.openNewTab();
      result.current.selectFileSearchResult({
        source: "workspace",
        path: "src/open.ts",
      });
    });

    expect(result.current.activeWorkspaceFilePath).toBe("src/open.ts");
    expect(result.current.fixedPanelTabsState.secondary.tabs).toEqual([
      {
        environmentId: "env-one",
        id: workspaceFileTabId("src/open.ts"),
        kind: "workspace-file-preview",
        lineRange: null,
        path: "src/open.ts",
        source: WORKING_TREE_SOURCE,
        statusLabel: null,
      },
    ]);
  });

  it("focuses an already-open workspace preview and removes the new tab", () => {
    const { result } = renderThreadFileTabsHook({
      environmentId: "env-one",
      storageFiles: undefined,
      threadId: "thr-new-tab-dedupe",
    });
    const workspaceTab = buildWorkspaceFileTab({
      lineRange: buildTestLineRange({ startLineNumber: 7 }),
      path: "src/existing.ts",
    });

    act(() => {
      result.current.openWorkspaceFile(workspaceTab);
      result.current.openNewTab();
      result.current.selectFileSearchResult({
        source: "workspace",
        path: "src/existing.ts",
      });
    });

    expect(result.current.activeWorkspaceFilePath).toBe("src/existing.ts");
    expect(result.current.activeWorkspaceFileLineRange).toEqual(
      buildTestLineRange({ startLineNumber: 7 }),
    );
    expect(result.current.fixedPanelTabsState.secondary.tabs).toHaveLength(1);
  });

  it("updates host-file line numbers without duplicating tabs", () => {
    const { result } = renderThreadFileTabsHook({
      environmentId: "env-one",
      storageFiles: undefined,
      threadId: "thr-host-file-dedupe",
    });
    const path = "/Users/me/notes/plan.md";

    act(() => {
      result.current.openHostFile({
        lineRange: buildTestLineRange({ startLineNumber: 12 }),
        path,
      });
      result.current.openHostFile({
        lineRange: buildTestLineRange({ startLineNumber: 20 }),
        path,
      });
    });

    expect(hostFileStates(result.current.orderedSecondaryFileTabs)).toEqual([
      { lineRange: buildTestLineRange({ startLineNumber: 20 }), path },
    ]);
    expect(result.current.activeHostFileLineRange).toEqual(
      buildTestLineRange({ startLineNumber: 20 }),
    );
  });

  it("updates storage-file line numbers without duplicating tabs", () => {
    const { result } = renderThreadFileTabsHook({
      environmentId: "env-one",
      storageFiles: [{ path: "notes.md" }],
      threadId: "thr-storage-file-dedupe",
    });

    act(() => {
      result.current.openStorageFile(
        buildStorageFileTab({
          lineRange: buildTestLineRange({ startLineNumber: 12 }),
          path: "notes.md",
        }),
      );
      result.current.openStorageFile(
        buildStorageFileTab({
          lineRange: buildTestLineRange({ startLineNumber: 20 }),
          path: "notes.md",
        }),
      );
    });

    expect(storageFileStates(result.current.orderedSecondaryFileTabs)).toEqual([
      {
        lineRange: buildTestLineRange({ startLineNumber: 20 }),
        path: "notes.md",
      },
    ]);
    expect(result.current.activeStorageFileLineRange).toEqual(
      buildTestLineRange({ startLineNumber: 20 }),
    );
  });

  it("clears workspace tabs when the environment changes", async () => {
    const { result, rerender } = renderThreadFileTabsHook({
      environmentId: "env-one",
      storageFiles: undefined,
      threadId: "thr-one",
    });
    act(() => {
      result.current.openWorkspaceFile(
        buildWorkspaceFileTab({
          lineRange: null,
          path: "src/app.ts",
        }),
      );
    });

    rerender({
      environmentId: "env-two",
      storageFiles: undefined,
      threadId: "thr-one",
    });

    await waitFor(() => {
      expect(
        workspaceFileStates(result.current.orderedSecondaryFileTabs),
      ).toEqual([]);
    });
    expect(result.current.activeWorkspaceFilePath).toBeNull();
  });

  it("prunes storage tabs against the current storage file list", async () => {
    const { result, rerender } = renderThreadFileTabsHook({
      environmentId: null,
      storageFiles: [{ path: "notes.md" }, { path: "plan.md" }],
      threadId: "thr-storage",
    });

    act(() => {
      result.current.openStorageFile(buildStorageFileTab({ path: "notes.md" }));
      result.current.openStorageFile(buildStorageFileTab({ path: "plan.md" }));
    });
    expect(storageFilePaths(result.current.orderedSecondaryFileTabs)).toEqual([
      "notes.md",
      "plan.md",
    ]);
    expect(result.current.activeStorageFilePath).toBe("plan.md");

    rerender({
      environmentId: null,
      storageFiles: [{ path: "notes.md" }],
      threadId: "thr-storage",
    });

    await waitFor(() => {
      expect(storageFilePaths(result.current.orderedSecondaryFileTabs)).toEqual(
        ["notes.md"],
      );
    });
    expect(result.current.activeStorageFilePath).toBeNull();
  });

  it("keeps seeded storage tabs while thread storage is unresolved", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const threadId = "thr-storage-cold-load";
    seedStoredState(
      threadId,
      createEmptyFixedPanelTabsState({
        secondary: {
          tabs: [
            createStoredStorageTab("overview.md"),
            createStoredStorageTab("notes.md"),
          ],
          activeTabId: storageFileTabId("notes.md"),
          isOpen: true,
        },
        lastUsedAt: NOW,
      }),
    );
    const { result, rerender } = renderThreadFileTabsHook({
      environmentId: undefined,
      storageFiles: undefined,
      threadId,
    });

    expect(storageFilePaths(result.current.orderedSecondaryFileTabs)).toEqual([
      "overview.md",
      "notes.md",
    ]);
    expect(result.current.activeStorageFilePath).toBe("notes.md");
    expect(getStoredStoragePaths(readStoredState(threadId))).toEqual([
      "overview.md",
      "notes.md",
    ]);
    expect(readStoredState(threadId).secondary.activeTabId).toBe(
      storageFileTabId("notes.md"),
    );

    rerender({
      environmentId: null,
      storageFiles: [{ path: "overview.md" }, { path: "notes.md" }],
      threadId,
    });

    await waitFor(() => {
      expect(storageFilePaths(result.current.orderedSecondaryFileTabs)).toEqual(
        ["overview.md", "notes.md"],
      );
    });
    expect(result.current.activeStorageFilePath).toBe("notes.md");
  });

  it("keeps seeded workspace tabs while thread environment is unresolved", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const threadId = "thr-workspace-cold-load";
    const workspaceTab = buildWorkspaceFileTab({
      lineRange: buildTestLineRange({ startLineNumber: 7 }),
      path: "src/app.ts",
    });
    seedStoredState(
      threadId,
      createEmptyFixedPanelTabsState({
        secondary: {
          tabs: [createStoredWorkspaceTab("env-one", workspaceTab)],
          activeTabId: workspaceFileTabId("src/app.ts"),
          isOpen: true,
        },
        lastUsedAt: NOW,
      }),
    );
    const { result, rerender } = renderThreadFileTabsHook({
      environmentId: undefined,
      storageFiles: undefined,
      threadId,
    });

    expect(
      workspaceFileStates(result.current.orderedSecondaryFileTabs),
    ).toEqual([]);
    expect(getStoredWorkspaceTabs(readStoredState(threadId))).toEqual([
      clearWorkspaceFileTabLineRange(workspaceTab),
    ]);
    expect(readStoredState(threadId).secondary.activeTabId).toBe(
      workspaceFileTabId("src/app.ts"),
    );

    rerender({
      environmentId: "env-one",
      storageFiles: undefined,
      threadId,
    });

    await waitFor(() => {
      expect(
        workspaceFileStates(result.current.orderedSecondaryFileTabs),
      ).toEqual([clearWorkspaceFileTabLineRange(workspaceTab)]);
    });
    expect(result.current.activeWorkspaceFilePath).toBe("src/app.ts");
  });

  it("keeps active seeded storage when it remains in the file list", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const threadId = "thr-storage-seeded-active";
    seedStoredState(
      threadId,
      createEmptyFixedPanelTabsState({
        secondary: {
          tabs: [createStoredStorageTab("notes.md")],
          activeTabId: storageFileTabId("notes.md"),
          isOpen: true,
        },
        lastUsedAt: NOW,
      }),
    );
    const { result } = renderThreadFileTabsHook({
      environmentId: null,
      storageFiles: [{ path: "notes.md" }],
      threadId,
    });

    await waitFor(() => {
      expect(storageFilePaths(result.current.orderedSecondaryFileTabs)).toEqual(
        ["notes.md"],
      );
    });
    expect(result.current.activeStorageFilePath).toBe("notes.md");
  });

  it("closes storage tabs", () => {
    const { result } = renderThreadFileTabsHook({
      environmentId: null,
      storageFiles: [{ path: "notes.md" }],
      threadId: "thr-storage-close",
    });

    act(() => {
      result.current.openStorageFile(buildStorageFileTab({ path: "notes.md" }));
    });
    expect(result.current.activeStorageFilePath).toBe("notes.md");

    act(() => {
      result.current.closeStorageFileTab("notes.md");
    });

    expect(storageFilePaths(result.current.orderedSecondaryFileTabs)).toEqual(
      [],
    );
    expect(result.current.activeStorageFilePath).toBeNull();
  });

  it("does not rewrite workspace tabs for no-op callbacks", () => {
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(NOW);
    const threadId = "thr-workspace-no-op";
    const workspaceTab = buildWorkspaceFileTab({
      lineRange: null,
      path: "src/app.ts",
      source: MERGE_BASE_SOURCE,
      statusLabel: DELETED_STATUS_LABEL,
    });
    seedStoredState(
      threadId,
      createEmptyFixedPanelTabsState({
        secondary: {
          tabs: [createStoredWorkspaceTab("env-one", workspaceTab)],
          activeTabId: workspaceFileTabId("src/app.ts"),
          isOpen: true,
        },
        lastUsedAt: NOW,
      }),
    );
    const { result } = renderThreadFileTabsHook({
      environmentId: "env-one",
      storageFiles: undefined,
      threadId,
    });
    dateNowSpy.mockReturnValue(NOW + 60_000);

    act(() => {
      result.current.openWorkspaceFile(workspaceTab);
      result.current.activateWorkspaceFileTab("src/app.ts");
      result.current.closeWorkspaceFileTab("src/missing.ts");
    });

    expect(readStoredState(threadId).lastUsedAt).toBe(NOW);
    expect(
      workspaceFileStates(result.current.orderedSecondaryFileTabs),
    ).toEqual([workspaceTab]);
  });

  it("does not rewrite storage tabs for no-op callbacks", async () => {
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(NOW);
    const threadId = "thr-storage-no-op";
    seedStoredState(
      threadId,
      createEmptyFixedPanelTabsState({
        secondary: {
          tabs: [
            createStoredStorageTab("overview.md"),
            createStoredStorageTab("notes.md"),
          ],
          activeTabId: storageFileTabId("notes.md"),
          isOpen: true,
        },
        lastUsedAt: NOW,
      }),
    );
    const { result } = renderThreadFileTabsHook({
      environmentId: null,
      storageFiles: [{ path: "overview.md" }, { path: "notes.md" }],
      threadId,
    });

    await waitFor(() => {
      expect(result.current.activeStorageFilePath).toBe("notes.md");
    });
    dateNowSpy.mockReturnValue(NOW + 60_000);

    act(() => {
      result.current.openStorageFile(buildStorageFileTab({ path: "notes.md" }));
      result.current.activateStorageFileTab("notes.md");
      result.current.closeStorageFileTab("missing.md");
    });

    expect(readStoredState(threadId).lastUsedAt).toBe(NOW);
    expect(getStoredStoragePaths(readStoredState(threadId))).toEqual([
      "overview.md",
      "notes.md",
    ]);
  });

  it("keeps stored storage tabs for any thread", async () => {
    const threadId = "thr-storage-existing";
    seedStoredState(
      threadId,
      createEmptyFixedPanelTabsState({
        secondary: {
          tabs: [createStoredStorageTab("notes.md")],
          activeTabId: storageFileTabId("notes.md"),
          isOpen: true,
        },
        lastUsedAt: Date.now(),
      }),
    );

    const { result } = renderThreadFileTabsHook({
      environmentId: "env-one",
      storageFiles: undefined,
      threadId,
    });

    await waitFor(() => {
      expect(storageFilePaths(result.current.orderedSecondaryFileTabs)).toEqual(
        ["notes.md"],
      );
    });
    expect(result.current.activeStorageFilePath).toBe("notes.md");
    expect(getStoredStoragePaths(readStoredState(threadId))).toEqual([
      "notes.md",
    ]);
  });
});

describe("useThreadFileTabs — browser tabs", () => {
  it("opens a browser tab via openBrowserTab and persists it (not transient)", () => {
    const { result } = renderThreadFileTabsHook({
      environmentId: "env-one",
      storageFiles: undefined,
      threadId: "thr-browser-open",
    });

    act(() => {
      result.current.openBrowserTab();
    });

    const tab = result.current.activeBrowserTab;
    expect(tab).not.toBeNull();
    expect(tab?.kind).toBe("browser");
    expect(tab?.url).toBe("");

    const browserTabs = readStoredState(
      "thr-browser-open",
    ).secondary.tabs.filter((entry) => entry.kind === "browser");
    expect(browserTabs).toHaveLength(1);
  });

  it("opens a browser tab at a given URL (popup path)", () => {
    const { result } = renderThreadFileTabsHook({
      environmentId: "env-one",
      storageFiles: undefined,
      threadId: "thr-browser-url",
    });

    act(() => {
      result.current.openBrowserTab("https://example.com");
    });

    expect(result.current.activeBrowserTab?.url).toBe("https://example.com");
  });

  it("persists url/title/favicon pushed from the view via updateBrowserTab", () => {
    const { result } = renderThreadFileTabsHook({
      environmentId: "env-one",
      storageFiles: undefined,
      threadId: "thr-browser-update",
    });

    act(() => {
      result.current.openBrowserTab();
    });
    const opened = result.current.activeBrowserTab;
    if (opened === null) {
      throw new Error("expected an active browser tab");
    }

    act(() => {
      result.current.updateBrowserTab({
        tabId: opened.id,
        url: "https://example.com",
        title: "Example",
      });
    });

    expect(result.current.activeBrowserTab?.title).toBe("Example");
    const persisted = readStoredState("thr-browser-update").secondary.tabs.find(
      (entry) => entry.kind === "browser",
    );
    expect(persisted?.kind === "browser" ? persisted.url : null).toBe(
      "https://example.com",
    );
    expect(persisted?.kind === "browser" ? persisted.title : null).toBe(
      "Example",
    );
  });

  it("supports multiple independent browser tabs and closes by id", () => {
    const { result } = renderThreadFileTabsHook({
      environmentId: "env-one",
      storageFiles: undefined,
      threadId: "thr-browser-multi",
    });

    act(() => {
      result.current.openBrowserTab("https://a.example");
    });
    const first = result.current.activeBrowserTab;
    act(() => {
      result.current.openBrowserTab("https://b.example");
    });
    const second = result.current.activeBrowserTab;
    if (first === null || second === null) {
      throw new Error("expected two browser tabs");
    }
    expect(first.id).not.toBe(second.id);

    act(() => {
      result.current.closeBrowserTab(second.id);
    });

    const ids = readStoredState("thr-browser-multi")
      .secondary.tabs.filter((entry) => entry.kind === "browser")
      .map((entry) => entry.id);
    expect(ids).toContain(first.id);
    expect(ids).not.toContain(second.id);
  });
});
