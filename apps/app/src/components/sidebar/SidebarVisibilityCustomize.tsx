import { useCallback, useEffect, useId, useMemo, useRef } from "react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Checkbox } from "@bb/shared-ui/checkbox";
import { Icon } from "@bb/shared-ui/icon";
import {
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { cn } from "@bb/shared-ui/lib/utils";
import type {
  SidebarVisibilityItem,
  SidebarActivationModifiers,
} from "./SidebarVisibilityControls";
import { SidebarVisibilityCustomizeFrame } from "./SidebarVisibilityCustomizeFrame";
import { useSidebarSortable } from "./sortableMotion";
import { useSidebarReorderDnd } from "./useSidebarReorderDnd";

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

  return (
    <SidebarVisibilityCustomizeFrame
      containerRef={containerRef}
      doneButtonRef={doneButtonRef}
      onDone={onDone}
      testId={`${testIdPrefix}-customize-inline`}
      title={title}
      variant={variant}
    >
      {list}
    </SidebarVisibilityCustomizeFrame>
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
