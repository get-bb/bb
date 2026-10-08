import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
} from "@/lib/route-paths";
import type { PaneContent } from "@/lib/split-layout";
import {
  createSidebarNavigationRows,
  getResourceNavigationRoutePath,
  getSidebarNavigationRowContent,
  isSameSidebarNavigationItem,
  resolveActiveSidebarNavigationItemId,
  SIDEBAR_NAVIGATION_LEADING_KEYS,
  toSidebarNavigationItem,
  type SidebarNavigationActions,
  type SidebarNavigationItem,
  type SidebarNavigationItemIcon,
  type SidebarNavigationRow,
  type SidebarNavigationState,
} from "./sidebarNavigationItems";
import {
  usePaneContentSplitActions,
  usePaneContentSplitDrag,
} from "./usePaneContentSplitDrag";
import {
  useSidebarNavigationArrangement,
  type SidebarNavigationArrangement,
} from "./useSidebarNavigationArrangement";

export interface SidebarNavigationHostOptions {
  onNavigate?: () => void;
  onNewChat?: () => void;
  onSearchThreads?: () => void;
  splitEnabled: boolean;
}

export interface SidebarNavigationModel {
  state: SidebarNavigationState;
  arrangement: SidebarNavigationArrangement<SidebarNavigationRow>;
  rowsById: ReadonlyMap<string, SidebarNavigationRow>;
  splitEnabled: boolean;
  onNavigate?: () => void;
}

const SidebarNavigationModelContext =
  createContext<SidebarNavigationModel | null>(null);

const HOST_ICON_NAMES: Record<
  Extract<SidebarNavigationItemIcon, { kind: "host" }>["name"],
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
  icon: SidebarNavigationItemIcon;
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
  items: readonly SidebarNavigationItem[],
): readonly SidebarNavigationItem[] {
  const previousRef = useRef<{
    byId: Map<string, SidebarNavigationItem>;
    list: readonly SidebarNavigationItem[];
  }>({ byId: new Map(), list: [] });
  return useMemo(() => {
    const previous = previousRef.current;
    const byId = new Map<string, SidebarNavigationItem>();
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

export function SidebarNavigationModelProvider({
  children,
  ...host
}: SidebarNavigationHostOptions & { children: ReactNode }) {
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
      });
    });
  }, [
    arrangement.ordered,
    arrangement.visibleKeys,
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

  const latest = useRef({
    arrangement,
    commandRunner,
    host,
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
      items,
      navigate,
      rowsById,
      setPluginEnabled,
      splitActions,
    };
  });

  const actions = useMemo<SidebarNavigationActions>(() => {
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
    return {
      activate(itemId, options) {
        const found = lookup(itemId);
        if (!found || found.item.isDisabled || found.item.isLoading) return;
        const { current, row, item } = found;
        const content = getSidebarNavigationRowContent(row);
        switch (row.action.kind) {
          case "new-thread":
            if (options.openInSplit && content) {
              openInSplit(current, content, item.label);
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
            void current.navigate(routePath);
            return;
          }
          case "open-plugin-panel": {
            const chrome = row.panelEntry?.chrome;
            if (!chrome) return;
            if (options.openInSplit && content) {
              openInSplit(current, content, item.label);
              return;
            }
            current.host.onNavigate?.();
            void current.navigate(
              getPluginPanelRoutePath({
                pluginId: chrome.pluginId,
                path: chrome.path,
              }),
            );
          }
        }
      },
      setVisible(itemId, isVisible) {
        latest.current.arrangement.setVisible(itemId, isVisible);
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
  }, []);

  const state = useMemo<SidebarNavigationState>(
    () => ({ items, activeItemId, isShortcutModifierHeld, actions }),
    [actions, activeItemId, isShortcutModifierHeld, items],
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
      {children}
    </SidebarNavigationModelContext.Provider>
  );
}

export function useSidebarNavigationModel(): SidebarNavigationModel {
  const model = useContext(SidebarNavigationModelContext);
  if (model === null) {
    throw new Error(
      "useSidebarNavigationModel must be used within a SidebarNavigationModelProvider.",
    );
  }
  return model;
}

export function useSidebarNavigation(): SidebarNavigationState {
  return useSidebarNavigationModel().state;
}

const PLACEHOLDER_SPLIT_CONTENT = { kind: "new-thread" } as const;

export function useSidebarNavigationSplit(itemId: string): {
  splitProps: {
    onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  };
  isAvailable: boolean;
} {
  const model = useSidebarNavigationModel();
  const row = model.rowsById.get(itemId);
  const target = useMemo(() => {
    const content = row ? getSidebarNavigationRowContent(row) : null;
    return row && content ? { content, label: row.label } : null;
  }, [row]);
  const enabled = target !== null && model.splitEnabled;
  const onNavigate = model.onNavigate;
  const options = useMemo(
    () => ({
      content: target?.content ?? PLACEHOLDER_SPLIT_CONTENT,
      enabled,
      label: target?.label ?? "",
      ...(onNavigate ? { onNavigate } : {}),
    }),
    [enabled, onNavigate, target],
  );
  const { onPointerDown } = usePaneContentSplitDrag(options);
  return useMemo(
    () => ({
      splitProps: onPointerDown ? { onPointerDown } : {},
      isAvailable: onPointerDown !== undefined,
    }),
    [onPointerDown],
  );
}
