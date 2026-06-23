import { useMemo, type CSSProperties } from "react";
import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const SIDEBAR_SORTABLE_TRANSITION = {
  duration: 160,
  easing: "cubic-bezier(0.2, 0, 0, 1)",
};

/**
 * Drag-handle plumbing shared by every sortable sidebar surface (sections,
 * projects, pinned roots, manager roots). Spread `attributes`/`listeners` onto
 * the activator element and wire `setActivatorNodeRef` to it.
 */
export interface SidebarSortableDragBindings {
  attributes: DraggableAttributes;
  disabled: boolean;
  listeners: DraggableSyntheticListeners;
  setActivatorNodeRef: (element: HTMLElement | null) => void;
}

export interface UseSidebarSortableArgs {
  id: string;
  disabled: boolean;
}

export interface UseSidebarSortableResult {
  dragBindings: SidebarSortableDragBindings;
  setNodeRef: (element: HTMLElement | null) => void;
  style: CSSProperties;
}

/**
 * Wires one sortable sidebar row to dnd-kit and produces the wrapper `style`
 * plus the `dragBindings` its activator needs. Every sidebar reorder surface
 * shares this so their drag presentation can't drift apart again.
 */
export function useSidebarSortable({
  id,
  disabled,
}: UseSidebarSortableArgs): UseSidebarSortableResult {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id, disabled, transition: SIDEBAR_SORTABLE_TRANSITION });
  const style = useMemo<CSSProperties>(
    () => ({
      // Vertical lists only translate. `CSS.Transform.toString` would also emit
      // the scaleX/scaleY dnd-kit derives for differently-sized list items,
      // visibly squishing the dragged row.
      transform: CSS.Translate.toString(transform),
      transition,
      // Each sticky row/header isolates its own stacking context
      // (`isolation: isolate`), so a dragged row paints behind its siblings
      // unless we lift it above them while dragging.
      position: isDragging ? "relative" : undefined,
      zIndex: isDragging ? 20 : undefined,
      opacity: isDragging ? 0.8 : undefined,
    }),
    [isDragging, transform, transition],
  );
  const dragBindings = useMemo<SidebarSortableDragBindings>(
    () => ({ attributes, disabled, listeners, setActivatorNodeRef }),
    [attributes, disabled, listeners, setActivatorNodeRef],
  );

  return { dragBindings, setNodeRef, style };
}
