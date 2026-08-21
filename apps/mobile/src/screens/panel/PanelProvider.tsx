import type { TerminalCreateTarget } from "@bb/server-contract";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSyncedPanelTabs } from "@/data/thread-tabs";
import {
  buildPanelStripEntries,
  createPanelViewState,
  panelReducer,
  reconcileFixedViewTabs,
  resolvePanelActiveView,
  type FilesLauncherParams,
  type OpenFileRequest,
  type PanelAction,
  type PanelActiveView,
  type PanelLauncherId,
  type PanelOpenTarget,
  type PanelScope,
  type PanelStripEntry,
  type PanelStripTarget,
  type PanelViewState,
} from "./panel-model";
import { WorkspacePanelSheet } from "./WorkspacePanelSheet";

/**
 * The imperative surface screens and tab contents use to drive the panel.
 * Obtain it with `usePanel()` (throws outside a provider) or
 * `useOptionalPanel()` (null outside one — for components that also render
 * where no panel exists, such as markdown links in dev showcases).
 */
export interface PanelController {
  scope: PanelScope;
  /** The whole view state (tabs + transient selection). */
  view: PanelViewState;
  activeView: PanelActiveView;
  visible: boolean;
  /** The strip in display order (fixed entries, then closable tabs). */
  entries: readonly PanelStripEntry[];
  /** Present the sheet, optionally landing on a view. */
  open(target?: PanelOpenTarget): void;
  close(): void;
  toggle(): void;
  /** Diff tab; `path` asks the Diff content to scroll that file into view. */
  openDiff(path?: string | null): void;
  /** Files launcher (search / thread storage). */
  openFiles(params?: Partial<FilesLauncherParams>): void;
  /** A terminal session's tab, or the Terminal launcher when no id is given. */
  openTerminal(terminalId?: string | null, target?: TerminalCreateTarget): void;
  /** A workspace / host / thread-storage file preview tab. */
  openFile(request: OpenFileRequest): void;
  activate(target: PanelStripTarget): void;
  closeTab(tabId: string): void;
  closeOtherTabs(tabId: string): void;
  closeAllTabs(): void;
  /** The Diff content read `view.diffPath`; clear it so it is not re-applied. */
  consumeDiffPath(): void;
  /** The Files content read `view.filesParams`; clear it. */
  consumeFilesParams(): void;
}

/**
 * Exported for the sheet: @gorhom/bottom-sheet modals render through a
 * portal host at the app root, outside this provider's React subtree, so the
 * sheet re-provides the controller to its own content.
 */
export const PanelContext = createContext<PanelController | null>(null);

export function usePanel(): PanelController {
  const controller = useContext(PanelContext);
  if (controller === null) {
    throw new Error("usePanel must be used inside a <WorkspacePanelProvider>");
  }
  return controller;
}

export function useOptionalPanel(): PanelController | null {
  return useContext(PanelContext);
}

interface WorkspacePanelProviderProps {
  scope: PanelScope;
  /** Key of the device-local tab state (the thread id, or the root-compose panel id). */
  panelStateId: string;
  /** The thread whose server strip mirrors this panel; null for local-only panels. */
  syncThreadId: string | null;
  /** Show the Info entry (thread scope). */
  showInfo: boolean;
  /** Show the Diff entry (a git-backed environment). */
  showDiff: boolean;
  /**
   * The scope's eligibility inputs (environment record, git flag) have
   * settled. Until then the fixed view tabs are left as persisted so a
   * loading flash never rewrites (and syncs) the strip.
   */
  scopeResolved?: boolean;
  children: ReactNode;
}

interface TransientPanelState {
  launcher: PanelLauncherId | null;
  visible: boolean;
  diffPath: string | null;
  filesParams: FilesLauncherParams | null;
}

const INITIAL_TRANSIENT: TransientPanelState = {
  launcher: null,
  visible: false,
  diffPath: null,
  filesParams: null,
};

function transientEquals(
  a: TransientPanelState,
  b: TransientPanelState,
): boolean {
  return (
    a.launcher === b.launcher &&
    a.visible === b.visible &&
    a.diffPath === b.diffPath &&
    a.filesParams === b.filesParams
  );
}

/**
 * Owns one workspace panel: the client-core tab state (device-local +
 * server-synced through `useSyncedPanelTabs`), the transient selection, the
 * controller, and the bottom sheet itself. Mount it around the screen whose
 * header / composer opens the panel; tab contents reach the controller
 * through `usePanel()`.
 */
export function WorkspacePanelProvider({
  scope,
  panelStateId,
  syncThreadId,
  showInfo,
  showDiff,
  scopeResolved = true,
  children,
}: WorkspacePanelProviderProps) {
  const { state: tabs, update } = useSyncedPanelTabs({
    panelStateId,
    syncThreadId,
  });
  const [transient, setTransient] =
    useState<TransientPanelState>(INITIAL_TRANSIENT);
  // `dispatch` is the only writer of the transient state; the ref lets it
  // read the latest value without re-creating the callback per change.
  const transientRef = useRef(transient);

  const stripOptions = useMemo(
    () => ({ showInfo, showDiff }),
    [showDiff, showInfo],
  );
  // Render the reconciled strip immediately (no flash of a missing Info /
  // Diff entry); commit it once settled so the store and the server follow.
  const reconciledTabs = useMemo(
    () =>
      scopeResolved ? reconcileFixedViewTabs(tabs, scope, stripOptions) : tabs,
    [scope, scopeResolved, stripOptions, tabs],
  );
  useEffect(() => {
    if (!scopeResolved || reconciledTabs === tabs) return;
    update((current) => reconcileFixedViewTabs(current, scope, stripOptions));
  }, [reconciledTabs, scope, scopeResolved, stripOptions, tabs, update]);

  const dispatch = useCallback(
    (action: PanelAction) => {
      let nextTransient = transientRef.current;
      update((currentTabs) => {
        const previous: PanelViewState = {
          ...transientRef.current,
          tabs: currentTabs,
        };
        const next = panelReducer(previous, action, scope);
        nextTransient = {
          launcher: next.launcher,
          visible: next.visible,
          diffPath: next.diffPath,
          filesParams: next.filesParams,
        };
        return next.tabs;
      });
      if (!transientEquals(nextTransient, transientRef.current)) {
        transientRef.current = nextTransient;
        setTransient(nextTransient);
      }
    },
    [scope, update],
  );

  const view = useMemo<PanelViewState>(
    () => ({ ...createPanelViewState(reconciledTabs), ...transient }),
    [reconciledTabs, transient],
  );
  const activeView = useMemo(
    () => resolvePanelActiveView(view, scope),
    [scope, view],
  );
  const entries = useMemo(
    () => buildPanelStripEntries(view, scope, stripOptions),
    [scope, stripOptions, view],
  );

  const controller = useMemo<PanelController>(
    () => ({
      scope,
      view,
      activeView,
      visible: view.visible,
      entries,
      open: (target) => dispatch({ type: "open", target }),
      close: () => dispatch({ type: "close" }),
      toggle: () => dispatch({ type: "toggle" }),
      openDiff: (path) =>
        dispatch({ type: "open", target: { kind: "diff", path } }),
      openFiles: (params) =>
        dispatch({ type: "open", target: { kind: "files", params } }),
      openTerminal: (terminalId, target) =>
        dispatch({
          type: "open",
          target: { kind: "terminal", terminalId, target },
        }),
      openFile: (request) =>
        dispatch({ type: "open", target: { kind: "file", request } }),
      activate: (target) => dispatch({ type: "activate", target }),
      closeTab: (tabId) => dispatch({ type: "close-tab", tabId }),
      closeOtherTabs: (tabId) => dispatch({ type: "close-other-tabs", tabId }),
      closeAllTabs: () => dispatch({ type: "close-all-tabs" }),
      consumeDiffPath: () => dispatch({ type: "consume-diff-path" }),
      consumeFilesParams: () => dispatch({ type: "consume-files-params" }),
    }),
    [activeView, dispatch, entries, scope, view],
  );

  return (
    <PanelContext.Provider value={controller}>
      {children}
      <WorkspacePanelSheet controller={controller} />
    </PanelContext.Provider>
  );
}
