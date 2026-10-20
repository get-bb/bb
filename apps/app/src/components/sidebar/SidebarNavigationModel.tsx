import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useStore } from "jotai";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import type {
  ExperimentalSidebarNavigationActions,
  ExperimentalSidebarNavigationIcon,
  ExperimentalSidebarNavigationItem,
  ExperimentalSidebarNavigationState,
} from "@get-bb/plugin-sdk";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import {
  useAppCommandRunner,
  useAppCommandShortcut,
  useIsAppCommandModifierHeld,
} from "@/components/commands/AppCommandProvider";
import { PluginItemIcon } from "@/components/plugin/PluginIcon";
import { openPluginDetailsInWorkspace } from "@/components/plugin/plugin-detail-opener";
import { useSetPluginEnabled } from "@/components/plugin/useSetPluginEnabled";
import { getPluginNavPanelKey } from "@/components/plugin/pluginNavSidebarOrder";
import { appToast } from "@/components/ui/app-toast";
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import { appQueryClient } from "@/lib/app-query-client";
import { usePluginNavPanelChrome } from "@/lib/plugin-nav-panel-chrome";
import {
  getPluginDetailRoutePath,
  getPluginPanelRoutePath,
  getRootComposeRoutePath,
  SETTINGS_ROUTE_PATH,
} from "@/lib/route-paths";
import type { PaneContent } from "@/lib/split-layout";
import {
  NavigationBadgeSources,
  type NavigationBadges,
} from "./navigationBadges";
import {
  createSidebarNavigationRows,
  getResourceNavigationRoutePath,
  getSidebarNavigationRowContent,
  isSameSidebarNavigationItem,
  NEW_THREAD_NAVIGATION_ITEM_ID,
  resolveActiveSidebarNavigationItemId,
  SIDEBAR_NAVIGATION_LEADING_KEYS,
  toSidebarNavigationItem,
  type SidebarNavigationRow,
} from "./sidebarNavigationItems";
import { usePaneContentSplitActions } from "./usePaneContentSplitDrag";
import {
  useSidebarNavigationArrangement,
  type SidebarNavigationArrangement,
} from "./useSidebarNavigationArrangement";

export interface SidebarNavigationHostOptions {
  onNavigate?: () => void;
  onNewChat?: () => void;
  onSearchThreads?: () => void;
  onOpenCustomize?: () => void;
  splitEnabled: boolean;
}

export interface SidebarNavigationModel {
  state: ExperimentalSidebarNavigationState;
  arrangement: SidebarNavigationArrangement<SidebarNavigationRow>;
  rowsById: ReadonlyMap<string, SidebarNavigationRow>;
  splitEnabled: boolean;
  onNavigate?: () => void;
}

const SidebarNavigationModelContext =
  createContext<SidebarNavigationModel | null>(null);

const HOST_ICON_NAMES: Record<
  Extract<ExperimentalSidebarNavigationIcon, { kind: "host" }>["name"],
  IconName
> = {
  "new-thread": "MessageSquarePlus",
  search: "Search",
  extensions: "Plug02",
  skills: "Zap",
};

export function SidebarNavigationIcon({
  icon,
  className,
}: {
  icon: ExperimentalSidebarNavigationIcon;
  className?: string;
}) {
  if (icon.kind === "host") {
    return (
      <Icon
        name={HOST_ICON_NAMES[icon.name]}
        className={className}
        aria-hidden="true"
      />
    );
  }
  return (
    <PluginItemIcon
      pluginId={icon.pluginId}
      icon={icon.icon}
      className={className}
    />
  );
}

function useStableItems(
  items: readonly ExperimentalSidebarNavigationItem[],
): readonly ExperimentalSidebarNavigationItem[] {
  const previousRef = useRef<{
    byId: Map<string, ExperimentalSidebarNavigationItem>;
    list: readonly ExperimentalSidebarNavigationItem[];
  }>({ byId: new Map(), list: [] });
  return useMemo(() => {
    const previous = previousRef.current;
    const byId = new Map<string, ExperimentalSidebarNavigationItem>();
    const list = items.map((item) => {
      const prior = previous.byId.get(item.id);
      const stable =
        prior && isSameSidebarNavigationItem(prior, item) ? prior : item;
      byId.set(item.id, stable);
      return stable;
    });
    const unchanged =
      list.length === previous.list.length &&
      list.every((item, index) => item === previous.list[index]);
    const next = unchanged ? previous.list : list;
    previousRef.current = { byId, list: next };
    return next;
  }, [items]);
}

function isSettingsPathname(pathname: string): boolean {
  return matchPath(`${SETTINGS_ROUTE_PATH}/*`, pathname) !== null;
}

export function SidebarNavigationModelProvider({
  children,
  ...host
}: SidebarNavigationHostOptions & { children: ReactNode }) {
  const store = useStore();
  const panelEntries = usePluginNavPanelChrome();
  const rows = useMemo(
    () => createSidebarNavigationRows(panelEntries),
    [panelEntries],
  );
  const arrangement = useSidebarNavigationArrangement(
    rows,
    SIDEBAR_NAVIGATION_LEADING_KEYS,
  );
  const rowsById = useMemo(
    () => new Map(rows.map((row) => [getPluginNavPanelKey(row), row])),
    [rows],
  );
  const [badges, setBadges] = useState<NavigationBadges>(() => new Map());
  const badgedPanels = useMemo(
    () =>
      rows.flatMap((row) => {
        const panel = row.panelEntry?.panel;
        return panel ? [{ itemId: getPluginNavPanelKey(row), panel }] : [];
      }),
    [rows],
  );
  const location = useLocation();
  const navigate = useNavigate();
  const commandRunner = useAppCommandRunner();
  const splitActions = usePaneContentSplitActions();
  const setPluginEnabled = useSetPluginEnabled();
  const newThreadShortcut = useAppCommandShortcut("thread.new");
  const threadSearchShortcut = useAppCommandShortcut("thread.search");
  const searchThreadsDisabled = !commandRunner.isCommandAvailable(
    "thread.search",
    null,
  );
  const newThreadDisabled = host.onNewChat === undefined;

  const rawItems = useMemo(() => {
    const visibleSet = new Set(arrangement.visibleKeys);
    return arrangement.ordered.map((row) => {
      const key = getPluginNavPanelKey(row);
      return toSidebarNavigationItem(row, {
        isDisabled:
          row.action.kind === "new-thread"
            ? newThreadDisabled
            : row.action.kind === "search-threads"
              ? searchThreadsDisabled
              : false,
        isVisible: visibleSet.has(key),
        shortcut:
          row.action.kind === "new-thread" && newThreadShortcut
            ? {
                label: newThreadShortcut.label,
                ariaKeyShortcuts: newThreadShortcut.ariaKeyshortcuts,
              }
            : row.action.kind === "search-threads" && threadSearchShortcut
              ? {
                  label: threadSearchShortcut.label,
                  ariaKeyShortcuts: threadSearchShortcut.ariaKeyshortcuts,
                }
              : null,
        badge: badges.get(key) ?? null,
      });
    });
  }, [
    arrangement.ordered,
    arrangement.visibleKeys,
    badges,
    newThreadDisabled,
    newThreadShortcut,
    searchThreadsDisabled,
    threadSearchShortcut,
  ]);
  const items = useStableItems(rawItems);
  const isShortcutModifierHeld = useIsAppCommandModifierHeld();
  const activeItemId = resolveActiveSidebarNavigationItemId({
    rows,
    pathname: location.pathname,
  });
  const isHomeActive =
    !isSettingsPathname(location.pathname) &&
    (activeItemId === null || activeItemId === NEW_THREAD_NAVIGATION_ITEM_ID);
  const currentRoutePath = `${location.pathname}${location.search}${location.hash}`;
  const homeRoutePathRef = useRef(
    isHomeActive ? currentRoutePath : getRootComposeRoutePath(),
  );
  useEffect(() => {
    if (isHomeActive) homeRoutePathRef.current = currentRoutePath;
  }, [currentRoutePath, isHomeActive]);

  const latest = useRef({
    arrangement,
    commandRunner,
    host,
    isHomeActive,
    items,
    navigate,
    rowsById,
    setPluginEnabled,
    splitActions,
  });
  useLayoutEffect(() => {
    latest.current = {
      arrangement,
      commandRunner,
      host,
      isHomeActive,
      items,
      navigate,
      rowsById,
      setPluginEnabled,
      splitActions,
    };
  });

  const actions = useMemo<ExperimentalSidebarNavigationActions>(() => {
    const lookup = (itemId: string) => {
      const current = latest.current;
      const row = current.rowsById.get(itemId);
      const item = current.items.find((candidate) => candidate.id === itemId);
      return row && item ? { current, row, item } : null;
    };
    const openInSplit = (
      current: typeof latest.current,
      content: PaneContent,
      label: string,
    ) =>
      current.splitActions.openInSplit({
        content,
        enabled: current.host.splitEnabled,
        label,
        onNavigate: current.host.onNavigate,
      });
    const openInBrowserTab = (routePath: string) => {
      window.open(routePath, "_blank", "noopener,noreferrer");
    };
    return {
      activate(itemId, options) {
        const found = lookup(itemId);
        if (!found || found.item.isDisabled || found.item.isLoading) return;
        const { current, row, item } = found;
        const content = getSidebarNavigationRowContent(row);
        const legacySplit =
          "openInSplit" in options && options.openInSplit === true;
        const requestedTarget =
          options.target ?? (legacySplit ? "split" : "current");
        const canSplit =
          content !== null &&
          current.host.splitEnabled &&
          !current.splitActions.isCompact &&
          store.get(splitLayoutAtom) !== null;
        const target =
          requestedTarget === "split" && !canSplit ? "tab" : requestedTarget;
        switch (row.action.kind) {
          case "new-thread":
            if (target === "split") {
              if (content) openInSplit(current, content, item.label);
              return;
            }
            if (target === "tab") {
              openInBrowserTab(getRootComposeRoutePath());
              return;
            }
            current.host.onNewChat?.();
            return;
          case "search-threads":
            current.host.onSearchThreads?.();
            current.commandRunner.dispatch("thread.search", null);
            return;
          case "open-extensions":
          case "open-skills": {
            const routePath = getResourceNavigationRoutePath(row.action);
            if (routePath === null) return;
            if (target === "tab") {
              openInBrowserTab(routePath);
              return;
            }
            void current.navigate(routePath);
            return;
          }
          case "open-plugin-panel": {
            const chrome = row.panelEntry?.chrome;
            if (!chrome) return;
            if (target === "split") {
              if (content) openInSplit(current, content, item.label);
              return;
            }
            const routePath = getPluginPanelRoutePath({
              pluginId: chrome.pluginId,
              path: chrome.path,
            });
            if (target === "tab") {
              openInBrowserTab(routePath);
              return;
            }
            current.host.onNavigate?.();
            void current.navigate(routePath);
          }
        }
      },
      goHome(options) {
        const current = latest.current;
        if (options?.target === "tab") {
          openInBrowserTab(getRootComposeRoutePath());
          return;
        }
        if (current.isHomeActive) return;
        void current.navigate(homeRoutePathRef.current);
      },
      setVisible(itemId, isVisible) {
        latest.current.arrangement.setVisible(itemId, isVisible);
      },
      setOrder(itemIds) {
        latest.current.arrangement.setOrder(itemIds);
      },
      openCustomize() {
        latest.current.host.onOpenCustomize?.();
      },
      openDetails(itemId) {
        const found = lookup(itemId);
        const pluginId = found?.row.ownerPluginId;
        if (!found || !pluginId) return;
        found.current.host.onNavigate?.();
        if (
          openPluginDetailsInWorkspace({ pluginId, title: found.item.label })
        ) {
          return;
        }
        void found.current.navigate(getPluginDetailRoutePath({ pluginId }));
      },
      async disablePlugin(itemId) {
        const found = lookup(itemId);
        const pluginId = found?.row.ownerPluginId;
        if (!found || !pluginId) return;
        const { current, item } = found;
        try {
          await current.setPluginEnabled(
            pluginId,
            false,
            current.host.onNavigate,
          );
          appToast.success(`${item.label} disabled`);
        } catch (error) {
          appToast.error(`Failed to disable ${item.label}`, {
            description: error instanceof Error ? error.message : String(error),
          });
          throw error;
        } finally {
          await invalidatePluginList({ queryClient: appQueryClient });
        }
      },
    };
  }, [store]);

  const state = useMemo<ExperimentalSidebarNavigationState>(
    () => ({
      items,
      activeItemId,
      isHomeActive,
      isShortcutModifierHeld,
      actions,
    }),
    [actions, activeItemId, isHomeActive, isShortcutModifierHeld, items],
  );
  const model = useMemo<SidebarNavigationModel>(
    () => ({
      state,
      arrangement,
      rowsById,
      splitEnabled: host.splitEnabled,
      ...(host.onNavigate ? { onNavigate: host.onNavigate } : {}),
    }),
    [arrangement, host.onNavigate, host.splitEnabled, rowsById, state],
  );
  return (
    <SidebarNavigationModelContext.Provider value={model}>
      <NavigationBadgeSources panels={badgedPanels} setBadges={setBadges} />
      {children}
    </SidebarNavigationModelContext.Provider>
  );
}

export function useOptionalSidebarNavigationModel(): SidebarNavigationModel | null {
  return useContext(SidebarNavigationModelContext);
}

export function useSidebarNavigationModel(): SidebarNavigationModel {
  const model = useOptionalSidebarNavigationModel();
  if (model === null) {
    throw new Error(
      "useSidebarNavigationModel must be used within a SidebarNavigationModelProvider.",
    );
  }
  return model;
}
