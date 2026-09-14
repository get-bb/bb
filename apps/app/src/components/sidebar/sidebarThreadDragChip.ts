import { COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { cn } from "@bb/shared-ui/lib/utils";
import type { Modifier } from "@dnd-kit/core";
import { getEventCoordinates } from "@dnd-kit/utilities";
import type { CSSProperties } from "react";
import {
  getSidebarThreadRowPaddingLeft,
  SIDEBAR_ROW_BASE_CLASS,
} from "./sidebarRowClasses";

export const SIDEBAR_THREAD_DRAG_CHIP_CLASS = cn(
  SIDEBAR_ROW_BASE_CLASS,
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  "pointer-events-none w-fit max-w-56 bg-sidebar-accent pr-2 text-sidebar-accent-foreground shadow-sm ring-1 ring-sidebar-border",
);

export const SIDEBAR_THREAD_DRAG_CHIP_STYLE = {
  paddingLeft: `${getSidebarThreadRowPaddingLeft(0)}px`,
} satisfies CSSProperties;

export const snapSidebarThreadDragChipToCursor: Modifier = ({
  activatorEvent,
  draggingNodeRect,
  transform,
}) => {
  if (draggingNodeRect === null || activatorEvent === null) return transform;
  const coordinates = getEventCoordinates(activatorEvent);
  if (coordinates === null) return transform;
  return {
    ...transform,
    x:
      transform.x +
      coordinates.x -
      draggingNodeRect.left -
      draggingNodeRect.width / 2,
    y:
      transform.y +
      coordinates.y -
      draggingNodeRect.top -
      draggingNodeRect.height / 2,
  };
};

export const SIDEBAR_THREAD_DRAG_OVERLAY_MODIFIERS = [
  snapSidebarThreadDragChipToCursor,
];
