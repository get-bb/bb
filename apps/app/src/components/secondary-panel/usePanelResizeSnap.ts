import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { createSplitResizeSnapSession } from "@/lib/split-resize-snap";
import {
  THREAD_SECONDARY_PANEL_MAX_SIZE_PERCENT,
  THREAD_SECONDARY_PANEL_MIN_SIZE_PERCENT,
} from "./secondaryPanelSizing";

interface UsePanelResizeSnapArgs {
  onResize: (leadingFraction: number) => void;
  onDragging: (isDragging: boolean) => void;
}

export function usePanelResizeSnap({
  onResize,
  onDragging,
}: UsePanelResizeSnapArgs) {
  const hitTargetRef = useRef<HTMLSpanElement>(null);
  const activeDragRef = useRef<((commit: boolean) => void) | null>(null);

  useEffect(() => () => activeDragRef.current?.(false), []);

  useEffect(() => {
    const onPointerDownCapture = (event: PointerEvent) => {
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
      activeDragRef.current?.(true);
      const previous = divider.previousElementSibling;
      const next = divider.nextElementSibling;
      if (
        !(previous instanceof HTMLElement) ||
        !(next instanceof HTMLElement)
      ) {
        return;
      }
      const start = previous.getBoundingClientRect().left;
      const end = next.getBoundingClientRect().right;
      if (end <= start) return;

      const ownerWindow = divider.ownerDocument.defaultView;
      if (ownerWindow === null) return;
      event.preventDefault();
      event.stopPropagation();
      divider.focus({ preventScroll: true });
      const snapSession = createSplitResizeSnapSession(divider, "x", {
        boundaryIndex: 1,
        childCount: 2,
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
      snapSession.resolve({ end, pointer: event.clientX, start });

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
          complete(true);
          return;
        }
        moveEvent.preventDefault();
        moveEvent.stopPropagation();
        const result = snapSession.resolve({
          end,
          pointer: moveEvent.clientX,
          start,
        });
        pendingFraction = Math.max(
          (100 - THREAD_SECONDARY_PANEL_MAX_SIZE_PERCENT) / 100,
          Math.min(
            (100 - THREAD_SECONDARY_PANEL_MIN_SIZE_PERCENT) / 100,
            result.fraction,
          ),
        );
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
        ownerWindow.removeEventListener("mouseup", commitDrag, true);
        ownerWindow.removeEventListener("blur", commitDrag);
        divider.removeEventListener("keydown", flushResize, true);
        divider.removeEventListener("lostpointercapture", finishForPointer);
        delete divider.dataset.dragging;
        if (divider.hasPointerCapture(pointerId)) {
          divider.releasePointerCapture(pointerId);
        }
        snapSession.clear();
        if (activeDragRef.current === complete) {
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
      const finishForPointer = (finishEvent: PointerEvent) => {
        if (finishEvent.pointerId !== pointerId) return;
        commitDrag();
      };
      activeDragRef.current = complete;
      ownerWindow.addEventListener("pointermove", move, true);
      ownerWindow.addEventListener("pointerup", finishForPointer, true);
      ownerWindow.addEventListener("pointercancel", finishForPointer, true);
      ownerWindow.addEventListener("mouseup", commitDrag, true);
      ownerWindow.addEventListener("blur", commitDrag);
      divider.addEventListener("keydown", flushResize, true);
      divider.addEventListener("lostpointercapture", finishForPointer);
      onDragging(true);
    };

    window.addEventListener("pointerdown", onPointerDownCapture, true);
    return () => window.removeEventListener("pointerdown", onPointerDownCapture, true);
  }, [onDragging, onResize]);

  return hitTargetRef;
}
