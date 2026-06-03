// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ThreadType } from "@bb/domain";
import { Provider as JotaiProvider } from "jotai";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  EnvironmentFilePreviewSource,
  HostFileTabState,
  WorkspaceFileTabState,
  WorkspaceFilePreviewStatusLabel,
} from "@/lib/file-preview";
import {
  createEmptyFixedPanelTabsState,
  getFixedPanelTabsStateStorageKey,
  parseFixedPanelTabsState,
  serializeFixedPanelTabsState,
  type AppFixedPanelTab,
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
  apps?: readonly { applicationId: string }[];
  environmentId: string | null | undefined;
  storageFiles: readonly { path: string }[] | undefined;
  threadId: string;
  threadType: ThreadType | undefined;
}

interface BuildWorkspaceFileTabArgs {
  lineNumber: number | null;
  path: string;
  source?: EnvironmentFilePreviewSource;
  statusLabel?: WorkspaceFilePreviewStatusLabel | null;
}

function buildWorkspaceFileTab({
  lineNumber,
  path,
  source = WORKING_TREE_SOURCE,
  statusLabel = null,
}: BuildWorkspaceFileTabArgs): WorkspaceFileTabState {
  return {
    lineNumber,
    path,
    source,
    statusLabel,
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

function isAppTab(tab: FixedPanelTab): tab is AppFixedPanelTab {
  return tab.kind === "app";
}

function workspaceFileStates(
  tabs: readonly SecondaryFileFixedPanelTab[],
): WorkspaceFileTabState[] {
  return tabs.filter(isWorkspaceFilePreviewTab).map((tab) => ({
    lineNumber: tab.lineNumber,
    path: tab.path,
    source: tab.source,
    statusLabel: tab.statusLabel,
  }));
}

function hostFileStates(
  tabs: readonly SecondaryFileFixedPanelTab[],
): HostFileTabState[] {
  return tabs.filter(isHostFilePreviewTab).map((tab) => ({
    lineNumber: tab.lineNumber,
    path: tab.path,
  }));
}

function storageFilePaths(
  tabs: readonly SecondaryFileFixedPanelTab[],
): string[] {
  return tabs.filter(isStorageFilePreviewTab).map((tab) => tab.path);
}

function appTabIds(tabs: readonly SecondaryFileFixedPanelTab[]): string[] {
  return tabs.filter(isAppTab).map((tab) => tab.applicationId);
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

function appTabId(applicationId: string): string {
  return `app:${encodeURIComponent(applicationId)}`;
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
    lineNumber: tab.lineNumber,
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
    lineNumber: tab.lineNumber,
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

function getStoredAppIds(state: FixedPanelTabsState): string[] {
  return state.secondary.tabs.filter(isAppTab).map((tab) => tab.applicationId);
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
      threadType: "manager",
      storageFiles: [],
      threadId: "thr-recent-record",
    });

    act(() => {
      result.current.openWorkspaceFile(
        buildWorkspaceFileTab({ lineNumber: null, path: "src/app.ts" }),
      );
    });
    act(() => {
      result.current.openStorageFile("plans/swap-model.md");
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
      threadType: "standard",
      storageFiles: undefined,
      threadId: "thr-recent-diff",
    });

    act(() => {
      result.current.openWorkspaceFile(
        buildWorkspaceFileTab({
          lineNumber: null,
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
      threadType: "standard",
      storageFiles: undefined,
      threadId: "thr-one",
    });
    const workspaceTab = buildWorkspaceFileTab({
      lineNumber: 42,
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
      workspaceTab,
    ]);
    expect(readStoredState("thr-one").secondary.isOpen).toBe(true);
  });

  it("keeps file tabs isolated by thread id", () => {
    const { result, rerender } = renderThreadFileTabsHook({
      environmentId: "env-one",
      threadType: "standard",
      storageFiles: undefined,
      threadId: "thr-one",
    });
    const workspaceTab = buildWorkspaceFileTab({
      lineNumber: null,
      path: "src/one.ts",
    });

    act(() => {
      result.current.openWorkspaceFile(workspaceTab);
    });

    rerender({
      environmentId: "env-two",
      threadType: "standard",
      storageFiles: undefined,
      threadId: "thr-two",
    });

    expect(
      workspaceFileStates(result.current.orderedSecondaryFileTabs),
    ).toEqual([]);
    expect(result.current.activeWorkspaceFilePath).toBeNull();

    rerender({
      environmentId: "env-one",
      threadType: "standard",
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
      threadType: "manager",
      storageFiles: [{ path: "notes.md" }],
      threadId: "thr-manager",
    });

    act(() => {
      result.current.openWorkspaceFile(
        buildWorkspaceFileTab({
          lineNumber: null,
          path: "src/workspace.ts",
        }),
      );
    });
    expect(result.current.activeWorkspaceFilePath).toBe("src/workspace.ts");
    expect(result.current.activeStorageFilePath).toBeNull();

    act(() => {
      result.current.openStorageFile("notes.md");
    });
    expect(result.current.activeWorkspaceFilePath).toBeNull();
    expect(result.current.activeStorageFilePath).toBe("notes.md");
  });

  it("opens, activates, and closes host-file tabs", () => {
    const { result } = renderThreadFileTabsHook({
      environmentId: "env-one",
      threadType: "standard",
      storageFiles: undefined,
      threadId: "thr-host-files",
    });
    const firstTab = {
      lineNumber: 12,
      path: "/Users/me/notes/plan.md",
    };
    const secondTab = {
      lineNumber: null,
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
    expect(result.current.activeHostFileLineNumber).toBeNull();
    expect(readStoredState("thr-host-files").secondary.isOpen).toBe(true);

    act(() => {
      result.current.activateHostFileTab(firstTab.path);
    });
    expect(result.current.activeHostFilePath).toBe(firstTab.path);
    expect(result.current.activeHostFileLineNumber).toBe(12);

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
      apps: [{ applicationId: "app_review" }],
      environmentId: "env-one",
      threadType: "manager",
      storageFiles: [{ path: "notes.md" }],
      threadId: "thr-manager-open-order",
    });

    act(() => {
      result.current.openApp("app_review");
      result.current.openWorkspaceFile(
        buildWorkspaceFileTab({ lineNumber: null, path: "src/app.ts" }),
      );
      result.current.openStorageFile("notes.md");
      result.current.openHostFile({ lineNumber: null, path: "/tmp/host.md" });
    });

    expect(tabIds(result.current.orderedSecondaryFileTabs)).toEqual([
      appTabId("app_review"),
      workspaceFileTabId("src/app.ts"),
      storageFileTabId("notes.md"),
      hostFileTabId("/tmp/host.md"),
    ]);
  });

  it("opens the transient new tab once and does not persist it", () => {
    const { result } = renderThreadFileTabsHook({
      environmentId: "env-one",
      threadType: "standard",
      storageFiles: undefined,
      threadId: "thr-new-tab",
    });

    act(() => {
      result.current.openNewTab();
      result.current.openNewTab();
    });

    expect(result.current.hasNewTab).toBe(true);
    expect(result.current.isNewTabActive).toBe(true);
    expect(result.current.fixedPanelTabsState.secondary.tabs).toEqual([
      {
        id: newTabId(),
        kind: "new-tab",
      },
    ]);
    expect(readStoredState("thr-new-tab").secondary.tabs).toEqual([]);
  });

  it("replaces the new tab with a selected workspace preview", () => {
    const { result } = renderThreadFileTabsHook({
      environmentId: "env-one",
      threadType: "standard",
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

    expect(result.current.hasNewTab).toBe(false);
    expect(result.current.activeWorkspaceFilePath).toBe("src/open.ts");
    expect(result.current.fixedPanelTabsState.secondary.tabs).toEqual([
      {
        environmentId: "env-one",
        id: workspaceFileTabId("src/open.ts"),
        kind: "workspace-file-preview",
        lineNumber: null,
        path: "src/open.ts",
        source: WORKING_TREE_SOURCE,
        statusLabel: null,
      },
    ]);
  });

  it("focuses an already-open workspace preview and removes the new tab", () => {
    const { result } = renderThreadFileTabsHook({
      environmentId: "env-one",
      threadType: "standard",
      storageFiles: undefined,
      threadId: "thr-new-tab-dedupe",
    });
    const workspaceTab = buildWorkspaceFileTab({
      lineNumber: 7,
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

    expect(result.current.hasNewTab).toBe(false);
    expect(result.current.activeWorkspaceFilePath).toBe("src/existing.ts");
    expect(result.current.activeWorkspaceFileLineNumber).toBe(7);
    expect(result.current.fixedPanelTabsState.secondary.tabs).toHaveLength(1);
  });

  it("updates host-file line numbers without duplicating tabs", () => {
    const { result } = renderThreadFileTabsHook({
      environmentId: "env-one",
      threadType: "standard",
      storageFiles: undefined,
      threadId: "thr-host-file-dedupe",
    });
    const path = "/Users/me/notes/plan.md";

    act(() => {
      result.current.openHostFile({ lineNumber: 12, path });
      result.current.openHostFile({ lineNumber: 20, path });
    });

    expect(hostFileStates(result.current.orderedSecondaryFileTabs)).toEqual([
      { lineNumber: 20, path },
    ]);
    expect(result.current.activeHostFileLineNumber).toBe(20);
  });

  it("clears workspace tabs when the environment changes", async () => {
    const { result, rerender } = renderThreadFileTabsHook({
      environmentId: "env-one",
      threadType: "standard",
      storageFiles: undefined,
      threadId: "thr-one",
    });
    act(() => {
      result.current.openWorkspaceFile(
        buildWorkspaceFileTab({
          lineNumber: null,
          path: "src/app.ts",
        }),
      );
    });

    rerender({
      environmentId: "env-two",
      threadType: "standard",
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

  it("prunes manager storage tabs against the current storage file list", async () => {
    const { result, rerender } = renderThreadFileTabsHook({
      environmentId: null,
      threadType: "manager",
      storageFiles: [{ path: "notes.md" }, { path: "plan.md" }],
      threadId: "thr-manager",
    });

    act(() => {
      result.current.openStorageFile("notes.md");
      result.current.openStorageFile("plan.md");
    });
    expect(storageFilePaths(result.current.orderedSecondaryFileTabs)).toEqual([
      "notes.md",
      "plan.md",
    ]);
    expect(result.current.activeStorageFilePath).toBe("plan.md");

    rerender({
      environmentId: null,
      threadType: "manager",
      storageFiles: [{ path: "notes.md" }],
      threadId: "thr-manager",
    });

    await waitFor(() => {
      expect(storageFilePaths(result.current.orderedSecondaryFileTabs)).toEqual(
        ["notes.md"],
      );
    });
    expect(result.current.activeStorageFilePath).toBeNull();
  });

  it("keeps seeded manager storage tabs while thread type is unresolved", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const threadId = "thr-manager-cold-load";
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
      threadType: undefined,
      storageFiles: undefined,
      threadId,
    });

    expect(storageFilePaths(result.current.orderedSecondaryFileTabs)).toEqual(
      [],
    );
    expect(getStoredStoragePaths(readStoredState(threadId))).toEqual([
      "overview.md",
      "notes.md",
    ]);
    expect(readStoredState(threadId).secondary.activeTabId).toBe(
      storageFileTabId("notes.md"),
    );

    rerender({
      environmentId: null,
      threadType: "manager",
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
      lineNumber: 7,
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
      threadType: undefined,
      storageFiles: undefined,
      threadId,
    });

    expect(
      workspaceFileStates(result.current.orderedSecondaryFileTabs),
    ).toEqual([]);
    expect(getStoredWorkspaceTabs(readStoredState(threadId))).toEqual([
      workspaceTab,
    ]);
    expect(readStoredState(threadId).secondary.activeTabId).toBe(
      workspaceFileTabId("src/app.ts"),
    );

    rerender({
      environmentId: "env-one",
      threadType: "standard",
      storageFiles: undefined,
      threadId,
    });

    await waitFor(() => {
      expect(
        workspaceFileStates(result.current.orderedSecondaryFileTabs),
      ).toEqual([workspaceTab]);
    });
    expect(result.current.activeWorkspaceFilePath).toBe("src/app.ts");
  });

  it("keeps active seeded storage when it remains in the file list", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const threadId = "thr-manager-seeded-active";
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
      threadType: "manager",
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

  it("closes manager storage tabs", () => {
    const { result } = renderThreadFileTabsHook({
      environmentId: null,
      threadType: "manager",
      storageFiles: [{ path: "notes.md" }],
      threadId: "thr-manager-storage-close",
    });

    act(() => {
      result.current.openStorageFile("notes.md");
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

  it("closes app tabs", () => {
    const { result } = renderThreadFileTabsHook({
      apps: [{ applicationId: "app_review" }],
      environmentId: null,
      threadType: "manager",
      storageFiles: undefined,
      threadId: "thr-manager-app",
    });

    act(() => {
      result.current.openApp("app_review");
    });

    expect(appTabIds(result.current.orderedSecondaryFileTabs)).toEqual([
      "app_review",
    ]);
    expect(result.current.activeAppId).toBe("app_review");

    act(() => {
      result.current.closeAppTab("app_review");
    });

    expect(appTabIds(result.current.orderedSecondaryFileTabs)).toEqual([]);
    expect(result.current.activeAppId).toBeNull();
  });

  it("opens an app tab from launcher search selection", () => {
    const { result } = renderThreadFileTabsHook({
      apps: [{ applicationId: "app_demo" }],
      environmentId: "env-one",
      threadType: "standard",
      storageFiles: undefined,
      threadId: "thr-app-selection",
    });

    act(() => {
      result.current.openNewTab();
      result.current.selectFileSearchResult({
        source: "app",
        applicationId: "app_demo",
      });
    });

    expect(appTabIds(result.current.orderedSecondaryFileTabs)).toEqual([
      "app_demo",
    ]);
    expect(result.current.activeAppId).toBe("app_demo");
    expect(getStoredAppIds(readStoredState("thr-app-selection"))).toEqual([
      "app_demo",
    ]);
  });

  it("does not rewrite workspace tabs for no-op callbacks", () => {
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(NOW);
    const threadId = "thr-workspace-no-op";
    const workspaceTab = buildWorkspaceFileTab({
      lineNumber: 3,
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
      threadType: "standard",
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

  it("does not rewrite manager storage tabs for no-op callbacks", async () => {
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
      threadType: "manager",
      storageFiles: [{ path: "overview.md" }, { path: "notes.md" }],
      threadId,
    });

    await waitFor(() => {
      expect(result.current.activeStorageFilePath).toBe("notes.md");
    });
    dateNowSpy.mockReturnValue(NOW + 60_000);

    act(() => {
      result.current.openStorageFile("notes.md");
      result.current.activateStorageFileTab("notes.md");
      result.current.closeStorageFileTab("missing.md");
    });

    expect(readStoredState(threadId).lastUsedAt).toBe(NOW);
    expect(getStoredStoragePaths(readStoredState(threadId))).toEqual([
      "overview.md",
      "notes.md",
    ]);
  });

  it("ignores stored storage tabs for standard threads", async () => {
    const threadId = "thr-standard";
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
      threadType: "standard",
      storageFiles: undefined,
      threadId,
    });

    await waitFor(() => {
      expect(storageFilePaths(result.current.orderedSecondaryFileTabs)).toEqual(
        [],
      );
    });
    expect(result.current.activeStorageFilePath).toBeNull();
    expect(getStoredStoragePaths(readStoredState(threadId))).toEqual([]);
  });
});

describe("useThreadFileTabs — browser tabs", () => {
  it("opens a browser tab via openBrowserTab and persists it (not transient)", () => {
    const { result } = renderThreadFileTabsHook({
      environmentId: "env-one",
      threadType: "standard",
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
      threadType: "standard",
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
      threadType: "standard",
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
    const persisted = readStoredState(
      "thr-browser-update",
    ).secondary.tabs.find((entry) => entry.kind === "browser");
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
      threadType: "standard",
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
