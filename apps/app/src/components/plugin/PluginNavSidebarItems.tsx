import {
  useCallback,
  useEffect,
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
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import {
  SidebarMore,
  SidebarOverflowItem,
  SidebarVisibilityCustomize,
  SidebarVisibilityActionContent,
  SidebarCustomizeActionContent,
  type SidebarVisibilityItem,
  type SidebarActivationModifiers as SidebarNavActivationModifiers,
} from "@/components/sidebar/SidebarVisibilityControls";
import {
  AUTOMATIONS_PLUGIN_ID,
  getPluginDetailRoutePath,
  getPluginPanelRoutePath,
} from "@/lib/route-paths";
import {
  usePluginNavPanelChrome,
  type PluginNavPanelChrome,
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
import {
  PROJECT_LIST_ACTION_BUTTON_CLASS,
  SIDEBAR_CONTROL_STATE_CLASS,
  SIDEBAR_MORE_ACTION_TRIGGER_CLASS,
} from "@/components/sidebar/sidebarRowClasses";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
  SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions";
import { useSidebarSortable } from "@/components/sidebar/sortableMotion";
import { useSidebarReorderDnd } from "@/components/sidebar/useSidebarReorderDnd";
import type { SidebarSortableDragBindings } from "@/components/sidebar/sortableMotion";
import { appToast } from "@/components/ui/app-toast";
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import { useSetPluginEnabled } from "./useSetPluginEnabled";
import { appQueryClient } from "@/lib/app-query-client";
import {
  pluginNavPanelOrderAtom,
  pluginNavVisiblePanelKeysAtom,
} from "./pluginNavSidebarAtoms";
import {
  arrangePluginNavPanelPreferences,
  DEFAULT_HIDDEN_SIDEBAR_NAVIGATION_KEYS,
  getPluginNavPanelKey,
  seedSkillsNavigationPreference,
  togglePluginNavPanelVisibility,
} from "./pluginNavSidebarOrder";
import { haveSameOrder, reorderStoredOrder } from "@/lib/stored-order";
import { openPluginDetailsInWorkspace } from "./plugin-detail-opener";
import type { PaneContent } from "@/lib/split-layout";

const MORE_TRIGGER_TEST_ID = "sidebar-navigation-more-trigger";

export type { SidebarActivationModifiers as SidebarNavActivationModifiers } from "@/components/sidebar/SidebarVisibilityControls";

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
  splitContent?: PaneContent;
  onActivate: (event: SidebarNavActivationModifiers) => void;
}

type SidebarNavRow = PluginSidebarNavRow | BuiltInSidebarNavEntry;

function isPluginSidebarNavRow(row: SidebarNavRow): row is PluginSidebarNavRow {
  return row.kind === "plugin";
}

export function PluginNavSidebarItems(props: {
  builtInEntries?: readonly BuiltInSidebarNavEntry[];
  compactCustomizeMode?: boolean;
  leadingOrderKeys?: readonly string[];
  onCompactCustomizeModeChange?: (isCustomizing: boolean) => void;
  onNavigate?: () => void;
  splitEnabled?: boolean;
}) {
  const entries = usePluginNavPanelChrome();
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
          chrome.pluginId === AUTOMATIONS_PLUGIN_ID ? "automations" : chrome.id,
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
            onCompactCustomizeModeChange: props.onCompactCustomizeModeChange,
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
  const setEnabled = useSetPluginEnabled();
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
    [compactCustomizeMode, isCompactViewport, onCompactCustomizeModeChange],
  );
  const seededPreferences = useMemo(
    () => seedSkillsNavigationPreference(storedOrder, storedVisibleKeys),
    [storedOrder, storedVisibleKeys],
  );
  const [disablePending, setDisablePending] = useState(false);
  const handleDisable = useCallback(
    async (row: PluginSidebarNavRow) => {
      const pluginId = row.chrome.pluginId;
      setDisablePending(true);
      try {
        await setEnabled(pluginId, false, onNavigate);
        appToast.success(`${row.title} disabled`);
      } catch (error) {
        appToast.error(`Failed to disable ${row.title}`, {
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await invalidatePluginList({ queryClient: appQueryClient });
        setDisablePending(false);
      }
    },
    [onNavigate, setEnabled],
  );
  const newLeadingKeys = useMemo(
    () =>
      leadingOrderKeys.filter((key) => !seededPreferences.order.includes(key)),
    [leadingOrderKeys, seededPreferences.order],
  );
  const newVisibleKeys = useMemo(
    () =>
      rows
        .map(getPluginNavPanelKey)
        .filter(
          (key) =>
            !seededPreferences.order.includes(key) &&
            !DEFAULT_HIDDEN_SIDEBAR_NAVIGATION_KEYS.some(
              (hiddenKey) => hiddenKey === key,
            ),
        ),
    [rows, seededPreferences.order],
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
            ? seededPreferences.order
            : [...newLeadingKeys, ...seededPreferences.order],
        storedVisibleKeys:
          seededPreferences.visibleKeys === null || newVisibleKeys.length === 0
            ? seededPreferences.visibleKeys
            : [...newVisibleKeys, ...seededPreferences.visibleKeys],
        defaultHiddenKeys: DEFAULT_HIDDEN_SIDEBAR_NAVIGATION_KEYS,
      }),
    [newLeadingKeys, newVisibleKeys, rows, seededPreferences],
  );
  const hidden = useMemo(
    () =>
      ordered.filter((row) => !visibleKeys.includes(getPluginNavPanelKey(row))),
    [ordered, visibleKeys],
  );

  const orderedKeys = useMemo(
    () => ordered.map(getPluginNavPanelKey),
    [ordered],
  );

  const persistPreferences = useCallback(
    (order: string[], nextVisibleKeys: string[] | null) => {
      if (!haveSameOrder(storedOrder, order)) setStoredOrder(order);
      if (
        storedVisibleKeys === nextVisibleKeys ||
        (storedVisibleKeys !== null &&
          nextVisibleKeys !== null &&
          haveSameOrder(storedVisibleKeys, nextVisibleKeys))
      ) {
        return;
      }
      setStoredVisibleKeys(nextVisibleKeys);
    },
    [setStoredOrder, setStoredVisibleKeys, storedOrder, storedVisibleKeys],
  );

  const setPanelVisible = useCallback(
    (key: string, isVisible: boolean) => {
      persistPreferences(
        normalizedOrder,
        togglePluginNavPanelVisibility(
          normalizedVisibleKeys ?? visibleKeys,
          key,
          isVisible,
        ),
      );
    },
    [normalizedVisibleKeys, normalizedOrder, persistPreferences, visibleKeys],
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
      if (nextOrder) persistPreferences(nextOrder, normalizedVisibleKeys);
    },
    [normalizedOrder, normalizedVisibleKeys, persistPreferences, visibleKeys],
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
      persistPreferences(nextOrder, normalizedVisibleKeys ?? visibleKeys);
    },
    [
      normalizedOrder,
      normalizedVisibleKeys,
      orderedKeys,
      persistPreferences,
      visibleKeys,
    ],
  );

  const reorderDisabled = ordered.length < 2;
  const openCustomize = useCallback(
    () => setIsCustomizeOpen(true),
    [setIsCustomizeOpen],
  );
  const rowProps = {
    onNavigate,
    pathname: location.pathname,
    splitEnabled,
    onHide: (key: string) => setPanelVisible(key, false),
    disablePending,
    onDisable: (row: PluginSidebarNavRow) => void handleDisable(row),
  };

  const handleActivate = useCallback(
    (row: SidebarNavRow, event: SidebarNavActivationModifiers) => {
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
      ?.querySelector<HTMLElement>(`[data-testid="${MORE_TRIGGER_TEST_ID}"]`)
      ?.focus();
  }, [isCustomizeOpen]);

  if (isCustomizeOpen) {
    return (
      <div
        ref={containerRef}
        className={cn(
          "px-2 py-2",
          isCompactViewport ? "flex min-h-0 flex-1 flex-col" : "shrink-0",
        )}
        data-testid="plugin-nav-sidebar-items"
        data-sidebar-navigation-customize-mode="true"
      >
        <SidebarVisibilityCustomize
          title="Customize sidebar"
          listLabel="Sidebar navigation"
          variant={isCompactViewport ? "compact" : "card"}
          items={ordered.map(sidebarVisibilityItem)}
          visibleIds={visibleKeys}
          onActivate={(item, event) => {
            const row = ordered.find(
              (candidate) => getPluginNavPanelKey(candidate) === item.id,
            );
            if (row) handleActivate(row, event);
          }}
          onDone={() => {
            restoreCustomizeTriggerFocusRef.current = true;
            setIsCustomizeOpen(false);
          }}
          onExit={() => setIsCustomizeOpen(false)}
          onReorder={handleCustomizeDragEnd}
          onVisibleChange={setPanelVisible}
        />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative shrink-0 space-y-0.5 px-2 py-2"
      data-testid="plugin-nav-sidebar-items"
      onClickCapture={onClickCapture}
    >
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
              <BuiltInSidebarNavRow
                key={getPluginNavPanelKey(row)}
                row={row}
                onHide={rowProps.onHide}
                onCustomize={openCustomize}
              />
            ),
          )}
        </SortableContext>
      </DndContext>
      {hidden.length > 0 ? (
        <SidebarMore
          ariaLabel="More sidebar navigation"
          listLabel="More navigation"
          customizeLabel="Customize sidebar"
          onCustomize={openCustomize}
        >
          {(close) =>
            hidden.map((row) => (
              <SidebarNavigationOverflowItem
                key={getPluginNavPanelKey(row)}
                row={row}
                onActivate={handleActivate}
                onAddToSidebar={(key) => setPanelVisible(key, true)}
                onClose={close}
                splitEnabled={splitEnabled}
              />
            ))
          }
        </SidebarMore>
      ) : null}
    </div>
  );
}

function sidebarVisibilityItem(row: SidebarNavRow): SidebarVisibilityItem {
  return {
    id: getPluginNavPanelKey(row),
    title: row.title,
    icon: isPluginSidebarNavRow(row) ? (
      <PluginIcon pluginId={row.chrome.pluginId} icon={row.chrome.icon} />
    ) : (
      row.icon
    ),
    ...(!isPluginSidebarNavRow(row) && row.disabled !== undefined
      ? { disabled: row.disabled }
      : {}),
  };
}

function SidebarNavigationOverflowItem({
  row,
  onActivate,
  onAddToSidebar,
  onClose,
  splitEnabled,
}: {
  row: SidebarNavRow;
  onActivate: (
    row: SidebarNavRow,
    event: SidebarNavActivationModifiers,
  ) => void;
  onAddToSidebar: (key: string) => void;
  onClose: () => void;
  splitEnabled: boolean;
}) {
  const splitActions = usePaneContentSplitActions();
  const content: PaneContent | undefined = isPluginSidebarNavRow(row)
    ? {
        kind: "plugin-panel",
        pluginId: row.chrome.pluginId,
        panelPath: row.chrome.path,
        subPath: "",
      }
    : row.splitContent;
  const disabled = !isPluginSidebarNavRow(row) && row.disabled;
  const canSplit =
    splitEnabled &&
    !splitActions.isCompact &&
    content !== undefined &&
    !disabled;

  return (
    <SidebarOverflowItem
      item={sidebarVisibilityItem(row)}
      onActivate={(event) => onActivate(row, event)}
      onAddToSidebar={onAddToSidebar}
      onClose={onClose}
      onPointerDown={(event) => {
        if (!canSplit || !content) return;
        splitActions.beginDrag(event, {
          content,
          enabled: splitEnabled,
          label: row.title,
          onDragStart: onClose,
          dragActivation: "distance",
        });
      }}
      additionalActions={
        !splitActions.isCompact ? (
          <DropdownMenuItem
            className="cursor-pointer"
            disabled={!canSplit}
            onSelect={() => {
              if (!content) return;
              onClose();
              splitActions.openInSplit({
                content,
                enabled: splitEnabled,
                label: row.title,
              });
            }}
          >
            <Icon name="Columns2" aria-hidden="true" />
            Open in split
          </DropdownMenuItem>
        ) : null
      }
    />
  );
}

function BuiltInSidebarNavRow({
  row,
  onHide,
  onCustomize,
}: {
  row: BuiltInSidebarNavEntry;
  onHide: (key: string) => void;
  onCustomize: () => void;
}) {
  const rowKey = getPluginNavPanelKey(row);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div data-sidebar-navigation-item={rowKey}>{row.content}</div>
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={`${row.title} options`}>
        <ContextMenuItem onSelect={() => onHide(rowKey)}>
          <SidebarVisibilityActionContent visible />
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onCustomize}>
          <SidebarCustomizeActionContent label="Customize sidebar" />
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
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
    <PluginNavSidebarItem
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
  disablePending: boolean;
  onHide: (key: string) => void;
  onDisable: (row: PluginSidebarNavRow) => void;
  dragBindings?: SidebarSortableDragBindings;
  rowRef?: (element: HTMLElement | null) => void;
  rowStyle?: CSSProperties;
}

type PluginNavRowMenuSurface = "context" | "dropdown";

function PluginNavRowMenuItems({
  disablePending,
  onDisable,
  onHide,
  onOpenInSplit,
  onOpenDetails,
  surface,
}: {
  disablePending: boolean;
  onDisable: () => void;
  onHide: () => void;
  onOpenInSplit?: () => void;
  onOpenDetails: () => void;
  surface: PluginNavRowMenuSurface;
}) {
  const Item = surface === "context" ? ContextMenuItem : DropdownMenuItem;
  const Separator =
    surface === "context" ? ContextMenuSeparator : DropdownMenuSeparator;
  return (
    <>
      {onOpenInSplit !== undefined ? (
        <Item onSelect={onOpenInSplit}>
          <Icon name="Columns2" aria-hidden="true" />
          Open in split
        </Item>
      ) : null}
      <Item onSelect={onOpenDetails}>
        <Icon name="Info" aria-hidden="true" />
        View details
      </Item>
      <Item onSelect={onHide}>
        <SidebarVisibilityActionContent visible />
      </Item>
      <Separator />
      <Item disabled={disablePending} onSelect={onDisable}>
        <Icon name="Unavailable" aria-hidden="true" />
        Disable
      </Item>
    </>
  );
}

export function ResourceNavSidebarItem({
  icon,
  title,
  routePath,
  onNavigate,
}: {
  icon: IconName;
  title: string;
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
      <Icon name={icon} aria-hidden="true" />
      <span className="min-w-0 truncate text-left">{title}</span>
    </Button>
  );
}

function PluginNavSidebarItem({
  row,
  pathname,
  onNavigate,
  onDisable,
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
      loading={panel === null}
      title={chrome.title}
      icon={<PluginIcon pluginId={chrome.pluginId} icon={chrome.icon} />}
      isActive={pathname === path || pathname.startsWith(`${path}/`)}
      splitMiniMap={splitIndicator.miniMap}
      accessory={sidebarAccessory}
      onPointerDown={onPointerDown}
      onOpenInSplit={
        splitEnabled && !isCompactViewport ? openInSplit : undefined
      }
      onOpenDetails={() => {
        onNavigate?.();
        if (
          openPluginDetailsInWorkspace({
            pluginId: chrome.pluginId,
            title: chrome.title,
          })
        )
          return;
        void navigate(getPluginDetailRoutePath({ pluginId: chrome.pluginId }));
      }}
      onDisable={() => onDisable(row)}
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
  loading?: boolean;
  title: string;
  icon: ReactNode;
  isActive: boolean;
  onSelect: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onPointerDown?: PointerEventHandler<HTMLElement>;
  onOpenInSplit?: () => void;
  onOpenDetails: () => void;
  onDisable: () => void;
  onHide: (key: string) => void;
  disablePending: boolean;
  splitMiniMap?: MiniMapSlot[] | null;
  accessory?: ReactNode;
  dragBindings?: SidebarSortableDragBindings;
  rowRef?: (element: HTMLElement | null) => void;
  rowStyle?: CSSProperties;
}

function SidebarNavRowChrome({
  rowKey,
  loading = false,
  title,
  icon,
  isActive,
  onSelect,
  onPointerDown,
  onOpenInSplit,
  onOpenDetails,
  onDisable,
  onHide,
  disablePending,
  splitMiniMap = null,
  accessory,
  dragBindings,
  rowRef,
  rowStyle,
}: SidebarNavRowChromeProps) {
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const { onKeyDown: _keyboardDragActivator, ...pointerDragListeners } =
    dragBindings?.listeners ?? {};
  const menuItems = (surface: PluginNavRowMenuSurface): ReactNode => (
    <PluginNavRowMenuItems
      surface={surface}
      disablePending={disablePending}
      onDisable={onDisable}
      onHide={() => onHide(rowKey)}
      onOpenInSplit={onOpenInSplit}
      onOpenDetails={onOpenDetails}
    />
  );

  return (
    <ContextMenu onOpenChange={setIsActionsOpen}>
      <ContextMenuTrigger asChild>
        <div
          ref={rowRef}
          style={rowStyle}
          className={cn(
            SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
            "relative",
            !loading &&
              "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200",
          )}
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
              loading &&
                "text-sidebar-foreground/55 dark:text-sidebar-foreground/55 [&_[data-icon-root]]:opacity-60",
            )}
            aria-busy={loading || undefined}
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
                    "rounded-md p-0",
                    SIDEBAR_MORE_ACTION_TRIGGER_CLASS,
                    SIDEBAR_CONTROL_STATE_CLASS,
                  )}
                >
                  <Icon
                    name="MoreHorizontal"
                    className={COARSE_POINTER_ICON_SIZE_CLASS}
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {menuItems("dropdown")}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={`${title} panel options`}>
        {menuItems("context")}
      </ContextMenuContent>
    </ContextMenu>
  );
}
