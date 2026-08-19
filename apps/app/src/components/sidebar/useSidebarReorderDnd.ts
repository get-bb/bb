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
import { COMPACT_VIEWPORT_QUERY } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  getMediaQuerySnapshot,
  subscribeMediaQuery,
} from "@bb/shared-ui/hooks/use-media-query";
import {
  isCompactSidebarDrawerShowing,
  subscribeCompactSidebarDrawerShowing,
} from "@/components/ui/sidebar-mobile-drawer-visibility.js";
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

function shouldInstallSidebarTouchMoveListener(): boolean {
  return (
    !getMediaQuerySnapshot(COMPACT_VIEWPORT_QUERY) ||
    isCompactSidebarDrawerShowing()
  );
}

/**
 * dnd-kit's `TouchSensor` with drawer-aware setup.
 *
 * `TouchSensor.setup()` registers a permanent NON-passive window `touchmove`
 * no-op for as long as any `DndContext` using it is mounted; dnd-kit needs it
 * so a `preventDefault` from a listener added mid-gesture still works on iOS
 * Safari. The compact sidebar is mounted at boot inside its closed drawer, so
 * on phones that listener used to exist on every page, and iOS Safari and
 * Chrome Android then dispatched the first `touchmove` of EVERY scroll gesture
 * synchronously through the main thread before compositor scrolling could
 * start. This subclass installs the same listener only while the compact
 * drawer is showing (touch reorder keeps working there) and always on wide
 * layouts. It tracks the drawer through a tiny external store instead of the
 * sidebar context, so no memoized row re-renders on drawer toggles.
 */
export class SidebarTouchSensor extends TouchSensor {
  static override setup(): () => void {
    if (typeof window === "undefined") {
      return () => {};
    }
    const noop = () => {};
    let installed = false;
    const sync = () => {
      const wanted = shouldInstallSidebarTouchMoveListener();
      if (wanted && !installed) {
        // Non-passive and non-capturing, exactly as dnd-kit installs it.
        window.addEventListener("touchmove", noop, {
          capture: false,
          passive: false,
        });
        installed = true;
      } else if (!wanted && installed) {
        window.removeEventListener("touchmove", noop);
        installed = false;
      }
    };
    sync();
    const unsubscribeDrawer = subscribeCompactSidebarDrawerShowing(sync);
    const unsubscribeViewport = subscribeMediaQuery(
      COMPACT_VIEWPORT_QUERY,
      sync,
    );
    return () => {
      unsubscribeDrawer();
      unsubscribeViewport();
      if (installed) {
        window.removeEventListener("touchmove", noop);
        installed = false;
      }
    };
  }
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
}: UseSidebarReorderDndArgs): UseSidebarReorderDndResult {
  const {
    beginDragClickSuppression,
    clearDragClickSuppressionSoon,
    consumeDragClickSuppression,
  } = useDragClickSuppression();
  const isDraggingRef = useRef(false);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(SidebarTouchSensor, {
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
      modifiers: SIDEBAR_REORDER_MODIFIERS,
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
