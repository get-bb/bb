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
import { OverflowFade } from "@bb/shared-ui/overflow-fade";
import {
  Sidebar,
  SidebarCollapsibleBody,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  useCloseMobileSidebar,
  useSidebar,
  useIsSidebarFramed,
} from "@/components/ui/sidebar.js";
import { ThreadActionSurfaceVisibility } from "@/lib/thread-actions/thread-action-registry";
import { PluginThreadList } from "./PluginThreadList";
import { useThreadListReplacement } from "./threadListProvider";
import {
  PluginSidebarFooterDisclosure,
  PluginSidebarFooterItems,
  usePluginSidebarFooterDisclosure,
} from "@/components/plugin/PluginSidebarFooterItems";
import { SidebarPluginAttentionGlyph } from "./SidebarPluginAttentionGlyph";
import { SidebarUpdatesBadge } from "./SidebarUpdatesBadge";
import { SidebarResizeHandle, SidebarTopReserveRow } from "./SidebarChrome";
import { SIDEBAR_FOOTER_ACTION_CLASS } from "@bb/shared-ui/sidebar-row-classes";
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
  useAppCommandShortcut,
  useAppCommandShortcuts,
  useIsAppCommandModifierHeld,
  useIndexedAppCommandHandlers,
} from "@/components/commands/AppCommandProvider";
import { useRouteState } from "@/hooks/useRouteState";
import { SidebarNavigationModelProvider } from "./SidebarNavigationModel";
import { SIDEBAR_FOOTER_MORE_ID } from "./sidebarFooterPreferences";
import { LazySidebarFooterCustomize } from "./LazySidebarFooterCustomize";
import {
  CHROME_ROW_HEIGHT_CLASS,
  getBbDesktopInfo,
  MACOS_WINDOW_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { NavRailSettingsButton } from "./NavRailSettingsButton";
import { SidebarNavigationHeader } from "./SidebarNavigationHeader";
import {
  SidebarNavigationProviderMount,
  SidebarNavigationRegion,
  useSidebarNavigationCustomize,
} from "./SidebarNavigationHost";
import {
  sidebarNavigationPlacement,
  type ResolvedSidebarNavigation,
} from "./sidebarNavigationProvider";

import { NAV_RAIL_WIDTH_CLASS } from "./navRailWidth";

const BUG_REPORT_NEW_ISSUE_URL = "https://github.com/get-bb/bb/issues/new";

interface AppSidebarProps {
  onResizeMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  isResizing: boolean;
  isBodyHidden: boolean;
  navigation: ResolvedSidebarNavigation;
  settingsRoutePath: string;
  isSettingsActive: boolean;
  alternateBody: ReactNode;
}

export function AppSidebar({
  onResizeMouseDown,
  isResizing,
  isBodyHidden,
  navigation,
  settingsRoutePath,
  isSettingsActive,
  alternateBody,
}: AppSidebarProps) {
  const placement = sidebarNavigationPlacement(navigation);
  const [desktopInfo] = useState(getBbDesktopInfo);
  const isFramed = useIsSidebarFramed();
  const threadListReplacement = useThreadListReplacement();
  const { threadId: activeThreadId } = useRouteState();
  const navigate = useNavigate();
  const closeOnMobile = useCloseMobileSidebar();
  const { isCompactViewport, open, openMobile } = useSidebar();
  const isThreadListVisible =
    !isBodyHidden && (isCompactViewport ? openMobile : open);
  const [isFooterCustomizing, setFooterCustomizing] = useState(false);
  const navigationCustomize = useSidebarNavigationCustomize(() =>
    setFooterCustomizing(false),
  );
  const setNavigationCustomizing = navigationCustomize.setCustomizing;
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
  const settingsShortcut = useAppCommandShortcut("settings.open");
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
  }, [isBodyHidden, isCompactViewport, openMobile, setNavigationCustomizing]);
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

  const navigationRegion = (className: string) => (
    <SidebarNavigationRegion
      placement={placement}
      customize={navigationCustomize}
      className={className}
    >
      {placement === "rail" && !isFramed ? (
        <div
          aria-hidden="true"
          className={cn(
            CHROME_ROW_HEIGHT_CLASS,
            "shrink-0",
            shouldUseMacosDesktopChrome(desktopInfo) && MACOS_WINDOW_DRAG_CLASS,
          )}
        />
      ) : null}
      {placement === "rail" ? (
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col",
            isFramed ? "pt-2.5" : "pt-1",
          )}
        >
          <SidebarNavigationProviderMount resolved={navigation} />
        </div>
      ) : (
        <SidebarNavigationProviderMount resolved={navigation} />
      )}
    </SidebarNavigationRegion>
  );

  const footer = (
    <SidebarFooter
      className={cn(
        "w-full justify-center pl-(--bb-frame-footer-inset) pointer-fine:pl-[calc(var(--bb-frame-footer-inset)_+_(2rem_-_var(--bb-title-bar-control-size))/2)] pointer-fine:[&_[data-sidebar=menu-button]]:size-(--bb-title-bar-control-size) [&_[data-sidebar=menu-button]]:ring-inset pointer-fine:[&_[data-sidebar=menu]]:gap-0.5",
        isFramed
          ? cn(
              "h-(--bb-app-chrome-row-height) py-0",
              placement === "rail" && "-mb-px",
            )
          : "pb-(--bb-frame-footer-inset)",
      )}
    >
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
            ...(placement === "list"
              ? [
                  {
                    id: "settings" as const,
                    href: settingsRoutePath,
                    ariaLabel: settingsShortcut
                      ? `Settings (${settingsShortcut.label})`
                      : "Settings",
                    ariaKeyShortcuts: settingsShortcut?.ariaKeyshortcuts,
                    onActivate: () => {
                      closeOnMobile();
                      void navigate(settingsRoutePath);
                    },
                  },
                ]
              : []),
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
  );

  const body = (
    <>
      <SidebarTopReserveRow
        testId="app-sidebar-top-reserve-row"
        headerSlot={
          navigation.kind === "plugin" &&
          navigation.slot.headerComponent !== undefined ? (
            <SidebarNavigationHeader resolved={navigation} />
          ) : undefined
        }
      />
      {placement === "list" ? navigationRegion("shrink-0") : null}
      <SidebarContent>
        <ThreadActionSurfaceVisibility visible={isThreadListVisible}>
          <PluginThreadList
            replacement={threadListReplacement}
            onNavigate={closeOnMobile}
          />
        </ThreadActionSurfaceVisibility>
      </SidebarContent>
      <div
        className={cn(
          "relative flex flex-col gap-2",
          (isFooterCustomizing || pluginSidebarFooter.activeItem !== null) &&
            "px-2 pt-2",
        )}
      >
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
      </div>
      {placement === "list" ? footer : null}
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
        onOpenCustomize={navigationCustomize.open}
        splitEnabled
      >
        <Sidebar ref={sidebarRef}>
          <div className="grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto]">
            {placement === "rail"
              ? navigationRegion(
                  cn(
                    "relative z-10 flex shrink-0 flex-col",
                    NAV_RAIL_WIDTH_CLASS,
                    !isFramed &&
                      "-mt-[env(safe-area-inset-top)] bg-surface-recessed pt-[env(safe-area-inset-top)]",
                  ),
                )
              : null}
            <SidebarCollapsibleBody
              data-testid="nav-rail-sidebar-body"
              className={cn(
                "col-start-2 row-start-1",
                (isBodyHidden || placement === "list") && "row-span-2",
                isFramed &&
                  !isBodyHidden &&
                  placement === "rail" &&
                  "rounded-bl-none border-b-0 [clip-path:inset(0_-6px_0_0_round_var(--bb-frame-card-radius)_0_0_0)]",
              )}
            >
              <div
                data-testid="app-sidebar-body"
                hidden={isBodyHidden}
                className="flex min-h-0 min-w-0 flex-1 flex-col"
              >
                {body}
              </div>
              {alternateBody}
            </SidebarCollapsibleBody>
            {placement === "rail" ? (
              <div
                className={cn(
                  "col-start-1 row-start-2 flex shrink-0 items-center justify-center",
                  NAV_RAIL_WIDTH_CLASS,
                  isFramed
                    ? "h-(--bb-app-chrome-row-height)"
                    : "bg-surface-recessed -mb-[env(safe-area-inset-bottom)] pt-2 pb-[calc(var(--bb-frame-footer-inset)_+_env(safe-area-inset-bottom))]",
                )}
              >
                <NavRailSettingsButton
                  isSettingsActive={isSettingsActive}
                  settingsRoutePath={settingsRoutePath}
                />
              </div>
            ) : null}
            {placement === "rail" ? (
              <SidebarCollapsibleBody
                data-testid="sidebar-footer-body"
                contentInFlow
                hidden={isBodyHidden}
                className={cn(
                  "col-start-2 row-start-2",
                  isFramed &&
                    "rounded-tl-none border-t-0 [clip-path:inset(0_-6px_0_0_round_0_0_0_var(--bb-frame-card-radius))]",
                )}
              >
                {footer}
              </SidebarCollapsibleBody>
            ) : null}
          </div>
        </Sidebar>
      </SidebarNavigationModelProvider>
    </SidebarThreadShortcutKeysContext.Provider>
  );
}
