import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
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
    <div
      ref={groupRef}
      role="group"
      aria-label="Row actions"
      {...{ [CUSTOMIZE_ATTRIBUTE]: "" }}
      className="relative z-10 flex shrink-0 items-center gap-0.5"
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
      <span
        aria-hidden="true"
        className={cn(
          SIDEBAR_CONTROL_BUTTON_CLASS,
          "pointer-events-none flex items-center justify-center text-muted-foreground",
        )}
      >
        <Icon
          name="MoreHorizontal"
          className={COARSE_POINTER_ICON_SIZE_CLASS}
        />
      </span>
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

export function ThreadRowActionsCustomizeFooter({
  onDone,
  style,
}: {
  onDone: (restoreFocus: boolean) => void;
  style: CSSProperties;
}) {
  return (
    <div
      {...{ [CUSTOMIZE_ATTRIBUTE]: "" }}
      className="flex items-center gap-2 pr-1"
      style={style}
      onKeyDown={(event) => finishOnEscape(event, onDone)}
    >
      <p className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">
        Shown on hover for every thread.
      </p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 shrink-0 px-2 text-xs text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent focus-visible:ring-2 max-md:pointer-coarse:h-9 max-md:pointer-coarse:text-sm"
        onClick={() => onDone(true)}
      >
        Done
      </Button>
    </div>
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
  onChange: (value: RowActionSlot) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const focusHandedOff = useRef(false);
  const { dragBindings, setNodeRef, style } = useSidebarSortable({
    id: value ?? `empty-${index}`,
    disabled: reorderDisabled,
  });
  const label = `Row action ${index + 1}: ${value === null ? "Empty" : THREAD_ROW_ACTIONS[value].label}`;
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
            <Icon
              name={value === null ? "Plus" : THREAD_ROW_ACTIONS[value].icon}
              className={cn(
                COARSE_POINTER_ICON_SIZE_CLASS,
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
        {THREAD_ROW_ACTION_IDS.map((id) => (
          <RowActionOption
            key={id}
            icon={THREAD_ROW_ACTIONS[id].icon}
            label={THREAD_ROW_ACTIONS[id].label}
            selected={value === id}
            onSelect={() => {
              focusHandedOff.current = onChange(id);
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
