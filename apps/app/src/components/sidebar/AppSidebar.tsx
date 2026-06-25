import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEventHandler,
} from "react";
import { cn } from "@/lib/utils";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "@/components/ui/icon.js";
import { COARSE_POINTER_CHILD_ICON_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing.js";
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
import { SidebarHistoryNavigationControls } from "./SidebarHistoryNavigationControls";
import { useQuickCreateProjectController } from "@/hooks/useQuickCreateProject";
import {
  CHROME_ROW_CLASS,
  getBbDesktopInfo,
  MACOS_CHROME_TRAFFIC_LIGHT_AXIS_NUDGE_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  MACOS_WINDOW_NO_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import {
  getAutomationsRoutePath,
  getRootComposeRoutePath,
  getThreadRoutePath,
} from "@/lib/route-paths";
import { useRouteState } from "@/hooks/useRouteState";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";
import {
  haveSameSidebarThreadSearchNavigationItems,
  type SidebarThreadSearchNavigationItem,
} from "./sidebarThreadSearch";

const FEEDBACK_NEW_ISSUE_URL = "https://github.com/ymichael/bb/issues/new";
const SIDEBAR_FOOTER_ACTION_CLASS = cn(
  COARSE_POINTER_CHILD_ICON_BUTTON_CLASS,
  "text-muted-foreground hover:text-sidebar-foreground [&>svg]:opacity-80",
);

interface AppSidebarProps {
  onResizeMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  isResizing: boolean;
  showTopReserve: boolean;
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
}: AppSidebarProps) {
  const quickCreateProject = useQuickCreateProjectController();
  const navigate = useNavigate();
  const closeOnMobile = useCloseMobileSidebar();
  const { isAutomationsView } = useRouteState();
  const { isCompactViewport, setOpen, setOpenMobile } = useSidebar();
  const [desktopInfo] = useState(getBbDesktopInfo);
  const [isThreadSearchActive, setIsThreadSearchActive] = useState(false);
  const [threadSearchQuery, setThreadSearchQuery] = useState("");
  const [threadSearchActiveIndex, setThreadSearchActiveIndex] = useState(0);
  const [threadSearchNavigationItems, setThreadSearchNavigationItems] =
    useState<readonly SidebarThreadSearchNavigationItem[]>([]);
  const threadSearchInputRef = useRef<HTMLInputElement | null>(null);
  const threadSearchActiveDescendantId =
    threadSearchNavigationItems[threadSearchActiveIndex]?.optionId;
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);

  const focusThreadSearchInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      threadSearchInputRef.current?.focus();
    });
  }, []);

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

  const handleOpenAutomations = useCallback(() => {
    closeOnMobile();
    void navigate(getAutomationsRoutePath());
  }, [closeOnMobile, navigate]);

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
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "k" ||
        event.shiftKey ||
        event.altKey ||
        (!event.metaKey && !event.ctrlKey)
      ) {
        return;
      }
      event.preventDefault();
      handleThreadSearchActivate();
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [handleThreadSearchActivate]);

  return (
    <>
      <Sidebar onKeyDown={handleThreadSearchKeyDown}>
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
                usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
                usesDesktopChrome &&
                  MACOS_CHROME_TRAFFIC_LIGHT_AXIS_NUDGE_CLASS,
              )}
            />
          </div>
        ) : null}
        <div
          data-testid="app-sidebar-primary-actions"
          className="shrink-0 px-2 py-2 group-data-[collapsible=icon]:hidden"
        >
          <ProjectListActionButtons
            onNewChat={handleNewChat}
            onOpenAutomations={handleOpenAutomations}
            isAutomationsActive={isAutomationsView}
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
                aria-label="Settings"
                tooltip={{ children: "Settings", hidden: false, side: "top" }}
                className={SIDEBAR_FOOTER_ACTION_CLASS}
              >
                <Link to="/settings" onClick={closeOnMobile}>
                  <Icon name="Settings" />
                  <span className="sr-only">Settings</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem className="min-w-0">
              <SidebarMenuButton
                className={SIDEBAR_FOOTER_ACTION_CLASS}
                tooltip={{ children: "Feedback", hidden: false, side: "top" }}
                aria-label="Send feedback"
                onClick={() => {
                  closeOnMobile();
                  openUrlInExternalBrowser(FEEDBACK_NEW_ISSUE_URL);
                }}
              >
                <Icon name="ChatFeedback" />
                <span className="sr-only">Feedback</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
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
    </>
  );
}
