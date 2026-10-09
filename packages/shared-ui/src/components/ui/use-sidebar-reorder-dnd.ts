import { useCallback, useEffect } from "react";
import type {
  DragEndEvent,
  DragStartEvent,
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

type UseSidebarReorderDndArgs = UseReorderDndArgs & {
  touchSensor: Sensor<TouchSensorOptions>;
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
  });
}
