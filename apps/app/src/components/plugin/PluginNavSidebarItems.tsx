import {
  useCallback,
  useEffect,
  Fragment,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEventHandler,
  type ReactNode,
} from "react";
import { useAtom } from "jotai";
import { useLocation, useNavigate } from "react-router-dom";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type {
  ExperimentalPluginNavPanelMenuContext,
  ExperimentalPluginNavPanelMenuGroup,
  ExperimentalPluginNavPanelMenuItem,
  ExperimentalPluginNavPanelSubmenu,
} from "@get-bb/plugin-sdk/app";
import { validateExperimentalPluginNavPanelMenuItems } from "@get-bb/plugin-sdk/internal/plugin-app-collector";
import { Button } from "@bb/shared-ui/button";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { Icon, ICON_NAMES, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { PROJECT_LIST_ACTION_BUTTON_CLASS } from "@/components/sidebar/ProjectList";
import { SplitPaneMiniMap } from "@/components/sidebar/SplitPaneMiniMap";
import type { MiniMapSlot } from "@/components/sidebar/paneContentSplitIndicator";
import { usePaneContentSplitIndicator } from "@/components/sidebar/paneContentSplitIndicator";
import { SIDEBAR_MORE_ACTION_TRIGGER_CLASS } from "@/components/sidebar/sidebarRowClasses";
import type { SidebarSortableDragBindings } from "@/components/sidebar/sortableMotion";
import { useSidebarSortable } from "@/components/sidebar/sortableMotion";
import { usePaneContentSplitDrag } from "@/components/sidebar/usePaneContentSplitDrag";
import { useSidebarReorderDnd } from "@/components/sidebar/useSidebarReorderDnd";
import { appToast } from "@/components/ui/app-toast";
import { CompactLongPressMenu } from "@/components/ui/compact-long-press-menu";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
  SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions";
import { getLocalStorage } from "@/lib/browser-storage";
import { usePluginFrontendBootComplete } from "@/lib/plugin-frontend-boot-state";
import { usePluginDisplayName } from "@/lib/plugin-logos";
import {
  usePluginNavPanelChrome,
  type PluginNavPanelChrome,
} from "@/lib/plugin-nav-panel-chrome";
import type { PluginNavPanelSlot } from "@/lib/plugin-slots";
import {
  getPluginDetailRoutePath,
  getPluginPanelRoutePath,
} from "@/lib/route-paths";
import {
  HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
  hiddenPluginNavPanelsAtom,
  PLUGIN_NAV_PANEL_MIGRATED_VISIBLE_LIMIT_STORAGE_KEY,
  pluginNavPanelMigratedVisibleLimitAtom,
  pluginNavPanelOrderAtom,
  pluginNavPanelOverflowExpandedAtom,
} from "./pluginNavSidebarAtoms";
import {
  HIDDEN_PLUGIN_NAV_PANELS_MIGRATION_STORAGE_KEY,
  isPluginNavPanelKey,
  migrateHiddenPluginNavPanels,
} from "./pluginNavSidebarMigration";
import {
  arrangePluginNavPanels,
  getPluginNavPanelKey,
  havePluginNavPanelOrdersDiverged,
  movePluginNavPanelToOverflow,
  movePluginNavPanelToTop,
  normalizePluginNavPanelOrder,
  PLUGIN_NAV_PANEL_VISIBLE_LIMIT,
  reorderPluginNavPanels,
} from "./pluginNavSidebarOrder";

type SidebarNavRow = {
  pluginId: string;
  id: string;
  title: string;
  chrome: PluginNavPanelChrome;
  panel: PluginNavPanelSlot | null;
};

export function PluginNavSidebarItems(props: {
  onNavigate?: () => void;
  splitEnabled?: boolean;
}) {
  const navPanels = usePluginNavPanelChrome();
  const rows = useMemo<SidebarNavRow[]>(
    () =>
      navPanels.map(({ chrome, panel }) => ({
        pluginId: chrome.pluginId,
        id: chrome.id,
        title: chrome.title,
        chrome,
        panel,
      })),
    [navPanels],
  );
  if (rows.length === 0) return null;
  return <PluginNavSidebarItemList {...props} rows={rows} />;
}

function routePathForRow(row: SidebarNavRow): string {
  return getPluginPanelRoutePath({
    pluginId: row.chrome.pluginId,
    path: row.chrome.path,
  });
}

function readStoredPluginNavPanelKeys(storageKey: string): string[] {
  const value = getLocalStorage()?.getItem(storageKey);
  if (value === null || value === undefined) return [];
  try {
    return normalizePluginNavPanelOrder(JSON.parse(value));
  } catch {
    return [];
  }
}

function readStoredMigratedVisibleLimit(): number | null {
  const value = getLocalStorage()?.getItem(
    PLUGIN_NAV_PANEL_MIGRATED_VISIBLE_LIMIT_STORAGE_KEY,
  );
  if (value === null || value === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "number" &&
      Number.isInteger(parsed) &&
      parsed >= 0 &&
      parsed <= PLUGIN_NAV_PANEL_VISIBLE_LIMIT
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function PluginNavSidebarItemList({
  onNavigate,
  rows,
  splitEnabled = false,
}: {
  onNavigate?: () => void;
  rows: readonly SidebarNavRow[];
  splitEnabled?: boolean;
}) {
  const location = useLocation();
  const bootComplete = usePluginFrontendBootComplete();
  const [storedOrder, setStoredOrder] = useAtom(pluginNavPanelOrderAtom);
  const [legacyHiddenKeys, setLegacyHiddenKeys] = useAtom(
    hiddenPluginNavPanelsAtom,
  );
  const [migratedVisibleLimit, setMigratedVisibleLimit] = useAtom(
    pluginNavPanelMigratedVisibleLimitAtom,
  );
  const [isOverflowOpen, setIsOverflowOpen] = useAtom(
    pluginNavPanelOverflowExpandedAtom,
  );
  const registrationOrder = useMemo(
    () => rows.map(getPluginNavPanelKey),
    [rows],
  );
  const activeKey = useMemo(() => {
    const activeRow = rows.find((row) => {
      const path = routePathForRow(row);
      return (
        location.pathname === path || location.pathname.startsWith(`${path}/`)
      );
    });
    return activeRow === undefined
      ? undefined
      : getPluginNavPanelKey(activeRow);
  }, [location.pathname, rows]);
  const migrationPending =
    getLocalStorage()?.getItem(
      HIDDEN_PLUGIN_NAV_PANELS_MIGRATION_STORAGE_KEY,
    ) !== "1";
  const pendingStoredHiddenKeys = migrationPending
    ? readStoredPluginNavPanelKeys(HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY)
    : [];
  const legacyPluginHiddenKeys = normalizePluginNavPanelOrder([
    ...legacyHiddenKeys,
    ...pendingStoredHiddenKeys,
  ]).filter(isPluginNavPanelKey);
  const pendingVisibleLimit = (() => {
    if (!migrationPending || legacyPluginHiddenKeys.length === 0) return null;
    const hiddenSet = new Set(legacyPluginHiddenKeys);
    return Math.min(
      registrationOrder.filter((key) => !hiddenSet.has(key)).length,
      PLUGIN_NAV_PANEL_VISIBLE_LIMIT,
    );
  })();
  const visibleLimit =
    pendingVisibleLimit ??
    migratedVisibleLimit ??
    readStoredMigratedVisibleLimit() ??
    PLUGIN_NAV_PANEL_VISIBLE_LIMIT;
  const displayOrder = (() => {
    const pluginOrder = normalizePluginNavPanelOrder([
      ...storedOrder.filter(isPluginNavPanelKey),
      ...registrationOrder,
    ]);
    if (!migrationPending || legacyPluginHiddenKeys.length === 0) {
      return pluginOrder;
    }
    const hiddenSet = new Set(legacyPluginHiddenKeys);
    const completeOrder = normalizePluginNavPanelOrder([
      ...pluginOrder,
      ...legacyPluginHiddenKeys,
    ]);
    return [
      ...completeOrder.filter((key) => !hiddenSet.has(key)),
      ...completeOrder.filter((key) => hiddenSet.has(key)),
    ];
  })();
  const { visible, overflow, ordered, normalizedOrder } =
    arrangePluginNavPanels({
      panels: rows,
      storedOrder: displayOrder,
      visibleLimit,
      ...(activeKey === undefined ? {} : { activeKey }),
    });
  const registeredKeys = ordered.map(getPluginNavPanelKey);

  useEffect(() => {
    if (!bootComplete) return;
    const storage = getLocalStorage();
    if (storage === null) return;
    let cancelled = false;
    void migrateHiddenPluginNavPanels({ storage, registrationOrder })
      .then((result) => {
        if (cancelled) return;
        setStoredOrder(result.order);
        setLegacyHiddenKeys(result.remainingHiddenKeys);
        setMigratedVisibleLimit(result.migratedVisibleLimit);
      })
      .catch((error: unknown) => {
        console.warn("Could not migrate hidden plugin pages", error);
      });
    return () => {
      cancelled = true;
    };
  }, [
    bootComplete,
    registrationOrder,
    setLegacyHiddenKeys,
    setMigratedVisibleLimit,
    setStoredOrder,
  ]);

  useEffect(() => {
    if (!bootComplete || migrationPending) return;
    if (!havePluginNavPanelOrdersDiverged(storedOrder, normalizedOrder)) return;
    setStoredOrder(normalizedOrder);
  }, [
    bootComplete,
    migrationPending,
    normalizedOrder,
    setStoredOrder,
    storedOrder,
  ]);

  const displayedRows = isOverflowOpen ? [...visible, ...overflow] : visible;
  const displayedKeys = displayedRows.map(getPluginNavPanelKey);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (
        !event.over ||
        typeof event.active.id !== "string" ||
        typeof event.over.id !== "string"
      ) {
        return;
      }
      const nextOrder = reorderPluginNavPanels({
        activeKey: event.active.id,
        overKey: event.over.id,
        order: normalizedOrder,
      });
      if (nextOrder) {
        setStoredOrder(nextOrder);
        const from = registeredKeys.indexOf(event.active.id);
        const to = registeredKeys.indexOf(event.over.id);
        if (
          migratedVisibleLimit !== null &&
          from >= visibleLimit &&
          to >= 0 &&
          to < visibleLimit
        ) {
          const standardVisibleLimit = Math.min(
            registeredKeys.length,
            PLUGIN_NAV_PANEL_VISIBLE_LIMIT,
          );
          const nextVisibleLimit = Math.min(
            visibleLimit + 1,
            standardVisibleLimit,
          );
          setMigratedVisibleLimit(
            nextVisibleLimit >= standardVisibleLimit ? null : nextVisibleLimit,
          );
        }
      }
    },
    [
      migratedVisibleLimit,
      normalizedOrder,
      registeredKeys,
      setMigratedVisibleLimit,
      setStoredOrder,
      visibleLimit,
    ],
  );
  const { dndContextProps, onClickCapture } = useSidebarReorderDnd({
    onDragEnd: handleDragEnd,
  });

  const handleOrderChange = useCallback(
    (order: string[], promotesFromOverflow = false) => {
      setStoredOrder(order);
      if (!promotesFromOverflow || migratedVisibleLimit === null) return;
      const standardVisibleLimit = Math.min(
        registeredKeys.length,
        PLUGIN_NAV_PANEL_VISIBLE_LIMIT,
      );
      const nextVisibleLimit = Math.min(visibleLimit + 1, standardVisibleLimit);
      setMigratedVisibleLimit(
        nextVisibleLimit >= standardVisibleLimit ? null : nextVisibleLimit,
      );
    },
    [
      migratedVisibleLimit,
      registeredKeys.length,
      setMigratedVisibleLimit,
      setStoredOrder,
      visibleLimit,
    ],
  );
  const rowProps = {
    onNavigate,
    pathname: location.pathname,
    splitEnabled,
    registeredKeys,
    normalizedOrder,
    visibleLimit,
    onOrderChange: handleOrderChange,
  };
  const reorderDisabled = displayedRows.length < 2;

  return (
    <div
      className="shrink-0 space-y-0.5 px-2 py-2 group-data-[collapsible=icon]:hidden"
      data-testid="plugin-nav-sidebar-items"
      onClickCapture={onClickCapture}
    >
      {ordered.length > PLUGIN_NAV_PANEL_VISIBLE_LIMIT ? (
        <div
          className={cn(
            CHROME_SECTION_LABEL_CLASS,
            "flex h-7 items-center justify-between px-2",
          )}
          data-testid="plugin-nav-sidebar-heading"
        >
          <span>Plugin pages</span>
          <span aria-label={`${ordered.length} plugin pages`}>
            {ordered.length}
          </span>
        </div>
      ) : null}
      <DndContext {...dndContextProps}>
        <SortableContext
          items={displayedKeys}
          strategy={verticalListSortingStrategy}
        >
          {visible.map((row) => (
            <SortableSidebarNavRow
              key={getPluginNavPanelKey(row)}
              row={row}
              reorderDisabled={reorderDisabled}
              {...rowProps}
            />
          ))}
          {overflow.length > 0 ? (
            <PluginNavSidebarOverflowToggle
              count={overflow.length}
              isOpen={isOverflowOpen}
              onToggle={() => setIsOverflowOpen((open) => !open)}
            />
          ) : null}
          {isOverflowOpen
            ? overflow.map((row) => (
                <SortableSidebarNavRow
                  key={getPluginNavPanelKey(row)}
                  row={row}
                  reorderDisabled={reorderDisabled}
                  {...rowProps}
                />
              ))
            : null}
        </SortableContext>
      </DndContext>
    </div>
  );
}

function PluginNavSidebarOverflowToggle({
  count,
  isOpen,
  onToggle,
}: {
  count: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-expanded={isOpen}
      className={cn(
        PROJECT_LIST_ACTION_BUTTON_CLASS,
        "w-full text-subtle-foreground/75",
      )}
      onClick={onToggle}
      data-testid="plugin-nav-sidebar-overflow-toggle"
    >
      <Icon
        name="ChevronRight"
        className={cn(
          "size-3 shrink-0 transition-transform duration-150",
          isOpen && "rotate-90",
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 truncate text-left">
        {isOpen ? "Show less" : `Show ${count} more`}
      </span>
    </Button>
  );
}

interface SidebarNavRowItemProps {
  row: SidebarNavRow;
  pathname: string;
  onNavigate?: () => void;
  splitEnabled: boolean;
  registeredKeys: readonly string[];
  normalizedOrder: readonly string[];
  visibleLimit: number;
  onOrderChange(order: string[], promotesFromOverflow?: boolean): void;
  dragBindings?: SidebarSortableDragBindings;
  rowRef?: (element: HTMLElement | null) => void;
  rowStyle?: CSSProperties;
}

function SortableSidebarNavRow({
  row,
  reorderDisabled,
  ...props
}: SidebarNavRowItemProps & { reorderDisabled: boolean }) {
  const { dragBindings, setNodeRef, style } = useSidebarSortable({
    id: getPluginNavPanelKey(row),
    disabled: reorderDisabled,
  });
  return (
    <PluginNavSidebarItem
      {...props}
      row={row}
      dragBindings={dragBindings}
      rowRef={setNodeRef}
      rowStyle={style}
    />
  );
}

type PluginNavRowMenuSurface = "context" | "dropdown";

interface HostMenuAction {
  id: string;
  label: string;
  icon: IconName;
  run(): void;
}

interface PluginNavRowMenuDefinition {
  context: ExperimentalPluginNavPanelMenuContext;
  hostActions: readonly HostMenuAction[];
  pluginGroups: readonly ExperimentalPluginNavPanelMenuGroup[];
  pluginDisplayName: string;
}

function isIconName(value: string | undefined): value is IconName {
  return (
    value !== undefined && (ICON_NAMES as readonly string[]).includes(value)
  );
}

function MenuIcon({ name }: { name?: string }) {
  return isIconName(name) ? <Icon name={name} aria-hidden="true" /> : null;
}

function PluginMenuItemContent({
  item,
}: {
  item: ExperimentalPluginNavPanelMenuItem;
}) {
  return (
    <>
      <MenuIcon name={item.icon} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{item.label}</span>
        {item.description ? (
          <span className="truncate text-xs text-muted-foreground">
            {item.description}
          </span>
        ) : null}
      </span>
    </>
  );
}

function pluginActionErrorDescription(error: unknown): string {
  return error instanceof Error ? error.message : "The plugin action failed.";
}

function runPluginAction(
  item: ExperimentalPluginNavPanelMenuItem,
  context: ExperimentalPluginNavPanelMenuContext,
): void {
  void Promise.resolve()
    .then(() => item.run(context))
    .catch((error: unknown) => {
      console.warn(
        `Plugin menu action ${context.pluginId}/${context.panelId}/${item.id} failed`,
        error,
      );
      appToast.error("Could not run plugin action", {
        description: pluginActionErrorDescription(error),
      });
    });
}

function PluginLeafMenuItems({
  context,
  items,
  surface,
}: {
  context: ExperimentalPluginNavPanelMenuContext;
  items: readonly ExperimentalPluginNavPanelMenuItem[];
  surface: PluginNavRowMenuSurface;
}) {
  return items.map((item) => {
    const content = <PluginMenuItemContent item={item} />;
    const onSelect = () => runPluginAction(item, context);
    return surface === "context" ? (
      <ContextMenuItem
        key={item.id}
        disabled={item.disabled}
        onSelect={onSelect}
      >
        {content}
      </ContextMenuItem>
    ) : (
      <DropdownMenuItem
        key={item.id}
        disabled={item.disabled}
        onSelect={onSelect}
      >
        {content}
      </DropdownMenuItem>
    );
  });
}

type LazySubmenuState =
  | { status: "idle" | "loading" | "error" }
  | { status: "ready"; items: readonly ExperimentalPluginNavPanelMenuItem[] };

function PluginMenuSubmenu({
  context,
  submenu,
  surface,
}: {
  context: ExperimentalPluginNavPanelMenuContext;
  submenu: ExperimentalPluginNavPanelSubmenu;
  surface: PluginNavRowMenuSurface;
}) {
  const eagerItems = typeof submenu.items === "function" ? null : submenu.items;
  const [lazyState, setLazyState] = useState<LazySubmenuState>(
    eagerItems === null
      ? { status: "idle" }
      : { status: "ready", items: eagerItems },
  );
  const loadedForOpenRef = useRef(false);
  const requestIdRef = useRef(0);
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        loadedForOpenRef.current = false;
        requestIdRef.current += 1;
        if (eagerItems === null) setLazyState({ status: "idle" });
        return;
      }
      if (
        eagerItems !== null ||
        loadedForOpenRef.current ||
        typeof submenu.items !== "function"
      ) {
        return;
      }
      loadedForOpenRef.current = true;
      const requestId = ++requestIdRef.current;
      const resolveItems = submenu.items;
      setLazyState({ status: "loading" });
      void Promise.resolve()
        .then(() =>
          typeof resolveItems === "function"
            ? resolveItems(context)
            : resolveItems,
        )
        .then((items) =>
          validateExperimentalPluginNavPanelMenuItems(
            `experimental_menu submenu ${submenu.id}`,
            items,
          ),
        )
        .then((items) => {
          if (requestIdRef.current === requestId) {
            setLazyState({ status: "ready", items });
          }
        })
        .catch((error: unknown) => {
          console.warn(
            `Plugin submenu ${context.pluginId}/${context.panelId}/${submenu.id} failed`,
            error,
          );
          if (requestIdRef.current === requestId) {
            setLazyState({ status: "error" });
          }
        });
    },
    [context, eagerItems, submenu],
  );
  const trigger = (
    <>
      <MenuIcon name={submenu.icon} />
      {submenu.label}
    </>
  );
  const content =
    lazyState.status === "ready" ? (
      <PluginLeafMenuItems
        context={context}
        items={lazyState.items}
        surface={surface}
      />
    ) : surface === "context" ? (
      <ContextMenuItem disabled>
        {lazyState.status === "error" ? "Could not load" : "Loading…"}
      </ContextMenuItem>
    ) : (
      <DropdownMenuItem disabled>
        {lazyState.status === "error" ? "Could not load" : "Loading…"}
      </DropdownMenuItem>
    );

  return surface === "context" ? (
    <ContextMenuSub onOpenChange={handleOpenChange}>
      <ContextMenuSubTrigger>{trigger}</ContextMenuSubTrigger>
      <ContextMenuSubContent>{content}</ContextMenuSubContent>
    </ContextMenuSub>
  ) : (
    <DropdownMenuSub onOpenChange={handleOpenChange}>
      <DropdownMenuSubTrigger>{trigger}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>{content}</DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function PluginMenuGroupItems({
  context,
  group,
  surface,
}: {
  context: ExperimentalPluginNavPanelMenuContext;
  group: ExperimentalPluginNavPanelMenuGroup;
  surface: PluginNavRowMenuSurface;
}) {
  return group.items.map((item) =>
    "items" in item ? (
      <PluginMenuSubmenu
        key={item.id}
        context={context}
        submenu={item}
        surface={surface}
      />
    ) : (
      <PluginLeafMenuItems
        key={item.id}
        context={context}
        items={[item]}
        surface={surface}
      />
    ),
  );
}

function PluginNavRowMenuItems({
  definition,
  surface,
}: {
  definition: PluginNavRowMenuDefinition;
  surface: PluginNavRowMenuSurface;
}) {
  return (
    <>
      {definition.hostActions.map((action) => {
        const content = (
          <>
            <Icon name={action.icon} aria-hidden="true" />
            {action.label}
          </>
        );
        return surface === "context" ? (
          <ContextMenuItem key={action.id} onSelect={action.run}>
            {content}
          </ContextMenuItem>
        ) : (
          <DropdownMenuItem key={action.id} onSelect={action.run}>
            {content}
          </DropdownMenuItem>
        );
      })}
      {definition.pluginGroups.map((group, index) => (
        <Fragment key={group.id}>
          {surface === "context" ? (
            <>
              {(definition.hostActions.length > 0 || index > 0) && (
                <ContextMenuSeparator />
              )}
              <ContextMenuLabel>
                {group.label ?? definition.pluginDisplayName}
              </ContextMenuLabel>
            </>
          ) : (
            <>
              {(definition.hostActions.length > 0 || index > 0) && (
                <DropdownMenuSeparator />
              )}
              <DropdownMenuLabel>
                {group.label ?? definition.pluginDisplayName}
              </DropdownMenuLabel>
            </>
          )}
          <PluginMenuGroupItems
            context={definition.context}
            group={group}
            surface={surface}
          />
        </Fragment>
      ))}
    </>
  );
}

function ToolsNavSidebarItemIcon() {
  return (
    <span className="bb-sidebar-row-icon-swap shrink-0" aria-hidden="true">
      <Icon name="Toolbox" className="bb-sidebar-row-icon-rest" />
      <Icon name="ToolCase" className="bb-sidebar-row-icon-hover" />
    </span>
  );
}

export function ExtensionsNavSidebarItem({
  routePath,
  onNavigate,
}: {
  routePath: string;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className={cn(PROJECT_LIST_ACTION_BUTTON_CLASS, "w-full")}
      onClick={() => {
        onNavigate?.();
        void navigate(routePath);
      }}
    >
      <ToolsNavSidebarItemIcon />
      <span className="min-w-0 flex-1 truncate text-left">Extensions</span>
    </Button>
  );
}

function PluginNavSidebarItem({
  row,
  pathname,
  onNavigate,
  splitEnabled,
  registeredKeys,
  normalizedOrder,
  visibleLimit,
  onOrderChange,
  ...props
}: SidebarNavRowItemProps) {
  const { chrome, panel } = row;
  const navigate = useNavigate();
  const pluginDisplayName = usePluginDisplayName(chrome.pluginId);
  const isCompactViewport = useIsCompactViewport();
  const path = routePathForRow(row);
  const content = useMemo(
    () =>
      ({
        kind: "plugin-panel",
        pluginId: chrome.pluginId,
        panelPath: chrome.path,
        subPath: "",
      }) as const,
    [chrome.path, chrome.pluginId],
  );
  const { onPointerDown, openInSplit } = usePaneContentSplitDrag({
    content,
    enabled: splitEnabled,
    label: chrome.title,
  });
  const splitIndicator = usePaneContentSplitIndicator(content, splitEnabled);
  const rowKey = getPluginNavPanelKey(row);
  const storedIndex = registeredKeys.indexOf(rowKey);
  const hostActions = useMemo<HostMenuAction[]>(() => {
    const actions: HostMenuAction[] = [];
    if (
      storedIndex >= visibleLimit ||
      (registeredKeys.length <= visibleLimit && storedIndex > 0)
    ) {
      actions.push({
        id: "move-top",
        label: "Move to top",
        icon: "ArrowUp",
        run: () => {
          const order = movePluginNavPanelToTop(
            normalizedOrder,
            registeredKeys,
            rowKey,
          );
          if (order) onOrderChange(order, storedIndex >= visibleLimit);
        },
      });
    } else if (registeredKeys.length > visibleLimit && storedIndex >= 0) {
      actions.push({
        id: "move-overflow",
        label: "Move to overflow",
        icon: "ChevronsDown",
        run: () => {
          const order = movePluginNavPanelToOverflow(
            normalizedOrder,
            registeredKeys,
            rowKey,
            visibleLimit,
          );
          if (order) onOrderChange(order);
        },
      });
    }
    if (splitEnabled && !isCompactViewport) {
      actions.push({
        id: "open-split",
        label: "Open in split",
        icon: "Columns2",
        run: () => openInSplit(),
      });
    }
    if (panel !== null) {
      actions.push({
        id: "plugin-settings",
        label: "Plugin settings",
        icon: "Settings",
        run: () => {
          onNavigate?.();
          void navigate(
            getPluginDetailRoutePath({
              pluginId: chrome.pluginId,
              view: "installed",
            }),
          );
        },
      });
    }
    return actions;
  }, [
    chrome.pluginId,
    isCompactViewport,
    navigate,
    normalizedOrder,
    onNavigate,
    onOrderChange,
    openInSplit,
    panel,
    registeredKeys,
    rowKey,
    splitEnabled,
    storedIndex,
    visibleLimit,
  ]);
  const menuContext = useMemo<ExperimentalPluginNavPanelMenuContext>(
    () => ({
      pluginId: chrome.pluginId,
      panelId: chrome.id,
      navigate: (subPath) => {
        onNavigate?.();
        void navigate(
          getPluginPanelRoutePath({
            pluginId: chrome.pluginId,
            path: chrome.path,
            subPath,
          }),
        );
      },
      openInSplit: (subPath = "") => {
        openInSplit({ ...content, subPath });
      },
    }),
    [
      chrome.id,
      chrome.path,
      chrome.pluginId,
      content,
      navigate,
      onNavigate,
      openInSplit,
    ],
  );
  const pluginGroups = (panel?.experimental_menu ?? []).filter(
    (group) => group.items.length > 0,
  );
  const menuDefinition: PluginNavRowMenuDefinition | null =
    hostActions.length === 0 && pluginGroups.length === 0
      ? null
      : {
          context: menuContext,
          hostActions,
          pluginGroups,
          pluginDisplayName,
        };
  const SidebarAccessory = panel?.experimental_sidebarAccessory;
  const sidebarAccessory =
    panel !== null && !isCompactViewport && SidebarAccessory !== undefined ? (
      <PluginSlotMount
        key={`${panel.pluginId}/${panel.id}/${panel.generation}`}
        pluginId={panel.pluginId}
        slotKind="navPanelSidebarAccessory"
        slotId={panel.id}
        crashFallback={<></>}
      >
        <SidebarAccessory />
      </PluginSlotMount>
    ) : null;

  return (
    <SidebarNavRowChrome
      {...props}
      rowKey={rowKey}
      title={chrome.title}
      icon={<PluginIcon pluginId={chrome.pluginId} icon={chrome.icon} />}
      isActive={pathname === path || pathname.startsWith(`${path}/`)}
      splitMiniMap={splitIndicator.miniMap}
      accessory={sidebarAccessory}
      menuDefinition={menuDefinition}
      onPointerDown={onPointerDown}
      onSelect={(event) => {
        onNavigate?.();
        if (event.metaKey || event.ctrlKey) {
          openInSplit();
          return;
        }
        void navigate(path);
      }}
    />
  );
}

interface SidebarNavRowChromeProps {
  rowKey: string;
  title: string;
  icon: ReactNode;
  isActive: boolean;
  onSelect(event: ReactMouseEvent<HTMLButtonElement>): void;
  onPointerDown?: PointerEventHandler<HTMLElement>;
  splitMiniMap?: MiniMapSlot[] | null;
  accessory?: ReactNode;
  menuDefinition: PluginNavRowMenuDefinition | null;
  dragBindings?: SidebarSortableDragBindings;
  rowRef?: (element: HTMLElement | null) => void;
  rowStyle?: CSSProperties;
}

function SidebarNavRowChrome({
  title,
  icon,
  isActive,
  onSelect,
  onPointerDown,
  splitMiniMap = null,
  accessory,
  menuDefinition,
  dragBindings,
  rowRef,
  rowStyle,
}: SidebarNavRowChromeProps) {
  const isCompactViewport = useIsCompactViewport();
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const { onKeyDown: _keyboardDragActivator, ...pointerDragListeners } =
    dragBindings?.listeners ?? {};
  const rowContent = (
    <div
      ref={rowRef}
      style={rowStyle}
      className={cn(SIDEBAR_HOVER_ACTIONS_ROW_CLASS, "relative")}
    >
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={cn(
          PROJECT_LIST_ACTION_BUTTON_CLASS,
          "w-full pr-7",
          accessory && "pr-18",
          isActive && "bg-sidebar-accent text-sidebar-foreground",
        )}
        aria-current={isActive ? "page" : undefined}
        ref={dragBindings?.setActivatorNodeRef}
        {...dragBindings?.attributes}
        onPointerDown={(event) => {
          pointerDragListeners.onPointerDown?.(event);
          onPointerDown?.(event);
        }}
        onClick={onSelect}
      >
        {icon}
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <span className="min-w-0 truncate">{title}</span>
          {splitMiniMap ? (
            <SplitPaneMiniMap
              slots={splitMiniMap}
              label={`${title} — open in split`}
            />
          ) : null}
        </span>
      </Button>
      {accessory ? (
        <span
          data-plugin-nav-sidebar-accessory=""
          data-sidebar-hover-actions-open={isActionsOpen ? "true" : undefined}
          className={cn(
            SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
            "pointer-events-none absolute right-1 top-1/2 block min-w-5 max-h-5 max-w-16 -translate-y-1/2 overflow-hidden text-xs text-ellipsis whitespace-nowrap text-center leading-5",
          )}
        >
          {accessory}
        </span>
      ) : null}
      {menuDefinition ? (
        <div
          data-sidebar-hover-actions-open={isActionsOpen ? "true" : undefined}
          data-sidebar-hover-actions-mobile={
            SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE
          }
          className={cn(
            SIDEBAR_HOVER_ACTIONS_CLASS,
            "absolute inset-y-0 right-0 flex items-center",
          )}
        >
          <DropdownMenu onOpenChange={setIsActionsOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`${title} panel options`}
                className={cn(
                  "rounded-md p-0 text-muted-foreground",
                  "data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-foreground",
                  SIDEBAR_MORE_ACTION_TRIGGER_CLASS,
                )}
              >
                <Icon
                  name="MoreHorizontal"
                  className={COARSE_POINTER_ICON_SIZE_CLASS}
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" mobileTitle={`${title} options`}>
              <PluginNavRowMenuItems
                definition={menuDefinition}
                surface="dropdown"
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </div>
  );

  if (isCompactViewport) {
    return (
      <CompactLongPressMenu
        disabled={menuDefinition === null}
        label={`${title} panel options`}
        onOpenChange={setIsActionsOpen}
        items={
          menuDefinition ? (
            <PluginNavRowMenuItems
              definition={menuDefinition}
              surface="dropdown"
            />
          ) : null
        }
      >
        {rowContent}
      </CompactLongPressMenu>
    );
  }
  return (
    <ContextMenu onOpenChange={setIsActionsOpen}>
      <ContextMenuTrigger disabled={menuDefinition === null} asChild>
        {rowContent}
      </ContextMenuTrigger>
      {menuDefinition ? (
        <ContextMenuContent aria-label={`${title} panel options`}>
          <PluginNavRowMenuItems
            definition={menuDefinition}
            surface="context"
          />
        </ContextMenuContent>
      ) : null}
    </ContextMenu>
  );
}
