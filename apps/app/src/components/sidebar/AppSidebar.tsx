import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEventHandler,
} from "react";
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
import { PluginNavSidebarItems } from "@/components/plugin/PluginNavSidebarItems";
import { PluginSidebarFooterActions } from "@/components/plugin/PluginSidebarFooterActions";
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
import {
  haveSameSidebarThreadSearchNavigationItems,
  type SidebarThreadSearchNavigationItem,
} from "./sidebarThreadSearch";
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

const BUG_REPORT_NEW_ISSUE_URL = "https://github.com/ymichael/bb/issues/new";
const SIDEBAR_FOOTER_ACTION_CLASS = cn(
  COARSE_POINTER_CHILD_ICON_BUTTON_CLASS,
  "text-muted-foreground hover:text-sidebar-foreground [&>svg]:opacity-80",
);

interface AppSidebarProps {
  onResizeMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  isResizing: boolean;
  showTopReserve: boolean;
  settingsRoutePath: string;
  toolsRoutePath: string;
}

export function isThreadSearchKeyboardEventTarget(
  target: EventTarget | null,
  input: HTMLInputElement | null,
): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target === input) {
    return true;
  }
  return target.closest('[role="option"]') !== null;
}

export function AppSidebar({
  onResizeMouseDown,
  isResizing,
  showTopReserve,
  settingsRoutePath,
  toolsRoutePath,
}: AppSidebarProps) {
  const quickCreateProject = useQuickCreateProjectController();
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
  const [isThreadSearchActive, setIsThreadSearchActive] = useState(false);
  const [threadSearchQuery, setThreadSearchQuery] = useState("");
  const [threadSearchActiveIndex, setThreadSearchActiveIndex] = useState(0);
  const [threadSearchNavigationItems, setThreadSearchNavigationItems] =
    useState<readonly SidebarThreadSearchNavigationItem[]>([]);
  const [threadShortcutKeysById, setThreadShortcutKeysById] = useState<
    ReadonlyMap<string, SidebarThreadShortcutPresentation>
  >(EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const threadShortcutTargetsRef = useRef<
    readonly SidebarThreadShortcutTarget[]
  >([]);
  const threadSearchInputRef = useRef<HTMLInputElement | null>(null);
  const isPointerCoarse = usePointerCoarse();
  const threadSearchActiveDescendantId =
    threadSearchNavigationItems[threadSearchActiveIndex]?.optionId;
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const threadJumpShortcuts = useAppCommandShortcuts(
    THREAD_JUMP_APP_COMMAND_IDS,
  );
  const isAppCommandModifierHeld = useIsAppCommandModifierHeld();
  const settingsShortcut = useAppCommandShortcut("settings.open");

  const focusThreadSearchInput = useCallback(() => {
    if (isPointerCoarse) return;

    window.requestAnimationFrame(() => {
      threadSearchInputRef.current?.focus();
    });
  }, [isPointerCoarse]);

  const handleThreadSearchActivate = useCallback(() => {
    setIsThreadSearchActive(true);
    if (isCompactViewport) {
      setOpenMobile(true);
    } else {
      setOpen(true);
    }
    focusThreadSearchInput();
  }, [focusThreadSearchInput, isCompactViewport, setOpen, setOpenMobile]);

  const handleThreadSearchClose = useCallback(() => {
    setIsThreadSearchActive(false);
    setThreadSearchQuery("");
    setThreadSearchActiveIndex(0);
    setThreadSearchNavigationItems([]);
  }, []);

  const handleThreadSearchNavigationItemsChange = useCallback(
    (items: readonly SidebarThreadSearchNavigationItem[]) => {
      setThreadSearchNavigationItems((current) =>
        haveSameSidebarThreadSearchNavigationItems(current, items)
          ? current
          : items,
      );
      setThreadSearchActiveIndex((current) => {
        if (items.length === 0) {
          return 0;
        }
        return Math.min(current, items.length - 1);
      });
    },
    [],
  );

  const handleThreadSearchSelectItem = useCallback(
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
      closeOnMobile();
    },
    [closeOnMobile, navigate],
  );

  const handleNewChat = useCallback(() => {
    closeOnMobile();
    void navigate(getRootComposeRoutePath(), {
      state: { focusPrompt: true },
    });
  }, [closeOnMobile, navigate]);

  const handleOpenTools = useCallback(() => {
    closeOnMobile();
    void navigate(toolsRoutePath);
  }, [closeOnMobile, navigate, toolsRoutePath]);

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
    if (!target) return false;
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
      targets[nextIndex]?.element.click();
      return true;
    },
    [activeThreadId],
  );

  useAppCommandHandler("thread.search", () => {
    handleThreadSearchActivate();
    return true;
  });
  useIndexedAppCommandHandlers(
    THREAD_JUMP_APP_COMMAND_IDS,
    activateThreadShortcut,
  );
  useAppCommandHandler("thread.previous", () => activateAdjacentThread(-1));
  useAppCommandHandler("thread.next", () => activateAdjacentThread(1));

  const handleThreadSearchKeyDown = useCallback<
    KeyboardEventHandler<HTMLDivElement>
  >(
    (event) => {
      if (!isThreadSearchActive || event.defaultPrevented) {
        return;
      }
      if (
        !isThreadSearchKeyboardEventTarget(
          event.target,
          threadSearchInputRef.current,
        )
      ) {
        return;
      }

      if (event.key === "ArrowDown") {
        if (threadSearchNavigationItems.length === 0) {
          return;
        }
        event.preventDefault();
        setThreadSearchActiveIndex((current) =>
          current >= threadSearchNavigationItems.length - 1 ? 0 : current + 1,
        );
        return;
      }

      if (event.key === "ArrowUp") {
        if (threadSearchNavigationItems.length === 0) {
          return;
        }
        event.preventDefault();
        setThreadSearchActiveIndex((current) =>
          current <= 0 ? threadSearchNavigationItems.length - 1 : current - 1,
        );
        return;
      }

      if (event.key === "Enter") {
        const item = threadSearchNavigationItems[threadSearchActiveIndex];
        if (!item) {
          return;
        }
        event.preventDefault();
        handleThreadSearchSelectItem(item);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        if (threadSearchQuery.length > 0) {
          setThreadSearchQuery("");
          focusThreadSearchInput();
          return;
        }
        handleThreadSearchClose();
      }
    },
    [
      focusThreadSearchInput,
      handleThreadSearchClose,
      handleThreadSearchSelectItem,
      isThreadSearchActive,
      threadSearchActiveIndex,
      threadSearchNavigationItems,
      threadSearchQuery.length,
    ],
  );

  useEffect(() => {
    if (isAppCommandModifierHeld) {
      showThreadShortcuts();
      return;
    }
    hideThreadShortcuts();
  }, [hideThreadShortcuts, isAppCommandModifierHeld, showThreadShortcuts]);

  return (
    <SidebarThreadShortcutKeysContext.Provider value={threadShortcutKeysById}>
      <Sidebar ref={sidebarRef} onKeyDown={handleThreadSearchKeyDown}>
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
            onOpenTools={handleOpenTools}
            threadSearch={{
              activeDescendantId: threadSearchActiveDescendantId,
              inputRef: threadSearchInputRef,
              isActive: isThreadSearchActive,
              onActivate: handleThreadSearchActivate,
              onClose: handleThreadSearchClose,
              onQueryChange: setThreadSearchQuery,
              query: threadSearchQuery,
            }}
          />
        </div>
        <PluginNavSidebarItems
          onNavigate={closeOnMobile}
          splitEnabled={threadSplitsEnabled}
        />
        <SidebarContent>
          <ProjectList
            onNewProject={
              quickCreateProject.isAvailable
                ? quickCreateProject.openCreateDialog
                : undefined
            }
            onProjectSelect={closeOnMobile}
            isCreatingProject={quickCreateProject.isCreating}
            threadSearch={{
              activeIndex: threadSearchActiveIndex,
              isActive: isThreadSearchActive,
              onActiveIndexChange: setThreadSearchActiveIndex,
              onNavigationItemsChange: handleThreadSearchNavigationItemsChange,
              onSelectItem: handleThreadSearchSelectItem,
              query: threadSearchQuery,
            }}
          />
        </SidebarContent>
        <SidebarFooter className="relative">
          <OverflowFade placement="above" tone="sidebar" size="sm" />
          <SidebarMenu className="flex-row items-center gap-1">
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
      </Sidebar>
    </SidebarThreadShortcutKeysContext.Provider>
  );
}
