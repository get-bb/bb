import {
  useCallback,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  experimental_SidebarNavigationIcon as NavigationIcon,
  experimental_useSidebarNavigation,
  experimental_useSidebarNavigationSplit,
  type ExperimentalSidebarNavigationItem,
  type ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SIDEBAR_DISCLOSURE_ACTION_CLASS } from "@/components/ui/chrome-style-tokens";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { CompactViewportOverrideProvider } from "@/components/ui/hooks/use-compact-viewport";
import { cn } from "@/lib/utils";
import { AppCommandShortcutPill } from "./ui/AppCommandShortcutPill.js";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
  SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "./ui/sidebar-hover-actions.js";
import {
  PROJECT_LIST_ACTION_BUTTON_CLASS,
  SIDEBAR_CONTROL_STATE_CLASS,
  SIDEBAR_MORE_ACTION_TRIGGER_CLASS,
} from "./ui/sidebarRowClasses.js";
import {
  SidebarCustomizeActionContent,
  SidebarMore,
  SidebarOverflowItem,
  SidebarVisibilityActionContent,
} from "./ui/SidebarVisibilityControls.js";
import { SplitPaneMiniMap } from "./ui/SplitPaneMiniMap.js";
import {
  useSidebarSortable,
  type SidebarSortableDragBindings,
} from "./ui/sortableMotion.js";
import { useSidebarReorderDnd } from "./ui/useSidebarReorderDnd.js";

type MenuSurface = "context" | "dropdown";

function RowMenuItems({
  item,
  surface,
  canOpenInSplit,
  disablePending,
  onDisable,
}: {
  item: ExperimentalSidebarNavigationItem;
  surface: MenuSurface;
  canOpenInSplit: boolean;
  disablePending: boolean;
  onDisable: () => void;
}) {
  const { actions } = experimental_useSidebarNavigation();
  const Item = surface === "context" ? ContextMenuItem : DropdownMenuItem;
  const Separator =
    surface === "context" ? ContextMenuSeparator : DropdownMenuSeparator;
  if (item.pluginId === null) {
    return (
      <>
        <Item onSelect={() => actions.setVisible(item.id, false)}>
          <SidebarVisibilityActionContent visible />
        </Item>
        <Separator />
        <Item onSelect={() => actions.openCustomize()}>
          <SidebarCustomizeActionContent label="Customize sidebar" />
        </Item>
      </>
    );
  }
  return (
    <>
      {canOpenInSplit ? (
        <Item onSelect={() => actions.activate(item.id, { openInSplit: true })}>
          <Icon name="Columns2" aria-hidden="true" />
          Open in split
        </Item>
      ) : null}
      <Item onSelect={() => actions.openDetails(item.id)}>
        <Icon name="Info" aria-hidden="true" />
        View details
      </Item>
      <Item onSelect={() => actions.setVisible(item.id, false)}>
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

function ItemShortcut({ item }: { item: ExperimentalSidebarNavigationItem }) {
  const { isShortcutModifierHeld } = experimental_useSidebarNavigation();
  if (item.shortcut === null) return null;
  if (item.action.kind === "search-threads") {
    return (
      <span className="inline-flex shrink-0 opacity-0 transition-opacity group-hover/nav-row:opacity-100 group-focus-visible/nav-row:opacity-100 max-md:pointer-coarse:hidden">
        <AppCommandShortcutPill shortcut={item.shortcut} />
      </span>
    );
  }
  return isShortcutModifierHeld ? (
    <AppCommandShortcutPill shortcut={item.shortcut} />
  ) : null;
}

function NavigationRow({
  item,
  isCompactViewport,
  reorderDisabled,
}: {
  item: ExperimentalSidebarNavigationItem;
  isCompactViewport: boolean;
  reorderDisabled: boolean;
}) {
  const sortable = useSidebarSortable({
    id: item.id,
    disabled: reorderDisabled || item.pluginId === null,
  });
  return (
    <NavigationRowChrome
      item={item}
      isCompactViewport={isCompactViewport}
      dragBindings={item.pluginId === null ? undefined : sortable.dragBindings}
      rowRef={sortable.setNodeRef}
      rowStyle={sortable.style}
    />
  );
}

function NavigationRowChrome({
  item,
  isCompactViewport,
  dragBindings,
  rowRef,
  rowStyle,
}: {
  item: ExperimentalSidebarNavigationItem;
  isCompactViewport: boolean;
  dragBindings: SidebarSortableDragBindings | undefined;
  rowRef: (element: HTMLElement | null) => void;
  rowStyle: CSSProperties;
}) {
  const { activeItemId, actions } = experimental_useSidebarNavigation();
  const split = experimental_useSidebarNavigationSplit(item.id);
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const [disablePending, setDisablePending] = useState(false);
  const isActive =
    item.id === activeItemId && item.action.kind !== "new-thread";
  const Accessory = item.experimental_Accessory;
  const { onKeyDown: _keyboardDragActivator, ...pointerDragListeners } =
    dragBindings?.listeners ?? {};
  const onDisable = useCallback(() => {
    setDisablePending(true);
    actions
      .disablePlugin(item.id)
      .catch(() => {})
      .finally(() => setDisablePending(false));
  }, [actions, item.id]);
  const menuItems = (surface: MenuSurface): ReactNode => (
    <RowMenuItems
      item={item}
      surface={surface}
      canOpenInSplit={split.isAvailable && !isCompactViewport}
      disablePending={disablePending}
      onDisable={onDisable}
    />
  );
  const hasOptionsButton = item.pluginId !== null;

  return (
    <ContextMenu onOpenChange={setIsActionsOpen}>
      <ContextMenuTrigger asChild>
        <div
          ref={rowRef}
          style={rowStyle}
          className={cn(
            SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
            "relative",
            !item.isLoading &&
              "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200",
          )}
          data-sidebar-navigation-item={item.id}
        >
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={cn(
              PROJECT_LIST_ACTION_BUTTON_CLASS,
              "group/nav-row w-full",
              hasOptionsButton && "pr-7",
              Accessory && "pr-18",
              isActive && "bg-sidebar-accent text-sidebar-foreground",
              item.isLoading &&
                "text-sidebar-foreground/55 dark:text-sidebar-foreground/55 [&_[data-icon-root]]:opacity-60",
            )}
            disabled={item.isDisabled}
            aria-busy={item.isLoading || undefined}
            aria-current={isActive ? "page" : undefined}
            aria-keyshortcuts={item.shortcut?.ariaKeyShortcuts}
            aria-label={
              item.shortcut
                ? `${item.label} (${item.shortcut.label})`
                : undefined
            }
            ref={dragBindings?.setActivatorNodeRef}
            {...dragBindings?.attributes}
            {...pointerDragListeners}
            {...split.splitProps}
            onClick={(event) =>
              actions.activate(item.id, {
                openInSplit: event.metaKey || event.ctrlKey,
              })
            }
          >
            <NavigationIcon icon={item.icon} />
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {split.layout ? (
                <SplitPaneMiniMap
                  slots={split.layout.panes}
                  label={`${item.label} — open in split`}
                />
              ) : null}
              <ItemShortcut item={item} />
            </span>
          </Button>
          {Accessory ? (
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
              <Accessory />
            </span>
          ) : null}
          {hasOptionsButton ? (
            <div
              data-sidebar-hover-actions-open={
                isActionsOpen ? "true" : undefined
              }
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
                    aria-label={`${item.label} panel options`}
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
          ) : null}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        aria-label={
          hasOptionsButton
            ? `${item.label} panel options`
            : `${item.label} options`
        }
      >
        {menuItems("context")}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function OverflowItem({
  item,
  isCompactViewport,
  onClose,
}: {
  item: ExperimentalSidebarNavigationItem;
  isCompactViewport: boolean;
  onClose: () => void;
}) {
  const { actions } = experimental_useSidebarNavigation();
  const split = experimental_useSidebarNavigationSplit(item.id, {
    activation: "distance",
    onDragStart: onClose,
  });
  const canSplit = split.isAvailable && !isCompactViewport && !item.isDisabled;
  return (
    <SidebarOverflowItem
      {...(canSplit && split.splitProps.onPointerDown
        ? { onPointerDown: split.splitProps.onPointerDown }
        : {})}
      item={{
        id: item.id,
        title: item.label,
        icon: <NavigationIcon icon={item.icon} />,
        ...(item.isDisabled ? { disabled: true } : {}),
      }}
      onActivate={(event) =>
        actions.activate(item.id, {
          openInSplit: event.metaKey || event.ctrlKey,
        })
      }
      onAddToSidebar={(id) => actions.setVisible(id, true)}
      onClose={onClose}
      additionalActions={
        !isCompactViewport ? (
          <DropdownMenuItem
            className="cursor-pointer"
            disabled={!canSplit}
            onSelect={() => {
              onClose();
              actions.activate(item.id, { openInSplit: true });
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

export function Navigation({
  isCompactViewport,
}: ExperimentalSidebarNavigationProps) {
  const { actions, items } = experimental_useSidebarNavigation();
  const visible = items.filter((item) => item.isVisible);
  const hidden = items.filter((item) => !item.isVisible);
  const visibleIds = visible.map((item) => item.id);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeId = event.active.id;
      const overId = event.over?.id;
      if (typeof activeId !== "string" || typeof overId !== "string") return;
      const from = visibleIds.indexOf(activeId);
      const to = visibleIds.indexOf(overId);
      if (from === -1 || to === -1 || from === to) return;
      const nextVisible = arrayMove(visibleIds, from, to);
      let cursor = 0;
      actions.setOrder(
        items.map((item) =>
          item.isVisible ? (nextVisible[cursor++] ?? item.id) : item.id,
        ),
      );
    },
    [actions, items, visibleIds],
  );
  const { dndContextProps, onClickCapture } = useSidebarReorderDnd({
    onDragEnd: handleDragEnd,
  });

  if (items.length === 0) return null;
  const reorderDisabled =
    visible.filter((item) => item.pluginId !== null).length < 2;

  return (
    <CompactViewportOverrideProvider isCompactViewport={isCompactViewport}>
      <div
        className="relative shrink-0 space-y-0.5 px-2 py-2"
        data-testid="plugin-nav-sidebar-items"
        onClickCapture={onClickCapture}
      >
        <DndContext {...dndContextProps}>
          <SortableContext
            items={visibleIds}
            strategy={verticalListSortingStrategy}
          >
            {visible.map((item) => (
              <NavigationRow
                key={item.id}
                item={item}
                isCompactViewport={isCompactViewport}
                reorderDisabled={reorderDisabled}
              />
            ))}
          </SortableContext>
        </DndContext>
        {hidden.length > 0 ? (
          <SidebarMore
            ariaLabel="More sidebar navigation"
            listLabel="More navigation"
            customizeLabel="Customize sidebar"
            onCustomize={() => actions.openCustomize()}
          >
            {(close) =>
              hidden.map((item) => (
                <OverflowItem
                  key={item.id}
                  item={item}
                  isCompactViewport={isCompactViewport}
                  onClose={close}
                />
              ))
            }
          </SidebarMore>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={cn(
              PROJECT_LIST_ACTION_BUTTON_CLASS,
              SIDEBAR_DISCLOSURE_ACTION_CLASS,
              "w-full hover:text-sidebar-foreground focus-visible:text-sidebar-foreground",
            )}
            data-testid="sidebar-navigation-customize-trigger"
            onClick={() => actions.openCustomize()}
          >
            <SidebarCustomizeActionContent label="Customize sidebar" />
          </Button>
        )}
      </div>
      <div
        aria-hidden="true"
        className="mx-2 my-2 shrink-0 border-t border-sidebar-border/25"
        data-testid="navigation-divider"
      />
    </CompactViewportOverrideProvider>
  );
}
