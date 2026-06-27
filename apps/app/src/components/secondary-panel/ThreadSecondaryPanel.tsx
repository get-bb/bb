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
import {
  COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
  COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
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
const SECONDARY_PANEL_HIDE_ICON_BUTTON_CLASS = `${COARSE_POINTER_HEADER_ICON_BUTTON_CLASS} shrink-0 ${CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS}`;
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
   * The browser-tab deck slot. Rendered in the content region so the deck can
   * own browser-view visibility and retention; absent on the web build / in
   * tests with no browser tabs.
   */
  browserDeck?: ReactNode;
  /**
   * Whether the active panel tab is a browser tab. When true the deck fills the
   * content region and the normal content slot is suppressed.
   */
  isBrowserTabActive?: boolean;
  /**
   * The persistent side-chat deck. Like the browser deck, it stays mounted
   * across tab switches so each side chat's composer text + streaming child
   * thread survive deactivation; it self-manages visibility, collapsing to
   * `display:none` when no side-chat tab is active.
   */
  sideChatDeck?: ReactNode;
  /**
   * Whether the active panel tab is a side-chat tab. When true the deck fills
   * the content region and the normal content slot is suppressed.
   */
  isSideChatTabActive?: boolean;
  isOpen: boolean;
  showConversationCollapseControl?: boolean;
  showGitDiffTab?: boolean;
  showInfoTab?: boolean;
  showNewTabButton?: boolean;
  /**
   * How the panel's own inline hide control (top chrome, trailing edge) renders
   * on the wide layout:
   * - "button": render it (the default).
   * - "reserved": render an invisible spacer of the same footprint — used when a
   *   toggle is pinned outside the panel (root compose's fixed overlay) and must
   *   land over a reserved slot with the tab strip kept clear of it.
   * - "hidden": render nothing, leaving no slot — used when a stable toggle lives
   *   elsewhere (the thread-detail full-width header) and the trailing controls
   *   should sit flush at the edge.
   * The drawer layout always renders the button (it carries its own close).
   */
  inlinePanelToggle?: "button" | "reserved" | "hidden";
  onPanelFocus: () => void;
  onPanelChange: (panel: ThreadSecondaryPanelTab) => void;
  onCollapse: () => void;
  onClose: () => void;
  onOpenNewTab: () => void;
  workspaceRootPath?: string | null;
  onOpenFileInEditor?: (path: string) => void;
  onOpenFilePreview?: (path: string) => void;
  onSelectionAddToChat?: (text: string) => void;
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
    case "side-chat":
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
  sideChatDeck,
  isSideChatTabActive = false,
  isOpen,
  showConversationCollapseControl = true,
  showGitDiffTab = true,
  showInfoTab = true,
  showNewTabButton = true,
  inlinePanelToggle = "button",
  onPanelFocus,
  onPanelChange,
  onCollapse,
  onClose,
  onOpenNewTab,
  workspaceRootPath,
  onOpenFileInEditor,
  onOpenFilePreview,
  onSelectionAddToChat,
  isConversationCollapsed,
  onToggleConversationCollapse,
  renderAsDrawer,
}: ThreadSecondaryPanelProps) {
  const activeFileTab = fileTabs?.find((tab) => tab.isActive);
  const visibleFileTabs = fileTabs?.filter((tab) => tab.isHidden !== true);
  const hasActiveFileTab = activeFileTab !== undefined;
  const isTerminalTabActive =
    activeTab?.kind === "terminal" && hasActiveFileTab;
  const togglePanelIconName = renderAsDrawer ? "X" : "PanelRight";
  // The conversation-collapse toggle only exists on a wide viewport; the drawer
  // layout fills the screen and cannot collapse the conversation.
  const conversationCollapseControl =
    renderAsDrawer || !showConversationCollapseControl
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
  // Inline, the panel slides out at a fixed width (clipped by the panel), so the
  // body content must stay mounted through the close animation (and across
  // open/close) instead of unmounting the instant `isOpen` flips — otherwise
  // everything but the tab strip vanishes while the panel is still sliding. The
  // drawer mounts its content only while open.
  const shouldRenderFileTabContent = isOpen || !renderAsDrawer;
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
      // Swipe mode keeps the body mounted while closed, so mark the whole panel
      // inert when hidden — otherwise focusable content (e.g. the new-tab search
      // input's mount autofocus) could pull keyboard focus into the off-screen
      // panel. The open control lives outside this aside on every surface.
      inert={!isOpen}
      onFocusCapture={handlePanelFocusCapture}
      // Swipe mode: the content is held at the panel's open width and absolutely
      // pinned to the panel's LEFT edge, while the Panel's own flex width animates
      // and its overflow-hidden clips the content into view. Two things matter:
      //   1. No transform/opacity on the content, so it is never promoted to a
      //      compositor layer — a composited layer is positioned by the GPU on a
      //      separate thread from the main-thread clip and visibly drifts out of
      //      sync mid-slide (invisible to getBoundingClientRect, which reports the
      //      main-thread layout value). A pure layout clip stays locked.
      //   2. `absolute left-0`, not block flow: when the fixed-width content is
      //      wider than the mid-animation panel, the panel's flex layout CENTERS
      //      the overflow (so the left edge clips by a width-dependent amount and
      //      the padding breathes). Pinning left-0 keeps the content's left edge
      //      flush to the panel edge at every width.
      // The left border rides the content (like the sidebar's sliding panel) so it
      // slides out with the panel on close instead of fading on its own timeline.
      // Hold the fixed open width only while NOT dragging the resize handle.
      // During a drag the panel width tracks the cursor (and can briefly animate),
      // and a fixed width would desync from it — the content's right edge would
      // pull off the panel edge. While resizing, fill the panel (left-0 + right-0
      // below) so the content is always exactly the panel's current width.
      style={
        !renderAsDrawer && !isSecondaryPanelResizing
          ? { width: `var(--secondary-swipe-width, ${persistedWidthPercent}cqw)` }
          : undefined
      }
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden bg-background",
        // Drawer: fill the drawer shell. Inline: the fixed-width, left-pinned
        // content the panel clips into view (or fills the panel while resizing).
        renderAsDrawer && "min-w-0 flex-1",
        !renderAsDrawer && [
          "absolute inset-y-0 left-0 border-l border-border-seam-vertical",
          isSecondaryPanelResizing && "right-0",
          !isOpen && "pointer-events-none",
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
            {showInfoTab ? (
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
              >
                <Icon name="Info" />
              </Button>
            ) : null}
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
              >
                <Icon name="FileDiff" />
              </Button>
            ) : null}
            {showNewTabButton ? (
              <NewTabButton
                onOpenNewTab={onOpenNewTab}
                usesDesktopChrome={usesDesktopChrome}
              />
            ) : null}
            {visibleFileTabs && visibleFileTabs.length > 0 ? (
              <SecondaryPanelTabStrip
                fileTabs={visibleFileTabs}
                onReorderTab={onFileTabReorder}
                usesDesktopChrome={usesDesktopChrome}
              />
            ) : null}
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
              >
                <Icon name={conversationCollapseControl.iconName} />
              </Button>
            ) : null}
            {renderAsDrawer || inlinePanelToggle === "button" ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  SECONDARY_PANEL_HIDE_ICON_BUTTON_CLASS,
                  usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
                )}
                onClick={onClose}
                aria-label={
                  renderAsDrawer ? "Close right panel" : "Hide right panel"
                }
              >
                <Icon name={togglePanelIconName} />
              </Button>
            ) : inlinePanelToggle === "reserved" ? (
              // A toggle pinned outside the panel owns show/hide on this surface
              // (root compose's fixed overlay); reserve this slot's footprint so
              // the tab strip stays clear and the pinned toggle lands over it.
              <div
                aria-hidden
                className={SECONDARY_PANEL_HIDE_ICON_BUTTON_CLASS}
              />
            ) : null}
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
          The browser deck owns native-view visibility/retention and renders
          content only when a browser tab is active. The normal content slot is
          suppressed in that case because the deck fills the region.
        */}
        {browserDeck}
        {sideChatDeck}
        {isBrowserTabActive || isSideChatTabActive ? null : hasActiveFileTab ? (
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
            onSelectionAddToChat={onSelectionAddToChat}
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
          // `overflow-clip`, not `overflow-hidden`: while swiping, the held-width
          // content is wider than the animating panel, which makes an
          // `overflow-hidden` panel a horizontal SCROLL container — and the
          // new-tab search input's mount autofocus then scrolls it to reveal
          // itself, shifting all the content sideways by ~50px (the "padding
          // breathes / left edge cut off" bug). `clip` clips identically but is
          // not scrollable, so nothing can ever offset the content.
          "min-w-0 overflow-clip",
          // The Panel's own flex width is the animation: it grows to make room and
          // its overflow clips the left-pinned content into view — one main-thread
          // layout animation, so the clip and the content it reveals can never
          // desync. `relative` anchors the absolutely left-pinned content; no
          // opacity, since the content is revealed rather than faded.
          `relative transition-[flex-grow,flex-basis] ${PANEL_COLLAPSE_TRANSITION_CLASS}`,
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
        // Zero-width: the visible panel border lives on the content (aside
        // border-l), so this handle is purely the drag hit area + hover seam and
        // sits exactly on that border instead of in a 1px slot to its left (which
        // left the hit area and hover highlight a pixel off the border). Hidden +
        // non-interactive when closed or while the conversation is collapsed.
        isOpen && !isConversationCollapsed
          ? "w-0 opacity-100"
          : "pointer-events-none w-0 opacity-0",
        isResizing && "bg-accent/20",
      )}
      aria-label="Resize thread and right panel"
    >
      {/*
        The panel's persistent left border lives on the content (aside
        `border-l`) so it slides with the panel on open/close. This seam is only
        the resize affordance — transparent at rest (so it doesn't double the
        content border), brightening on hover/drag.
      */}
      <span
        // Sit on the handle's right edge (`left-full`), which is the panel's left
        // edge where the content border-l lives, so the hover/drag highlight lands
        // exactly on the border instead of a pixel to its left at the handle's
        // center.
        className={cn(
          // z-10 so the highlight paints over the adjacent content's border-l
          // (the content renders after the handle) instead of being hidden behind
          // it — otherwise the hover/drag highlight is invisible.
          "pointer-events-none absolute inset-y-0 left-full z-10 w-px transition-colors",
          isResizing
            ? "bg-accent-foreground/50"
            : "bg-transparent group-hover:bg-accent-foreground/35",
        )}
      />
    </PanelResizeHandle>
  );
}
