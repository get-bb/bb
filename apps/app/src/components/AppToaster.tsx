import { useEffect, useRef, type RefObject } from "react";
import { Toaster, type ToasterProps } from "sonner";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { usePreferredTheme } from "@/hooks/useTheme";

const COMPACT_TOAST_TOP_OFFSET =
  "calc(env(safe-area-inset-top) + var(--bb-app-chrome-row-height) + 16px)";
const COMPACT_TOAST_SWIPE_DIRECTIONS: NonNullable<
  ToasterProps["swipeDirections"]
> = ["top", "left", "right"];

type ToastSwipeDirection = NonNullable<ToasterProps["swipeDirections"]>[number];

interface ToastSwipeStart {
  moved: boolean;
  pointerId: number;
  toastElement: HTMLElement;
  x: number;
  y: number;
}

interface SonnerFirstMoveFixOptions {
  enabled: boolean;
  swipeDirections: readonly ToastSwipeDirection[] | undefined;
  toasterRef: RefObject<HTMLElement | null>;
}

function useSonnerFirstMoveFix({
  enabled,
  swipeDirections,
  toasterRef,
}: SonnerFirstMoveFixOptions): void {
  const swipeStartRef = useRef<ToastSwipeStart | null>(null);

  useEffect(() => {
    const toasterElement = toasterRef.current;
    if (!enabled || toasterElement === null) {
      return;
    }
    const allowedDirections = new Set(swipeDirections);
    const ownerDocument = toasterElement.ownerDocument;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        event.button !== 0 ||
        event.pointerType !== "touch" ||
        !(target instanceof Element) ||
        target.closest("button") !== null
      ) {
        return;
      }
      const toastElement = target.closest<HTMLElement>("[data-sonner-toast]");
      if (
        toastElement === null ||
        toastElement.dataset.dismissible !== "true" ||
        toastElement.dataset.type === "loading"
      ) {
        return;
      }
      swipeStartRef.current = {
        moved: false,
        pointerId: event.pointerId,
        toastElement,
        x: event.clientX,
        y: event.clientY,
      };
    };

    const handlePointerMove = (event: PointerEvent) => {
      const start = swipeStartRef.current;
      if (
        start === null ||
        start.moved ||
        start.pointerId !== event.pointerId ||
        ownerDocument.getSelection()?.toString()
      ) {
        return;
      }
      const deltaX = event.clientX - start.x;
      const deltaY = event.clientY - start.y;
      if (Math.abs(deltaX) <= 1 && Math.abs(deltaY) <= 1) {
        return;
      }
      start.moved = true;
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        const direction = deltaX > 0 ? "right" : "left";
        if (allowedDirections.has(direction)) {
          start.toastElement.style.setProperty(
            "--swipe-amount-x",
            `${deltaX}px`,
          );
        }
        return;
      }
      const direction = deltaY > 0 ? "bottom" : "top";
      if (allowedDirections.has(direction)) {
        start.toastElement.style.setProperty("--swipe-amount-y", `${deltaY}px`);
      }
    };

    const handlePointerEnd = (event: PointerEvent) => {
      if (swipeStartRef.current?.pointerId === event.pointerId) {
        swipeStartRef.current = null;
      }
    };

    toasterElement.addEventListener("pointerdown", handlePointerDown);
    ownerDocument.addEventListener("pointermove", handlePointerMove);
    ownerDocument.addEventListener("pointerup", handlePointerEnd);
    ownerDocument.addEventListener("pointercancel", handlePointerEnd);
    return () => {
      swipeStartRef.current = null;
      toasterElement.removeEventListener("pointerdown", handlePointerDown);
      ownerDocument.removeEventListener("pointermove", handlePointerMove);
      ownerDocument.removeEventListener("pointerup", handlePointerEnd);
      ownerDocument.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [enabled, swipeDirections, toasterRef]);
}

function withCompactTopOffset(
  offset: ToasterProps["offset"],
): ToasterProps["offset"] {
  if (typeof offset === "object") {
    return { ...offset, top: COMPACT_TOAST_TOP_OFFSET };
  }
  return {
    top: COMPACT_TOAST_TOP_OFFSET,
    right: offset,
    bottom: offset,
    left: offset,
  };
}

export function AppToaster({
  position = "bottom-right",
  offset,
  mobileOffset,
  swipeDirections,
  ...props
}: ToasterProps) {
  const theme = usePreferredTheme();
  const isCompactViewport = useIsCompactViewport();
  const toasterRef = useRef<HTMLElement | null>(null);
  const renderedSwipeDirections =
    swipeDirections ??
    (isCompactViewport ? COMPACT_TOAST_SWIPE_DIRECTIONS : undefined);
  useSonnerFirstMoveFix({
    enabled: isCompactViewport,
    swipeDirections: renderedSwipeDirections,
    toasterRef,
  });
  return (
    <Toaster
      ref={toasterRef}
      theme={theme}
      position={isCompactViewport ? "top-center" : position}
      {...props}
      offset={isCompactViewport ? withCompactTopOffset(offset) : offset}
      mobileOffset={
        isCompactViewport ? withCompactTopOffset(mobileOffset) : mobileOffset
      }
      swipeDirections={renderedSwipeDirections}
    />
  );
}
