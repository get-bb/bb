import { useMemo, type CSSProperties } from "react";
import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
  DropAnimation,
} from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const SIDEBAR_SORTABLE_TRANSITION = {
  duration: 160,
  easing: "cubic-bezier(0.2, 0, 0, 1)",
};

/**
 * Drop animation for sidebar `DragOverlay`s — the overlay flies back onto the
 * row the thread will land on, with dnd-kit's side effects switched off.
 *
 * dnd-kit's default side effect hides the drag source by writing `opacity: 0`
 * directly onto its DOM node, then restores the value it captured at drop time
 * from `animation.onfinish`. Sidebar rows dim their drag source through a
 * React-owned inline opacity (below, and the section-thread ghost row in
 * `ProjectRow`), so that restore is a raw DOM write racing React: it only has
 * to land after the drop-settle window clears the ghost — main-thread work from
 * the move mutation is enough — and the dim value is re-applied permanently.
 * React's committed style no longer carries an opacity, so there is nothing
 * left for it to diff away and the row stays greyed out until it remounts.
 * With side effects off the source row's opacity stays owned by React alone,
 * and the dimmed row reads as the landing slot while the overlay animates onto
 * it.
 */
export const SIDEBAR_DRAG_OVERLAY_DROP_ANIMATION: DropAnimation = {
  duration: 180,
  easing: "cubic-bezier(0.2, 0, 0, 1)",
  sideEffects: null,
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

interface UseSidebarSortableArgs {
  id: string;
  disabled: boolean;
}

interface UseSidebarSortableResult {
  dragBindings: SidebarSortableDragBindings;
  isOver: boolean;
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
    isOver,
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
      // Sticky sidebar tiers paint as high as z-index 60 and include opaque
      // shields around their sticky gaps. Lift the entire dragged group above
      // that stack so its label never disappears underneath a peer header.
      position: isDragging ? "relative" : undefined,
      zIndex: isDragging ? 100 : undefined,
      // React owns this opacity. Any overlay animating over a sidebar row must
      // use SIDEBAR_DRAG_OVERLAY_DROP_ANIMATION so dnd-kit never captures and
      // restores it behind React's back.
      opacity: isDragging ? 0.8 : undefined,
    }),
    [isDragging, transform, transition],
  );
  const dragBindings = useMemo<SidebarSortableDragBindings>(
    () => ({ attributes, disabled, listeners, setActivatorNodeRef }),
    [attributes, disabled, listeners, setActivatorNodeRef],
  );

  return { dragBindings, isOver, setNodeRef, style };
}
