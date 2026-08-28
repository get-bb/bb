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
  onDragEnd: (event: DragEndEvent) => void;
  onDragStart?: (event: DragStartEvent) => void;
  onDragOver?: (event: DragOverEvent) => void;
  onDragCancel?: () => void;
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
  dndContextProps: SidebarReorderDndContextProps;
  consumeClickSuppression: ConsumeDragClickSuppression;
  onClickCapture: MouseEventHandler<HTMLElement>;
}

function shouldInstallSidebarTouchMoveListener(): boolean {
  return (
    !getMediaQuerySnapshot(COMPACT_VIEWPORT_QUERY) ||
    isCompactSidebarDrawerShowing()
  );
}

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
