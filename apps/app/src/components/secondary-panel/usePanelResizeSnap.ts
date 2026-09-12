import { useCallback, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import {
  createSplitResizeSnapSession,
  type SplitResizeAxis,
  type SplitResizeGridTarget,
} from "@/lib/split-resize-snap";

interface UsePanelResizeSnapArgs {
  axis: SplitResizeAxis;
  minFraction: number;
  maxFraction: number;
  onResize: (leadingFraction: number) => void;
  onDragging: (isDragging: boolean) => void;
  target: SplitResizeGridTarget;
}

interface PanelResizeSnapDrag {
  cancel: () => void;
  finish: () => void;
}

export function usePanelResizeSnap({
  axis,
  minFraction,
  maxFraction,
  onResize,
  onDragging,
  target,
}: UsePanelResizeSnapArgs) {
  const { boundaryIndex, childCount } = target;
  const hitTargetRef = useRef<HTMLSpanElement>(null);
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
      const eventTarget = event.target;
      if (!(eventTarget instanceof HTMLElement)) return;
      const divider = eventTarget.closest<HTMLElement>(
        "[data-panel-resize-snap-handle]",
      );
      if (
        divider === null ||
        hitTargetRef.current?.parentElement !== divider ||
        divider.getAttribute("data-panel-resize-handle-enabled") !== "true" ||
        event.button !== 0
      ) return;
      finish();
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
      event.preventDefault();
      event.stopPropagation();
      divider.focus({ preventScroll: true });
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
      divider.setPointerCapture(pointerId);
      divider.dataset.dragging = "true";
      const pointer = axis === "x" ? event.clientX : event.clientY;
      snapSession.resolve({ end, pointer, start });

      let finished = false;
      let pendingFraction: number | null = null;
      let frame: number | null = null;
      const applyResize = () => {
        frame = null;
        const fraction = pendingFraction;
        pendingFraction = null;
        if (fraction !== null) onResize(fraction);
      };
      const flushResize = () => {
        if (frame !== null) ownerWindow.cancelAnimationFrame(frame);
        flushSync(applyResize);
      };
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
        const fraction = Math.max(
          minFraction,
          Math.min(maxFraction, result.fraction),
        );
        pendingFraction = fraction;
        if (frame === null) {
          frame = ownerWindow.requestAnimationFrame(applyResize);
        }
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
        divider.removeEventListener("keydown", flushResize, true);
        divider.removeEventListener("lostpointercapture", finishForPointer);
        delete divider.dataset.dragging;
        if (divider.hasPointerCapture(pointerId)) {
          divider.releasePointerCapture(pointerId);
        }
        snapSession.clear();
        if (
          activeDragRef.current?.finish === commitDrag ||
          activeDragRef.current?.cancel === cancelDrag
        ) {
          activeDragRef.current = null;
        }
        if (commit) {
          flushResize();
          previous.getBoundingClientRect();
        } else if (frame !== null) {
          ownerWindow.cancelAnimationFrame(frame);
        }
        onDragging(false);
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
      divider.addEventListener("keydown", flushResize, true);
      divider.addEventListener("lostpointercapture", finishForPointer);
      onDragging(true);
    },
    [axis, boundaryIndex, childCount, finish, maxFraction, minFraction, onDragging, onResize],
  );

  useEffect(() => {
    window.addEventListener("pointerdown", onPointerDownCapture, true);
    return () => window.removeEventListener("pointerdown", onPointerDownCapture, true);
  }, [onPointerDownCapture]);

  return hitTargetRef;
}
