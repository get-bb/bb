import {
  activateSecondaryPanelTabInState,
  buildOrderedSecondaryPanelFileTabs,
  closeSecondaryPanelTabInState,
  createGitDiffFixedPanelTab,
  createHostFilePreviewFixedPanelTab,
  createTerminalFixedPanelTab,
  createThreadInfoFixedPanelTab,
  createThreadStorageFilePreviewFixedPanelTab,
  createWorkspaceFilePreviewFixedPanelTab,
  findSecondaryPanelTab,
  isSecondaryFileTab,
  openSecondaryPanelTabInState,
  reconcileFixedPanelViewTabsInState,
  setSecondaryPanelTabsInState,
  type EnvironmentFilePreviewSource,
  type FilePreviewLineRange,
  type FixedPanelTab,
  type FixedPanelTabsState,
  type FixedPanelViewTab,
  type WorkspaceFilePreviewStatusLabel,
} from "@bb/client-core";
import type { TerminalCreateTarget } from "@bb/server-contract";
import type { IconName } from "@/ui/icon-map";

/**
 * Pure model of the mobile workspace panel (the bottom-sheet counterpart of
 * the web's ThreadSecondaryPanel): which surface the panel serves, the
 * transient view state layered over the client-core tab state, the tab strip
 * entries, and the transitions every controller action performs. Everything
 * here is vitest-tested; the React provider only wires it to the store, the
 * sync hook and the sheet.
 */

// ---------------------------------------------------------------------------
// Scope

interface ThreadPanelScope {
  kind: "thread";
  threadId: string;
  projectId: string | null;
  /** The thread's environment; null until the thread loads or when it has none. */
  environmentId: string | null;
  hostId: string | null;
}

/** The root-compose panel: a project (or none) before a thread exists. */
interface ProjectPanelScope {
  kind: "project";
  projectId: string | null;
  /** A reused environment picked on the compose screen, else null. */
  environmentId: string | null;
  hostId: string | null;
}

export type PanelScope = ThreadPanelScope | ProjectPanelScope;

// ---------------------------------------------------------------------------
// View state

/**
 * The fixed strip entries that are not client-core tabs: the Files launcher
 * (file search / storage browser) and the Terminal launcher (sessions list /
 * start). They never persist or sync; a tab activation clears them.
 */
export type PanelLauncherId = "files" | "terminal";

export interface FilesLauncherParams {
  /** Which section the Files page should lead with. */
  section: "search" | "storage";
  initialQuery: string | null;
}

export interface PanelViewState {
  tabs: FixedPanelTabsState;
  /** Set while a launcher entry is selected (overrides `tabs.secondary.activeTabId`). */
  launcher: PanelLauncherId | null;
  /** The sheet is presented. */
  visible: boolean;
  /** Scroll-to intent for the Diff tab ("Changed files" / a file row); the Diff content consumes it. */
  diffPath: string | null;
  /** What the Files launcher was opened with; the Files content consumes it. */
  filesParams: FilesLauncherParams | null;
}

const DEFAULT_FILES_LAUNCHER_PARAMS: FilesLauncherParams = {
  section: "search",
  initialQuery: null,
};

export function createPanelViewState(
  tabs: FixedPanelTabsState,
): PanelViewState {
  return {
    tabs,
    launcher: null,
    visible: false,
    diffPath: null,
    filesParams: null,
  };
}

export type PanelActiveView =
  | { kind: "tab"; tab: FixedPanelTab }
  | { kind: "launcher"; launcher: PanelLauncherId };

/**
 * What the panel body shows: a selected launcher, else the active tab, else
 * the scope's default (Info for a thread, Files for the root-compose panel).
 */
export function resolvePanelActiveView(
  state: PanelViewState,
  scope: PanelScope,
): PanelActiveView {
  if (state.launcher !== null) {
    return { kind: "launcher", launcher: state.launcher };
  }
  const activeTabId = state.tabs.secondary.activeTabId;
  const activeTab =
    activeTabId === null
      ? null
      : findSecondaryPanelTab(state.tabs.secondary.tabs, activeTabId);
  if (activeTab !== null) return { kind: "tab", tab: activeTab };
  if (scope.kind === "thread") {
    const info = findSecondaryPanelTab(
      state.tabs.secondary.tabs,
      createThreadInfoFixedPanelTab().id,
    );
    if (info !== null) return { kind: "tab", tab: info };
  }
  return { kind: "launcher", launcher: "files" };
}

// ---------------------------------------------------------------------------
// Tab descriptors

interface PanelTabDescriptor {
  label: string;
  icon: IconName;
  /** Shown beside the label ("deleted"). */
  statusLabel: string | null;
  /** Mobile renders this kind; otherwise the "available on desktop" card. */
  supported: boolean;
}

function fileNameFromPath(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

function fileIconForPath(path: string): IconName {
  const name = fileNameFromPath(path);
  const dot = name.lastIndexOf(".");
  const extension = dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
  if (extension === "md" || extension === "markdown") return "FileText";
  if (extension === "html" || extension === "htm") return "AppWindow";
  return "Code";
}

function browserTabLabel(tab: { title: string | null; url: string }): string {
  if (tab.title) return tab.title;
  if (tab.url.length === 0) return "Browser";
  try {
    return new URL(tab.url).host || tab.url;
  } catch {
    return tab.url;
  }
}

/** The tab kinds mobile renders natively; every other kind is a placeholder. */
export const MOBILE_SUPPORTED_TAB_KINDS: ReadonlySet<FixedPanelTab["kind"]> =
  new Set<FixedPanelTab["kind"]>([
    "thread-info",
    "git-diff",
    "workspace-file-preview",
    "host-file-preview",
    "thread-storage-file-preview",
    "terminal",
    "new-tab",
  ]);

export function describePanelTab(tab: FixedPanelTab): PanelTabDescriptor {
  const supported = MOBILE_SUPPORTED_TAB_KINDS.has(tab.kind);
  switch (tab.kind) {
    case "thread-info":
      return { label: "Info", icon: "Info", statusLabel: null, supported };
    case "git-diff":
      return { label: "Diff", icon: "FileDiff", statusLabel: null, supported };
    case "workspace-file-preview":
      return {
        label: fileNameFromPath(tab.path),
        icon: fileIconForPath(tab.path),
        statusLabel: tab.statusLabel,
        supported,
      };
    case "host-file-preview":
      return {
        label: fileNameFromPath(tab.path),
        icon: fileIconForPath(tab.path),
        statusLabel: null,
        supported,
      };
    case "thread-storage-file-preview":
      return {
        label: fileNameFromPath(tab.path),
        icon: fileIconForPath(tab.path),
        statusLabel: null,
        supported,
      };
    case "terminal":
      return {
        label: "Terminal",
        icon: "Terminal",
        statusLabel: null,
        supported,
      };
    case "browser":
      return {
        label: browserTabLabel(tab),
        icon: "Globe",
        statusLabel: null,
        supported,
      };
    case "plugin-panel":
      return { label: tab.title, icon: "Puzzle", statusLabel: null, supported };
    case "plugin-page-fixed":
      return { label: "Plugin", icon: "Puzzle", statusLabel: null, supported };
    case "new-tab":
      return { label: "New tab", icon: "NewTab", statusLabel: null, supported };
  }
}

// ---------------------------------------------------------------------------
// Tab strip

export type PanelStripTarget =
  | { kind: "tab"; tabId: string }
  | { kind: "launcher"; launcher: PanelLauncherId };

export interface PanelStripEntry {
  key: string;
  label: string;
  icon: IconName;
  statusLabel: string | null;
  active: boolean;
  /** File tabs close; fixed entries (Info, Diff, Files, Terminal) do not. */
  closable: boolean;
  target: PanelStripTarget;
}

interface BuildPanelStripEntriesOptions {
  /** Info is a thread-only view. */
  showInfo: boolean;
  /** Diff needs a git-backed environment. */
  showDiff: boolean;
}

function stripTargetMatchesView(
  target: PanelStripTarget,
  view: PanelActiveView,
): boolean {
  if (target.kind === "tab") {
    return view.kind === "tab" && view.tab.id === target.tabId;
  }
  return view.kind === "launcher" && view.launcher === target.launcher;
}

/**
 * The strip in display order: Info, Diff, Files, Terminal (the fixed entries
 * the scope allows), then the closable file tabs. Workspace previews of
 * another environment stay hidden in thread scope (they belong to the thread
 * that opened them) and show everywhere in project scope, like the web.
 */
export function buildPanelStripEntries(
  state: PanelViewState,
  scope: PanelScope,
  options: BuildPanelStripEntriesOptions,
): PanelStripEntry[] {
  const view = resolvePanelActiveView(state, scope);
  const entries: PanelStripEntry[] = [];
  const push = (
    target: PanelStripTarget,
    descriptor: Pick<PanelTabDescriptor, "label" | "icon" | "statusLabel">,
    closable: boolean,
  ) => {
    entries.push({
      key:
        target.kind === "tab"
          ? `tab:${target.tabId}`
          : `launcher:${target.launcher}`,
      label: descriptor.label,
      icon: descriptor.icon,
      statusLabel: descriptor.statusLabel,
      active: stripTargetMatchesView(target, view),
      closable,
      target,
    });
  };
  if (options.showInfo) {
    const info = createThreadInfoFixedPanelTab();
    push({ kind: "tab", tabId: info.id }, describePanelTab(info), false);
  }
  if (options.showDiff) {
    const diff = createGitDiffFixedPanelTab();
    push({ kind: "tab", tabId: diff.id }, describePanelTab(diff), false);
  }
  push(
    { kind: "launcher", launcher: "files" },
    { label: "Files", icon: "FolderOpen", statusLabel: null },
    false,
  );
  push(
    { kind: "launcher", launcher: "terminal" },
    { label: "Terminal", icon: "Terminal", statusLabel: null },
    false,
  );
  const fileTabs = buildOrderedSecondaryPanelFileTabs({
    includeWorkspaceTabsOutsideEnvironment: scope.kind === "project",
    resolvedEnvironmentId: scope.environmentId,
    tabs: state.tabs.secondary.tabs,
  });
  for (const tab of fileTabs) {
    if (tab.kind === "new-tab") continue;
    push({ kind: "tab", tabId: tab.id }, describePanelTab(tab), true);
  }
  return entries;
}

/** The fixed view tabs the scope keeps at the front of the client-core tab list. */
function fixedViewTabsForScope(
  scope: PanelScope,
  options: BuildPanelStripEntriesOptions,
): FixedPanelViewTab[] {
  if (scope.kind !== "thread") return [];
  const tabs: FixedPanelViewTab[] = [];
  if (options.showInfo) tabs.push(createThreadInfoFixedPanelTab());
  if (options.showDiff) tabs.push(createGitDiffFixedPanelTab());
  return tabs;
}

/** Keep the scope's fixed view tabs (Info / Diff) in front of the file tabs. */
export function reconcileFixedViewTabs(
  tabs: FixedPanelTabsState,
  scope: PanelScope,
  options: BuildPanelStripEntriesOptions,
): FixedPanelTabsState {
  return reconcileFixedPanelViewTabsInState({
    fixedTabs: fixedViewTabsForScope(scope, options),
    state: tabs,
  });
}

// ---------------------------------------------------------------------------
// Open requests

export interface OpenFileRequest {
  /** Workspace = the environment's checkout; host = any absolute path on the host; storage = thread storage. */
  kind: "workspace" | "host" | "storage";
  path: string;
  /** 1-based first line to reveal (optional end line for a range). */
  line?: number | null;
  endLine?: number | null;
  /** Workspace previews only; defaults to the working tree. */
  source?: EnvironmentFilePreviewSource;
  statusLabel?: WorkspaceFilePreviewStatusLabel | null;
}

export type PanelOpenTarget =
  | { kind: "diff"; path?: string | null }
  | { kind: "files"; params?: Partial<FilesLauncherParams> }
  | {
      kind: "terminal";
      /** Activate (or add) the tab of an existing session; omitted = the launcher. */
      terminalId?: string | null;
      target?: TerminalCreateTarget;
    }
  | { kind: "file"; request: OpenFileRequest }
  | { kind: "tab-id"; tabId: string };

function lineRangeFromRequest(
  request: OpenFileRequest,
): FilePreviewLineRange | null {
  const start = request.line ?? null;
  if (start === null || !Number.isInteger(start) || start < 1) return null;
  const end = request.endLine ?? start;
  return {
    startLineNumber: start,
    endLineNumber: Number.isInteger(end) && end >= start ? end : start,
  };
}

/**
 * The client-core tab an open-file request becomes in this scope. Host and
 * storage previews belong to a thread (their ids embed it), so they need a
 * thread scope; workspace previews resolve to the environment, or to the
 * project when the panel has no environment yet (root compose).
 */
export function createTabForOpenFileRequest(
  request: OpenFileRequest,
  scope: PanelScope,
): FixedPanelTab | null {
  const lineRange = lineRangeFromRequest(request);
  switch (request.kind) {
    case "workspace":
      return createWorkspaceFilePreviewFixedPanelTab({
        environmentId: scope.environmentId,
        projectId: scope.environmentId === null ? scope.projectId : null,
        tab: {
          lineRange,
          path: request.path,
          source: request.source ?? { kind: "working-tree" },
          statusLabel: request.statusLabel ?? null,
        },
      });
    case "host":
      if (scope.kind !== "thread" || scope.environmentId === null) return null;
      return createHostFilePreviewFixedPanelTab({
        environmentId: scope.environmentId,
        tab: { lineRange, path: request.path },
        threadId: scope.threadId,
      });
    case "storage":
      if (scope.kind !== "thread") return null;
      return createThreadStorageFilePreviewFixedPanelTab({
        environmentId: scope.environmentId,
        isPinned: false,
        tab: { lineRange, path: request.path },
        threadId: scope.threadId,
      });
  }
}

// ---------------------------------------------------------------------------
// Transitions

export type PanelAction =
  | { type: "open"; target?: PanelOpenTarget }
  | { type: "close" }
  | { type: "toggle" }
  | { type: "activate"; target: PanelStripTarget }
  | { type: "close-tab"; tabId: string }
  | { type: "close-other-tabs"; tabId: string }
  | { type: "close-all-tabs" }
  | { type: "consume-diff-path" }
  | { type: "consume-files-params" };

function withTabs(
  state: PanelViewState,
  tabs: FixedPanelTabsState,
): PanelViewState {
  return tabs === state.tabs ? state : { ...state, tabs };
}

function activateTab(state: PanelViewState, tabId: string): PanelViewState {
  const tabs = activateSecondaryPanelTabInState(state.tabs, tabId);
  if (findSecondaryPanelTab(tabs.secondary.tabs, tabId) === null) return state;
  if (tabs === state.tabs && state.launcher === null) return state;
  return { ...withTabs(state, tabs), launcher: null };
}

function applyOpenTarget(
  state: PanelViewState,
  target: PanelOpenTarget,
  scope: PanelScope,
): PanelViewState {
  switch (target.kind) {
    case "diff": {
      const diff = createGitDiffFixedPanelTab();
      return {
        ...withTabs(
          state,
          openSecondaryPanelTabInState({ state: state.tabs, tab: diff }),
        ),
        launcher: null,
        diffPath: target.path ?? null,
      };
    }
    case "files":
      return {
        ...state,
        launcher: "files",
        filesParams: { ...DEFAULT_FILES_LAUNCHER_PARAMS, ...target.params },
      };
    case "terminal": {
      if (!target.terminalId) {
        return { ...state, launcher: "terminal" };
      }
      const tab = createTerminalFixedPanelTab({
        terminalId: target.terminalId,
        ...(target.target !== undefined ? { target: target.target } : {}),
      });
      return {
        ...withTabs(
          state,
          openSecondaryPanelTabInState({ state: state.tabs, tab }),
        ),
        launcher: null,
      };
    }
    case "file": {
      const tab = createTabForOpenFileRequest(target.request, scope);
      if (tab === null) return state;
      return {
        ...withTabs(
          state,
          openSecondaryPanelTabInState({ state: state.tabs, tab }),
        ),
        launcher: null,
      };
    }
    case "tab-id":
      return activateTab(state, target.tabId);
  }
}

function closeOtherTabs(
  state: PanelViewState,
  keepTabId: string | null,
): PanelViewState {
  const tabs = state.tabs.secondary.tabs.filter(
    (tab) => !isSecondaryFileTab(tab) || tab.id === keepTabId,
  );
  if (tabs.length === state.tabs.secondary.tabs.length) return state;
  const activeTabId =
    keepTabId !== null && tabs.some((tab) => tab.id === keepTabId)
      ? keepTabId
      : tabs.some((tab) => tab.id === state.tabs.secondary.activeTabId)
        ? state.tabs.secondary.activeTabId
        : null;
  return {
    ...withTabs(
      state,
      setSecondaryPanelTabsInState({
        activeTabId,
        isOpen: state.tabs.secondary.isOpen,
        state: state.tabs,
        tabs,
      }),
    ),
    launcher: keepTabId === null ? state.launcher : null,
  };
}

/**
 * One controller action → the next view state. The tab half of the result
 * is what the provider writes to the store (and thus syncs); the rest is
 * session-only.
 */
export function panelReducer(
  state: PanelViewState,
  action: PanelAction,
  scope: PanelScope,
): PanelViewState {
  switch (action.type) {
    case "open": {
      const next =
        action.target === undefined
          ? state
          : applyOpenTarget(state, action.target, scope);
      return next.visible ? next : { ...next, visible: true };
    }
    case "close":
      return state.visible ? { ...state, visible: false } : state;
    case "toggle":
      return { ...state, visible: !state.visible };
    case "activate":
      if (action.target.kind === "launcher") {
        return state.launcher === action.target.launcher
          ? state
          : { ...state, launcher: action.target.launcher };
      }
      return activateTab(state, action.target.tabId);
    case "close-tab": {
      const tabs = closeSecondaryPanelTabInState(state.tabs, action.tabId);
      return withTabs(state, tabs);
    }
    case "close-other-tabs":
      return closeOtherTabs(state, action.tabId);
    case "close-all-tabs":
      return closeOtherTabs(state, null);
    case "consume-diff-path":
      return state.diffPath === null ? state : { ...state, diffPath: null };
    case "consume-files-params":
      return state.filesParams === null
        ? state
        : { ...state, filesParams: null };
  }
}
