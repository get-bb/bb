import { useCallback, useMemo, type MouseEventHandler } from "react";
import {
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DndContextProps,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
  useDragClickSuppression,
  type ConsumeDragClickSuppression,
} from "@/components/ui/use-drag-click-suppression";

/**
 * Sidebar reorder lists mix uneven row heights — a tall expanded parent next
 * to a collapsed leaf, or (for sections) a long Threads list beside a short
 * one. `closestCenter` keys off the dragged element's center, so a swap only
 * registers after you over-drag past a tall neighbor's center. Prefer the
 * droppable the pointer is actually over, falling back to center distance when
 * the pointer is outside every droppable (e.g. keyboard drag, which has none).
 */
const sidebarReorderCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

const restrictSidebarDragToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

const SIDEBAR_REORDER_MODIFIERS: Modifier[] = [
  restrictSidebarDragToVerticalAxis,
];

export interface UseSidebarReorderDndArgs {
  /**
   * Performs the reorder once a drag settles. The hook clears the drag-click
   * suppression timer before invoking it, so callers only own the reorder.
   */
  onDragEnd: (event: DragEndEvent) => void;
  /** Runs alongside the internal drag-click suppression on drag start. */
  onDragStart?: (event: DragStartEvent) => void;
  /** Live drag-over tracking (e.g. to preview/expand a hovered folder). */
  onDragOver?: (event: DragOverEvent) => void;
  /** Runs alongside the internal suppression reset when a drag is cancelled. */
  onDragCancel?: () => void;
}

export type SidebarReorderDndContextProps = Pick<
  DndContextProps,
  | "sensors"
  | "collisionDetection"
  | "onDragStart"
  | "onDragOver"
  | "onDragCancel"
  | "onDragEnd"
  | "modifiers"
>;

export interface UseSidebarReorderDndResult {
  /** Spread onto the surface's `DndContext`. */
  dndContextProps: SidebarReorderDndContextProps;
  /**
   * Swallows the click that ends a drag. Wire to the list container's
   * `onClickCapture` and/or hand to rows as their suppression source so the
   * drag-release click never selects a row.
   */
  consumeClickSuppression: ConsumeDragClickSuppression;
  onClickCapture: MouseEventHandler<HTMLElement>;
}

/**
 * Container-side reorder plumbing shared by every sortable sidebar surface
 * (sections, projects, pinned roots, parent-thread roots): the activation-tuned
 * sensors, the drag-click suppression glue, and the `DndContext` handler shell.
 * Pair with {@link useSidebarSortable} on the items inside the context.
 */
export function useSidebarReorderDnd({
  onDragEnd,
  onDragStart,
  onDragOver,
  onDragCancel,
}: UseSidebarReorderDndArgs): UseSidebarReorderDndResult {
  const {
    beginDragClickSuppression,
    clearDragClickSuppressionSoon,
    consumeDragClickSuppression,
  } = useDragClickSuppression();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      beginDragClickSuppression();
      onDragStart?.(event);
    },
    [beginDragClickSuppression, onDragStart],
  );
  const handleDragCancel = useCallback(() => {
    clearDragClickSuppressionSoon();
    onDragCancel?.();
  }, [clearDragClickSuppressionSoon, onDragCancel]);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      clearDragClickSuppressionSoon();
      onDragEnd(event);
    },
    [clearDragClickSuppressionSoon, onDragEnd],
  );
  const onClickCapture = useCallback<MouseEventHandler<HTMLElement>>(
    (event) => {
      if (!consumeDragClickSuppression()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [consumeDragClickSuppression],
  );
  const dndContextProps = useMemo<SidebarReorderDndContextProps>(
    () => ({
      sensors,
      collisionDetection: sidebarReorderCollisionDetection,
      modifiers: SIDEBAR_REORDER_MODIFIERS,
      onDragStart: handleDragStart,
      onDragOver,
      onDragCancel: handleDragCancel,
      onDragEnd: handleDragEnd,
    }),
    [handleDragCancel, handleDragEnd, handleDragStart, onDragOver, sensors],
  );

  return {
    dndContextProps,
    consumeClickSuppression: consumeDragClickSuppression,
    onClickCapture,
  };
}
