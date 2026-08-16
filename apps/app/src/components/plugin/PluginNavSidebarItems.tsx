import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEventHandler,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAtom } from "jotai";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { PROJECT_LIST_ACTION_BUTTON_CLASS } from "@/components/sidebar/ProjectList";
import { getPluginPanelRoutePath } from "@/lib/route-paths";
import {
  usePluginNavPanelChrome,
  type PluginNavPanelChrome,
} from "@/lib/plugin-nav-panel-chrome";
import { cn } from "@bb/shared-ui/lib/utils";
import type { PluginNavPanelSlot } from "@/lib/plugin-slots";
import { usePaneContentSplitDrag } from "@/components/sidebar/usePaneContentSplitDrag";
import { usePaneContentSplitIndicator } from "@/components/sidebar/paneContentSplitIndicator";
import type { MiniMapSlot } from "@/components/sidebar/paneContentSplitIndicator";
import { SplitPaneMiniMap } from "@/components/sidebar/SplitPaneMiniMap";
import { SIDEBAR_MORE_ACTION_TRIGGER_CLASS } from "@/components/sidebar/sidebarRowClasses";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
  SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions";
import { useSidebarSortable } from "@/components/sidebar/sortableMotion";
import { useSidebarReorderDnd } from "@/components/sidebar/useSidebarReorderDnd";
import type { SidebarSortableDragBindings } from "@/components/sidebar/sortableMotion";
import {
  hiddenPluginNavPanelsAtom,
  pluginNavPanelOrderAtom,
} from "./pluginNavSidebarAtoms";
import {
  arrangePluginNavPanels,
  getPluginNavPanelKey,
  havePluginNavPanelOrdersDiverged,
  hidePluginNavPanel,
  reorderPluginNavPanels,
  seedLeadingNavPanelKeys,
  showPluginNavPanel,
} from "./pluginNavSidebarOrder";

/**
 * Reserved plugin id for rows the host owns rather than a plugin. Real plugin
 * ids come from a plugin manifest name, so they never take this shape.
 */
const BUILTIN_NAV_ROW_PLUGIN_ID = "__builtin__";

/**
 * Order/hidden preference key of the built-in Extensions row. The id stays
 * "tools" so an order or hidden list saved under the row's old name keeps
 * naming the same row.
 */
export const TOOLS_NAV_ROW_KEY = getPluginNavPanelKey({
  pluginId: BUILTIN_NAV_ROW_PLUGIN_ID,
  id: "tools",
});

/**
 * One sidebar nav row. Plugin rows come from `navPanel` slots; the Extensions
 * row is host chrome that shares the list so both obey the same order and hide
 * preferences.
 */
type SidebarNavRow =
  | {
      kind: "tools";
      pluginId: string;
      id: string;
      title: string;
      /** Last visited Extensions route, so the row returns where the user was. */
      routePath: string;
    }
  | {
      kind: "plugin";
      pluginId: string;
      id: string;
      title: string;
      chrome: PluginNavPanelChrome;
      /**
       * The live registration; null while the row is drawn from remembered
       * chrome before plugin frontends have booted (no sidebar accessory).
       */
      panel: PluginNavPanelSlot | null;
    };

/**
 * Sidebar entries for plugin `navPanel` slots (plugin design §5.2) plus the
 * built-in Extensions row: one row per entry, styled like primary sidebar
 * actions.
 * Plugin rows navigate to the panel's own route under
 * /plugins/<pluginId>/<path>. Renders nothing while no row qualifies. The host
 * owns the row chrome; only an optional bounded sidebar accessory mounts here.
 * The panel component itself mounts on the route (PluginPanelView).
 *
 * Rows are drag-reorderable and can be hidden; hidden rows move into a
 * collapsed "More" disclosure below the list rather than disappearing. Both
 * preferences live in `pluginNavSidebarAtoms`.
 */
export function PluginNavSidebarItems({
  toolsRoutePath,
  ...props
}: {
  onNavigate?: () => void;
  splitEnabled?: boolean;
  /** Omit when a host surface should render plugin rows without Extensions. */
  toolsRoutePath?: string;
}) {
  const navPanels = usePluginNavPanelChrome();
  const rows = useMemo<SidebarNavRow[]>(() => {
    const pluginRows = navPanels.map<SidebarNavRow>(({ chrome, panel }) => ({
      kind: "plugin",
      pluginId: chrome.pluginId,
      id: chrome.id,
      title: chrome.title,
      chrome,
      panel,
    }));
    if (toolsRoutePath === undefined) return pluginRows;
    return [
      {
        kind: "tools",
        pluginId: BUILTIN_NAV_ROW_PLUGIN_ID,
        id: "tools",
        title: "Extensions",
        routePath: toolsRoutePath,
      },
      ...pluginRows,
    ];
  }, [navPanels, toolsRoutePath]);
  // Router hooks live in the inner component so hosts without a Router
  // (isolated sidebar tests/stories) can render the empty state.
  if (rows.length === 0) return null;
  return <PluginNavSidebarItemList {...props} rows={rows} />;
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
  const [storedOrder, setStoredOrder] = useAtom(pluginNavPanelOrderAtom);
  const [hiddenKeys, setHiddenKeys] = useAtom(hiddenPluginNavPanelsAtom);
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);

  const { visible, hidden, normalizedOrder } = useMemo(() => {
    // Users who customized their plugin order before the Extensions row joined
    // the list keep it on top instead of finding it at the bottom. Seed only
    // while the row exists, so a build without it saves no key for it.
    const leadingKeys = rows.some((row) => row.kind === "tools")
      ? [TOOLS_NAV_ROW_KEY]
      : [];
    return arrangePluginNavPanels({
      panels: rows,
      storedOrder: seedLeadingNavPanelKeys(storedOrder, leadingKeys),
      hiddenKeys,
    });
  }, [hiddenKeys, rows, storedOrder]);

  // Give newly installed panels a slot in the persisted order. This only ever
  // adds keys: a plugin frontend that has not registered yet keeps its slot, so
  // an early mount cannot save a shortened order over the user's arrangement.
  useEffect(() => {
    if (!havePluginNavPanelOrdersDiverged(storedOrder, normalizedOrder)) return;
    setStoredOrder(normalizedOrder);
  }, [normalizedOrder, setStoredOrder, storedOrder]);

  const visibleKeys = useMemo(
    () => visible.map(getPluginNavPanelKey),
    [visible],
  );

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
        visibleKeys,
      });
      if (nextOrder) setStoredOrder(nextOrder);
    },
    [normalizedOrder, setStoredOrder, visibleKeys],
  );
  const { dndContextProps, onClickCapture } = useSidebarReorderDnd({
    onDragEnd: handleDragEnd,
  });

  const handleHide = useCallback(
    (key: string) => {
      setHiddenKeys((current) => hidePluginNavPanel(current, key));
    },
    [setHiddenKeys],
  );
  const handleShow = useCallback(
    (key: string) => {
      setHiddenKeys((current) => showPluginNavPanel(current, key));
    },
    [setHiddenKeys],
  );

  const reorderDisabled = visible.length < 2;
  const rowProps = {
    onNavigate,
    pathname: location.pathname,
    splitEnabled,
  };

  return (
    <div
      // Pull back most of the primary-actions bottom padding so plugin panel
      // rows keep the same compact 2px rhythm as sidebar thread rows.
      className="-mt-1.5 shrink-0 space-y-0.5 px-2 pb-2 group-data-[collapsible=icon]:hidden"
      data-testid="plugin-nav-sidebar-items"
      onClickCapture={onClickCapture}
    >
      <DndContext {...dndContextProps}>
        <SortableContext
          items={visibleKeys}
          strategy={verticalListSortingStrategy}
        >
          {visible.map((row) => (
            <SortableSidebarNavRow
              key={getPluginNavPanelKey(row)}
              row={row}
              reorderDisabled={reorderDisabled}
              onHide={handleHide}
              {...rowProps}
            />
          ))}
        </SortableContext>
      </DndContext>
      {hidden.length > 0 ? (
        <>
          <PluginNavSidebarOverflowToggle
            count={hidden.length}
            isOpen={isOverflowOpen}
            onToggle={() => setIsOverflowOpen((open) => !open)}
          />
          {isOverflowOpen
            ? hidden.map((row) => (
                <SidebarNavRowItem
                  key={getPluginNavPanelKey(row)}
                  row={row}
                  isHidden
                  onShow={handleShow}
                  {...rowProps}
                />
              ))
            : null}
        </>
      ) : null}
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
        // Quieter than the hidden rows it heads, matching the sidebar's
        // section labels ("Pinned"). Hover still brightens it via the shared
        // interactive-state class.
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
      <span className="min-w-0 truncate text-left">{`More (${count})`}</span>
    </Button>
  );
}

const SortableSidebarNavRow = function SortableSidebarNavRow({
  row,
  reorderDisabled,
  ...props
}: SidebarNavRowItemProps & { reorderDisabled: boolean }) {
  const { dragBindings, setNodeRef, style } = useSidebarSortable({
    id: getPluginNavPanelKey(row),
    disabled: reorderDisabled,
  });
  return (
    <SidebarNavRowItem
      {...props}
      row={row}
      dragBindings={dragBindings}
      rowRef={setNodeRef}
      rowStyle={style}
    />
  );
};

interface SidebarNavRowItemProps {
  row: SidebarNavRow;
  pathname: string;
  onNavigate?: () => void;
  splitEnabled: boolean;
  /** Present for rows parked in the "More" disclosure. */
  isHidden?: boolean;
  onHide?: (key: string) => void;
  onShow?: (key: string) => void;
  dragBindings?: SidebarSortableDragBindings;
  rowRef?: (element: HTMLElement | null) => void;
  rowStyle?: CSSProperties;
}

function SidebarNavRowItem({
  row,
  splitEnabled,
  ...props
}: SidebarNavRowItemProps) {
  return row.kind === "tools" ? (
    <ToolsNavSidebarItem {...props} row={row} />
  ) : (
    <PluginNavSidebarItem {...props} row={row} splitEnabled={splitEnabled} />
  );
}

type PluginNavRowMenuSurface = "context" | "dropdown";

function PluginNavRowVisibilityMenuItem({
  isHidden,
  onSelect,
  surface,
}: {
  isHidden: boolean;
  onSelect: () => void;
  surface: PluginNavRowMenuSurface;
}) {
  const content = (
    <>
      <Icon name={isHidden ? "Eye" : "EyeOff"} aria-hidden="true" />
      {isHidden ? "Show in sidebar" : "Hide from sidebar"}
    </>
  );
  return surface === "context" ? (
    <ContextMenuItem onSelect={onSelect}>{content}</ContextMenuItem>
  ) : (
    <DropdownMenuItem onSelect={onSelect}>{content}</DropdownMenuItem>
  );
}

/**
 * The Extensions row's glyph. Resting is the toolbox; hovering (or focusing)
 * the row swaps in the tool case.
 *
 * Both glyphs are always rendered into one grid cell and only their opacity
 * changes, so the icon box is the same size in both states and the swap cannot
 * shift the row's text. The trigger is the shared row-hover CSS the sidebar's
 * other affordances already use rather than React hover state, so it stays a
 * paint-only change and matches keyboard focus for free.
 */
function ToolsNavSidebarItemIcon() {
  return (
    <span className="bb-sidebar-row-icon-swap shrink-0" aria-hidden="true">
      <Icon name="Toolbox" className="bb-sidebar-row-icon-rest" />
      <Icon name="ToolCase" className="bb-sidebar-row-icon-hover" />
    </span>
  );
}

/**
 * The Extensions row. It has no split-pane content kind, so it navigates in
 * place and draws no mini-map; everything else matches a plugin row.
 */
function ToolsNavSidebarItem({
  row,
  pathname: _pathname,
  onNavigate,
  ...props
}: Omit<SidebarNavRowItemProps, "row" | "splitEnabled"> & {
  row: Extract<SidebarNavRow, { kind: "tools" }>;
}) {
  const navigate = useNavigate();
  return (
    <SidebarNavRowChrome
      {...props}
      rowKey={getPluginNavPanelKey(row)}
      title={row.title}
      icon={<ToolsNavSidebarItemIcon />}
      // Never active: AppLayout swaps AppSidebar out for ToolsSidebar on every
      // Extensions route, so this row is only on screen while Extensions is
      // closed.
      isActive={false}
      onSelect={() => {
        onNavigate?.();
        void navigate(row.routePath);
      }}
    />
  );
}

function PluginNavSidebarItem({
  row,
  pathname,
  onNavigate,
  splitEnabled,
  ...props
}: Omit<SidebarNavRowItemProps, "row"> & {
  row: Extract<SidebarNavRow, { kind: "plugin" }>;
}) {
  const { chrome, panel } = row;
  const navigate = useNavigate();
  const isCompactViewport = useIsCompactViewport();
  const path = getPluginPanelRoutePath({
    pluginId: chrome.pluginId,
    path: chrome.path,
  });
  const content = {
    kind: "plugin-panel",
    pluginId: chrome.pluginId,
    panelPath: chrome.path,
    subPath: "",
  } as const;
  const { onPointerDown, openInSplit } = usePaneContentSplitDrag({
    content,
    enabled: splitEnabled,
    label: chrome.title,
  });
  const splitIndicator = usePaneContentSplitIndicator(content, splitEnabled);
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
      rowKey={getPluginNavPanelKey(row)}
      title={chrome.title}
      icon={<PluginIcon pluginId={chrome.pluginId} icon={chrome.icon} />}
      isActive={pathname === path || pathname.startsWith(`${path}/`)}
      splitMiniMap={splitIndicator.miniMap}
      accessory={sidebarAccessory}
      // Split-drag initiator; engages only when the pointer leaves the
      // sidebar, so it coexists with the dnd-kit reorder listeners.
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
  onSelect: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onPointerDown?: PointerEventHandler<HTMLElement>;
  splitMiniMap?: MiniMapSlot[] | null;
  accessory?: ReactNode;
  isHidden?: boolean;
  onHide?: (key: string) => void;
  onShow?: (key: string) => void;
  dragBindings?: SidebarSortableDragBindings;
  rowRef?: (element: HTMLElement | null) => void;
  rowStyle?: CSSProperties;
}

/** Shared chrome for every sidebar nav row: button, hide menus, drag handle. */
function SidebarNavRowChrome({
  rowKey,
  title,
  icon,
  isActive,
  onSelect,
  onPointerDown,
  splitMiniMap = null,
  accessory,
  isHidden = false,
  onHide,
  onShow,
  dragBindings,
  rowRef,
  rowStyle,
}: SidebarNavRowChromeProps) {
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  // dnd-kit's KeyboardSensor activates on Space/Enter and preventDefaults them.
  // On a real <button> row that would swallow Enter-to-open, so the row keeps
  // only the pointer/touch drag activators. Reordering stays a pointer gesture.
  const { onKeyDown: _keyboardDragActivator, ...pointerDragListeners } =
    dragBindings?.listeners ?? {};
  const visibilityItem = (surface: PluginNavRowMenuSurface): ReactNode => (
    <PluginNavRowVisibilityMenuItem
      surface={surface}
      isHidden={isHidden}
      onSelect={() => (isHidden ? onShow?.(rowKey) : onHide?.(rowKey))}
    />
  );

  return (
    <ContextMenu onOpenChange={setIsActionsOpen}>
      <ContextMenuTrigger asChild>
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
              // Accessory-less rows keep their existing title width. A row
              // with one reserves its 4rem trailing value; the options trigger
              // replaces that value on hover rather than taking more space.
              "w-full pr-7",
              accessory && "pr-18",
              isActive && "bg-sidebar-accent text-sidebar-foreground",
              isHidden && "text-subtle-foreground",
            )}
            aria-current={isActive ? "page" : undefined}
            ref={dragBindings?.setActivatorNodeRef}
            {...dragBindings?.attributes}
            {...pointerDragListeners}
            onPointerDown={onPointerDown}
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
              data-sidebar-hover-actions-open={
                isActionsOpen ? "true" : undefined
              }
              // Share the action column with the options trigger. A short
              // value centers on the trigger glyph; a longer value grows left
              // up to 4rem. The shared fade class hides it on hover/focus or
              // while the menu is open without unmounting plugin state.
              className={cn(
                SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
                "pointer-events-none absolute right-1 top-1/2 block min-w-5 max-h-5 max-w-16 -translate-y-1/2 overflow-hidden text-xs text-ellipsis whitespace-nowrap text-center leading-5",
              )}
            >
              {accessory}
            </span>
          ) : null}
          <div
            data-sidebar-hover-actions-open={isActionsOpen ? "true" : undefined}
            data-sidebar-hover-actions-mobile={
              SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE
            }
            className={cn(
              SIDEBAR_HOVER_ACTIONS_CLASS,
              // right-0 (not right-1): the trigger's own m-1 supplies the inset,
              // so the glyph centers on the same column as the sidebar search
              // icon above and the thread-row more menus below.
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
              <DropdownMenuContent align="end">
                {visibilityItem("dropdown")}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={`${title} panel options`}>
        {visibilityItem("context")}
      </ContextMenuContent>
    </ContextMenu>
  );
}
