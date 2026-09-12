import { useCallback, useEffect, useRef } from "react";
import {
  createSplitResizeFlexPair,
  createSplitResizeSnapSession,
  type SplitResizeAxis,
  type SplitResizeGridTarget,
} from "@/lib/split-resize-snap";

interface UsePanelResizeSnapArgs {
  axis: SplitResizeAxis;
  onResize: (leadingFraction: number) => void;
  target: SplitResizeGridTarget;
}

interface PanelResizeSnapDrag {
  cancel: () => void;
  finish: () => void;
}

export interface PanelResizeSnapController {
  finish: () => void;
  onPointerDownCapture: (event: PointerEvent) => void;
}

export function usePanelResizeSnap({
  axis,
  onResize,
  target,
}: UsePanelResizeSnapArgs): PanelResizeSnapController {
  const { boundaryIndex, childCount } = target;
  const activeDragRef = useRef<PanelResizeSnapDrag | null>(null);
  const finish = useCallback(() => {
    const activeDrag = activeDragRef.current;
    activeDragRef.current = null;
    activeDrag?.finish();
  }, []);
  const cancel = useCallback(() => {
    const activeDrag = activeDragRef.current;
    activeDragRef.current = null;
    activeDrag?.cancel();
  }, []);

  useEffect(() => cancel, [cancel]);

  const onPointerDownCapture = useCallback(
    (event: PointerEvent) => {
      finish();
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

      const ownerWindow = divider.ownerDocument.defaultView;
      if (ownerWindow === null) return;
      const pair = createSplitResizeFlexPair(previous, next, ownerWindow);
      const snapSession = createSplitResizeSnapSession(divider, axis, {
        boundaryIndex,
        childCount,
      });
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

      let finished = false;
      let pendingFraction: number | null = null;
      const move = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        if (moveEvent.buttons === 0) {
          finish();
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
        pendingFraction = result.fraction;
        pair.apply(result.fraction);
      };
      const complete = (commit: boolean) => {
        if (finished) return;
        finished = true;
        ownerWindow.removeEventListener("pointermove", move, true);
        ownerWindow.removeEventListener("pointerup", finishForPointer, true);
        ownerWindow.removeEventListener(
          "pointercancel",
          finishForPointer,
          true,
        );
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
        if (
          activeDragRef.current?.finish === commitDrag ||
          activeDragRef.current?.cancel === cancelDrag
        ) {
          activeDragRef.current = null;
        }
        if (commit && pendingFraction !== null) {
          onResize(pendingFraction);
          return;
        }
        if (!commit) {
          pair.restore();
        }
      };
      const commitDrag = () => complete(true);
      const cancelDrag = () => complete(false);
      const finishForPointer = (finishEvent: PointerEvent) => {
        if (finishEvent.pointerId !== pointerId) return;
        commitDrag();
      };
      const finishOnMouseUp = () => commitDrag();
      const finishOnBlur = () => commitDrag();

      activeDragRef.current = { cancel: cancelDrag, finish: commitDrag };
      ownerWindow.addEventListener("pointermove", move, true);
      ownerWindow.addEventListener("pointerup", finishForPointer, true);
      ownerWindow.addEventListener("pointercancel", finishForPointer, true);
      ownerWindow.addEventListener("mouseup", finishOnMouseUp, true);
      ownerWindow.addEventListener("blur", finishOnBlur);
    },
    [axis, boundaryIndex, childCount, finish, onResize],
  );

  return { finish, onPointerDownCapture };
}
