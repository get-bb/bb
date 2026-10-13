import { useCallback, useEffect } from "react";
import type {
  DragEndEvent,
  DragStartEvent,
  PointerActivationConstraint,
  Sensor,
  TouchSensorOptions,
} from "@dnd-kit/core";
import {
  useReorderDnd,
  type UseReorderDndArgs,
  type UseReorderDndResult,
} from "./use-reorder-dnd";

function setSidebarDraggingCursor(active: boolean): void {
  if (active) {
    document.body.dataset.sidebarDragging = "true";
    return;
  }
  delete document.body.dataset.sidebarDragging;
}

type UseSidebarReorderDndArgs = Omit<UseReorderDndArgs, "mouseActivation"> & {
  touchSensor: Sensor<TouchSensorOptions>;
};

/**
 * Sidebar rows are clicked far more often than they are dragged, and the click
 * that switches threads usually happens with the hand already moving toward
 * the next row. Any distance budget prices that drift in lost clicks -- 4px was
 * unusable and 8px still dropped them -- because crossing it starts a drag, and
 * dnd-kit answers a drag by suppressing the click the browser fires on release.
 *
 * Time decides instead. A press that lets go inside the delay never activates,
 * whatever it did with the pointer, so its click always lands; drifting past
 * the tolerance cancels the press outright rather than promoting it. Dragging a
 * row now costs a brief hold before the pointer moves, and the delay is long
 * enough that a deliberate, slow click is still a click.
 */
const SIDEBAR_MOUSE_ACTIVATION: PointerActivationConstraint = {
  delay: 250,
  tolerance: 8,
};

export function useSidebarReorderDnd({
  onDragEnd,
  onDragStart,
  onDragMove,
  onDragOver,
  onDragCancel,
  collisionDetection,
  axis,
  measuring,
  touchSensor,
}: UseSidebarReorderDndArgs): UseReorderDndResult {
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      setSidebarDraggingCursor(true);
      onDragStart?.(event);
    },
    [onDragStart],
  );
  const handleDragCancel = useCallback(() => {
    setSidebarDraggingCursor(false);
    onDragCancel?.();
  }, [onDragCancel]);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setSidebarDraggingCursor(false);
      onDragEnd(event);
    },
    [onDragEnd],
  );

  useEffect(() => {
    return () => {
      setSidebarDraggingCursor(false);
    };
  }, []);

  return useReorderDnd({
    onDragEnd: handleDragEnd,
    onDragStart: handleDragStart,
    onDragMove,
    onDragOver,
    onDragCancel: handleDragCancel,
    collisionDetection,
    touchSensor,
    axis,
    measuring,
    mouseActivation: SIDEBAR_MOUSE_ACTIVATION,
  });
}
