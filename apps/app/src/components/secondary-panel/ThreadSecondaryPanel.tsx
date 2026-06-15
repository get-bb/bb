import {
  type CSSProperties,
  type FocusEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";
import { useAtomValue } from "jotai";
import type { DiffFileEntry } from "@bb/server-contract";
import { Icon } from "@/components/ui/icon.js";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { Panel, PanelResizeHandle } from "react-resizable-panels";
import { Button } from "@/components/ui/button.js";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@/components/ui/chromeStyleTokens";
import { COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing.js";
import { cn } from "@/lib/utils";
import {
  PANEL_COLLAPSE_TRANSITION_CLASS,
  PANEL_RESIZE_HIT_AREA_MARGINS,
} from "./panelTransitionTokens";
import { SECONDARY_PANEL_TOP_CHROME_BACKGROUND_CLASS } from "./panelChromeClasses";
import { resolveConversationCollapseControl } from "./panelToggleControlState";
import { SecondaryPanelTabStrip } from "./SecondaryPanelTabStrip";
import type {
  SecondaryPanelFileTab,
  SecondaryPanelTabReorderHandler,
} from "./secondaryPanelFileTab";
import { type ThreadSecondaryPanel as ThreadSecondaryPanelTab } from "@/lib/thread-secondary-panel";
import { GIT_DIFF_VIEW_BASE_OPTIONS } from "../git-diff/GitDiffCard";
import { usePreferredTheme } from "@/hooks/useTheme";
import { useEnvironmentDiffFiles } from "@/hooks/queries/environment-queries";
import {
  DEFAULT_CODE_OVERFLOW_MODE,
  type CodeOverflowMode,
} from "@/lib/code-overflow-mode";
import { useGitDiffPanelState } from "./git-diff/useGitDiffPanelState";
import { useResponsiveGitDiffPanelDisplay } from "./git-diff/useResponsiveGitDiffPanelDisplay";
import {
  summarizeDiffFileEntries,
  useDiffFilesCollapseControls,
} from "./git-diff/diffFilesStore";
import { buildGitDiffIdentity } from "./git-diff/gitDiffPanelHelpers";
import {
  type SecondaryPanelDraggingHandler,
  useSecondaryPanelResize,
} from "./useSecondaryPanelResize";
import { threadSecondaryPanelResizingAtom } from "./threadSecondaryPanelAtoms";
import { GitDiffToolbar } from "./GitDiffToolbar";
import {
  GitDiffTabContent,
  ThreadInfoTabContent,
} from "./ThreadSecondaryPanelTabContent";
import {
  CHROME_ROW_CLASS,
  getBbDesktopInfo,
  MACOS_TRAFFIC_LIGHT_RESERVE_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  MACOS_WINDOW_NO_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { IframeDragGuardOverlay } from "@/lib/iframe-drag-guard";
import type { SecondaryFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
export type {
  GitDiffDisplayMode,
  GitDiffSelectionOption,
} from "./GitDiffToolbar";
export type { SecondaryPanelFileTab } from "./secondaryPanelFileTab";

const THREAD_SECONDARY_PANEL_MIN_SIZE_PERCENT = 24;
const THREAD_SECONDARY_PANEL_MAX_SIZE_PERCENT = 70;
// While the conversation is collapsed the panel fills the content area, so its
// size/max are lifted to the full width of the horizontal group.
const CONVERSATION_COLLAPSED_PANEL_SIZE_PERCENT = 100;
const PANEL_SCROLL_SLOT_CLASS =
  "min-h-0 flex-1 overflow-x-auto overflow-y-auto";
const SECONDARY_RESIZABLE_PANEL_STYLE: CSSProperties = {
  pointerEvents: "auto",
};
const SECONDARY_PANEL_CHROME_ICON_BUTTON_CLASS = `${COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS} shrink-0 ${CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS}`;
// Stable empty TOC reference so the collapse-controls hook's derived atom and
// the stats memo are not rebuilt every render while the diff is loading/absent.
const EMPTY_DIFF_FILES: readonly DiffFileEntry[] = [];

interface ResolveActiveFixedPanelArgs {
  activeTab: SecondaryFixedPanelTab | null;
  canUseGitUi: boolean;
}

export interface ThreadSecondaryPanelProps {
  activeTab: SecondaryFixedPanelTab | null;
  canUseGitUi: boolean;
  defaultMergeBaseBranch?: string;
  environmentId?: string;
  metadataContent: ReactNode;
  fileTabs?: SecondaryPanelFileTab[];
  fileTabContent?: ReactNode;
  onFileTabReorder: SecondaryPanelTabReorderHandler;
  /**
   * The persistent browser-tab deck. Rendered in the content region and kept
   * mounted across tab switches so each browser tab's native view (and page)
   * survives deactivation; it self-manages visibility, collapsing to
   * `display:none` when no browser tab is active. Absent on the web build / in
   * tests with no browser tabs.
   */
  browserDeck?: ReactNode;
  /**
   * Whether the active panel tab is a browser tab. When true the deck fills the
   * content region and the normal content slot is suppressed.
   */
  isBrowserTabActive?: boolean;
  isOpen: boolean;
  showGitDiffTab?: boolean;
  onPanelFocus: () => void;
  onPanelChange: (panel: ThreadSecondaryPanelTab) => void;
  onCollapse: () => void;
  onClose: () => void;
  onOpenNewTab: () => void;
  workspaceRootPath?: string | null;
  onOpenFileInEditor?: (path: string) => void;
  onOpenFilePreview?: (path: string) => void;
  /**
   * When true the conversation pane is collapsed: this panel expands to fill
   * the content area (its max size is lifted). Always false in the
   * drawer/compact layout.
   */
  isConversationCollapsed: boolean;
  /**
   * Toggles {@link isConversationCollapsed}. On a wide viewport the panel header
   * renders the expand/restore-conversation control (immediately left of the
   * hide-panel button); the collapsed conversation rail surfaces the same
   * action. Unused in the drawer/compact layout, which cannot collapse the
   * conversation.
   */
  onToggleConversationCollapse: () => void;
  /**
   * When true, the panel is the top-left-most surface under the macOS
   * traffic-light strip (desktop macOS + main sidebar collapsed + conversation
   * collapsed, so only the 36px rail sits to the panel's left). Adds the full
   * traffic-light reserve on the top chrome so the leading tabs clear the pinned
   * sidebar-collapse trigger — which floats over the header and overhangs the
   * rail — landing them one gap to its right rather than jammed under it.
   */
  reserveLeftForDesktopTrafficLights: boolean;
  /**
   * When true, render only the aside content — skip the PanelResizeHandle +
   * Panel wrappers that are only meaningful inside a desktop PanelGroup.
   * Caller is responsible for wrapping the content in a Drawer in that case.
   */
  renderAsDrawer: boolean;
}

function resolveActiveFixedPanel({
  activeTab,
  canUseGitUi,
}: ResolveActiveFixedPanelArgs): ThreadSecondaryPanelTab | null {
  if (activeTab === null) {
    return null;
  }

  switch (activeTab.kind) {
    case "thread-info":
      return "thread-info";
    case "git-diff":
      return canUseGitUi ? "git-diff" : "thread-info";
    case "workspace-file-preview":
    case "host-file-preview":
    case "thread-storage-file-preview":
    case "browser":
    case "terminal":
    case "new-tab":
      return null;
  }
}

export function ThreadSecondaryPanel({
  activeTab,
  canUseGitUi,
  defaultMergeBaseBranch,
  environmentId,
  metadataContent,
  fileTabs,
  fileTabContent,
  onFileTabReorder,
  browserDeck,
  isBrowserTabActive = false,
  isOpen,
  showGitDiffTab = true,
  onPanelFocus,
  onPanelChange,
  onCollapse,
  onClose,
  onOpenNewTab,
  workspaceRootPath,
  onOpenFileInEditor,
  onOpenFilePreview,
  isConversationCollapsed,
  onToggleConversationCollapse,
  reserveLeftForDesktopTrafficLights,
  renderAsDrawer,
}: ThreadSecondaryPanelProps) {
  const activeFileTab = fileTabs?.find((tab) => tab.isActive);
  const hasActiveFileTab = activeFileTab !== undefined;
  const isTerminalTabActive =
    activeTab?.kind === "terminal" && hasActiveFileTab;
  const togglePanelIconName = renderAsDrawer ? "X" : "PanelRight";
  // The conversation-collapse toggle only exists on a wide viewport; the drawer
  // layout fills the screen and cannot collapse the conversation.
  const conversationCollapseControl = renderAsDrawer
    ? null
    : resolveConversationCollapseControl({
        isConversationCollapsed,
        onToggleConversationCollapse,
      });
  const {
    gitDiffDisplayMode,
    handleGitDiffDisplayModeChange,
    handleSecondaryPanelResizeStart,
    handleSecondaryPanelWidthChange,
  } = useResponsiveGitDiffPanelDisplay({ isSecondaryPanelOpen: isOpen });
  const {
    handleSecondaryPanelDragging: handleResizeDragging,
    handleSecondaryPanelResize,
    persistedWidthPercent,
    secondaryPanelRef: panelRef,
    secondaryResizablePanelRef: resizablePanelRef,
  } = useSecondaryPanelResize({
    isSecondaryPanelOpen: isOpen,
    onPanelWidthChange: handleSecondaryPanelWidthChange,
  });
  const handleSecondaryPanelDragging: SecondaryPanelDraggingHandler =
    useCallback(
      (isDragging) => {
        if (isDragging) {
          handleSecondaryPanelResizeStart();
        }
        handleResizeDragging(isDragging);
      },
      [handleResizeDragging, handleSecondaryPanelResizeStart],
    );
  const activeFixedPanel =
    resolveActiveFixedPanel({ activeTab, canUseGitUi }) ?? "thread-info";
  const isDiffPanelActive = activeFixedPanel === "git-diff";
  const shouldShowGitDiffTab = canUseGitUi && showGitDiffTab !== false;
  const shouldRenderFileTabContent = isOpen;
  const {
    gitDiffTarget,
    gitDiffSelectOptions,
    gitDiffSelectValue,
    onGitDiffSelectionChange,
  } = useGitDiffPanelState({
    environmentId,
    isDiffPanelActive,
    defaultMergeBaseBranch,
  });
  // Share the diff tab's table of contents with the body: React Query dedupes
  // this against GitDiffTabContent's own fetch (same key), so the toolbar reads
  // the file list, stats, and merge-base ref without a second round-trip. The
  // toolbar's stats + collapse-all derive from this TOC, not the (removed)
  // whole-diff blob.
  const { data: diffFilesResponse, isLoading: isDiffFilesLoading } =
    useEnvironmentDiffFiles(environmentId ?? "", {
      enabled:
        isDiffPanelActive &&
        Boolean(environmentId) &&
        gitDiffTarget !== undefined,
      target: gitDiffTarget,
    });
  const diffFiles = useMemo(
    () =>
      diffFilesResponse?.outcome === "available"
        ? diffFilesResponse.files
        : EMPTY_DIFF_FILES,
    [diffFilesResponse],
  );
  const diffMergeBaseRef =
    diffFilesResponse?.outcome === "available"
      ? diffFilesResponse.mergeBaseRef
      : null;
  const diffIdentity = useMemo(
    () =>
      buildGitDiffIdentity({
        environmentId,
        mergeBaseRef: diffMergeBaseRef,
        target: gitDiffTarget,
      }),
    [diffMergeBaseRef, environmentId, gitDiffTarget],
  );
  const gitDiffStats = useMemo(
    () => summarizeDiffFileEntries(diffFiles),
    [diffFiles],
  );
  const { areAllCollapsed, toggleAllCollapsed, hasFiles } =
    useDiffFilesCollapseControls(diffIdentity, diffFiles);
  const isSecondaryPanelResizing = useAtomValue(
    threadSecondaryPanelResizingAtom,
  );
  const [desktopInfo] = useState(getBbDesktopInfo);
  const [gitDiffLineOverflowMode, setGitDiffLineOverflowMode] =
    useState<CodeOverflowMode>(DEFAULT_CODE_OVERFLOW_MODE);
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const preferredTheme = usePreferredTheme();
  const gitDiffViewOptions = useMemo(
    () => ({
      ...GIT_DIFF_VIEW_BASE_OPTIONS,
      diffStyle: gitDiffDisplayMode,
      overflow: gitDiffLineOverflowMode,
      themeType: preferredTheme,
    }),
    [gitDiffDisplayMode, gitDiffLineOverflowMode, preferredTheme],
  );
  const handlePanelFocusCapture = (event: FocusEvent<HTMLElement>) => {
    const previousTarget = event.relatedTarget;
    if (
      previousTarget instanceof Node &&
      event.currentTarget.contains(previousTarget)
    ) {
      return;
    }
    onPanelFocus();
  };

  const asideMarkup = (
    <aside
      ref={panelRef}
      aria-hidden={!isOpen}
      onFocusCapture={handlePanelFocusCapture}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background",
        !renderAsDrawer && [
          "transition-[transform,opacity,background-color]",
          PANEL_COLLAPSE_TRANSITION_CLASS,
          isOpen
            ? "opacity-100"
            : "pointer-events-none translate-x-[8%] opacity-0",
        ],
      )}
    >
      <IframeDragGuardOverlay active={isSecondaryPanelResizing} />
      <div className={SECONDARY_PANEL_TOP_CHROME_BACKGROUND_CLASS}>
        <div
          data-testid="thread-secondary-panel-top-chrome"
          className={cn(
            CHROME_ROW_CLASS,
            // No bottom border: the top nav sits flush over the panel body so
            // each view's background (info, diff, new-tab, terminal) runs
            // straight up to the top with no seam.
            "min-w-0 justify-between gap-2 px-4",
            usesDesktopChrome && MACOS_WINDOW_DRAG_CLASS,
            reserveLeftForDesktopTrafficLights &&
              MACOS_TRAFFIC_LIGHT_RESERVE_CLASS,
          )}
        >
          <div
            className="flex min-w-0 flex-1 items-center gap-1"
            // A toolbar, not a tablist: the Info/Diff controls and file tabs are
            // toggle buttons (`aria-pressed`) rather than `role="tab"` widgets
            // backed by tabpanels, so `role="tablist"` would be malformed. Toolbar
            // semantics describe this compact row of view controls without
            // claiming the unimplemented tab contract.
            role="toolbar"
            aria-label="Right panel views"
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                SECONDARY_PANEL_CHROME_ICON_BUTTON_CLASS,
                usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
              )}
              onClick={() => onPanelChange("thread-info")}
              aria-label="Show thread info panel"
              aria-pressed={
                activeFixedPanel === "thread-info" && !hasActiveFileTab
              }
              title="Info"
            >
              <Icon name="Info" />
            </Button>
            {shouldShowGitDiffTab ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  SECONDARY_PANEL_CHROME_ICON_BUTTON_CLASS,
                  usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
                )}
                onClick={() => onPanelChange("git-diff")}
                aria-label="Show diff panel"
                aria-pressed={isDiffPanelActive && !hasActiveFileTab}
                title="Diff"
              >
                <Icon name="FileDiff" />
              </Button>
            ) : null}
            {fileTabs && fileTabs.length > 0 ? (
              <SecondaryPanelTabStrip
                fileTabs={fileTabs}
                onReorderTab={onFileTabReorder}
                usesDesktopChrome={usesDesktopChrome}
              />
            ) : null}
            <NewTabButton
              onOpenNewTab={onOpenNewTab}
              usesDesktopChrome={usesDesktopChrome}
            />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {conversationCollapseControl ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
                  "shrink-0",
                  usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
                )}
                onClick={conversationCollapseControl.onClick}
                aria-label={conversationCollapseControl.label}
                aria-expanded={conversationCollapseControl.isExpanded}
                title={conversationCollapseControl.label}
              >
                <Icon name={conversationCollapseControl.iconName} />
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
                "shrink-0",
                usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
              )}
              onClick={onClose}
              aria-label={
                renderAsDrawer ? "Close right panel" : "Hide right panel"
              }
              title={renderAsDrawer ? "Close right panel" : "Hide right panel"}
            >
              <Icon name={togglePanelIconName} />
            </Button>
          </div>
        </div>
        {isDiffPanelActive && !hasActiveFileTab ? (
          <GitDiffToolbar
            selectionValue={gitDiffSelectValue}
            selectionOptions={gitDiffSelectOptions}
            onSelectionChange={onGitDiffSelectionChange}
            isSelectorDisabled={isDiffFilesLoading || gitDiffTarget === undefined}
            stats={gitDiffStats}
            areAllFilesCollapsed={areAllCollapsed}
            isCollapseAllDisabled={!hasFiles || isDiffFilesLoading}
            onToggleAllCollapsed={toggleAllCollapsed}
            displayMode={gitDiffDisplayMode}
            onDisplayModeChange={handleGitDiffDisplayModeChange}
            lineOverflowMode={gitDiffLineOverflowMode}
            onLineOverflowModeChange={setGitDiffLineOverflowMode}
          />
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        {/*
          The browser deck stays mounted regardless of the active tab so its
          native views survive switching away; it shows itself only when a
          browser tab is active. The normal content slot is suppressed in that
          case (the deck fills the region).
        */}
        {browserDeck}
        {isBrowserTabActive ? null : hasActiveFileTab ? (
          <div
            className={
              isTerminalTabActive
                ? "min-h-0 flex-1 overflow-hidden"
                : cn(PANEL_SCROLL_SLOT_CLASS, "pb-3")
            }
            data-file-preview-scroll-container={
              isTerminalTabActive ? undefined : ""
            }
          >
            {shouldRenderFileTabContent
              ? (fileTabContent ?? (
                  <EmptyStatePanel className="mx-4 rounded-lg">
                    No file preview content provided.
                  </EmptyStatePanel>
                ))
              : null}
          </div>
        ) : isDiffPanelActive ? (
          <GitDiffTabContent
            environmentId={environmentId}
            target={gitDiffTarget}
            isDiffPanelActive={isDiffPanelActive}
            gitDiffViewOptions={gitDiffViewOptions}
            onOpenFileInEditor={onOpenFileInEditor}
            onOpenFilePreview={onOpenFilePreview}
            workspaceRootPath={workspaceRootPath}
          />
        ) : (
          <ThreadInfoTabContent metadataContent={metadataContent} />
        )}
      </div>
    </aside>
  );

  if (renderAsDrawer) {
    return asideMarkup;
  }

  return (
    <>
      <SecondaryPanelResizeHandle
        isOpen={isOpen}
        isConversationCollapsed={isConversationCollapsed}
        onDragging={handleSecondaryPanelDragging}
      />
      <Panel
        ref={resizablePanelRef}
        id="thread-detail-secondary-panel"
        collapsible
        collapsedSize={0}
        defaultSize={
          isOpen
            ? isConversationCollapsed
              ? CONVERSATION_COLLAPSED_PANEL_SIZE_PERCENT
              : persistedWidthPercent
            : 0
        }
        minSize={THREAD_SECONDARY_PANEL_MIN_SIZE_PERCENT}
        maxSize={
          isConversationCollapsed
            ? CONVERSATION_COLLAPSED_PANEL_SIZE_PERCENT
            : THREAD_SECONDARY_PANEL_MAX_SIZE_PERCENT
        }
        onCollapse={onCollapse}
        onResize={handleSecondaryPanelResize}
        order={2}
        style={SECONDARY_RESIZABLE_PANEL_STYLE}
        className={cn(
          "min-w-0 overflow-hidden transition-[flex-grow,flex-basis,opacity]",
          PANEL_COLLAPSE_TRANSITION_CLASS,
          isOpen ? "opacity-100" : "opacity-0",
        )}
      >
        {asideMarkup}
      </Panel>
    </>
  );
}

interface NewTabButtonProps {
  onOpenNewTab: () => void;
  usesDesktopChrome: boolean;
}

function NewTabButton({ onOpenNewTab, usesDesktopChrome }: NewTabButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        SECONDARY_PANEL_CHROME_ICON_BUTTON_CLASS,
        usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
      )}
      onClick={onOpenNewTab}
      aria-label="Open new tab"
      title="New tab"
    >
      <Icon name="Plus" />
    </Button>
  );
}

interface SecondaryPanelResizeHandleProps {
  isOpen: boolean;
  isConversationCollapsed: boolean;
  onDragging: SecondaryPanelDraggingHandler;
}

function SecondaryPanelResizeHandle({
  isOpen,
  isConversationCollapsed,
  onDragging,
}: SecondaryPanelResizeHandleProps) {
  const isResizing = useAtomValue(threadSecondaryPanelResizingAtom);
  return (
    <PanelResizeHandle
      id="thread-detail-secondary-panel-handle"
      // Dragging is meaningless while collapsed (the conversation is at zero
      // width); the collapsed rail's expand chevron is the only affordance in
      // that state.
      disabled={!isOpen || isConversationCollapsed}
      onDragging={onDragging}
      hitAreaMargins={PANEL_RESIZE_HIT_AREA_MARGINS}
      className={cn(
        "group relative shrink-0 overflow-visible bg-transparent transition-[width,opacity,background-color] before:absolute before:inset-y-0 before:-left-1.5 before:-right-1.5 before:content-['']",
        PANEL_COLLAPSE_TRANSITION_CLASS,
        isConversationCollapsed ? "cursor-default" : "cursor-col-resize",
        // While collapsed the handle's hairline would sit flush against the
        // collapsed rail's recessed edge, doubling the seam. Drag is disabled
        // in that state anyway, so fold the handle to zero width and hide it;
        // the rail's recessed background is then the single clean edge.
        isOpen && !isConversationCollapsed
          ? "w-px opacity-100"
          : "pointer-events-none w-0 opacity-0",
        isResizing && "bg-accent/20",
      )}
      aria-label="Resize thread and right panel"
    >
      <span
        className={cn(
          "pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border-seam-vertical transition-colors",
          isResizing
            ? "bg-accent-foreground/50"
            : "group-hover:bg-accent-foreground/35",
        )}
      />
    </PanelResizeHandle>
  );
}
