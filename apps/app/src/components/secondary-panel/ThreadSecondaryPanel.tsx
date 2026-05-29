import {
  type CSSProperties,
  type FocusEvent,
  type ReactNode,
  useMemo,
  useState,
} from "react";
import { useAtomValue } from "jotai";
import { Icon } from "@/components/ui/icon.js";
import { TabPill } from "@/components/ui/tab-pill";
import { Panel, PanelResizeHandle } from "react-resizable-panels";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/lib/utils";
import { ConversationCollapseToggle } from "./ConversationCollapseToggle";
import { PANEL_COLLAPSE_TRANSITION_CLASS } from "./panelTransitionTokens";
import type { WorkspaceFilePreviewStatusLabel } from "@/lib/file-preview";
import { type ThreadSecondaryPanel as ThreadSecondaryPanelTab } from "@/lib/thread-secondary-panel";
import { GIT_DIFF_VIEW_BASE_OPTIONS } from "../git-diff/GitDiffCard";
import { usePreferredTheme } from "@/hooks/useTheme";
import { useGitDiffPanelState } from "./git-diff/useGitDiffPanelState";
import { useResponsiveGitDiffPanelDisplay } from "./git-diff/useResponsiveGitDiffPanelDisplay";
import {
  gitDiffCollapsedFileKeysAtom,
  gitDiffLoadingFileKeysAtom,
  threadSecondaryPanelResizingAtom,
} from "./threadSecondaryPanelAtoms";
import { GitDiffToolbar } from "./GitDiffToolbar";
import {
  GitDiffTabContent,
  ThreadInfoTabContent,
} from "./ThreadSecondaryPanelTabContent";
import {
  getBbDesktopInfo,
  MACOS_WINDOW_DRAG_CLASS,
  MACOS_WINDOW_NO_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { IFRAME_POINTER_EVENTS_NONE_CLASS } from "@/lib/iframe-drag-guard";
export type {
  GitDiffDisplayMode,
  GitDiffSelectionOption,
} from "./GitDiffToolbar";

const THREAD_SECONDARY_PANEL_MIN_SIZE_PERCENT = 24;
const THREAD_SECONDARY_PANEL_MAX_SIZE_PERCENT = 70;
// While the conversation is collapsed the panel fills the content area, so its
// size/max are lifted to the full width of the horizontal group.
const CONVERSATION_COLLAPSED_PANEL_SIZE_PERCENT = 100;
const PANEL_SCROLL_SLOT_CLASS =
  "min-h-0 flex-1 overflow-x-hidden overflow-y-auto";
const SECONDARY_RESIZABLE_PANEL_STYLE: CSSProperties = {
  pointerEvents: "auto",
};

export interface SecondaryPanelFileTab {
  id: string;
  filename: string;
  isActive: boolean;
  isPinned?: boolean;
  leadingVisual?: ReactNode;
  statusLabel: WorkspaceFilePreviewStatusLabel | null;
  onSelect: () => void;
  onClose: () => void;
}

export interface ThreadSecondaryPanelProps {
  activePanel: ThreadSecondaryPanelTab | null;
  canUseGitUi: boolean;
  defaultMergeBaseBranch?: string;
  environmentId?: string;
  metadataContent: ReactNode;
  fileTabs?: SecondaryPanelFileTab[];
  fileTabContent?: ReactNode;
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
   * the content area (its max size is lifted) and the seam toggle flips to an
   * "expand" affordance. Always false in the drawer/compact layout.
   */
  isConversationCollapsed: boolean;
  onToggleConversationCollapse: () => void;
  /**
   * When true, render only the aside content — skip the PanelResizeHandle +
   * Panel wrappers that are only meaningful inside a desktop PanelGroup.
   * Caller is responsible for wrapping the content in a Drawer in that case.
   */
  renderAsDrawer: boolean;
}

export function ThreadSecondaryPanel({
  activePanel: rawActivePanel,
  canUseGitUi,
  defaultMergeBaseBranch,
  environmentId,
  metadataContent,
  fileTabs,
  fileTabContent,
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
  renderAsDrawer,
}: ThreadSecondaryPanelProps) {
  const activeFileTab = fileTabs?.find((tab) => tab.isActive);
  const hasActiveFileTab = activeFileTab !== undefined;
  const togglePanelIconName = renderAsDrawer ? "X" : "PanelRight";
  const {
    gitDiffDisplayMode,
    handleGitDiffDisplayModeChange,
    handleSecondaryPanelDragging,
    handleSecondaryPanelResize,
    persistedWidthPercent,
    secondaryPanelRef: panelRef,
    secondaryResizablePanelRef: resizablePanelRef,
  } = useResponsiveGitDiffPanelDisplay({ isSecondaryPanelOpen: isOpen });
  const activePanel =
    !canUseGitUi && rawActivePanel === "git-diff"
      ? "thread-info"
      : rawActivePanel;
  const isDiffPanelActive = activePanel === "git-diff";
  const {
    currentGitDiff,
    gitDiffError,
    gitDiffSelectOptions,
    gitDiffSelectValue,
    gitDiffStats,
    hasParsedGitDiffFiles,
    isGitDiffLoading,
    isParsingGitDiffFiles,
    isPreparingGitDiff,
    onGitDiffSelectionChange,
    onRequestFileContents,
    parsedGitDiffFileEntries,
    queuedGitDiffFileRenderKeys,
    setGitDiffFileRef,
    threadGitDiff,
    toggleAllGitDiffFilesCollapsed,
    toggleGitDiffFileCollapsed,
  } = useGitDiffPanelState({
    environmentId,
    isDiffPanelActive,
    defaultMergeBaseBranch,
  });
  const collapsedGitDiffFileKeys = useAtomValue(gitDiffCollapsedFileKeysAtom);
  const loadingGitDiffFileKeys = useAtomValue(gitDiffLoadingFileKeysAtom);
  const isSecondaryPanelResizing = useAtomValue(
    threadSecondaryPanelResizingAtom,
  );
  const [desktopInfo] = useState(getBbDesktopInfo);
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const areAllGitDiffFilesCollapsed = useMemo(
    () =>
      hasParsedGitDiffFiles &&
      parsedGitDiffFileEntries.every(({ key }) =>
        collapsedGitDiffFileKeys.has(key),
      ),
    [collapsedGitDiffFileKeys, hasParsedGitDiffFiles, parsedGitDiffFileEntries],
  );
  const preferredTheme = usePreferredTheme();
  const gitDiffViewOptions = useMemo(
    () => ({
      ...GIT_DIFF_VIEW_BASE_OPTIONS,
      diffStyle: gitDiffDisplayMode,
      themeType: preferredTheme,
    }),
    [gitDiffDisplayMode, preferredTheme],
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
        isSecondaryPanelResizing && IFRAME_POINTER_EVENTS_NONE_CLASS,
        !renderAsDrawer && [
          "transition-[transform,opacity,background-color]",
          PANEL_COLLAPSE_TRANSITION_CLASS,
          isOpen
            ? "opacity-100"
            : "pointer-events-none translate-x-[8%] opacity-0",
        ],
      )}
    >
      <div className="bg-background">
        <div
          data-testid="thread-secondary-panel-top-chrome"
          className={cn(
            "flex h-12 min-w-0 items-center justify-between gap-2 px-4",
            usesDesktopChrome && MACOS_WINDOW_DRAG_CLASS,
          )}
        >
          <div
            className="flex min-w-0 flex-1 items-center gap-1"
            role="tablist"
            aria-label="Secondary panel views"
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 w-7 shrink-0 rounded-md p-0",
                usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
              )}
              onClick={() => onPanelChange("thread-info")}
              aria-label="Show thread info panel"
              aria-pressed={activePanel === "thread-info" && !hasActiveFileTab}
              title="Info"
            >
              <Icon name="Info" />
            </Button>
            {showGitDiffTab !== false ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 w-7 shrink-0 rounded-md p-0",
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
              <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
                {fileTabs.map((tab) => (
                  <div
                    key={tab.id}
                    className={cn(
                      "shrink-0",
                      usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
                    )}
                  >
                    <FileTab tab={tab} />
                  </div>
                ))}
              </div>
            ) : null}
            <NewTabButton
              onOpenNewTab={onOpenNewTab}
              usesDesktopChrome={usesDesktopChrome}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "h-7 w-7 shrink-0 rounded-md p-0",
              usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
            )}
            onClick={onClose}
            aria-label={
              renderAsDrawer ? "Close secondary panel" : "Hide secondary panel"
            }
            title={
              renderAsDrawer ? "Close secondary panel" : "Hide secondary panel"
            }
          >
            <Icon name={togglePanelIconName} />
          </Button>
        </div>
        {isDiffPanelActive && !hasActiveFileTab ? (
          <GitDiffToolbar
            selectionValue={gitDiffSelectValue}
            selectionOptions={gitDiffSelectOptions}
            onSelectionChange={onGitDiffSelectionChange}
            isSelectorDisabled={isGitDiffLoading || threadGitDiff === undefined}
            stats={gitDiffStats}
            isParsing={isParsingGitDiffFiles}
            areAllFilesCollapsed={areAllGitDiffFilesCollapsed}
            isCollapseAllDisabled={!hasParsedGitDiffFiles || isGitDiffLoading}
            onToggleAllCollapsed={toggleAllGitDiffFilesCollapsed}
            displayMode={gitDiffDisplayMode}
            onDisplayModeChange={handleGitDiffDisplayModeChange}
          />
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        {hasActiveFileTab ? (
          <div className={cn(PANEL_SCROLL_SLOT_CLASS, "pb-3")}>
            {fileTabContent ?? (
              <p className="mx-4 rounded-lg border border-dashed border-border bg-surface-raised px-3 py-6 text-center text-sm text-muted-foreground">
                No file preview content provided.
              </p>
            )}
          </div>
        ) : isDiffPanelActive ? (
          <GitDiffTabContent
            collapsedGitDiffFileKeys={collapsedGitDiffFileKeys}
            currentGitDiff={currentGitDiff}
            gitDiffError={
              gitDiffError instanceof Error
                ? gitDiffError
                : gitDiffError
                  ? new Error("Failed to load git diff")
                  : null
            }
            gitDiffViewOptions={gitDiffViewOptions}
            isParsingGitDiffFiles={isParsingGitDiffFiles}
            isPreparingGitDiff={isPreparingGitDiff}
            loadingGitDiffFileKeys={loadingGitDiffFileKeys}
            onOpenFileInEditor={onOpenFileInEditor}
            onOpenFilePreview={onOpenFilePreview}
            onRequestFileContents={onRequestFileContents}
            parsedGitDiffFileEntries={parsedGitDiffFileEntries}
            queuedGitDiffFileRenderKeys={queuedGitDiffFileRenderKeys}
            setGitDiffFileRef={setGitDiffFileRef}
            threadGitDiff={threadGitDiff}
            toggleGitDiffFileCollapsed={toggleGitDiffFileCollapsed}
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
      {isOpen ? (
        // Anchored on the seam but rendered OUTSIDE the resize handle: a child
        // of the handle would be treated as part of its drag hit-area, so a
        // press on the toggle would start a resize. As a higher-stacked sibling
        // that merely overlaps the handle, react-resizable-panels excludes it
        // from drag initiation (see its intersecting-handle stacking check).
        <div className="relative z-10 w-0 shrink-0 overflow-visible">
          <ConversationCollapseToggle
            collapsed={isConversationCollapsed}
            onToggle={onToggleConversationCollapse}
            className={cn(
              "absolute left-0 top-1/2 -translate-y-1/2",
              // Centered on the seam normally; nudged clear of the content edge
              // once collapsed so the round button is never clipped at x≈0.
              isConversationCollapsed ? "translate-x-1" : "-translate-x-1/2",
            )}
          />
        </div>
      ) : null}
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
        "h-7 w-7 shrink-0 rounded-md p-0",
        usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
      )}
      onClick={onOpenNewTab}
      aria-label="Open a new tab"
      title="New tab"
    >
      <Icon name="Plus" />
    </Button>
  );
}

function FileTab({ tab }: { tab: SecondaryPanelFileTab }) {
  const title =
    tab.statusLabel === null
      ? tab.filename
      : `${tab.filename} (${tab.statusLabel})`;
  return (
    <TabPill
      label={tab.filename}
      leadingVisual={tab.leadingVisual}
      secondaryLabel={tab.statusLabel === null ? null : `(${tab.statusLabel})`}
      title={title}
      isActive={tab.isActive}
      onSelect={tab.onSelect}
      labelMaxWidthClass="max-w-[160px]"
      closeAction={
        tab.isPinned
          ? null
          : {
              onClose: tab.onClose,
              closeLabel: `Close ${tab.filename}`,
              closeTooltip: "Close tab",
            }
      }
    />
  );
}

interface SecondaryPanelResizeHandleProps {
  isOpen: boolean;
  isConversationCollapsed: boolean;
  onDragging: (isDragging: boolean) => void;
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
      // width); the seam toggle is the only affordance in that state.
      disabled={!isOpen || isConversationCollapsed}
      onDragging={onDragging}
      className={cn(
        "group relative shrink-0 overflow-visible bg-transparent transition-[width,opacity,background-color] before:absolute before:inset-y-0 before:-left-1.5 before:-right-1.5 before:content-['']",
        PANEL_COLLAPSE_TRANSITION_CLASS,
        isConversationCollapsed ? "cursor-default" : "cursor-col-resize",
        isOpen ? "w-px opacity-100" : "pointer-events-none w-0 opacity-0",
        isResizing && "bg-accent/20",
      )}
      aria-label="Resize thread and secondary panels"
    >
      <span
        className={cn(
          "pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors",
          isResizing
            ? "bg-accent-foreground/50"
            : "group-hover:bg-accent-foreground/35",
        )}
      />
    </PanelResizeHandle>
  );
}
