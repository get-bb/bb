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
import { PluginIcon } from "@/components/plugin/PluginIcon";
import { PROJECT_LIST_ACTION_BUTTON_CLASS } from "@/components/sidebar/ProjectList";
import { getPluginPanelRoutePath } from "@/lib/route-paths";
import { usePluginSlots } from "@/lib/plugin-slots";
import { cn } from "@bb/shared-ui/lib/utils";
import type { PluginNavPanelSlot } from "@/lib/plugin-slots";
import { usePaneContentSplitDrag } from "@/components/sidebar/usePaneContentSplitDrag";
import { usePaneContentSplitIndicator } from "@/components/sidebar/paneContentSplitIndicator";
import type { MiniMapSlot } from "@/components/sidebar/paneContentSplitIndicator";
import { SplitPaneMiniMap } from "@/components/sidebar/SplitPaneMiniMap";
import { SIDEBAR_MORE_ACTION_TRIGGER_CLASS } from "@/components/sidebar/sidebarRowClasses";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
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
  showPluginNavPanel,
} from "./pluginNavSidebarOrder";

type SidebarNavRow = PluginNavPanelSlot;

/**
 * Sidebar entries for plugin `navPanel` slots (plugin design §5.2): one row per
 * entry, styled like primary sidebar actions.
 * Plugin rows navigate to the panel's own route under
 * /plugins/<pluginId>/<path>. Renders nothing while no row qualifies. Only host
 * chrome renders here — a plugin's component mounts on the route
 * (PluginPanelView).
 *
 * Rows are drag-reorderable and can be hidden; hidden rows move into a
 * collapsed "More" disclosure below the list rather than disappearing. Both
 * preferences live in `pluginNavSidebarAtoms`.
 */
export function PluginNavSidebarItems({
  ...props
}: {
  onNavigate?: () => void;
  splitEnabled?: boolean;
}) {
  const { navPanels } = usePluginSlots();
  // Router hooks live in the inner component so hosts without a Router
  // (isolated sidebar tests/stories) can render the empty state.
  if (navPanels.length === 0) return null;
  return <PluginNavSidebarItemList {...props} rows={navPanels} />;
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

  const { visible, hidden, normalizedOrder } = useMemo(
    () =>
      arrangePluginNavPanels({
        panels: rows,
        storedOrder,
        hiddenKeys,
      }),
    [hiddenKeys, rows, storedOrder],
  );

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

function SidebarNavRowItem({ row, ...props }: SidebarNavRowItemProps) {
  return <PluginNavSidebarItem {...props} row={row} />;
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

function PluginNavSidebarItem({
  row,
  pathname,
  onNavigate,
  splitEnabled,
  ...props
}: SidebarNavRowItemProps) {
  const navigate = useNavigate();
  const path = getPluginPanelRoutePath({
    pluginId: row.pluginId,
    path: row.path,
  });
  const content = {
    kind: "plugin-panel",
    pluginId: row.pluginId,
    panelPath: row.path,
    subPath: "",
  } as const;
  const { onPointerDown, openInSplit } = usePaneContentSplitDrag({
    content,
    enabled: splitEnabled,
    label: row.title,
  });
  const splitIndicator = usePaneContentSplitIndicator(content, splitEnabled);

  return (
    <SidebarNavRowChrome
      {...props}
      rowKey={getPluginNavPanelKey(row)}
      title={row.title}
      icon={<PluginIcon pluginId={row.pluginId} icon={row.icon} />}
      isActive={pathname === path || pathname.startsWith(`${path}/`)}
      splitMiniMap={splitIndicator.miniMap}
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
              "w-full pr-7",
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
          <div
            data-sidebar-hover-actions-open={isActionsOpen ? "true" : undefined}
            className={cn(
              SIDEBAR_HOVER_ACTIONS_CLASS,
              "absolute inset-y-0 right-1 flex items-center",
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
