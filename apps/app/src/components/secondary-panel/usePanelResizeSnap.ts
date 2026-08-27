import { useCallback, useEffect, useRef } from "react";
import {
  createSplitResizeSnapSession,
  SPLIT_RESIZE_SNAP_RELEASE_PX,
  type SplitResizeAxis,
  type SplitResizeGridTarget,
} from "@/lib/split-resize-snap";

const OUTER_PANEL_SNAP_RELEASE_PX = SPLIT_RESIZE_SNAP_RELEASE_PX * 1.25;

interface UsePanelResizeSnapArgs {
  axis: SplitResizeAxis;
  onResize: (leadingFraction: number) => void;
  target: SplitResizeGridTarget;
}

/**
 * Gives react-resizable-panels' outer divider the same single-writer drag path
 * as bb's other split dividers. A window-capture listener resolves every
 * pointer sample through the shared magnetic grid before the panel library's
 * body listener can apply a second raw layout.
 */
export function usePanelResizeSnap({
  axis,
  onResize,
  target,
}: UsePanelResizeSnapArgs): (event: PointerEvent) => void {
  const { boundaryIndex, childCount } = target;
  const cleanupRef = useRef<(() => void) | null>(null);
  const clear = useCallback(() => {
    const cleanup = cleanupRef.current;
    cleanupRef.current = null;
    cleanup?.();
  }, []);

  useEffect(() => clear, [clear]);

  return useCallback(
    (event: PointerEvent) => {
      clear();
      const eventTarget = event.target;
      if (!(eventTarget instanceof HTMLElement)) return;
      const divider = eventTarget.closest<HTMLElement>(
        "[data-panel-resize-snap-handle]",
      );
      if (divider === null) return;
      const previous = divider.previousElementSibling;
      const next = divider.nextElementSibling;
      if (
        !(previous instanceof HTMLElement) ||
        !(next instanceof HTMLElement)
      ) {
        return;
      }
      const previousRect = previous.getBoundingClientRect();
      const nextRect = next.getBoundingClientRect();
      const start = axis === "x" ? previousRect.left : previousRect.top;
      const end = axis === "x" ? nextRect.right : nextRect.bottom;
      if (end <= start) return;

      const snapSession = createSplitResizeSnapSession(
        divider,
        axis,
        {
          boundaryIndex,
          childCount,
        },
        {
          // The panel library mediates this divider rather than letting bb move
          // its adjacent flex panes directly, so the same numeric band feels
          // lighter. A modestly longer hold restores perceptual parity without
          // changing capture or the direct split defaults.
          releasePx: OUTER_PANEL_SNAP_RELEASE_PX,
        },
      );
      const grid = divider.closest<HTMLElement>(
        "[data-split-resize-grid-root]",
      );
      const transitionDuration = grid?.style.getPropertyValue(
        "--panel-collapse-duration",
      );
      const transitionPriority = grid?.style.getPropertyPriority(
        "--panel-collapse-duration",
      );
      grid?.style.setProperty("--panel-collapse-duration", "0ms");
      const pointerId = event.pointerId;
      const pointer = axis === "x" ? event.clientX : event.clientY;
      snapSession.resolve({ end, pointer, start });

      const ownerDocument = divider.ownerDocument;
      const ownerWindow = ownerDocument.defaultView;
      if (ownerWindow === null) {
        snapSession.clear();
        return;
      }

      let finished = false;
      const move = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        if (moveEvent.buttons === 0) {
          clear();
          return;
        }
        moveEvent.preventDefault();
        moveEvent.stopPropagation();
        const nextPointer =
          axis === "x" ? moveEvent.clientX : moveEvent.clientY;
        const result = snapSession.resolve({
          end,
          pointer: nextPointer,
          start,
        });
        onResize(result.fraction);
      };
      const finish = (finishEvent?: PointerEvent) => {
        if (finishEvent !== undefined && finishEvent.pointerId !== pointerId) {
          return;
        }
        if (finished) return;
        finished = true;
        ownerWindow.removeEventListener("pointermove", move, true);
        ownerWindow.removeEventListener("pointerup", finish, true);
        ownerWindow.removeEventListener("pointercancel", finish, true);
        ownerWindow.removeEventListener("mouseup", finishOnMouseUp, true);
        ownerWindow.removeEventListener("blur", finishOnBlur);
        snapSession.clear();
        if (grid !== null) {
          if (transitionDuration === "" || transitionDuration === undefined) {
            grid.style.removeProperty("--panel-collapse-duration");
          } else {
            grid.style.setProperty(
              "--panel-collapse-duration",
              transitionDuration,
              transitionPriority,
            );
          }
        }
        if (cleanupRef.current === finish) cleanupRef.current = null;
      };
      const finishOnMouseUp = () => finish();
      const finishOnBlur = () => finish();

      cleanupRef.current = finish;
      ownerWindow.addEventListener("pointermove", move, true);
      ownerWindow.addEventListener("pointerup", finish, true);
      ownerWindow.addEventListener("pointercancel", finish, true);
      ownerWindow.addEventListener("mouseup", finishOnMouseUp, true);
      ownerWindow.addEventListener("blur", finishOnBlur);
    },
    [axis, boundaryIndex, childCount, clear, onResize],
  );
}
