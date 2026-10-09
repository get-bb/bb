import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { closestCenter, DndContext, type DragEndEvent } from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  SortableContext,
} from "@dnd-kit/sortable";
import { useAtom } from "jotai";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  experimental_Icon as RegisteredIcon,
  experimental_useThreadActionRegistrations,
  type PluginThreadActionRegistrationInfo,
} from "@get-bb/plugin-sdk/app";
import { THREAD_ROW_ACTION_LIMIT } from "../../shared/preferences.js";
import { arrayMove } from "../model/array-move.js";
import { threadRowActionsAtom } from "../preferences/atoms.js";
import { useSidebarReorderDnd } from "@/components/ui/use-sidebar-reorder-dnd";
import { SidebarTouchSensor } from "../dnd/sidebarTouchSensor.js";
import { useSidebarSortable } from "@/components/ui/sortable-motion";
import { SIDEBAR_CONTROL_BUTTON_CLASS } from "@/components/ui/sidebar-row-classes";

type RowActionSlot = string | null;

export function getRowActionSlots(enabled: readonly string[]): RowActionSlot[] {
  return [
    ...Array.from(
      { length: Math.max(0, THREAD_ROW_ACTION_LIMIT - enabled.length) },
      () => null,
    ),
    ...enabled.slice(0, THREAD_ROW_ACTION_LIMIT),
  ];
}

export function assignRowActionSlot(
  enabled: readonly string[],
  slotIndex: number,
  value: RowActionSlot,
): string[] {
  const slots = getRowActionSlots(enabled);
  const previous = slots[slotIndex] ?? null;
  const existingIndex = value === null ? -1 : slots.indexOf(value);
  if (existingIndex !== -1) slots[existingIndex] = previous;
  slots[slotIndex] = value;
  return slots.filter((slot): slot is string => slot !== null);
}

const CUSTOMIZE_ATTRIBUTE = "data-row-actions-customize";
const CUSTOMIZE_SELECTOR = `[${CUSTOMIZE_ATTRIBUTE}]`;
const SLOT_SELECTOR = "[data-sidebar-customize-launch]";

export function focusFirstRowActionSlot(root: Element | null | undefined) {
  root
    ?.querySelector<HTMLElement>(`${CUSTOMIZE_SELECTOR} ${SLOT_SELECTOR}`)
    ?.focus({ preventScroll: true });
}

function finishOnEscape(
  event: KeyboardEvent<HTMLElement>,
  onDone: (restoreFocus: boolean) => void,
) {
  if (
    event.key !== "Escape" ||
    !(event.target instanceof Node) ||
    !event.currentTarget.contains(event.target)
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  onDone(true);
}

export function ThreadRowActionsEditor({
  onDone,
}: {
  onDone: (restoreFocus: boolean) => void;
}) {
  const [enabled, setEnabled] = useAtom(threadRowActionsAtom);
  const registrations = experimental_useThreadActionRegistrations();
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
      if (typeof activeId !== "string" || typeof overId !== "string") return;
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
    touchSensor: SidebarTouchSensor,
  });

  return (
    <div
      ref={groupRef}
      role="group"
      aria-label="Row actions"
      {...{ [CUSTOMIZE_ATTRIBUTE]: "" }}
      className="relative z-10 flex shrink-0 items-center gap-1 pr-0.5"
      onClick={(event) => event.stopPropagation()}
      onClickCapture={onClickCapture}
      onKeyDown={(event) => finishOnEscape(event, onDone)}
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
              registrations={registrations}
              reorderDisabled={slot === null || enabled.length < 2}
              onChange={(value) => {
                if (value === slot) return false;
                const next = assignRowActionSlot(enabled, index, value);
                focusSlot.current =
                  value === null
                    ? index
                    : getRowActionSlots(next).indexOf(value);
                setEnabled(next);
                return true;
              }}
            />
          ))}
        </SortableContext>
      </DndContext>
      <Button
        type="button"
        size="sm"
        aria-label="Done"
        className="ml-0.5 h-6 shrink-0 gap-0.5 rounded-md px-1.5 text-xs font-normal focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-background/60 max-md:pointer-coarse:size-8 max-md:pointer-coarse:px-0"
        onClick={() => onDone(true)}
      >
        <Icon
          name="Check"
          className="size-3 max-md:pointer-coarse:size-4"
          aria-hidden
        />
        <span className="max-md:pointer-coarse:hidden">Done</span>
      </Button>
    </div>
  );
}

function isSlotPickerOpen(): boolean {
  return (
    document.querySelector(`${SLOT_SELECTOR}[aria-expanded="true"]`) !== null
  );
}

export function useFinishRowActionsOnOutsideClick(
  onDone: ((restoreFocus: boolean) => void) | null,
) {
  useEffect(() => {
    if (onDone === null) return;
    let pickerWasOpen = false;
    const handlePointerDown = () => {
      pickerWasOpen = isSlotPickerOpen();
    };
    const handleClick = (event: MouseEvent) => {
      const pickerClick = pickerWasOpen || isSlotPickerOpen();
      pickerWasOpen = false;
      if (pickerClick) return;
      if (
        event.target instanceof Element &&
        event.target.closest(CUSTOMIZE_SELECTOR)
      )
        return;
      onDone(false);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("click", handleClick, true);
    };
  }, [onDone]);
}

function RowActionSlotPicker({
  index,
  value,
  registrations,
  reorderDisabled,
  onChange,
}: {
  index: number;
  value: RowActionSlot;
  registrations: readonly PluginThreadActionRegistrationInfo[];
  reorderDisabled: boolean;
  onChange: (value: RowActionSlot) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const focusHandedOff = useRef(false);
  const { dragBindings, setNodeRef, style } = useSidebarSortable({
    id: value ?? `empty-${index}`,
    disabled: reorderDisabled,
  });
  const registration =
    value === null
      ? undefined
      : registrations.find((candidate) => candidate.key === value);
  const label = `Row action ${index + 1}: ${value === null ? "Empty" : (registration?.title ?? value)}`;
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
              "flex size-6 touch-none items-center justify-center border focus-visible:bg-state-hover focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sidebar-ring/60 max-md:pointer-coarse:size-8",
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
            <RegisteredIcon
              name={value === null ? "Plus" : (registration?.icon ?? "Puzzle")}
              className={cn(
                "size-3.5 max-md:pointer-coarse:size-4",
                value === null && "text-muted-foreground",
              )}
            />
          </button>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-44"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (focusHandedOff.current) {
            focusHandedOff.current = false;
            return;
          }
          buttonRef.current?.focus();
        }}
      >
        {registrations.map((candidate) => (
          <RowActionOption
            key={candidate.key}
            icon={candidate.icon}
            label={candidate.title}
            selected={value === candidate.key}
            onSelect={() => {
              focusHandedOff.current = onChange(candidate.key);
            }}
          />
        ))}
        {value !== null && (
          <>
            <DropdownMenuSeparator />
            <RowActionOption
              icon="EyeOff"
              label="Hide"
              selected={false}
              onSelect={() => {
                focusHandedOff.current = onChange(null);
              }}
            />
          </>
        )}
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
  icon: string;
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
      <RegisteredIcon name={icon} aria-hidden="true" />
      {label}
      <span className="ml-auto inline-flex size-4 shrink-0 items-center justify-center">
        {selected && <Icon name="Check" className="size-4" />}
      </span>
    </DropdownMenuItem>
  );
}
