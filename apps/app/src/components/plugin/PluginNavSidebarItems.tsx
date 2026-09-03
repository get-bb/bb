import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEventHandler,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAtom } from "jotai";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { FilterHorizontalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Button } from "@bb/shared-ui/button";
import { Checkbox } from "@bb/shared-ui/checkbox";
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
import {
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@bb/shared-ui/popover";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { PROJECT_LIST_ACTION_BUTTON_CLASS } from "@/components/sidebar/ProjectList";
import {
  AUTOMATIONS_PLUGIN_ID,
  getPluginPanelRoutePath,
} from "@/lib/route-paths";
import {
  usePluginNavPanelChrome,
  type PluginNavPanelChrome,
  type PluginNavPanelChromeEntry,
} from "@/lib/plugin-nav-panel-chrome";
import { cn } from "@bb/shared-ui/lib/utils";
import type { PluginNavPanelSlot } from "@/lib/plugin-slots";
import {
  usePaneContentSplitActions,
  usePaneContentSplitDrag,
} from "@/components/sidebar/usePaneContentSplitDrag";
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
  pluginNavPanelOrderAtom,
  pluginNavVisiblePanelKeysAtom,
} from "./pluginNavSidebarAtoms";
import {
  arrangePluginNavPanelPreferences,
  BUILT_IN_SIDEBAR_NAVIGATION_KEYS,
  getPluginNavPanelKey,
  togglePluginNavPanelVisibility,
} from "./pluginNavSidebarOrder";
import { haveSameOrder, reorderStoredOrder } from "@/lib/stored-order";

const PLUGIN_NAV_VISIBLE_LIMIT = 3;

type PluginSidebarNavRow = {
  kind: "plugin";
  pluginId: string;
  id: string;
  title: string;
  chrome: PluginNavPanelChrome;
  panel: PluginNavPanelSlot | null;
};

export interface BuiltInSidebarNavEntry {
  kind: "built-in";
  pluginId: "__bb__";
  id: string;
  title: string;
  icon: ReactNode;
  content: ReactNode;
  disabled?: boolean;
  onActivate: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

type SidebarNavRow = PluginSidebarNavRow | BuiltInSidebarNavEntry;

function isPluginSidebarNavRow(
  row: SidebarNavRow,
): row is PluginSidebarNavRow {
  return row.kind === "plugin";
}

export function PluginNavSidebarItems(props: {
  builtInEntries?: readonly BuiltInSidebarNavEntry[];
  compactCustomizeMode?: boolean;
  entries?: readonly PluginNavPanelChromeEntry[];
  leadingOrderKeys?: readonly string[];
  onCompactCustomizeModeChange?: (isCustomizing: boolean) => void;
  onNavigate?: () => void;
  splitEnabled?: boolean;
}) {
  const discoveredEntries = usePluginNavPanelChrome();
  const entries = props.entries ?? discoveredEntries;
  const rows = useMemo<SidebarNavRow[]>(
    () => [
      ...(props.builtInEntries ?? []),
      ...entries.map(({ chrome, panel }) => ({
        kind: "plugin" as const,
        pluginId:
          chrome.pluginId === AUTOMATIONS_PLUGIN_ID
            ? "__bb__"
            : chrome.pluginId,
        id:
          chrome.pluginId === AUTOMATIONS_PLUGIN_ID
            ? "automations"
            : chrome.id,
        title: chrome.title,
        chrome,
        panel,
      })),
    ],
    [entries, props.builtInEntries],
  );
  const leadingOrderKeys = useMemo(
    () =>
      props.leadingOrderKeys ??
      (props.builtInEntries ?? []).map(getPluginNavPanelKey),
    [props.builtInEntries, props.leadingOrderKeys],
  );
  if (rows.length === 0) return null;
  return (
    <PluginNavSidebarItemList
      rows={rows}
      leadingOrderKeys={leadingOrderKeys}
      splitEnabled={props.splitEnabled ?? false}
      {...(props.compactCustomizeMode === undefined
        ? {}
        : { compactCustomizeMode: props.compactCustomizeMode })}
      {...(props.onCompactCustomizeModeChange
        ? {
            onCompactCustomizeModeChange:
              props.onCompactCustomizeModeChange,
          }
        : {})}
      {...(props.onNavigate ? { onNavigate: props.onNavigate } : {})}
    />
  );
}

function PluginNavSidebarItemList({
  compactCustomizeMode,
  leadingOrderKeys,
  onCompactCustomizeModeChange,
  onNavigate,
  rows,
  splitEnabled = false,
}: {
  compactCustomizeMode?: boolean;
  leadingOrderKeys: readonly string[];
  onCompactCustomizeModeChange?: (isCustomizing: boolean) => void;
  onNavigate?: () => void;
  rows: readonly SidebarNavRow[];
  splitEnabled?: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const isCompactViewport = useIsCompactViewport();
  const splitActions = usePaneContentSplitActions();
  const [storedOrder, setStoredOrder] = useAtom(pluginNavPanelOrderAtom);
  const [storedVisibleKeys, setStoredVisibleKeys] = useAtom(
    pluginNavVisiblePanelKeysAtom,
  );
  const [uncontrolledCustomizeOpen, setUncontrolledCustomizeOpen] =
    useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const restoreCustomizeTriggerFocusRef = useRef(false);
  const isCustomizeOpen =
    isCompactViewport && compactCustomizeMode !== undefined
      ? compactCustomizeMode
      : uncontrolledCustomizeOpen;
  const setIsCustomizeOpen = useCallback(
    (isOpen: boolean) => {
      if (!isCompactViewport || compactCustomizeMode === undefined) {
        setUncontrolledCustomizeOpen(isOpen);
      }
      if (isCompactViewport) {
        onCompactCustomizeModeChange?.(isOpen);
      }
    },
    [
      compactCustomizeMode,
      isCompactViewport,
      onCompactCustomizeModeChange,
    ],
  );
  const defaultVisibleKeys = useMemo(
    () =>
      leadingOrderKeys.filter((key) =>
        rows.some((row) => getPluginNavPanelKey(row) === key),
      ),
    [leadingOrderKeys, rows],
  );
  const newLeadingKeys = useMemo(
    () => leadingOrderKeys.filter((key) => !storedOrder.includes(key)),
    [leadingOrderKeys, storedOrder],
  );
  const {
    ordered,
    normalizedOrder,
    normalizedVisibleKeys,
    visible,
    visibleKeys,
  } = useMemo(
    () =>
      arrangePluginNavPanelPreferences({
        panels: rows,
        storedOrder:
          newLeadingKeys.length === 0
            ? storedOrder
            : [...newLeadingKeys, ...storedOrder],
        storedVisibleKeys:
          storedVisibleKeys === null || newLeadingKeys.length === 0
            ? storedVisibleKeys
            : [...newLeadingKeys, ...storedVisibleKeys],
        defaultVisibleKeys,
        defaultVisibleCount: PLUGIN_NAV_VISIBLE_LIMIT,
      }),
    [
      defaultVisibleKeys,
      newLeadingKeys,
      rows,
      storedOrder,
      storedVisibleKeys,
    ],
  );

  useEffect(() => {
    if (haveSameOrder(storedOrder, normalizedOrder)) return;
    setStoredOrder(normalizedOrder);
  }, [normalizedOrder, setStoredOrder, storedOrder]);

  useEffect(() => {
    if (
      storedVisibleKeys === null ||
      normalizedVisibleKeys === null ||
      haveSameOrder(storedVisibleKeys, normalizedVisibleKeys)
    ) {
      return;
    }
    setStoredVisibleKeys(normalizedVisibleKeys);
  }, [normalizedVisibleKeys, setStoredVisibleKeys, storedVisibleKeys]);

  const orderedKeys = useMemo(
    () => ordered.map(getPluginNavPanelKey),
    [ordered],
  );

  const setPanelVisible = useCallback(
    (key: string, isVisible: boolean) => {
      setStoredVisibleKeys(
        togglePluginNavPanelVisibility(
          normalizedVisibleKeys ?? visibleKeys,
          key,
          isVisible,
        ),
      );
    },
    [normalizedVisibleKeys, setStoredVisibleKeys, visibleKeys],
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
      const nextOrder = reorderStoredOrder({
        activeId: event.active.id,
        overId: event.over.id,
        order: normalizedOrder,
        visibleIds: visibleKeys,
      });
      if (nextOrder) setStoredOrder(nextOrder);
    },
    [normalizedOrder, setStoredOrder, visibleKeys],
  );
  const { dndContextProps, onClickCapture } = useSidebarReorderDnd({
    onDragEnd: handleDragEnd,
  });

  const handleCustomizeDragEnd = useCallback(
    (activeKey: string, overKey: string) => {
      const nextOrder = reorderStoredOrder({
        activeId: activeKey,
        overId: overKey,
        order: normalizedOrder,
        visibleIds: orderedKeys,
      });
      if (!nextOrder) return;
      if (storedVisibleKeys === null) setStoredVisibleKeys(visibleKeys);
      setStoredOrder(nextOrder);
    },
    [
      normalizedOrder,
      orderedKeys,
      setStoredOrder,
      setStoredVisibleKeys,
      storedVisibleKeys,
      visibleKeys,
    ],
  );

  const reorderDisabled = ordered.length < 2;
  const rowProps = {
    onNavigate,
    pathname: location.pathname,
    splitEnabled,
    onHide: (key: string) => setPanelVisible(key, false),
  };

  const handleActivate = useCallback(
    (row: SidebarNavRow, event: ReactMouseEvent<HTMLButtonElement>) => {
      if (!isPluginSidebarNavRow(row)) {
        row.onActivate(event);
        return;
      }
      if (event.metaKey || event.ctrlKey) {
        splitActions.openInSplit({
          content: {
            kind: "plugin-panel",
            pluginId: row.chrome.pluginId,
            panelPath: row.chrome.path,
            subPath: "",
          },
          enabled: splitEnabled,
          label: row.title,
          onNavigate,
        });
        return;
      }
      onNavigate?.();
      void navigate(
        getPluginPanelRoutePath({
          pluginId: row.chrome.pluginId,
          path: row.chrome.path,
        }),
      );
    },
    [navigate, onNavigate, splitActions, splitEnabled],
  );

  useEffect(() => {
    if (isCustomizeOpen || !restoreCustomizeTriggerFocusRef.current) return;
    restoreCustomizeTriggerFocusRef.current = false;
    containerRef.current
      ?.querySelector<HTMLElement>(
        '[data-testid="sidebar-navigation-customize-trigger"]',
      )
      ?.focus();
  }, [isCustomizeOpen]);

  if (isCompactViewport && isCustomizeOpen) {
    return (
      <div
        ref={containerRef}
        className="flex min-h-0 flex-1 flex-col px-2 py-2 group-data-[collapsible=icon]:hidden"
        data-testid="plugin-nav-sidebar-items"
        data-sidebar-navigation-customize-mode="true"
      >
        <SidebarNavigationInlineCustomizeMode
          rows={ordered}
          visibleKeys={visibleKeys}
          onActivate={handleActivate}
          onBack={() => {
            restoreCustomizeTriggerFocusRef.current = true;
            setIsCustomizeOpen(false);
          }}
          onExit={() => setIsCustomizeOpen(false)}
          onDragEnd={handleCustomizeDragEnd}
          onVisibleChange={setPanelVisible}
        />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="shrink-0 space-y-0.5 px-2 py-2 group-data-[collapsible=icon]:hidden"
      data-testid="plugin-nav-sidebar-items"
      onClickCapture={onClickCapture}
    >
      {!visibleKeys.includes(BUILT_IN_SIDEBAR_NAVIGATION_KEYS.newThread) ? (
        <div className="flex min-w-0 items-center justify-end">
          <SidebarNavigationCustomizeMenu
            isOpen={isCustomizeOpen}
            rows={ordered}
            visibleKeys={visibleKeys}
            onActivate={handleActivate}
            onDragEnd={handleCustomizeDragEnd}
            onOpenChange={setIsCustomizeOpen}
            onVisibleChange={setPanelVisible}
          />
        </div>
      ) : null}
      <DndContext {...dndContextProps}>
        <SortableContext
          items={visibleKeys}
          strategy={verticalListSortingStrategy}
        >
          {visible.map((row) =>
            isPluginSidebarNavRow(row) ? (
              <SortableSidebarNavRow
                key={getPluginNavPanelKey(row)}
                row={row}
                reorderDisabled={reorderDisabled}
                {...rowProps}
              />
            ) : (
              <div
                key={getPluginNavPanelKey(row)}
                data-sidebar-navigation-item={getPluginNavPanelKey(row)}
              >
                {getPluginNavPanelKey(row) ===
                BUILT_IN_SIDEBAR_NAVIGATION_KEYS.newThread ? (
                  <div
                    className="flex min-w-0 items-center gap-0.5"
                    data-sidebar-navigation-primary-row
                  >
                    <div className="min-w-0 flex-1">{row.content}</div>
                    <SidebarNavigationCustomizeMenu
                      isOpen={isCustomizeOpen}
                      rows={ordered}
                      visibleKeys={visibleKeys}
                      onActivate={handleActivate}
                      onDragEnd={handleCustomizeDragEnd}
                      onOpenChange={setIsCustomizeOpen}
                      onVisibleChange={setPanelVisible}
                    />
                  </div>
                ) : (
                  row.content
                )}
              </div>
            ),
          )}
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SidebarNavigationInlineCustomizeMode({
  onActivate,
  onBack,
  onDragEnd,
  onExit,
  onVisibleChange,
  rows,
  visibleKeys,
}: {
  onActivate: (
    row: SidebarNavRow,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => void;
  onBack: () => void;
  onDragEnd: (activeKey: string, overKey: string) => void;
  onExit: () => void;
  onVisibleChange: (key: string, visible: boolean) => void;
  rows: readonly SidebarNavRow[];
  visibleKeys: readonly string[];
}) {
  const backButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    backButtonRef.current?.focus();
  }, []);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="sidebar-navigation-customize-inline"
    >
      <div className="flex shrink-0 items-center gap-1">
        <Button
          ref={backButtonRef}
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Back to sidebar"
          className={cn(
            COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
            "shrink-0 text-muted-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2",
          )}
          onClick={onBack}
        >
          <Icon name="ChevronLeft" aria-hidden="true" />
        </Button>
        <div className={cn("min-w-0 flex-1 px-1", CHROME_SECTION_LABEL_CLASS)}>
          Customize sidebar
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pt-1">
        <SidebarNavigationCustomizeList
          rows={rows}
          visibleKeys={visibleKeys}
          surface="sidebar"
          onActivate={(row, event) => {
            onActivate(row, event);
            onExit();
          }}
          onDragEnd={onDragEnd}
          onVisibleChange={onVisibleChange}
        />
      </div>
    </div>
  );
}

function SidebarNavigationCustomizeMenu({
  isOpen,
  onActivate,
  onDragEnd,
  onOpenChange,
  onVisibleChange,
  rows,
  visibleKeys,
}: {
  isOpen: boolean;
  onActivate: (
    row: SidebarNavRow,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => void;
  onDragEnd: (activeKey: string, overKey: string) => void;
  onOpenChange: (isOpen: boolean) => void;
  onVisibleChange: (key: string, visible: boolean) => void;
  rows: readonly SidebarNavRow[];
  visibleKeys: readonly string[];
}) {
  const isCompactViewport = useIsCompactViewport();
  const contentRef = useRef<HTMLDivElement>(null);
  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Customize sidebar navigation"
      aria-expanded={isCompactViewport ? isOpen : undefined}
      className={cn(
        COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
        "shrink-0 text-subtle-foreground opacity-60 ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-foreground hover:opacity-100 focus-visible:ring-2 focus-visible:opacity-100 max-md:pointer-coarse:[&_svg]:size-5 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-foreground data-[state=open]:opacity-100",
      )}
      data-testid="sidebar-navigation-customize-trigger"
      {...(isCompactViewport
        ? { onClick: () => onOpenChange(true) }
        : {})}
    >
      <HugeiconsIcon icon={FilterHorizontalIcon} aria-hidden="true" />
    </Button>
  );

  if (isCompactViewport) {
    return <span className="inline-flex shrink-0">{trigger}</span>;
  }

  return (
    <Popover open={isOpen} onOpenChange={onOpenChange}>
      <span className="inline-flex shrink-0">
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      </span>
      <PopoverContent
        ref={contentRef}
        side="right"
        align="start"
        sideOffset={8}
        className="w-52 p-2"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current
            ?.querySelector<HTMLElement>(
              "[data-sidebar-navigation-customize-launch]",
            )
            ?.focus();
        }}
      >
        <div className={cn("px-2 py-1", CHROME_SECTION_LABEL_CLASS)}>
          Customize sidebar
        </div>
        <SidebarNavigationCustomizeList
          rows={rows}
          visibleKeys={visibleKeys}
          onActivate={(row, event) => {
            onActivate(row, event);
            onOpenChange(false);
          }}
          onDragEnd={onDragEnd}
          onVisibleChange={onVisibleChange}
        />
      </PopoverContent>
    </Popover>
  );
}

function SidebarNavigationCustomizeList({
  onActivate,
  onDragEnd,
  onVisibleChange,
  rows,
  surface = "popover",
  visibleKeys,
}: {
  onActivate: (
    row: SidebarNavRow,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => void;
  onDragEnd: (activeKey: string, overKey: string) => void;
  onVisibleChange: (key: string, visible: boolean) => void;
  rows: readonly SidebarNavRow[];
  surface?: "popover" | "sidebar";
  visibleKeys: readonly string[];
}) {
  const orderedKeys = useMemo(
    () => rows.map(getPluginNavPanelKey),
    [rows],
  );
  const visibleKeySet = useMemo(() => new Set(visibleKeys), [visibleKeys]);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (
        typeof event.active.id !== "string" ||
        typeof event.over?.id !== "string"
      ) {
        return;
      }
      onDragEnd(event.active.id, event.over.id);
    },
    [onDragEnd],
  );
  const { dndContextProps, onClickCapture } = useSidebarReorderDnd({
    onDragEnd: handleDragEnd,
  });

  return (
    <div
      role="list"
      aria-label="Sidebar navigation"
      className="space-y-0.5"
      onClickCapture={onClickCapture}
    >
      <DndContext {...dndContextProps}>
        <SortableContext
          items={orderedKeys}
          strategy={verticalListSortingStrategy}
        >
          {rows.map((row) => {
            const key = getPluginNavPanelKey(row);
            return (
              <SortableSidebarNavigationCustomizeItem
                key={key}
                row={row}
                checked={visibleKeySet.has(key)}
                reorderDisabled={rows.length < 2}
                surface={surface}
                onActivate={(event) => onActivate(row, event)}
                onCheckedChange={(checked) =>
                  onVisibleChange(key, checked)
                }
              />
            );
          })}
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableSidebarNavigationCustomizeItem({
  checked,
  onActivate,
  onCheckedChange,
  reorderDisabled,
  row,
  surface,
}: {
  checked: boolean;
  onActivate: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onCheckedChange: (checked: boolean) => void;
  reorderDisabled: boolean;
  row: SidebarNavRow;
  surface: "popover" | "sidebar";
}) {
  const panelKey = getPluginNavPanelKey(row);
  const checkboxId = useId();
  const { dragBindings, setNodeRef, style } = useSidebarSortable({
    id: panelKey,
    disabled: reorderDisabled,
  });
  const icon = isPluginSidebarNavRow(row) ? (
    <PluginIcon pluginId={row.chrome.pluginId} icon={row.chrome.icon} />
  ) : (
    row.icon
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      role="listitem"
      className={cn(
        "group flex min-h-7 items-center rounded-md px-1 text-xs",
        surface === "sidebar"
          ? cn(
              COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
              "text-sidebar-foreground hover:bg-sidebar-accent focus-within:bg-sidebar-accent",
            )
          : "text-popover-foreground hover:bg-state-hover focus-within:bg-state-hover",
      )}
      data-plugin-nav-customize-item={panelKey}
    >
      <button
        type="button"
        ref={dragBindings.setActivatorNodeRef}
        {...dragBindings.attributes}
        {...dragBindings.listeners}
        aria-label={`Reorder ${row.title}`}
        className={cn(
          "flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-subtle-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:cursor-grabbing",
          surface === "sidebar"
            ? cn(
                COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
                "hover:text-sidebar-foreground focus-visible:text-sidebar-foreground",
              )
            : "hover:text-popover-foreground focus-visible:text-popover-foreground",
        )}
        onClick={(event) => event.stopPropagation()}
        data-plugin-nav-customize-drag-handle={panelKey}
      >
        <Icon
          name="DragDropVertical"
          className={COARSE_POINTER_ICON_SIZE_CLASS}
        />
      </button>
      <button
        type="button"
        disabled={!isPluginSidebarNavRow(row) && row.disabled}
        className={cn(
          "flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm px-1 text-left outline-none disabled:cursor-default disabled:opacity-50",
          surface === "sidebar"
            ? COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS
            : "min-h-7",
        )}
        onClick={onActivate}
        data-sidebar-navigation-customize-launch={panelKey}
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{row.title}</span>
      </button>
      {surface === "sidebar" ? (
        <label
          htmlFor={checkboxId}
          className={cn(
            COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
            "flex shrink-0 cursor-pointer items-center justify-center",
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <Checkbox
            id={checkboxId}
            checked={checked}
            aria-label={`Show ${row.title} in sidebar`}
            onCheckedChange={(nextChecked) =>
              onCheckedChange(nextChecked === true)
            }
            data-plugin-nav-customize-checkbox={panelKey}
          />
        </label>
      ) : (
        <Checkbox
          checked={checked}
          aria-label={`Show ${row.title} in sidebar`}
          onCheckedChange={(nextChecked) =>
            onCheckedChange(nextChecked === true)
          }
          onClick={(event) => event.stopPropagation()}
          data-plugin-nav-customize-checkbox={panelKey}
          className="mx-1"
        />
      )}
    </div>
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
  row: PluginSidebarNavRow;
  pathname: string;
  onNavigate?: () => void;
  splitEnabled: boolean;
  onHide?: (key: string) => void;
  dragBindings?: SidebarSortableDragBindings;
  rowRef?: (element: HTMLElement | null) => void;
  rowStyle?: CSSProperties;
}

function SidebarNavRowItem({
  row,
  splitEnabled,
  ...props
}: SidebarNavRowItemProps) {
  return (
    <PluginNavSidebarItem {...props} row={row} splitEnabled={splitEnabled} />
  );
}

type PluginNavRowMenuSurface = "context" | "dropdown";

function PluginNavRowVisibilityMenuItem({
  onSelect,
  surface,
}: {
  onSelect: () => void;
  surface: PluginNavRowMenuSurface;
}) {
  const content = (
    <>
      <Icon name="EyeOff" aria-hidden="true" />
      Hide from sidebar
    </>
  );
  return surface === "context" ? (
    <ContextMenuItem onSelect={onSelect}>{content}</ContextMenuItem>
  ) : (
    <DropdownMenuItem onSelect={onSelect}>{content}</DropdownMenuItem>
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
      <span className="min-w-0 truncate text-left">Extensions</span>
    </Button>
  );
}

function PluginNavSidebarItem({
  row,
  pathname,
  onNavigate,
  splitEnabled,
  ...props
}: SidebarNavRowItemProps) {
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
  const rowKey = getPluginNavPanelKey(row);
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
      rowKey={rowKey}
      title={chrome.title}
      icon={<PluginIcon pluginId={chrome.pluginId} icon={chrome.icon} />}
      isActive={pathname === path || pathname.startsWith(`${path}/`)}
      splitMiniMap={splitIndicator.miniMap}
      accessory={sidebarAccessory}
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
  onHide?: (key: string) => void;
  splitMiniMap?: MiniMapSlot[] | null;
  accessory?: ReactNode;
  dragBindings?: SidebarSortableDragBindings;
  rowRef?: (element: HTMLElement | null) => void;
  rowStyle?: CSSProperties;
}

function SidebarNavRowChrome({
  rowKey,
  title,
  icon,
  isActive,
  onSelect,
  onPointerDown,
  onHide,
  splitMiniMap = null,
  accessory,
  dragBindings,
  rowRef,
  rowStyle,
}: SidebarNavRowChromeProps) {
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const { onKeyDown: _keyboardDragActivator, ...pointerDragListeners } =
    dragBindings?.listeners ?? {};
  const visibilityItem = (surface: PluginNavRowMenuSurface): ReactNode => (
    <PluginNavRowVisibilityMenuItem
      surface={surface}
      onSelect={() => onHide?.(rowKey)}
    />
  );

  return (
    <ContextMenu onOpenChange={setIsActionsOpen}>
      <ContextMenuTrigger asChild>
        <div
          ref={rowRef}
          style={rowStyle}
          className={cn(SIDEBAR_HOVER_ACTIONS_ROW_CLASS, "relative")}
          data-sidebar-navigation-item={rowKey}
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
