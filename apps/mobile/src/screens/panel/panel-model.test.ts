import {
  createEmptyFixedPanelTabsState,
  createGitDiffFixedPanelTab,
  createTerminalFixedPanelTab,
  createThreadInfoFixedPanelTab,
  createWorkspaceFilePreviewFixedPanelTab,
  type FixedPanelTab,
} from "@bb/client-core";
import { describe, expect, it } from "vitest";
import {
  buildPanelStripEntries,
  createPanelViewState,
  createTabForOpenFileRequest,
  describePanelTab,
  panelReducer,
  reconcileFixedViewTabs,
  resolvePanelActiveView,
  type PanelScope,
  type PanelViewState,
} from "./panel-model";

const threadScope: PanelScope = {
  kind: "thread",
  threadId: "thr_1",
  projectId: "proj_1",
  environmentId: "env_1",
  hostId: "host_1",
};
const projectScope: PanelScope = {
  kind: "project",
  projectId: "proj_1",
  environmentId: null,
  hostId: "host_1",
};
const bothFixed = { showInfo: true, showDiff: true };

const info = createThreadInfoFixedPanelTab();
const diff = createGitDiffFixedPanelTab();
const fileA = createWorkspaceFilePreviewFixedPanelTab({
  environmentId: "env_1",
  projectId: null,
  tab: {
    lineRange: null,
    path: "src/a.ts",
    source: { kind: "working-tree" },
    statusLabel: null,
  },
});
const fileOtherEnv = createWorkspaceFilePreviewFixedPanelTab({
  environmentId: "env_2",
  projectId: null,
  tab: {
    lineRange: null,
    path: "src/other.ts",
    source: { kind: "working-tree" },
    statusLabel: "deleted",
  },
});
const terminal = createTerminalFixedPanelTab({ terminalId: "term_1" });
const browser: FixedPanelTab = {
  environmentId: null,
  id: "browser:x:none",
  kind: "browser",
  title: null,
  url: "https://example.com/docs",
};

function viewWith(
  tabs: readonly FixedPanelTab[],
  activeTabId: string | null,
  overrides: Partial<PanelViewState> = {},
): PanelViewState {
  return {
    ...createPanelViewState(
      createEmptyFixedPanelTabsState({
        secondary: { tabs, activeTabId, isOpen: true },
      }),
    ),
    ...overrides,
  };
}

describe("resolvePanelActiveView", () => {
  it("prefers the launcher, then the active tab, then Info (thread) or Files (project)", () => {
    const state = viewWith([info, diff, fileA], fileA.id);
    expect(resolvePanelActiveView(state, threadScope)).toEqual({
      kind: "tab",
      tab: fileA,
    });
    expect(
      resolvePanelActiveView({ ...state, launcher: "terminal" }, threadScope),
    ).toEqual({ kind: "launcher", launcher: "terminal" });
    expect(
      resolvePanelActiveView(viewWith([info, diff], null), threadScope),
    ).toEqual({ kind: "tab", tab: info });
    expect(resolvePanelActiveView(viewWith([], null), threadScope)).toEqual({
      kind: "launcher",
      launcher: "files",
    });
    expect(
      resolvePanelActiveView(viewWith([fileA], "missing"), projectScope),
    ).toEqual({ kind: "launcher", launcher: "files" });
  });
});

describe("buildPanelStripEntries", () => {
  it("orders fixed entries before file tabs, marks the active one, and hides other environments' workspace tabs in thread scope", () => {
    const state = viewWith(
      [info, diff, fileA, fileOtherEnv, terminal, browser],
      terminal.id,
    );
    const entries = buildPanelStripEntries(state, threadScope, bothFixed);
    expect(entries.map((entry) => entry.label)).toEqual([
      "Info",
      "Diff",
      "Files",
      "Terminal",
      "a.ts",
      "Terminal",
      "example.com",
    ]);
    expect(entries.map((entry) => entry.closable)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
    expect(entries.filter((entry) => entry.active).map((e) => e.key)).toEqual([
      `tab:${terminal.id}`,
    ]);
  });

  it("omits Info / Diff when not eligible and shows cross-environment workspace tabs in project scope", () => {
    const state = viewWith([fileA, fileOtherEnv], null, { launcher: "files" });
    const entries = buildPanelStripEntries(state, projectScope, {
      showInfo: false,
      showDiff: false,
    });
    expect(entries.map((entry) => entry.label)).toEqual([
      "Files",
      "Terminal",
      "a.ts",
      "other.ts",
    ]);
    expect(entries[0]?.active).toBe(true);
    expect(entries[3]?.statusLabel).toBe("deleted");
  });
});

describe("describePanelTab", () => {
  it("labels file tabs by file name and flags desktop-only kinds", () => {
    expect(describePanelTab(fileA)).toMatchObject({
      label: "a.ts",
      icon: "Code",
      supported: true,
    });
    expect(describePanelTab(browser)).toMatchObject({
      label: "example.com",
      icon: "Globe",
      supported: false,
    });
    expect(describePanelTab({ ...browser, title: "Docs" }).label).toBe("Docs");
    expect(
      describePanelTab({
        actionId: "act",
        id: "plugin-panel:x:none",
        kind: "plugin-panel",
        paramsJson: null,
        pluginId: "plug",
        title: "My panel",
      }),
    ).toMatchObject({ label: "My panel", supported: false });
  });
});

describe("createTabForOpenFileRequest", () => {
  it("builds workspace tabs against the environment, or the project when there is none", () => {
    const tab = createTabForOpenFileRequest(
      { kind: "workspace", path: "src/a.ts", line: 12, endLine: 14 },
      threadScope,
    );
    expect(tab).toMatchObject({
      kind: "workspace-file-preview",
      environmentId: "env_1",
      projectId: null,
      lineRange: { startLineNumber: 12, endLineNumber: 14 },
      source: { kind: "working-tree" },
    });
    const projectTab = createTabForOpenFileRequest(
      { kind: "workspace", path: "README.md", line: 0 },
      projectScope,
    );
    expect(projectTab).toMatchObject({
      environmentId: null,
      projectId: "proj_1",
      lineRange: null,
    });
  });

  it("requires a thread for host and storage previews", () => {
    expect(
      createTabForOpenFileRequest(
        { kind: "host", path: "/tmp/x.log" },
        projectScope,
      ),
    ).toBeNull();
    expect(
      createTabForOpenFileRequest(
        { kind: "storage", path: "notes.md" },
        projectScope,
      ),
    ).toBeNull();
    expect(
      createTabForOpenFileRequest(
        { kind: "host", path: "/tmp/x.log" },
        threadScope,
      ),
    ).toMatchObject({ kind: "host-file-preview", threadId: "thr_1" });
    expect(
      createTabForOpenFileRequest(
        { kind: "storage", path: "notes.md", line: 3 },
        threadScope,
      ),
    ).toMatchObject({
      kind: "thread-storage-file-preview",
      threadId: "thr_1",
      lineRange: { startLineNumber: 3, endLineNumber: 3 },
    });
  });
});

describe("reconcileFixedViewTabs", () => {
  it("keeps Info / Diff in front of the file tabs for a thread and strips them for a project", () => {
    const tabs = createEmptyFixedPanelTabsState({
      secondary: { tabs: [fileA, info], activeTabId: fileA.id, isOpen: true },
    });
    const forThread = reconcileFixedViewTabs(tabs, threadScope, bothFixed);
    expect(forThread.secondary.tabs.map((tab) => tab.id)).toEqual([
      info.id,
      diff.id,
      fileA.id,
    ]);
    expect(forThread.secondary.activeTabId).toBe(fileA.id);
    const forProject = reconcileFixedViewTabs(tabs, projectScope, {
      showInfo: false,
      showDiff: false,
    });
    expect(forProject.secondary.tabs.map((tab) => tab.id)).toEqual([fileA.id]);
  });
});

describe("panelReducer", () => {
  it("open lands on the requested view and presents the sheet", () => {
    const start = viewWith([info, diff], null);
    const diffView = panelReducer(
      start,
      { type: "open", target: { kind: "diff", path: "src/a.ts" } },
      threadScope,
    );
    expect(diffView.visible).toBe(true);
    expect(diffView.diffPath).toBe("src/a.ts");
    expect(resolvePanelActiveView(diffView, threadScope)).toEqual({
      kind: "tab",
      tab: diff,
    });

    const files = panelReducer(
      diffView,
      {
        type: "open",
        target: { kind: "files", params: { section: "storage" } },
      },
      threadScope,
    );
    expect(files.launcher).toBe("files");
    expect(files.filesParams).toEqual({
      section: "storage",
      initialQuery: null,
    });
    // The tab state keeps the Diff tab active underneath; the launcher wins.
    expect(files.tabs.secondary.activeTabId).toBe(diff.id);

    const consumed = panelReducer(
      files,
      { type: "consume-files-params" },
      threadScope,
    );
    expect(consumed.filesParams).toBeNull();
  });

  it("opening a file adds its tab, clears the launcher, and re-opening focuses the same tab", () => {
    const start = viewWith([info, diff], null, { launcher: "files" });
    const opened = panelReducer(
      start,
      {
        type: "open",
        target: {
          kind: "file",
          request: { kind: "workspace", path: "src/a.ts" },
        },
      },
      threadScope,
    );
    expect(opened.launcher).toBeNull();
    expect(opened.tabs.secondary.tabs.map((tab) => tab.id)).toEqual([
      info.id,
      diff.id,
      fileA.id,
    ]);
    expect(opened.tabs.secondary.activeTabId).toBe(fileA.id);

    const again = panelReducer(
      panelReducer(
        opened,
        { type: "activate", target: { kind: "tab", tabId: info.id } },
        threadScope,
      ),
      {
        type: "open",
        target: {
          kind: "file",
          request: { kind: "workspace", path: "src/a.ts" },
        },
      },
      threadScope,
    );
    expect(again.tabs.secondary.tabs).toHaveLength(3);
    expect(again.tabs.secondary.activeTabId).toBe(fileA.id);
  });

  it("a terminal id opens a terminal tab; no id selects the Terminal launcher", () => {
    const start = viewWith([info], null);
    const launcher = panelReducer(
      start,
      { type: "open", target: { kind: "terminal" } },
      threadScope,
    );
    expect(launcher.launcher).toBe("terminal");
    const tab = panelReducer(
      launcher,
      { type: "open", target: { kind: "terminal", terminalId: "term_1" } },
      threadScope,
    );
    expect(tab.launcher).toBeNull();
    expect(tab.tabs.secondary.activeTabId).toBe(terminal.id);
  });

  it("closing the active file tab falls back to a neighbour, then to a fixed tab", () => {
    const fileB = createWorkspaceFilePreviewFixedPanelTab({
      environmentId: "env_1",
      projectId: null,
      tab: {
        lineRange: null,
        path: "src/b.ts",
        source: { kind: "working-tree" },
        statusLabel: null,
      },
    });
    const start = viewWith([info, diff, fileA, fileB], fileA.id);
    const afterFirst = panelReducer(
      start,
      { type: "close-tab", tabId: fileA.id },
      threadScope,
    );
    expect(afterFirst.tabs.secondary.activeTabId).toBe(fileB.id);
    const afterSecond = panelReducer(
      afterFirst,
      { type: "close-tab", tabId: fileB.id },
      threadScope,
    );
    expect(afterSecond.tabs.secondary.tabs.map((tab) => tab.id)).toEqual([
      info.id,
      diff.id,
    ]);
    expect(resolvePanelActiveView(afterSecond, threadScope)).toEqual({
      kind: "tab",
      tab: info,
    });
  });

  it("close others keeps the long-pressed tab (and the fixed views); close all leaves only fixed views", () => {
    const start = viewWith([info, diff, fileA, terminal, browser], browser.id, {
      launcher: "terminal",
    });
    const others = panelReducer(
      start,
      { type: "close-other-tabs", tabId: fileA.id },
      threadScope,
    );
    expect(others.tabs.secondary.tabs.map((tab) => tab.id)).toEqual([
      info.id,
      diff.id,
      fileA.id,
    ]);
    expect(others.tabs.secondary.activeTabId).toBe(fileA.id);
    expect(others.launcher).toBeNull();

    const all = panelReducer(start, { type: "close-all-tabs" }, threadScope);
    expect(all.tabs.secondary.tabs.map((tab) => tab.id)).toEqual([
      info.id,
      diff.id,
    ]);
    expect(all.tabs.secondary.activeTabId).toBeNull();
    expect(all.launcher).toBe("terminal");
  });

  it("returns the same state for no-op actions so callers can skip persistence", () => {
    const start = viewWith([info, diff], info.id, { visible: true });
    expect(
      panelReducer(
        start,
        { type: "activate", target: { kind: "tab", tabId: info.id } },
        threadScope,
      ),
    ).toBe(start);
    expect(
      panelReducer(start, { type: "close-tab", tabId: "nope" }, threadScope),
    ).toBe(start);
    expect(panelReducer(start, { type: "open" }, threadScope)).toBe(start);
    expect(
      panelReducer(
        start,
        { type: "activate", target: { kind: "tab", tabId: "nope" } },
        threadScope,
      ),
    ).toBe(start);
    expect(panelReducer(start, { type: "close" }, threadScope).visible).toBe(
      false,
    );
  });
});
