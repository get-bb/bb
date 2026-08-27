import { useCallback, useEffect, useRef } from "react";
import {
  createSplitResizeSnapSession,
  type SplitResizeAxis,
  type SplitResizeGridTarget,
} from "@/lib/split-resize-snap";

interface UsePanelResizeSnapArgs {
  axis: SplitResizeAxis;
  onSnap: (leadingFraction: number) => void;
  target: SplitResizeGridTarget;
}

/**
 * Bridges react-resizable-panels' outer divider into bb's shared magnetic
 * split grid. The library applies its raw pointer layout first; this listener
 * runs afterward and overrides only samples captured by the snap session.
 */
export function usePanelResizeSnap({
  axis,
  onSnap,
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
        { boundaryIndex, childCount },
      );
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
        const nextPointer =
          axis === "x" ? moveEvent.clientX : moveEvent.clientY;
        const result = snapSession.resolve({
          end,
          pointer: nextPointer,
          start,
        });
        if (result.snapped) onSnap(result.fraction);
      };
      const finish = (finishEvent?: PointerEvent) => {
        if (finishEvent !== undefined && finishEvent.pointerId !== pointerId) {
          return;
        }
        if (finished) return;
        finished = true;
        ownerDocument.body.removeEventListener("pointermove", move, true);
        ownerWindow.removeEventListener("pointerup", finish, true);
        ownerWindow.removeEventListener("pointercancel", finish, true);
        ownerWindow.removeEventListener("blur", finishOnBlur);
        snapSession.clear();
        if (cleanupRef.current === finish) cleanupRef.current = null;
      };
      const finishOnBlur = () => finish();

      cleanupRef.current = finish;
      // react-resizable-panels installs its body capture listener first. The
      // shared snap listener is added after pointer-down so it sees and can
      // override the library's raw layout within the same event turn.
      ownerDocument.body.addEventListener("pointermove", move, true);
      ownerWindow.addEventListener("pointerup", finish, true);
      ownerWindow.addEventListener("pointercancel", finish, true);
      ownerWindow.addEventListener("blur", finishOnBlur);
    },
    [axis, boundaryIndex, childCount, clear, onSnap],
  );
}
