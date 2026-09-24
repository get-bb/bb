import { useCallback, useEffect } from "react";
import {
  TouchSensor,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  useReorderDnd,
  type UseReorderDndArgs,
  type UseReorderDndResult,
} from "../ui/useReorderDnd.js";

function setSidebarDraggingCursor(active: boolean): void {
  if (active) {
    document.body.dataset.sidebarDragging = "true";
    return;
  }
  delete document.body.dataset.sidebarDragging;
}

type UseSidebarReorderDndArgs = Omit<UseReorderDndArgs, "touchSensor">;

export class SidebarTouchSensor extends TouchSensor {
  static override setup(): () => void {
    if (typeof window === "undefined") {
      return () => {};
    }
    const noop = () => {};
    window.addEventListener("touchmove", noop, {
      capture: false,
      passive: false,
    });
    return () => {
      window.removeEventListener("touchmove", noop);
    };
  }
}

export function useSidebarReorderDnd({
  onDragEnd,
  onDragStart,
  onDragMove,
  onDragOver,
  onDragCancel,
  collisionDetection,
  axis,
  measuring,
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
    touchSensor: SidebarTouchSensor,
    axis,
    measuring,
  });
}
