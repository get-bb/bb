import { useCallback, useEffect, useRef, useState } from "react";
import { closestCenter, DndContext, type DragEndEvent } from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  SortableContext,
} from "@dnd-kit/sortable";
import { useAtom } from "jotai";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon, type IconName } from "@/components/ui/icon";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { cn } from "@/lib/utils";
import {
  THREAD_ROW_ACTION_IDS,
  THREAD_ROW_ACTION_LIMIT,
  type ThreadRowActionId,
} from "../../shared/preferences.js";
import { arrayMove } from "../model/array-move.js";
import { threadRowActionsAtom } from "../preferences/atoms.js";
import { useSidebarReorderDnd } from "../dnd/useSidebarReorderDnd.js";
import { useSidebarSortable } from "../rows/sortableMotion.js";
import { SIDEBAR_CONTROL_BUTTON_CLASS } from "../rows/sidebarRowClasses.js";
import { THREAD_ROW_ACTIONS } from "../rows/threadRowActions.js";
import { SidebarCustomizePanel } from "./SidebarVisibilityCustomize.js";

type RowActionSlot = ThreadRowActionId | null;

function isThreadRowActionId(id: unknown): id is ThreadRowActionId {
  return (
    typeof id === "string" &&
    (THREAD_ROW_ACTION_IDS as readonly string[]).includes(id)
  );
}

export function getRowActionSlots(
  enabled: readonly ThreadRowActionId[],
): RowActionSlot[] {
  return [
    ...Array.from(
      { length: Math.max(0, THREAD_ROW_ACTION_LIMIT - enabled.length) },
      () => null,
    ),
    ...enabled.slice(0, THREAD_ROW_ACTION_LIMIT),
  ];
}

export function assignRowActionSlot(
  enabled: readonly ThreadRowActionId[],
  slotIndex: number,
  value: RowActionSlot,
): ThreadRowActionId[] {
  const slots = getRowActionSlots(enabled);
  const previous = slots[slotIndex] ?? null;
  const existingIndex = value === null ? -1 : slots.indexOf(value);
  if (existingIndex !== -1) slots[existingIndex] = previous;
  slots[slotIndex] = value;
  return slots.filter((slot): slot is ThreadRowActionId => slot !== null);
}

export function ThreadRowActionsCustomize({
  onDone,
  variant,
}: {
  onDone: () => void;
  variant: "compact" | "card";
}) {
  const [enabled, setEnabled] = useAtom(threadRowActionsAtom);
  const slots = getRowActionSlots(enabled);
  const groupRef = useRef<HTMLDivElement>(null);
  const focusSlot = useRef<number | null>(null);
  useEffect(() => {
    const index = focusSlot.current;
    if (index === null) return;
    focusSlot.current = null;
    const frame = requestAnimationFrame(() => {
      groupRef.current
        ?.querySelector<HTMLElement>(
          `[data-sidebar-customize-launch="${index}"]`,
        )
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled]);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeId = event.active.id;
      const overId = event.over?.id;
      if (!isThreadRowActionId(activeId) || !isThreadRowActionId(overId))
        return;
      setEnabled((current) => {
        const from = current.indexOf(activeId);
        const to = current.indexOf(overId);
        if (from === -1 || to === -1 || from === to) return current;
        return arrayMove(current, from, to);
      });
    },
    [setEnabled],
  );
  const { dndContextProps, onClickCapture } = useSidebarReorderDnd({
    onDragEnd: handleDragEnd,
    collisionDetection: closestCenter,
    axis: "free",
  });

  return (
    <SidebarCustomizePanel
      onDone={onDone}
      testIdPrefix="sidebar-thread-list-row-actions"
      title="Customize row actions"
      variant={variant}
    >
      <div
        className="space-y-0.5 px-1 pb-1"
        data-testid="sidebar-thread-list-row-actions-preview"
      >
        <div className="flex h-7 items-center gap-2 rounded-md bg-sidebar-accent pl-2 max-md:pointer-coarse:h-9">
          <FakeThreadRowTitle width="w-full" />
          <div
            ref={groupRef}
            role="group"
            aria-label="Row actions"
            className="flex shrink-0 items-center gap-0.5"
            onClickCapture={onClickCapture}
          >
            <DndContext {...dndContextProps}>
              <SortableContext
                items={enabled}
                strategy={horizontalListSortingStrategy}
              >
                {slots.map((slot, index) => (
                  <RowActionSlotPicker
                    key={slot ?? `empty-${index}`}
                    index={index}
                    value={slot}
                    reorderDisabled={slot === null || enabled.length < 2}
                    onChange={(value) => {
                      if (value === slot) return;
                      const next = assignRowActionSlot(enabled, index, value);
                      focusSlot.current =
                        value === null
                          ? index
                          : getRowActionSlots(next).indexOf(value);
                      setEnabled(next);
                    }}
                  />
                ))}
              </SortableContext>
            </DndContext>
            <span
              aria-hidden="true"
              className={cn(
                SIDEBAR_CONTROL_BUTTON_CLASS,
                "pointer-events-none flex items-center justify-center",
              )}
            >
              <Icon
                name="MoreHorizontal"
                className={COARSE_POINTER_ICON_SIZE_CLASS}
              />
            </span>
          </div>
        </div>
        <FakeThreadRow width="w-2/5" />
      </div>
    </SidebarCustomizePanel>
  );
}

function FakeThreadRow({ width }: { width: string }) {
  return (
    <div
      aria-hidden="true"
      className="flex h-7 items-center gap-2 pl-2 max-md:pointer-coarse:h-9"
    >
      <FakeThreadRowTitle width={width} />
    </div>
  );
}

function FakeThreadRowTitle({ width }: { width: string }) {
  return (
    <span aria-hidden="true" className="flex min-w-0 flex-1 items-center gap-2">
      <span className="size-1.5 shrink-0 rounded-full bg-sidebar-foreground/20" />
      <span
        className={cn("h-1.5 rounded-full bg-sidebar-foreground/15", width)}
      />
    </span>
  );
}

function RowActionSlotPicker({
  index,
  value,
  reorderDisabled,
  onChange,
}: {
  index: number;
  value: RowActionSlot;
  reorderDisabled: boolean;
  onChange: (value: RowActionSlot) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const { dragBindings, setNodeRef, style } = useSidebarSortable({
    id: value ?? `empty-${index}`,
    disabled: reorderDisabled,
  });
  const label = `Row action ${index + 1}: ${value === null ? "None" : THREAD_ROW_ACTIONS[value].title}`;
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <span ref={setNodeRef} style={style} className="flex">
          <button
            ref={(element) => {
              buttonRef.current = element;
              dragBindings.setActivatorNodeRef(element);
            }}
            type="button"
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={open}
            title={label}
            className={cn(
              SIDEBAR_CONTROL_BUTTON_CLASS,
              "flex touch-none items-center justify-center border focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              value === null
                ? "border-dashed border-sidebar-foreground/25"
                : "border-sidebar-foreground/15",
              !reorderDisabled && "active:cursor-grabbing",
            )}
            data-sidebar-customize-launch={index}
            data-row-action-slot={value ?? "none"}
            {...dragBindings.listeners}
            onKeyDown={undefined}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setOpen(true)}
          >
            {value !== null && (
              <Icon
                name={THREAD_ROW_ACTIONS[value].icon}
                className={COARSE_POINTER_ICON_SIZE_CLASS}
              />
            )}
          </button>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-44"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          buttonRef.current?.focus();
        }}
      >
        {THREAD_ROW_ACTION_IDS.map((id) => (
          <RowActionOption
            key={id}
            icon={THREAD_ROW_ACTIONS[id].icon}
            label={THREAD_ROW_ACTIONS[id].title}
            selected={value === id}
            onSelect={() => onChange(id)}
          />
        ))}
        <DropdownMenuSeparator />
        <RowActionOption
          icon="X"
          label="None"
          selected={value === null}
          onSelect={() => onChange(null)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RowActionOption({
  icon,
  label,
  selected,
  onSelect,
}: {
  icon: IconName;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      role="menuitemradio"
      aria-checked={selected}
      onSelect={onSelect}
    >
      <Icon name={icon} aria-hidden="true" />
      {label}
      <span className="ml-auto inline-flex size-4 shrink-0 items-center justify-center">
        {selected && <Icon name="Check" className="size-4" />}
      </span>
    </DropdownMenuItem>
  );
}
