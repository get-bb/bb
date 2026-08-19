import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import { THREAD_JUMP_APP_COMMAND_IDS } from "@bb/domain";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";
import { COARSE_POINTER_CHILD_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { OverflowFade } from "@/components/ui/overflow-fade.js";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useCloseMobileSidebar,
  useSidebar,
} from "@/components/ui/sidebar.js";
import { ProjectList, ProjectListActionButtons } from "./ProjectList";
import { PluginThreadList } from "./PluginThreadList";
import { useThreadListReplacement } from "./threadListProvider";
import { PluginNavSidebarItems } from "@/components/plugin/PluginNavSidebarItems";
import { PluginSidebarFooterActions } from "@/components/plugin/PluginSidebarFooterActions";
import { SidebarPluginAttentionGlyph } from "./SidebarPluginAttentionGlyph";
import { SidebarUpdatesBadge } from "./SidebarUpdatesBadge";
import { SidebarHistoryNavigationControls } from "./SidebarHistoryNavigationControls";
import { useQuickCreateProjectController } from "@/hooks/useQuickCreateProject";
import {
  CHROME_ROW_CLASS,
  getBbDesktopInfo,
  MACOS_CHROME_CONTROL_NO_DRAG_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { getRootComposeRoutePath, getThreadRoutePath } from "@/lib/route-paths";
import { useThreadSplitsEnabled } from "@/hooks/useThreadSplitsEnabled";
import { usePaneContentSplitDrag } from "./usePaneContentSplitDrag";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";
import type { SidebarThreadSearchNavigationItem } from "./sidebarThreadSearch";
import { useSidebarThreadSearch } from "./useSidebarThreadSearch";
import {
  EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS,
  getSidebarThreadNavigationTargets,
  getSidebarThreadShortcutTargets,
  SidebarThreadShortcutKeysContext,
  type SidebarThreadShortcutPresentation,
  type SidebarThreadShortcutTarget,
} from "./sidebarThreadShortcuts";
import {
  useAppCommandHandler,
  useAppCommandShortcut,
  useAppCommandShortcuts,
  useIsAppCommandModifierHeld,
  useIndexedAppCommandHandlers,
} from "@/components/commands/AppCommandProvider";
import { useRouteState } from "@/hooks/useRouteState";

const NEW_THREAD_PANE_CONTENT = { kind: "new-thread" } as const;

const BUG_REPORT_NEW_ISSUE_URL = "https://github.com/get-bb/bb/issues/new";
const SIDEBAR_FOOTER_ACTION_CLASS = cn(
  COARSE_POINTER_CHILD_ICON_BUTTON_CLASS,
  "text-muted-foreground hover:text-sidebar-foreground [&>svg]:opacity-80",
);

interface AppSidebarProps {
  onResizeMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  isResizing: boolean;
  showTopReserve: boolean;
  settingsRoutePath: string;
  toolsRoutePath?: string;
  /**
   * Compact drawer hosting. When set, the sidebar renders its body only,
   * inside a persistent `<Sidebar>` panel owned by AppLayoutSidebar, and stays
   * mounted (hidden) while a Settings/Tools body is showing, so returning to
   * the app never remounts the thread list in the closed drawer.
   */
  mobileHosted?: { hidden: boolean };
}

export function AppSidebar({
  onResizeMouseDown,
  isResizing,
  showTopReserve,
  settingsRoutePath,
  toolsRoutePath,
  mobileHosted,
}: AppSidebarProps) {
  const quickCreateProject = useQuickCreateProjectController();
  // The resolved replacement owns the sidebar's scrolling thread list. It never
  // replaces the chrome around it: the New-thread button, search field,
  // the plugin nav rows, and the footer stay host-rendered in every sidebar.
  const threadListReplacement = useThreadListReplacement();
  const { threadId: activeThreadId } = useRouteState();
  const navigate = useNavigate();
  const threadSplitsEnabled = useThreadSplitsEnabled();
  const newThreadSplit = usePaneContentSplitDrag({
    content: NEW_THREAD_PANE_CONTENT,
    enabled: threadSplitsEnabled,
    label: "New thread",
  });
  const closeOnMobile = useCloseMobileSidebar();
  const { isCompactViewport, setOpen, setOpenMobile } = useSidebar();
  const [desktopInfo] = useState(getBbDesktopInfo);
  const [threadShortcutKeysById, setThreadShortcutKeysById] = useState<
    ReadonlyMap<string, SidebarThreadShortcutPresentation>
  >(EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const threadShortcutTargetsRef = useRef<
    readonly SidebarThreadShortcutTarget[]
  >([]);
  const isPointerCoarse = usePointerCoarse();
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const threadJumpShortcuts = useAppCommandShortcuts(
    THREAD_JUMP_APP_COMMAND_IDS,
  );
  const isAppCommandModifierHeld = useIsAppCommandModifierHeld();
  const settingsShortcut = useAppCommandShortcut("settings.open");

  const openSidebarForThreadSearch = useCallback(() => {
    if (isCompactViewport) {
      setOpenMobile(true);
    } else {
      setOpen(true);
    }
  }, [isCompactViewport, setOpen, setOpenMobile]);

  const openSearchedThread = useCallback(
    (item: SidebarThreadSearchNavigationItem) => {
      void navigate(
        getThreadRoutePath({
          projectId: item.projectId,
          threadId: item.threadId,
        }),
        // Hand the matched message's event sequence to the timeline so it can
        // scroll to and briefly highlight that message. Omitted for title-only
        // matches, which just open the thread normally.
        item.messageSeq !== null
          ? {
              state: {
                searchMessageSeq: item.messageSeq,
                searchThreadId: item.threadId,
              },
            }
          : undefined,
      );
    },
    [navigate],
  );

  const threadSearch = useSidebarThreadSearch({
    isPointerCoarse,
    onOpenSidebar: openSidebarForThreadSearch,
    onOpenThread: openSearchedThread,
    onThreadOpened: closeOnMobile,
  });

  const handleNewChat = useCallback(() => {
    closeOnMobile();
    void navigate(getRootComposeRoutePath(), {
      state: { focusPrompt: true },
    });
  }, [closeOnMobile, navigate]);

  const showThreadShortcuts = useCallback(() => {
    const targets = getSidebarThreadShortcutTargets(sidebarRef.current);
    threadShortcutTargetsRef.current = targets;
    setThreadShortcutKeysById(
      new Map(
        targets.flatMap((target, index) => {
          const command = THREAD_JUMP_APP_COMMAND_IDS[index];
          const shortcut = command
            ? threadJumpShortcuts.get(command)
            : undefined;
          return shortcut ? [[target.threadId, shortcut] as const] : [];
        }),
      ),
    );
  }, [threadJumpShortcuts]);

  const hideThreadShortcuts = useCallback(() => {
    threadShortcutTargetsRef.current = [];
    setThreadShortcutKeysById(EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS);
  }, []);

  const activateThreadShortcut = useCallback((index: number): boolean => {
    const targets = threadShortcutTargetsRef.current;
    const target =
      targets[index] ??
      getSidebarThreadShortcutTargets(sidebarRef.current)[index];
    if (!target?.element) return false;
    target.element.click();
    return true;
  }, []);

  const activateAdjacentThread = useCallback(
    (offset: -1 | 1): boolean => {
      const targets = getSidebarThreadNavigationTargets(sidebarRef.current);
      if (targets.length === 0) return false;
      const activeIndex = targets.findIndex(
        (target) => target.threadId === activeThreadId,
      );
      const nextIndex =
        activeIndex === -1
          ? offset === 1
            ? 0
            : targets.length - 1
          : (activeIndex + offset + targets.length) % targets.length;
      const target = targets[nextIndex];
      if (!target) return false;
      if (target.element) {
        target.element.click();
        return true;
      }
      // The neighbor sits inside a windowed-out placeholder: there is no row
      // to click, so navigate by id, matching what the row's link would do.
      if (!target.projectId) return false;
      closeOnMobile();
      void navigate(
        getThreadRoutePath({
          projectId: target.projectId,
          threadId: target.threadId,
        }),
      );
      return true;
    },
    [activeThreadId, closeOnMobile, navigate],
  );

  // While hosted-and-hidden (a Settings/Tools body is showing in the drawer)
  // this sidebar is not the visible one: leave its shortcuts unhandled, as
  // they are on wide viewports where Settings/Tools replace the sidebar,
  // rather than opening the drawer onto a hidden search field or clicking
  // rows the user cannot see.
  const isHiddenHostedBody = mobileHosted?.hidden === true;
  useAppCommandHandler("thread.search", () => {
    if (isHiddenHostedBody) return false;
    threadSearch.onActivate();
    return true;
  });
  const activateVisibleThreadShortcut = useCallback(
    (index: number) =>
      isHiddenHostedBody ? false : activateThreadShortcut(index),
    [activateThreadShortcut, isHiddenHostedBody],
  );
  useIndexedAppCommandHandlers(
    THREAD_JUMP_APP_COMMAND_IDS,
    activateVisibleThreadShortcut,
  );
  useAppCommandHandler("thread.previous", () =>
    isHiddenHostedBody ? false : activateAdjacentThread(-1),
  );
  useAppCommandHandler("thread.next", () =>
    isHiddenHostedBody ? false : activateAdjacentThread(1),
  );

  useEffect(() => {
    if (isAppCommandModifierHeld) {
      showThreadShortcuts();
      return;
    }
    hideThreadShortcuts();
  }, [hideThreadShortcuts, isAppCommandModifierHeld, showThreadShortcuts]);

  // Keep this object identity stable across unrelated re-renders (opening
  // the mobile drawer flips useSidebar context and re-renders AppSidebar):
  // a fresh object here would defeat ProjectList's memo and re-render every
  // thread group on each drawer toggle.
  const threadSearchPanelController = useMemo(
    () => ({
      activeIndex: threadSearch.activeIndex,
      isActive: threadSearch.isActive,
      onActiveIndexChange: threadSearch.onActiveIndexChange,
      onNavigationItemsChange: threadSearch.onNavigationItemsChange,
      onSelectItem: threadSearch.onSelectItem,
      query: threadSearch.query,
    }),
    [
      threadSearch.activeIndex,
      threadSearch.isActive,
      threadSearch.onActiveIndexChange,
      threadSearch.onNavigationItemsChange,
      threadSearch.onSelectItem,
      threadSearch.query,
    ],
  );

  const originalThreadList = (
    <ProjectList
      onNewProject={
        quickCreateProject.isAvailable
          ? quickCreateProject.openCreateDialog
          : undefined
      }
      onProjectSelect={closeOnMobile}
      isCreatingProject={quickCreateProject.isCreating}
      threadSearch={threadSearchPanelController}
    />
  );

  const body = (
    <>
      {showTopReserve ? (
        /* Top reserve that keeps the sidebar's content (New Thread / New
             Projects) anchored below the title-bar chrome, mirroring
             the page-header height on the content side. The sidebar toggle is
             pinned at the app's top-left for every chrome (see AppLayout's
             SidebarTriggerOverlay), so this row hosts no trigger of its own — it
             stays mounted in every sidebar state, including while the panel
             collapses off-canvas, so the content holds its vertical position
             instead of riding up under the pinned toggle during the animation.
             On desktop it doubles as the window-drag strip. The Back/Forward
             route-history controls live on the right of this chrome row, clear
             of the pinned toggle/traffic lights on the left and the resize
             handle on the right; they opt out of the desktop drag region so
             clicks register. */
        <div
          data-testid="app-sidebar-top-reserve-row"
          className={cn(
            CHROME_ROW_CLASS,
            "shrink-0 justify-end px-2",
            usesDesktopChrome && MACOS_WINDOW_DRAG_CLASS,
          )}
        >
          <SidebarHistoryNavigationControls
            onNavigate={closeOnMobile}
            className={cn(
              "group-data-[collapsible=icon]:hidden",
              usesDesktopChrome && MACOS_CHROME_CONTROL_NO_DRAG_CLASS,
            )}
          />
        </div>
      ) : null}
      <div
        data-testid="app-sidebar-primary-actions"
        className="shrink-0 px-2 py-2 group-data-[collapsible=icon]:hidden"
      >
        <ProjectListActionButtons
          splitEnabled={threadSplitsEnabled}
          newThreadSplit={newThreadSplit}
          onNewChat={handleNewChat}
          threadSearch={{
            activeDescendantId: threadSearch.activeDescendantId,
            inputRef: threadSearch.inputRef,
            isActive: threadSearch.isActive,
            onActivate: threadSearch.onActivate,
            onClose: threadSearch.onClose,
            onQueryChange: threadSearch.onQueryChange,
            query: threadSearch.query,
          }}
        />
      </div>
      <PluginNavSidebarItems
        onNavigate={closeOnMobile}
        splitEnabled={threadSplitsEnabled}
        toolsRoutePath={toolsRoutePath}
      />
      <SidebarContent>
        <PluginThreadList
          replacement={threadListReplacement}
          original={originalThreadList}
          searchQuery={threadSearch.query}
          onNavigate={threadSearch.onExternalThreadOpen}
        />
      </SidebarContent>
      <SidebarFooter className="relative">
        <OverflowFade placement="above" tone="sidebar" size="sm" />
        {/* The footer holds a variable number of plugin action buttons, so a
         * narrowed sidebar plus several plugins can no longer fit the action
         * row and the update chips on one line. `flex-wrap-reverse` plus the
         * flexible spacer below handles both layouts without measuring:
         * while everything fits, the spacer stretches and pushes the chips to
         * the right of a single row; once it doesn't, the chips wrap onto
         * their own line, which wrap-reverse renders above the actions, and
         * they sit flush left because the spacer stays behind on the action
         * line. */}
        <SidebarMenu className="flex-row flex-wrap-reverse items-center gap-1">
          <SidebarMenuItem className="min-w-0">
            <SidebarMenuButton
              asChild
              aria-label={
                settingsShortcut
                  ? `Settings (${settingsShortcut.label})`
                  : "Settings"
              }
              aria-keyshortcuts={settingsShortcut?.ariaKeyshortcuts}
              tooltip={{
                children: settingsShortcut
                  ? `Settings (${settingsShortcut.label})`
                  : "Settings",
                hidden: false,
                side: "top",
              }}
              className={SIDEBAR_FOOTER_ACTION_CLASS}
            >
              <Link to={settingsRoutePath} onClick={closeOnMobile}>
                <Icon name="Settings" />
                <span className="sr-only">Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <PluginSidebarFooterActions onNavigate={closeOnMobile} />
          <SidebarMenuItem className="min-w-0">
            <SidebarMenuButton
              className={SIDEBAR_FOOTER_ACTION_CLASS}
              tooltip={{
                children: "Report a bug",
                hidden: false,
                side: "top",
              }}
              aria-label="Report a bug"
              onClick={() => {
                closeOnMobile();
                openUrlInExternalBrowser(BUG_REPORT_NEW_ISSUE_URL);
              }}
            >
              <Icon name="Bug" />
              <span className="sr-only">Report a bug</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <li aria-hidden="true" className="min-w-0 flex-1" />
          <SidebarPluginAttentionGlyph
            className={SIDEBAR_FOOTER_ACTION_CLASS}
            onNavigate={closeOnMobile}
          />
          <SidebarUpdatesBadge onNavigate={closeOnMobile} />
        </SidebarMenu>
      </SidebarFooter>
      <div
        data-testid="app-sidebar-resize-handle"
        className={cn(
          "absolute -right-1.5 top-0 z-30 hidden h-full w-3 cursor-col-resize md:block",
          "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent before:transition-colors hover:before:bg-sidebar-border",
          "group-data-[collapsible=icon]:hidden",
          isResizing && "before:bg-sidebar-border",
        )}
        onMouseDown={onResizeMouseDown}
      />
    </>
  );

  return (
    <SidebarThreadShortcutKeysContext.Provider value={threadShortcutKeysById}>
      {mobileHosted ? (
        <div
          ref={sidebarRef}
          data-testid="app-sidebar-body"
          hidden={mobileHosted.hidden}
          className="flex min-h-0 flex-1 flex-col"
          onKeyDown={threadSearch.onKeyDown}
        >
          {body}
        </div>
      ) : (
        <Sidebar ref={sidebarRef} onKeyDown={threadSearch.onKeyDown}>
          {body}
        </Sidebar>
      )}
    </SidebarThreadShortcutKeysContext.Provider>
  );
}
