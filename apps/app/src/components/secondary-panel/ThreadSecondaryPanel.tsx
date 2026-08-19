import {
  type CSSProperties,
  type FocusEvent,
  type ReactNode,
  type TransitionEvent,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAtomValue } from "jotai";
import type { DiffFileEntry } from "@bb/server-contract";
import { Icon } from "@bb/shared-ui/icon";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Panel, PanelResizeHandle } from "react-resizable-panels";
import { Button } from "@bb/shared-ui/button";
import {
  APP_PAGE_HEADER_SURFACE_CLASS,
  HEADER_PANE_ACTION_ICON_BUTTON_CLASS,
  HEADER_SEAM_CLASS,
} from "@/components/layout/AppPageHeader";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@/components/ui/chromeStyleTokens";
import {
  COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
  COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  PANEL_COLLAPSE_TRANSITION_CLASS,
  PANEL_RESIZE_HIT_AREA_MARGINS,
  PANEL_RESIZE_HANDLE_LAYER_CLASS,
  PANEL_RESIZE_HIT_TARGET_CLASS,
} from "./panelTransitionTokens";
import { SECONDARY_PANEL_TOP_CHROME_BACKGROUND_CLASS } from "./panelChromeClasses";
import {
  CONVERSATION_COLLAPSED_PANEL_SIZE_PERCENT,
  THREAD_SECONDARY_PANEL_MAX_SIZE_PERCENT,
  THREAD_SECONDARY_PANEL_MIN_SIZE_PERCENT,
} from "./secondaryPanelSizing";
import { resolveConversationCollapseControl } from "./panelToggleControlState";
import { SecondaryPanelHostLayoutContext } from "./SecondaryPanelHostLayoutContext";
import { SecondaryPanelTabStrip } from "./SecondaryPanelTabStrip";
import type {
  SecondaryPanelFileTab,
  SecondaryPanelTabReorderHandler,
} from "./secondaryPanelFileTab";
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
  MACOS_APP_REGION_NO_DRAG_CLASS,
  MACOS_CHROME_CONTROL_AXIS_CLASS,
  MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  MACOS_WINDOW_NO_DRAG_CLASS,
  shouldReserveMacosTrafficLights,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { useDesktopWindowState } from "@/hooks/useDesktopWindowState";
import { useOptionalIsSidebarShowing } from "@/components/ui/sidebar.js";
import { IframeDragGuardOverlay } from "@/lib/iframe-drag-guard";
import type {
  FixedPanelViewTab,
  SecondaryFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import {
  createGitDiffFixedPanelTab,
  createThreadInfoFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import { type ThreadSecondaryPanel as ThreadSecondaryPanelTab } from "@/lib/thread-secondary-panel";
import { useAppCommandShortcut } from "@/components/commands/AppCommandProvider";
import { AppCommandShortcutHint } from "@/components/commands/AppCommandShortcutHint";
import type { AppShortcutPresentation } from "@/lib/app-keybindings";
import { TabPill } from "@/components/ui/tab-pill";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { dispatchBrowserViewBoundsSync } from "@/lib/browser-view-bounds-sync";
import type { GitDiffTabStatus } from "./gitDiffTabEligibility";
export type {
  GitDiffDisplayMode,
  GitDiffSelectionOption,
} from "./GitDiffToolbar";
export type { SecondaryPanelFileTab } from "./secondaryPanelFileTab";

export function isSecondaryPanelLayoutTransition(
  propertyName: string,
): boolean {
  return propertyName === "flex-grow" || propertyName === "flex-basis";
}
// While the conversation is collapsed the panel fills the content area, so its
// size/max are lifted to the full width of the horizontal group.
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

// The reserved slot occupies the exact footprint of root compose's pinned
// right-panel toggle (which is painted on top of this slot). On macOS desktop
// the top chrome is a window-drag region ([app-region:drag]); Electron resolves
// draggable regions in DOM order (a later region wins), so a plain slot would
// leave the toggle's pixels inside that drag region and Electron would swallow
// the click as a window drag; the panel could be opened but never closed. As a
// descendant of the drag row this slot is resolved *after* it, so marking it
// no-drag carves the toggle's footprint back out; the OS then routes the click
// to the web contents, where the pinned toggle receives it.
export function getReservedInlinePanelToggleClassName(
  usesDesktopChrome: boolean,
): string {
  return cn(
    SECONDARY_PANEL_HIDE_ICON_BUTTON_CLASS,
    usesDesktopChrome && MACOS_APP_REGION_NO_DRAG_CLASS,
  );
}

/**
 * Keeps the navigation row and optional Diff toolbar in normal document flow.
 * The stack must reserve the combined height of both rows before the flexible
 * panel body begins; only the navigation row owns the fixed chrome-row height.
 */
export function getSecondaryPanelChromeStackClassName(
  hasGitDiffToolbar: boolean,
  surface: "panel" | "page" = "panel",
): string {
  return cn(
    "shrink-0",
    hasGitDiffToolbar && "flex flex-col",
    surface === "page"
      ? cn(APP_PAGE_HEADER_SURFACE_CLASS, HEADER_SEAM_CLASS)
      : SECONDARY_PANEL_TOP_CHROME_BACKGROUND_CLASS,
  );
}

interface CollapsedPanelTrafficLightReserveArgs {
  /** The conversation is collapsed, so this panel fills the content area. */
  isConversationCollapsed: boolean;
  /** The compact drawer layout (never the window's top-left surface). */
  renderAsDrawer: boolean;
  /**
   * Whether the main app sidebar is showing. `null` when the sidebar context is
   * absent (e.g. tests) — treated as showing, so no reserve is applied. The
   * sidebar hosts the traffic lights in its own top strip while open.
   */
  isSidebarShowing: boolean | null;
  /**
   * Whether macOS traffic lights are visible (macOS desktop chrome, not
   * fullscreen). False on the web build and in fullscreen, where the lights are
   * hidden.
   */
  reserveMacosTrafficLights: boolean;
}

/**
 * Left-padding class that clears the macOS traffic-light safe area for the
 * secondary panel's leading top-chrome toolbar, or `false` when no reserve is
 * needed. The reserve applies when the panel is the window's flush top-left
 * surface — the conversation is collapsed — while the main sidebar is collapsed
 * and the lights are visible: the collapsed-left / expanded-right case from
 * BB-46. It lands the leading controls on the same x = 120px as
 * AppPageHeader's own reserve. See {@link MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS}
 * for the geometry.
 *
 * Collapsing hands the panel the top-left on BOTH thread surfaces, so this does
 * not test for the split host. Either way the conversation column collapses to
 * zero width — the split host sets its layout to [0, panel], inline thread
 * detail sizes the timeline panel to 0 — and the thread header rides inside
 * that column, so nothing is left on the title-bar row but this toolbar. The
 * split host reserved correctly because it satisfied the host gate; inline
 * thread detail, identical in layout, did not, which left its tab strip
 * sitting under the traffic lights.
 */
export function resolveCollapsedPanelTrafficLightReserveClassName({
  isConversationCollapsed,
  renderAsDrawer,
  isSidebarShowing,
  reserveMacosTrafficLights,
}: CollapsedPanelTrafficLightReserveArgs): string | false {
  const reserves =
    isConversationCollapsed &&
    !renderAsDrawer &&
    isSidebarShowing === false &&
    reserveMacosTrafficLights;
  return reserves && MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS;
}

export function resolveSecondaryPanelHideControl() {
  return {
    iconName: "PanelRight" as const,
    label: "Hide right panel",
  };
}

export interface SecondaryPanelFixedTab {
  ariaLabel: string;
  label: string;
  leadingVisual: ReactNode;
  onSelect: () => void;
  tab: FixedPanelViewTab;
  title: string;
}

export interface ThreadSecondaryPanelProps {
  activeTab: SecondaryFixedPanelTab | null;
  canUseGitUi: boolean;
  gitDiffTabStatus?: GitDiffTabStatus;
  onRetryGitDiffEligibility?: () => void;
  requestedMergeBaseBranch?: string;
  environmentId?: string;
  metadataContent: ReactNode;
  fileTabs?: SecondaryPanelFileTab[];
  fileTabContent?: ReactNode;
  fixedTabs?: readonly SecondaryPanelFixedTab[];
  fixedTabContent?: ReactNode;
  fixedTabContentFillsRegion?: boolean;
  /**
   * True when the active file tab's content owns its own layout and
   * scrolling (terminal-style): the slot then provides only a definite
   * height instead of the padded scroll container. Set for plugin panel
   * tabs registered with `layout: "flush"`.
   */
  fileTabContentFillsRegion?: boolean;
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
  isOpen: boolean;
  showConversationCollapseControl?: boolean;
  /** Legacy thread-surface inputs normalized into `fixedTabs`. */
  showGitDiffTab?: boolean;
  showInfoTab?: boolean;
  showNewTabButton?: boolean;
  /**
   * Use the app page-header surface when this panel's top row is a direct
   * sibling of a page header. The default keeps thread panels on sidebar
   * chrome.
   */
  topChromeSurface?: "panel" | "page";
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
  /**
   * Unique id for this panel's resizable Panel within its PanelGroup. The
   * split-workspace host swaps different panes' panels through one group, and
   * react-resizable-panels keys layout state by panel id — a shared id would
   * make a newly focused pane's panel adopt the previous pane's layout entry
   * and then "collapse" to its own defaultSize, misreporting a user close.
   * Defaults to the standalone surface's stable id.
   */
  resizablePanelId?: string;
  onPanelFocus: () => void;
  /** Reports the panel's live percentage while it resizes. */
  onPanelResize?: (sizePercent: number) => void;
  /** Legacy thread-surface selector normalized into `fixedTabs`. */
  onPanelChange?: (panel: ThreadSecondaryPanelTab) => void;
  onCollapse: () => void;
  onClose: () => void;
  onClearPendingGitDiffIntent?: () => void;
  onOpenNewTab: () => void;
  pendingGitDiffCommitSha?: string | null;
  pendingGitDiffScrollPath?: string | null;
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
   * renders the full-screen/exit-full-screen control (immediately left of the
   * hide-panel button) in both states. Unused in the drawer/compact layout,
   * which cannot collapse the conversation.
   */
  onToggleConversationCollapse: () => void;
  /**
   * When true, render only the aside content — skip the PanelResizeHandle +
   * Panel wrappers that are only meaningful inside a desktop PanelGroup.
   * Caller is responsible for wrapping the content in a Drawer in that case.
   */
  renderAsDrawer: boolean;
}

export function ThreadSecondaryPanel({
  activeTab,
  canUseGitUi,
  gitDiffTabStatus,
  requestedMergeBaseBranch,
  environmentId,
  metadataContent,
  fileTabs,
  fileTabContent,
  fixedTabs,
  fixedTabContent,
  fixedTabContentFillsRegion = false,
  fileTabContentFillsRegion,
  onFileTabReorder,
  browserDeck,
  isBrowserTabActive = false,
  isOpen,
  showConversationCollapseControl = true,
  showGitDiffTab = true,
  showInfoTab = true,
  showNewTabButton = true,
  topChromeSurface = "panel",
  inlinePanelToggle = "button",
  resizablePanelId = "thread-detail-secondary-panel",
  onPanelFocus,
  onPanelResize,
  onPanelChange,
  onCollapse,
  onClose,
  onClearPendingGitDiffIntent,
  onOpenNewTab,
  onRetryGitDiffEligibility,
  pendingGitDiffCommitSha,
  pendingGitDiffScrollPath,
  workspaceRootPath,
  onOpenFileInEditor,
  onOpenFilePreview,
  onSelectionAddToChat,
  isConversationCollapsed,
  onToggleConversationCollapse,
  renderAsDrawer,
}: ThreadSecondaryPanelProps) {
  const resolvedGitDiffTabStatus =
    gitDiffTabStatus ?? (canUseGitUi ? "eligible" : "ineligible");
  const newTabShortcut = useAppCommandShortcut("panel.newTab");
  const togglePanelShortcut = useAppCommandShortcut("panel.toggle");
  const diffShortcut = useAppCommandShortcut("diff.toggle");
  const activeFileTab = fileTabs?.find((tab) => tab.isActive);
  const visibleFileTabs = useMemo(
    () => fileTabs?.filter((tab) => tab.isHidden !== true),
    [fileTabs],
  );
  const hasActiveFileTab = activeFileTab !== undefined;
  const isTerminalTabActive =
    activeTab?.kind === "terminal" && hasActiveFileTab;
  const hideControl = resolveSecondaryPanelHideControl();
  const resolvedFixedTabs = useMemo<readonly SecondaryPanelFixedTab[]>(() => {
    if (fixedTabs !== undefined) return fixedTabs;
    const selectThreadPanel = onPanelChange ?? (() => undefined);
    return [
      ...(showInfoTab
        ? [
            {
              ariaLabel: "Show thread info panel",
              label: "Info",
              leadingVisual: <Icon name="Info" />,
              onSelect: () => selectThreadPanel("thread-info"),
              tab: createThreadInfoFixedPanelTab(),
              title: "Thread info",
            },
          ]
        : []),
      ...(resolvedGitDiffTabStatus !== "ineligible" && showGitDiffTab
        ? [
            {
              ariaLabel: "Show diff panel",
              label: "Diff",
              leadingVisual: <Icon name="FileDiff" />,
              onSelect: () => selectThreadPanel("git-diff"),
              tab: createGitDiffFixedPanelTab(),
              title: "Diff",
            },
          ]
        : []),
    ];
  }, [
    fixedTabs,
    onPanelChange,
    resolvedGitDiffTabStatus,
    showGitDiffTab,
    showInfoTab,
  ]);
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
  // A Panel that registers with its group already collapsed (a closed panel
  // mounting, or the split-workspace host swapping panes' panels) reports a
  // collapse no user performed — and it can land after a programmatic open,
  // silently closing it again. Only a collapse from a layout this Panel
  // instance actually held expanded may close the persisted panel.
  const hasPanelExpandedRef = useRef(false);
  const handlePanelResize = useCallback(
    (size: number) => {
      if (size > 0) {
        hasPanelExpandedRef.current = true;
        onPanelResize?.(size);
      }
      handleSecondaryPanelResize(size);
    },
    [handleSecondaryPanelResize, onPanelResize],
  );
  const hostLayout = useContext(SecondaryPanelHostLayoutContext);
  const handlePanelCollapse = useCallback(() => {
    if (hostLayout?.isSuppressed) {
      return;
    }
    if (!hasPanelExpandedRef.current) {
      return;
    }
    hasPanelExpandedRef.current = false;
    onCollapse();
  }, [hostLayout?.isSuppressed, onCollapse]);
  const handlePanelTransitionEnd = useCallback(
    (event: TransitionEvent<HTMLElement>) => {
      if (
        event.target !== event.currentTarget ||
        !isSecondaryPanelLayoutTransition(event.propertyName)
      ) {
        return;
      }

      // ResizeObserver catches the panel's changing width, but the restored
      // right-aligned panel continues translating after its final size tick.
      // Re-measure once the flex transition settles so a native browser view
      // cannot keep the full-screen x-position over the thread workspace.
      dispatchBrowserViewBoundsSync();
    },
    [],
  );
  // Inside a window-level host, the Panel's mount size must follow the
  // window's panel visibility: this pane's own persisted state can lag one
  // commit behind the host's alignment, and the group re-applies defaultSize
  // after mount — a stale-closed value would collapse the just-opened panel.
  const isLayoutOpen =
    (hostLayout?.isOpen ?? isOpen) && !hostLayout?.isSuppressed;
  const activeFixedTab =
    resolvedFixedTabs.find((fixedTab) => fixedTab.tab.id === activeTab?.id) ??
    (!hasActiveFileTab ? resolvedFixedTabs[0] : undefined);
  const isDiffPanelActive =
    resolvedGitDiffTabStatus === "eligible" &&
    activeFixedTab?.tab.kind === "git-diff";
  // The diff body stays mounted while the panel is closed (see the retained
  // content note below), but its live queries must not: every workspace write
  // invalidates the diff TOC, evicts patches, and would otherwise refetch and
  // re-render pierre into an off-screen panel. Gate the diff-tab data on the
  // panel actually being open; the DOM stays, the network and diff work stop.
  const isDiffPanelLive = isDiffPanelActive && isLayoutOpen;
  const isDiffEligibilityPending =
    activeFixedTab?.tab.kind === "git-diff" &&
    (resolvedGitDiffTabStatus === "loading" ||
      resolvedGitDiffTabStatus === "error");
  const showsGitDiffToolbar = isDiffPanelActive && !hasActiveFileTab;
  // Keep file content mounted across every close. The compact views defer the
  // first full panel mount, then retain it inside their persistent drawer.
  // Removing only this subtree would lose terminal and plugin state and move
  // the later mount cost back into the next open action.
  const {
    gitDiffTarget,
    gitDiffSelectOptions,
    gitDiffSelectValue,
    onGitDiffSelectionChange,
  } = useGitDiffPanelState({
    environmentId,
    isDiffPanelActive: isDiffPanelLive,
    requestedMergeBaseBranch,
    onClearPendingGitDiffIntent,
    pendingGitDiffCommitSha,
    pendingGitDiffScrollPath,
  });
  // Share the diff tab's table of contents with the body: React Query dedupes
  // this against GitDiffTabContent's own fetch (same key), so the toolbar reads
  // the file list, stats, and merge-base ref without a second round-trip. The
  // toolbar's stats + collapse-all derive from this TOC, not the (removed)
  // whole-diff blob.
  const { data: diffFilesResponse, isLoading: isDiffFilesLoading } =
    useEnvironmentDiffFiles(environmentId ?? "", {
      enabled:
        isDiffPanelLive &&
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
  const isGitDiffTruncated =
    diffFilesResponse?.outcome === "available" && diffFilesResponse.truncated;
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
  const desktopWindowState = useDesktopWindowState();
  const isSidebarShowing = useOptionalIsSidebarShowing();
  // The panel reserves the traffic-light safe area only when it is the window's
  // flush top-left surface (conversation collapsed) with the main sidebar
  // collapsed and the lights visible. See
  // resolveCollapsedPanelTrafficLightReserveClassName.
  const collapsedPanelTrafficLightReserveClassName =
    resolveCollapsedPanelTrafficLightReserveClassName({
      isConversationCollapsed,
      renderAsDrawer,
      isSidebarShowing,
      reserveMacosTrafficLights: shouldReserveMacosTrafficLights({
        desktopInfo,
        windowState: desktopWindowState,
      }),
    });
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
          ? {
              width: `var(--secondary-swipe-width, ${persistedWidthPercent}cqw)`,
            }
          : undefined
      }
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden bg-sidebar",
        // Drawer: fill the drawer shell. Inline: the fixed-width, left-pinned
        // content the panel clips into view (or fills the panel while resizing).
        renderAsDrawer && "min-w-0 flex-1",
        !renderAsDrawer && [
          "absolute inset-y-0 left-0",
          // Inside the split-workspace host, the hairline resize handle is the
          // visible seam; elsewhere the panel carries its own hairline border
          // (it slides with the panel through the open/close animation).
          // Collapsing the conversation drops the timeline and the resize
          // handle to zero width, so this border would land directly on the app
          // sidebar's own `border-r` and read as one thick double seam. The
          // sidebar owns that boundary, so give the border up while collapsed.
          // Collapsing the conversation drops the timeline and the resize
          // handle to zero width, so this border would land directly on the app
          // sidebar's own `border-r` and read as one thick 2px seam. The
          // sidebar owns that boundary, so give the border up while collapsed.
          hostLayout === null &&
            !isConversationCollapsed &&
            "border-l border-border-seam",
          isSecondaryPanelResizing && "right-0",
          !isOpen && "pointer-events-none",
        ],
      )}
    >
      <IframeDragGuardOverlay active={isSecondaryPanelResizing} />
      <div
        className={getSecondaryPanelChromeStackClassName(
          showsGitDiffToolbar,
          topChromeSurface,
        )}
      >
        <div
          data-testid="thread-secondary-panel-top-chrome"
          className={cn(
            CHROME_ROW_CLASS,
            "min-w-0 justify-between gap-2 px-4",
            usesDesktopChrome && MACOS_WINDOW_DRAG_CLASS,
            usesDesktopChrome && MACOS_CHROME_CONTROL_AXIS_CLASS,
          )}
        >
          <div
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1",
              // When this panel owns the window's top-left (conversation
              // collapsed, on either thread surface, with the sidebar
              // collapsed), reserve the traffic-light
              // safe area so the leading controls clear the lights and the
              // pinned sidebar trigger. The padding must animate on the SAME
              // timing/easing as the panel's collapse slide
              // (PANEL_COLLAPSE_TRANSITION_CLASS): the panel's left edge starts
              // well right of 120px and both ease to their endpoints together,
              // so the combined inset (panel-left + px-4 + padding) decreases
              // monotonically to exactly 120px and never dips below it
              // mid-animation. A faster/looser padding transition would let the
              // panel reach the left edge before the padding fills, briefly
              // sliding the leading controls back under the lights/trigger.
              `transition-[padding] ${PANEL_COLLAPSE_TRANSITION_CLASS}`,
              collapsedPanelTrafficLightReserveClassName,
            )}
            // A toolbar, not a tablist: the pinned Info view, Diff control, and
            // open-view pills are toggle buttons (`aria-pressed`) rather than
            // `role="tab"` widgets backed by tabpanels, so `role="tablist"`
            // would be malformed. Toolbar semantics describe this compact row
            // without claiming the unimplemented tab contract.
            role="toolbar"
            aria-label="Right panel views"
          >
            {resolvedFixedTabs.map((fixedTab) => {
              const shortcut =
                fixedTab.tab.kind === "git-diff" ? diffShortcut : null;
              return (
                <PinnedIconTab
                  key={fixedTab.tab.id}
                  ariaLabel={
                    shortcut
                      ? `${fixedTab.ariaLabel} (${shortcut.label})`
                      : fixedTab.ariaLabel
                  }
                  ariaKeyshortcuts={shortcut?.ariaKeyshortcuts}
                  isActive={
                    activeFixedTab?.tab.id === fixedTab.tab.id &&
                    !hasActiveFileTab
                  }
                  label={fixedTab.label}
                  leadingVisual={fixedTab.leadingVisual}
                  onClick={fixedTab.onSelect}
                  title={fixedTab.title}
                  usesDesktopChrome={usesDesktopChrome}
                  activeTreatment="fill"
                />
              );
            })}
            {visibleFileTabs && visibleFileTabs.length > 0 ? (
              <SecondaryPanelTabStrip
                fileTabs={visibleFileTabs}
                onReorderTab={onFileTabReorder}
                usesDesktopChrome={usesDesktopChrome}
                isPanelOpen={isOpen}
                activeTreatment="fill"
              />
            ) : null}
            {showNewTabButton ? (
              <NewTabButton
                onOpenNewTab={onOpenNewTab}
                shortcut={newTabShortcut}
                usesDesktopChrome={usesDesktopChrome}
              />
            ) : null}
          </div>
          <div className="flex min-w-0 shrink-0 items-center gap-1">
            {conversationCollapseControl ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      HEADER_PANE_ACTION_ICON_BUTTON_CLASS,
                      CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
                      "shrink-0",
                      usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
                    )}
                    onClick={conversationCollapseControl.onClick}
                    aria-label={conversationCollapseControl.label}
                    aria-pressed={conversationCollapseControl.isFullScreen}
                  >
                    <Icon name={conversationCollapseControl.iconName} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {conversationCollapseControl.label}
                </TooltipContent>
              </Tooltip>
            ) : null}
            {renderAsDrawer || inlinePanelToggle === "button" ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  SECONDARY_PANEL_HIDE_ICON_BUTTON_CLASS,
                  "relative",
                  usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
                )}
                onClick={onClose}
                aria-label={
                  togglePanelShortcut
                    ? `${hideControl.label} (${togglePanelShortcut.label})`
                    : hideControl.label
                }
                aria-keyshortcuts={togglePanelShortcut?.ariaKeyshortcuts}
              >
                <Icon name={hideControl.iconName} />
                <AppCommandShortcutHint
                  shortcut={togglePanelShortcut}
                  className="absolute right-full mr-1"
                />
              </Button>
            ) : inlinePanelToggle === "reserved" ? (
              // A toggle pinned outside the panel owns show/hide on this surface
              // (root compose's fixed overlay); reserve this slot's footprint so
              // the tab strip stays clear and the pinned toggle lands over it.
              // Under macOS desktop chrome the slot must carve itself out of the
              // window-drag chrome row so the pinned toggle stays clickable; see
              // getReservedInlinePanelToggleClassName.
              <div
                aria-hidden
                className={getReservedInlinePanelToggleClassName(
                  usesDesktopChrome,
                )}
              />
            ) : null}
          </div>
        </div>
        {showsGitDiffToolbar ? (
          <GitDiffToolbar
            selectionValue={gitDiffSelectValue}
            selectionOptions={gitDiffSelectOptions}
            onSelectionChange={onGitDiffSelectionChange}
            isSelectorDisabled={
              isDiffFilesLoading || gitDiffTarget === undefined
            }
            stats={gitDiffStats}
            isTruncated={isGitDiffTruncated}
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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-sidebar">
        {/*
          The browser deck owns native-view visibility/retention and renders
          content only when a browser tab is active. The normal content slot is
          suppressed in that case because the deck fills the region.
        */}
        {browserDeck}
        {isBrowserTabActive ? null : hasActiveFileTab ? (
          <div
            className={
              isTerminalTabActive || fileTabContentFillsRegion
                ? "min-h-0 flex-1 overflow-hidden"
                : cn(PANEL_SCROLL_SLOT_CLASS, "pb-3")
            }
            data-file-preview-scroll-container={
              isTerminalTabActive || fileTabContentFillsRegion ? undefined : ""
            }
          >
            {fileTabContent ?? (
              <EmptyStatePanel className="mx-4 rounded-lg">
                No file preview content provided.
              </EmptyStatePanel>
            )}
          </div>
        ) : activeFixedTab !== undefined && fixedTabContent !== undefined ? (
          <div
            className={
              fixedTabContentFillsRegion
                ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                : cn(PANEL_SCROLL_SLOT_CLASS, "p-4 pb-3")
            }
          >
            {fixedTabContent}
          </div>
        ) : isDiffEligibilityPending ? (
          <EmptyStatePanel className="m-4 rounded-lg" role="status">
            {resolvedGitDiffTabStatus === "error" ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <span>
                  Could not determine whether this workspace uses Git.
                </span>
                {onRetryGitDiffEligibility ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onRetryGitDiffEligibility}
                  >
                    Retry
                  </Button>
                ) : null}
              </div>
            ) : (
              "Checking Git support…"
            )}
          </EmptyStatePanel>
        ) : isDiffPanelActive ? (
          <GitDiffTabContent
            environmentId={environmentId}
            target={gitDiffTarget}
            isDiffPanelActive={isDiffPanelActive}
            isPanelOpen={isLayoutOpen}
            gitDiffViewOptions={gitDiffViewOptions}
            onClearPendingGitDiffIntent={onClearPendingGitDiffIntent}
            onOpenFileInEditor={onOpenFileInEditor}
            onOpenFilePreview={onOpenFilePreview}
            onSelectionAddToChat={onSelectionAddToChat}
            pendingGitDiffScrollPath={pendingGitDiffScrollPath}
            workspaceRootPath={workspaceRootPath}
          />
        ) : activeFixedTab?.tab.kind === "thread-info" ? (
          <ThreadInfoTabContent metadataContent={metadataContent} />
        ) : (
          <EmptyStatePanel className="m-4 rounded-lg">
            This panel view is unavailable.
          </EmptyStatePanel>
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
        matchesSplitDividers={hostLayout !== null}
        onDragging={handleSecondaryPanelDragging}
      />
      <Panel
        ref={resizablePanelRef}
        id={resizablePanelId}
        collapsible
        collapsedSize={0}
        defaultSize={
          isLayoutOpen
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
        onCollapse={handlePanelCollapse}
        onResize={handlePanelResize}
        onTransitionEnd={handlePanelTransitionEnd}
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
  shortcut: AppShortcutPresentation | null;
  usesDesktopChrome: boolean;
}

interface PinnedIconTabProps {
  activeTreatment: "fill" | "underline";
  ariaLabel: string;
  ariaKeyshortcuts?: string;
  isActive: boolean;
  label: string;
  leadingVisual: ReactNode;
  onClick: () => void;
  title: string;
  usesDesktopChrome: boolean;
}

function PinnedIconTab({
  activeTreatment,
  ariaLabel,
  ariaKeyshortcuts,
  isActive,
  label,
  leadingVisual,
  onClick,
  title,
  usesDesktopChrome,
}: PinnedIconTabProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          data-testid={label === "Info" ? "thread-info-tab" : undefined}
          className={cn(
            "shrink-0",
            usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
          )}
        >
          <TabPill
            label={label}
            ariaLabel={ariaLabel}
            ariaKeyshortcuts={ariaKeyshortcuts}
            iconOnly
            leadingVisual={leadingVisual}
            title={title}
            isActive={isActive}
            activeTreatment={activeTreatment}
            onSelect={onClick}
            closeAction={null}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

function NewTabButton({
  onOpenNewTab,
  shortcut,
  usesDesktopChrome,
}: NewTabButtonProps) {
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
      aria-label={
        shortcut ? `Open new tab (${shortcut.label})` : "Open new tab"
      }
      aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
    >
      <Icon name="Plus" />
    </Button>
  );
}

interface SecondaryPanelResizeHandleProps {
  isOpen: boolean;
  isConversationCollapsed: boolean;
  /**
   * True inside the split-workspace host, where the panel sits beside split
   * dividers: the handle renders as the same visible hairline so the grab
   * target reads (and grabs) like its neighbors instead of an invisible seam.
   */
  matchesSplitDividers: boolean;
  onDragging: SecondaryPanelDraggingHandler;
}

function SecondaryPanelResizeHandle({
  isOpen,
  isConversationCollapsed,
  matchesSplitDividers,
  onDragging,
}: SecondaryPanelResizeHandleProps) {
  const isResizing = useAtomValue(threadSecondaryPanelResizingAtom);
  return (
    <PanelResizeHandle
      id="thread-detail-secondary-panel-handle"
      // Dragging is meaningless while collapsed (the conversation is at zero
      // width); the panel header's restore control is the only affordance in
      // that state.
      disabled={!isOpen || isConversationCollapsed}
      onDragging={onDragging}
      hitAreaMargins={PANEL_RESIZE_HIT_AREA_MARGINS}
      className={cn(
        "group relative shrink-0 overflow-visible transition-[width,opacity,background-color]",
        PANEL_RESIZE_HANDLE_LAYER_CLASS,
        PANEL_COLLAPSE_TRANSITION_CLASS,
        isConversationCollapsed ? "cursor-default" : "cursor-col-resize",
        matchesSplitDividers
          ? [
              // Match SplitDivider: a one-pixel vertical seam that warms on
              // hover/drag while the overlapping child keeps it easy to grab.
              // Collapses away with the panel.
              "bg-border-seam hover:bg-ring/40",
              isOpen && !isConversationCollapsed
                ? "w-px opacity-100"
                : "pointer-events-none w-0 opacity-0",
              isResizing && "bg-ring/40",
            ]
          : [
              // Zero-width: the visible panel border lives on the content
              // (aside border-l), so this handle is purely the drag hit area +
              // hover seam and sits exactly on that border instead of in a 1px
              // slot to its left (which left the hit area and hover highlight
              // a pixel off the border). Hidden + non-interactive when closed
              // or while the conversation is collapsed.
              "bg-transparent",
              isOpen && !isConversationCollapsed
                ? "w-0 opacity-100"
                : "pointer-events-none w-0 opacity-0",
              isResizing && "bg-accent/20",
            ],
      )}
      aria-label="Resize thread and right panel"
    >
      <span
        aria-hidden
        data-panel-resize-hit-target=""
        className={PANEL_RESIZE_HIT_TARGET_CLASS}
      />
      {matchesSplitDividers ? null : (
        /*
          The panel's persistent left border lives on the content (aside
          `border-l`) so it slides with the panel on open/close. This seam is
          only the resize affordance — transparent at rest (so it doesn't
          double the content border), brightening on hover/drag.
        */
        <span
          // Sit on the handle's right edge (`left-full`), which is the panel's
          // left edge where the content border-l lives, so the hover/drag
          // highlight lands exactly on the border instead of a pixel to its
          // left at the handle's center.
          className={cn(
            // z-10 so the highlight paints over the adjacent content's
            // border-l (the content renders after the handle) instead of being
            // hidden behind it — otherwise the hover/drag highlight is
            // invisible.
            "pointer-events-none absolute inset-y-0 left-full z-10 w-px transition-colors",
            isResizing
              ? "bg-accent-foreground/50"
              : "bg-transparent group-hover:bg-accent-foreground/35",
          )}
        />
      )}
    </PanelResizeHandle>
  );
}
