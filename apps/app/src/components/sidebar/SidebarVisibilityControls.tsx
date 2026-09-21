import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEventHandler,
  type ReactNode,
} from "react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Button } from "@bb/shared-ui/button";
import { Checkbox } from "@bb/shared-ui/checkbox";
import { Icon } from "@bb/shared-ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
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
import { cn } from "@bb/shared-ui/lib/utils";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions";
import {
  PROJECT_LIST_ACTION_BUTTON_CLASS,
  SIDEBAR_CONTROL_BUTTON_CLASS,
} from "./sidebarRowClasses";
import { TopLevelSidebarSection } from "./TopLevelSidebarSection";
import { useSidebarSortable } from "./sortableMotion";
import { useSidebarReorderDnd } from "./useSidebarReorderDnd";

const OVERFLOW_ROW_BUTTON_CLASS =
  "w-full justify-start gap-2 rounded-sm px-2 text-xs font-normal hover:bg-state-hover focus-visible:bg-state-hover";

export interface SidebarVisibilityItem {
  id: string;
  title: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SidebarActivationModifiers {
  metaKey: boolean;
  ctrlKey: boolean;
}

export function SidebarCustomizeActionContent({ label }: { label: string }) {
  return (
    <>
      <Icon name="FilterHorizontal" aria-hidden="true" />
      {label}
    </>
  );
}

export function SidebarVisibilityActionContent({
  visible,
  label,
}: {
  visible: boolean;
  label?: string;
}) {
  return (
    <>
      <Icon name={visible ? "EyeOff" : "Eye"} aria-hidden="true" />
      {label ?? (visible ? "Hide from sidebar" : "Add to sidebar")}
    </>
  );
}

export function SidebarMore({
  activity,
  ariaLabel,
  children,
  customizeLabel,
  listLabel,
  onCustomize,
  testIdPrefix = "sidebar-navigation",
}: {
  activity?: ReactNode;
  ariaLabel: string;
  children: (close: () => void) => ReactNode;
  customizeLabel: string;
  listLabel: string;
  onCustomize: () => void;
  testIdPrefix?: string;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const close = useCallback(() => setIsMenuOpen(false), []);

  return (
    <div data-testid={`${testIdPrefix}-more-row`}>
      <Popover open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={ariaLabel}
                  className={cn(
                    PROJECT_LIST_ACTION_BUTTON_CLASS,
                    "w-full text-muted-foreground hover:text-sidebar-foreground focus-visible:text-sidebar-foreground data-[state=open]:text-sidebar-foreground",
                    isMenuOpen && "bg-sidebar-accent",
                  )}
                  data-testid={`${testIdPrefix}-more-trigger`}
                >
                  <Icon name="MoreHorizontal" aria-hidden="true" />
                  <span className="min-w-0 truncate text-left">More</span>
                  {activity ? (
                    <span className="ml-auto flex shrink-0">{activity}</span>
                  ) : null}
                </Button>
              </PopoverTrigger>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent aria-label={`${ariaLabel} options`}>
            <ContextMenuItem onSelect={onCustomize}>
              <SidebarCustomizeActionContent label={customizeLabel} />
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={8}
          mobileTitle="More"
          aria-label={ariaLabel}
          className="flex max-h-[min(var(--radix-popover-content-available-height),calc(100dvh-0.5rem))] w-56 flex-col overflow-hidden p-1 max-md:min-h-0 max-md:flex-1"
        >
          <div
            role="list"
            aria-label={listLabel}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          >
            {children(close)}
          </div>
          <div
            role="separator"
            className="-mx-1 my-1 h-px shrink-0 bg-border"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              OVERFLOW_ROW_BUTTON_CLASS,
              COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
              "shrink-0",
            )}
            data-testid={`${testIdPrefix}-customize-trigger`}
            onClick={() => {
              close();
              onCustomize();
            }}
          >
            <SidebarCustomizeActionContent label={customizeLabel} />
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function SidebarOverflowItem({
  activity,
  additionalActions,
  children,
  expanded,
  item,
  onActivate,
  onAddToSidebar,
  onClose,
  onExpandedChange,
  onPointerDown,
  testIdPrefix = "sidebar-navigation",
}: {
  activity?: ReactNode;
  additionalActions?: ReactNode;
  children?: ReactNode;
  expanded?: boolean;
  item: SidebarVisibilityItem;
  onActivate?: (event: SidebarActivationModifiers) => void;
  onAddToSidebar: (id: string) => void;
  onClose: () => void;
  onExpandedChange?: (expanded: boolean) => void;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
  testIdPrefix?: string;
}) {
  const [isActionsOpen, setIsActionsOpen] = useState(false);

  const actions = (
    <DropdownMenu
      modal={false}
      open={isActionsOpen}
      onOpenChange={setIsActionsOpen}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`${item.title} options`}
          className={
            onExpandedChange
              ? SIDEBAR_CONTROL_BUTTON_CLASS
              : cn(
                  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
                  "rounded-sm p-0 hover:bg-state-hover",
                )
          }
        >
          <Icon
            name="MoreHorizontal"
            className={COARSE_POINTER_ICON_SIZE_CLASS}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="start"
        sideOffset={4}
        aria-label={`${item.title} options`}
      >
        {additionalActions}
        <DropdownMenuItem
          className="cursor-pointer"
          onSelect={() => {
            onClose();
            onAddToSidebar(item.id);
          }}
        >
          <SidebarVisibilityActionContent visible={false} />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (onExpandedChange) {
    return (
      <div role="listitem" data-sidebar-overflow-item={item.id}>
        <TopLevelSidebarSection
          label={item.title}
          stickyHeader={false}
          collapseControl={{
            isCollapsed: !expanded,
            onToggleCollapsed: () => onExpandedChange(!expanded),
          }}
          status={!expanded ? activity : undefined}
          actions={actions}
          actionsOpen={isActionsOpen}
          actionsMobileAlways
        >
          {children}
        </TopLevelSidebarSection>
      </div>
    );
  }

  return (
    <div role="listitem">
      <div className={cn(SIDEBAR_HOVER_ACTIONS_ROW_CLASS, "relative")}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            OVERFLOW_ROW_BUTTON_CLASS,
            COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
            "pr-9 max-md:pointer-coarse:pr-11",
          )}
          disabled={item.disabled}
          data-sidebar-overflow-item={item.id}
          data-sidebar-navigation-more-item={
            testIdPrefix === "sidebar-navigation" ? item.id : undefined
          }
          onPointerDown={onPointerDown}
          onClick={(event) => {
            if (!onActivate) return;
            onClose();
            onActivate({ metaKey: event.metaKey, ctrlKey: event.ctrlKey });
          }}
        >
          {item.icon ? (
            <span className="flex size-4 shrink-0 items-center justify-center">
              {item.icon}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-left">
            {item.title}
          </span>
          {activity}
        </Button>
        <div
          data-sidebar-hover-actions-open={isActionsOpen ? "true" : undefined}
          data-sidebar-hover-actions-mobile={
            SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE
          }
          className={cn(
            SIDEBAR_HOVER_ACTIONS_CLASS,
            "absolute inset-y-0 right-0 flex items-center pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto",
          )}
        >
          {actions}
        </div>
      </div>
    </div>
  );
}

export function SidebarVisibilityCustomize({
  items,
  listLabel,
  onActivate,
  onDone,
  onExit,
  onReorder,
  onVisibleChange,
  testIdPrefix = "sidebar-navigation",
  title,
  variant,
  visibleIds,
}: {
  items: readonly SidebarVisibilityItem[];
  listLabel: string;
  onActivate?: (
    item: SidebarVisibilityItem,
    event: SidebarActivationModifiers,
  ) => void;
  onDone: () => void;
  onExit?: () => void;
  onReorder: (activeId: string, overId: string) => void;
  onVisibleChange: (id: string, visible: boolean) => void;
  testIdPrefix?: string;
  title: string;
  variant: "compact" | "card";
  visibleIds: readonly string[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const doneButtonRef = useRef<HTMLButtonElement>(null);
  const orderedIds = useMemo(() => items.map((item) => item.id), [items]);
  const visibleIdSet = useMemo(() => new Set(visibleIds), [visibleIds]);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (
        typeof event.active.id !== "string" ||
        typeof event.over?.id !== "string"
      )
        return;
      onReorder(event.active.id, event.over.id);
    },
    [onReorder],
  );
  const { dndContextProps, onClickCapture } = useSidebarReorderDnd({
    onDragEnd: handleDragEnd,
  });

  useEffect(() => {
    if (variant === "compact") {
      doneButtonRef.current?.focus();
      return;
    }
    containerRef.current
      ?.querySelector<HTMLElement>("[data-sidebar-customize-launch]")
      ?.focus();
  }, [variant]);

  const list = (
    <div
      role="list"
      aria-label={listLabel}
      className="space-y-0.5"
      onClickCapture={onClickCapture}
    >
      <DndContext {...dndContextProps}>
        <SortableContext
          items={orderedIds}
          strategy={verticalListSortingStrategy}
        >
          {items.map((item) => (
            <SidebarCustomizeItem
              key={item.id}
              item={item}
              checked={visibleIdSet.has(item.id)}
              reorderDisabled={items.length < 2}
              onActivate={
                onActivate
                  ? (event) => {
                      onActivate(item, event);
                      onExit?.();
                    }
                  : undefined
              }
              onCheckedChange={(checked) => onVisibleChange(item.id, checked)}
              testIdPrefix={testIdPrefix}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );

  if (variant === "compact") {
    return (
      <div
        ref={containerRef}
        className="flex min-h-0 flex-1 flex-col"
        data-testid={`${testIdPrefix}-customize-inline`}
      >
        <div className="flex shrink-0 items-center gap-1">
          <Button
            ref={doneButtonRef}
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Back to sidebar"
            className={cn(
              COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
              "shrink-0 text-muted-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2",
            )}
            onClick={onDone}
          >
            <Icon name="ChevronLeft" aria-hidden="true" />
          </Button>
          <div
            className={cn("min-w-0 flex-1 px-1", CHROME_SECTION_LABEL_CLASS)}
          >
            {title}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pt-1">{list}</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="rounded-lg border border-sidebar-border/40 bg-sidebar-accent/40 p-1"
      data-testid={`${testIdPrefix}-customize-inline`}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onDone();
      }}
    >
      <div className="flex items-center gap-1 pb-1">
        <div
          className={cn("min-w-0 flex-1 px-2 py-1", CHROME_SECTION_LABEL_CLASS)}
        >
          {title}
        </div>
        <Button
          ref={doneButtonRef}
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 px-2 text-xs text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent focus-visible:ring-2"
          onClick={onDone}
        >
          Done
        </Button>
      </div>
      {list}
    </div>
  );
}

function SidebarCustomizeItem({
  checked,
  item,
  onActivate,
  onCheckedChange,
  reorderDisabled,
  testIdPrefix,
}: {
  checked: boolean;
  item: SidebarVisibilityItem;
  onActivate?: ((event: SidebarActivationModifiers) => void) | undefined;
  onCheckedChange: (checked: boolean) => void;
  reorderDisabled: boolean;
  testIdPrefix: string;
}) {
  const checkboxId = useId();
  const { dragBindings, setNodeRef, style } = useSidebarSortable({
    id: item.id,
    disabled: reorderDisabled,
  });
  const isNavigation = testIdPrefix === "sidebar-navigation";

  return (
    <div
      ref={setNodeRef}
      style={style}
      role="listitem"
      className={cn(
        "group flex min-h-7 items-center rounded-md px-1 text-xs",
        COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
        "text-sidebar-foreground hover:bg-sidebar-accent focus-within:bg-sidebar-accent",
      )}
      data-sidebar-customize-item={item.id}
      data-plugin-nav-customize-item={isNavigation ? item.id : undefined}
    >
      <button
        type="button"
        ref={dragBindings.setActivatorNodeRef}
        {...dragBindings.attributes}
        {...dragBindings.listeners}
        aria-label={`Reorder ${item.title}`}
        className={cn(
          "flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-subtle-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:cursor-grabbing",
          COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
          "hover:text-sidebar-foreground focus-visible:text-sidebar-foreground",
        )}
        onClick={(event) => event.stopPropagation()}
        data-plugin-nav-customize-drag-handle={
          isNavigation ? item.id : undefined
        }
      >
        <Icon
          name="DragDropVertical"
          className={COARSE_POINTER_ICON_SIZE_CLASS}
        />
      </button>
      <button
        type="button"
        disabled={item.disabled}
        className={cn(
          "flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm px-1 text-left outline-none disabled:cursor-default disabled:opacity-50",
          COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
        )}
        onClick={(event) => {
          if (onActivate)
            onActivate({ metaKey: event.metaKey, ctrlKey: event.ctrlKey });
          else onCheckedChange(!checked);
        }}
        data-sidebar-customize-launch={item.id}
        data-sidebar-navigation-customize-launch={
          isNavigation ? item.id : undefined
        }
      >
        {item.icon ? (
          <span className="flex size-4 shrink-0 items-center justify-center">
            {item.icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{item.title}</span>
      </button>
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
          aria-label={`Show ${item.title} in sidebar`}
          onCheckedChange={(nextChecked) =>
            onCheckedChange(nextChecked === true)
          }
          data-plugin-nav-customize-checkbox={
            isNavigation ? item.id : undefined
          }
        />
      </label>
    </div>
  );
}
