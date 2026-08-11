import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MouseEventHandler,
} from "react";
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
export const sidebarReorderCollisionDetection: CollisionDetection = (args) => {
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

function setSidebarDraggingCursor(active: boolean): void {
  if (active) {
    document.body.dataset.sidebarDragging = "true";
    return;
  }
  delete document.body.dataset.sidebarDragging;
}

interface UseSidebarReorderDndArgs {
  /**
   * Performs the reorder once a drag settles. The hook clears the drag-click
   * suppression timer before invoking it, so callers only own the reorder.
   */
  onDragEnd: (event: DragEndEvent) => void;
  /** Runs alongside the internal drag-click suppression on drag start. */
  onDragStart?: (event: DragStartEvent) => void;
  /** Live drag-over tracking (e.g. to preview/expand a hovered section). */
  onDragOver?: (event: DragOverEvent) => void;
  /** Runs alongside the internal suppression reset when a drag is cancelled. */
  onDragCancel?: () => void;
  /**
   * Overrides target selection for surfaces that combine nested draggable
   * levels in one context. Ordinary one-level lists use the shared default.
   */
  collisionDetection?: CollisionDetection;
  /** Modifies the drag transform; ordinary sidebar lists stay vertical-only. */
  modifiers?: Modifier[];
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

interface UseSidebarReorderDndResult {
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
  collisionDetection = sidebarReorderCollisionDetection,
  modifiers = SIDEBAR_REORDER_MODIFIERS,
}: UseSidebarReorderDndArgs): UseSidebarReorderDndResult {
  const {
    beginDragClickSuppression,
    clearDragClickSuppressionSoon,
    consumeDragClickSuppression,
  } = useDragClickSuppression();
  const isDraggingRef = useRef(false);
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
      isDraggingRef.current = true;
      setSidebarDraggingCursor(true);
      beginDragClickSuppression();
      onDragStart?.(event);
    },
    [beginDragClickSuppression, onDragStart],
  );
  const handleDragCancel = useCallback(() => {
    if (!isDraggingRef.current) {
      return;
    }
    isDraggingRef.current = false;
    setSidebarDraggingCursor(false);
    clearDragClickSuppressionSoon();
    onDragCancel?.();
  }, [clearDragClickSuppressionSoon, onDragCancel]);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      isDraggingRef.current = false;
      setSidebarDraggingCursor(false);
      clearDragClickSuppressionSoon();
      onDragEnd(event);
    },
    [clearDragClickSuppressionSoon, onDragEnd],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.code === "Escape") {
        // Split tear-out hands the gesture off by dispatching Escape. dnd-kit
        // can consume that while its drag is still initializing without
        // invoking DndContext's public onDragCancel callback, so clear the
        // sidebar-owned cursor and projected-drag state directly as well.
        handleDragCancel();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      isDraggingRef.current = false;
      setSidebarDraggingCursor(false);
    };
  }, [handleDragCancel]);
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
      collisionDetection,
      modifiers,
      onDragStart: handleDragStart,
      onDragOver,
      onDragCancel: handleDragCancel,
      onDragEnd: handleDragEnd,
    }),
    [
      collisionDetection,
      handleDragCancel,
      handleDragEnd,
      handleDragStart,
      modifiers,
      onDragOver,
      sensors,
    ],
  );

  return {
    dndContextProps,
    consumeClickSuppression: consumeDragClickSuppression,
    onClickCapture,
  };
}
