import { useMemo, type CSSProperties, type ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { SettingsRowList } from "@/components/ui/settings-section";

const restrictDragToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

const sortableSettingsRowModifiers: Modifier[] = [restrictDragToVerticalAxis];

export function SortableSettingsRowList({
  ids,
  disabled,
  onReorder,
  children,
}: {
  ids: string[];
  disabled: boolean;
  onReorder: (activeId: string, overId: string) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent): void => {
    if (
      disabled ||
      typeof event.active.id !== "string" ||
      typeof event.over?.id !== "string"
    ) {
      return;
    }
    onReorder(event.active.id, event.over.id);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={sortableSettingsRowModifiers}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <SettingsRowList>{children}</SettingsRowList>
      </SortableContext>
    </DndContext>
  );
}

export function useSortableSettingsRow({
  id,
  disabled,
  label,
}: {
  id: string;
  disabled: boolean;
  label: string;
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id, disabled });
  const style = useMemo<CSSProperties>(
    () => ({ transform: CSS.Translate.toString(transform), transition }),
    [transform, transition],
  );
  const handle = (
    <Button
      ref={setActivatorNodeRef}
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "-ml-2 h-8 w-7 shrink-0 touch-none text-muted-foreground",
        !disabled && "cursor-grab active:cursor-grabbing",
      )}
      disabled={disabled}
      aria-label={`Reorder ${label}`}
      {...attributes}
      {...listeners}
    >
      <Icon name="DragDropVertical" aria-hidden="true" />
    </Button>
  );
  return { setNodeRef, style, isDragging, handle };
}
