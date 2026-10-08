import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { cn } from "@bb/shared-ui/lib/utils";
import { THREAD_JUMP_APP_COMMAND_IDS } from "@bb/domain";
import { useNavigate } from "react-router-dom";
import { OverflowFade } from "@/components/ui/overflow-fade.js";
import {
  Sidebar,
  SidebarCollapsibleBody,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  useCloseMobileSidebar,
  useSidebar,
} from "@/components/ui/sidebar.js";
import { PluginThreadList } from "./PluginThreadList";
import { useThreadListReplacement } from "./threadListProvider";
import {
  PluginSidebarFooterDisclosure,
  PluginSidebarFooterItems,
  usePluginSidebarFooterDisclosure,
} from "@/components/plugin/PluginSidebarFooterItems";
import { SidebarPluginAttentionGlyph } from "./SidebarPluginAttentionGlyph";
import { SidebarUpdatesBadge } from "./SidebarUpdatesBadge";
import { SidebarWhatsNew } from "./SidebarWhatsNew";
import { SidebarResizeHandle, SidebarTopReserveRow } from "./SidebarChrome";
import { SIDEBAR_FOOTER_ACTION_CLASS } from "./sidebarRowClasses";
import { getRootComposeRoutePath, getThreadRoutePath } from "@/lib/route-paths";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";
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
  useAppCommandShortcuts,
  useIsAppCommandModifierHeld,
  useIndexedAppCommandHandlers,
} from "@/components/commands/AppCommandProvider";
import { useRouteState } from "@/hooks/useRouteState";
import { SidebarNavigationModelProvider } from "./SidebarNavigationModel";
import { SIDEBAR_FOOTER_MORE_ID } from "./sidebarFooterPreferences";
import { LazySidebarFooterCustomize } from "./LazySidebarFooterCustomize";
import {
  NavRailNewThreadButton,
  type NavRailCustomizeState,
} from "./AppNavRail";

const BUG_REPORT_NEW_ISSUE_URL = "https://github.com/get-bb/bb/issues/new";

interface AppSidebarProps {
  onResizeMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  isResizing: boolean;
  isBodyHidden: boolean;
  renderRail: (customize: NavRailCustomizeState) => ReactNode;
  alternateBody: ReactNode;
}

export function AppSidebar({
  onResizeMouseDown,
  isResizing,
  isBodyHidden,
  renderRail,
  alternateBody,
}: AppSidebarProps) {
  const threadListReplacement = useThreadListReplacement();
  const { threadId: activeThreadId } = useRouteState();
  const navigate = useNavigate();
  const closeOnMobile = useCloseMobileSidebar();
  const { isCompactViewport, openMobile } = useSidebar();
  const [isFooterCustomizing, setFooterCustomizing] = useState(false);
  const [isNavigationCustomizing, setNavigationCustomizing] = useState(false);
  const [threadShortcutKeysById, setThreadShortcutKeysById] = useState<
    ReadonlyMap<string, SidebarThreadShortcutPresentation>
  >(EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const threadShortcutTargetsRef = useRef<
    readonly SidebarThreadShortcutTarget[]
  >([]);
  const threadJumpShortcuts = useAppCommandShortcuts(
    THREAD_JUMP_APP_COMMAND_IDS,
  );
  const isAppCommandModifierHeld = useIsAppCommandModifierHeld();
  const pluginSidebarFooter = usePluginSidebarFooterDisclosure();

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

  useEffect(() => {
    if (!isCompactViewport) return;
    if (!openMobile || isBodyHidden) setFooterCustomizing(false);
    if (!openMobile) setNavigationCustomizing(false);
  }, [isBodyHidden, isCompactViewport, openMobile]);
  const activateVisibleThreadShortcut = useCallback(
    (index: number) => (isBodyHidden ? false : activateThreadShortcut(index)),
    [activateThreadShortcut, isBodyHidden],
  );
  useIndexedAppCommandHandlers(
    THREAD_JUMP_APP_COMMAND_IDS,
    activateVisibleThreadShortcut,
  );
  useAppCommandHandler("thread.previous", () =>
    isBodyHidden ? false : activateAdjacentThread(-1),
  );
  useAppCommandHandler("thread.next", () =>
    isBodyHidden ? false : activateAdjacentThread(1),
  );

  useEffect(() => {
    if (isAppCommandModifierHeld) {
      showThreadShortcuts();
      return;
    }
    hideThreadShortcuts();
  }, [hideThreadShortcuts, isAppCommandModifierHeld, showThreadShortcuts]);

  const body = (
    <>
      <SidebarTopReserveRow
        testId="app-sidebar-top-reserve-row"
        headerSlot={
          <div
            data-testid="nav-rail-header"
            data-sidebar-header-slot=""
            className="flex h-full min-w-0 flex-1 items-center"
          >
            <NavRailNewThreadButton />
          </div>
        }
      />
      <SidebarContent>
        <PluginThreadList
          replacement={threadListReplacement}
          onNavigate={closeOnMobile}
        />
      </SidebarContent>
      <SidebarFooter className="relative">
        <OverflowFade placement="above" tone="sidebar" size="sm" />
        {isFooterCustomizing ? (
          <div className="max-h-[50svh] overflow-y-auto">
            <LazySidebarFooterCustomize
              onDone={() => {
                flushSync(() => setFooterCustomizing(false));
                document.getElementById(SIDEBAR_FOOTER_MORE_ID)?.focus();
              }}
            />
          </div>
        ) : (
          <PluginSidebarFooterDisclosure
            item={pluginSidebarFooter.activeItem}
            onDismiss={pluginSidebarFooter.dismiss}
          />
        )}
        {isFooterCustomizing ||
        pluginSidebarFooter.activeItem !== null ? null : (
          <SidebarWhatsNew onNavigate={closeOnMobile} />
        )}
        <SidebarMenu
          className={cn(
            "flex-row items-center gap-1",
            isFooterCustomizing && "hidden",
          )}
        >
          <PluginSidebarFooterItems
            onCustomize={() => {
              pluginSidebarFooter.dismiss();
              setNavigationCustomizing(false);
              setFooterCustomizing(true);
            }}
            activeDisclosureKey={pluginSidebarFooter.activeKey}
            onDisclosureCommand={pluginSidebarFooter.handleCommand}
            onNavigate={closeOnMobile}
            builtInActions={[
              {
                id: "mobile",
                href: "/settings/mobile",
                onActivate: () => {
                  closeOnMobile();
                  void navigate("/settings/mobile");
                },
              },
              {
                id: "report-bug",
                onActivate: () => {
                  closeOnMobile();
                  openUrlInExternalBrowser(BUG_REPORT_NEW_ISSUE_URL);
                },
              },
            ]}
          />
          <SidebarPluginAttentionGlyph
            className={SIDEBAR_FOOTER_ACTION_CLASS}
            onNavigate={closeOnMobile}
          />
          <SidebarUpdatesBadge onNavigate={closeOnMobile} />
        </SidebarMenu>
      </SidebarFooter>
      <SidebarResizeHandle
        testId="app-sidebar-resize-handle"
        isResizing={isResizing}
        onMouseDown={onResizeMouseDown}
      />
    </>
  );

  return (
    <SidebarThreadShortcutKeysContext.Provider value={threadShortcutKeysById}>
      <SidebarNavigationModelProvider
        onNavigate={closeOnMobile}
        onNewChat={handleNewChat}
        onSearchThreads={closeOnMobile}
        splitEnabled
      >
        <Sidebar ref={sidebarRef}>
          <div className="flex min-h-0 flex-1">
            {renderRail({
              isOpen: isNavigationCustomizing,
              onOpenChange: setNavigationCustomizing,
            })}
            <SidebarCollapsibleBody data-testid="nav-rail-sidebar-body">
              <div
                data-testid="app-sidebar-body"
                hidden={isBodyHidden}
                className="flex min-h-0 min-w-0 flex-1 flex-col"
              >
                {body}
              </div>
              {alternateBody}
            </SidebarCollapsibleBody>
          </div>
        </Sidebar>
      </SidebarNavigationModelProvider>
    </SidebarThreadShortcutKeysContext.Provider>
  );
}
