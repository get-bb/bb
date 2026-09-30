import { COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { cn } from "@/lib/utils";
import type { ClientRect, Modifier } from "@dnd-kit/core";
import { getEventCoordinates } from "@dnd-kit/utilities";
import { useMemo } from "react";
import type { CSSProperties } from "react";
import {
  getSidebarThreadRowPaddingLeft,
  SIDEBAR_ROW_BASE_CLASS,
} from "../rows/sidebarRowClasses.js";

export const SIDEBAR_THREAD_DRAG_CHIP_CLASS = cn(
  SIDEBAR_ROW_BASE_CLASS,
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  "pointer-events-none w-fit max-w-56 bg-sidebar-accent pr-2 text-sidebar-accent-foreground shadow-sm ring-1 ring-sidebar-border",
);

export const SIDEBAR_THREAD_DRAG_CHIP_STYLE = {
  paddingLeft: `${getSidebarThreadRowPaddingLeft(0)}px`,
} satisfies CSSProperties;

export function SidebarThreadDragChip({
  title,
  className,
  visualOnly = false,
}: {
  title: string;
  className?: string;
  visualOnly?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      data-sidebar-section-drag-overlay="true"
      data-sidebar-touch-armed-chip={visualOnly ? "" : undefined}
      style={SIDEBAR_THREAD_DRAG_CHIP_STYLE}
      className={cn(SIDEBAR_THREAD_DRAG_CHIP_CLASS, className)}
    >
      {visualOnly ? (
        <span
          data-sidebar-drag-title={title}
          className="min-w-0 flex-1 truncate before:content-[attr(data-sidebar-drag-title)]"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{title}</span>
      )}
    </div>
  );
}

export function createSnapSidebarThreadDragChipToCursor(): Modifier {
  let overlayOriginRect: ClientRect | null = null;
  return ({
    activatorEvent,
    active,
    activeNodeRect,
    draggingNodeRect,
    transform,
  }) => {
    if (active === null) {
      overlayOriginRect = null;
      return transform;
    }
    overlayOriginRect ??= activeNodeRect;
    if (
      overlayOriginRect === null ||
      draggingNodeRect === null ||
      activatorEvent === null
    ) {
      return transform;
    }
    const coordinates = getEventCoordinates(activatorEvent);
    if (coordinates === null) return transform;
    return {
      ...transform,
      x:
        transform.x +
        coordinates.x -
        overlayOriginRect.left -
        draggingNodeRect.width / 2,
      y:
        transform.y +
        coordinates.y -
        overlayOriginRect.top -
        draggingNodeRect.height / 2,
    };
  };
}

export function useSidebarThreadDragOverlayModifiers(): Modifier[] {
  return useMemo(() => [createSnapSidebarThreadDragChipToCursor()], []);
}
