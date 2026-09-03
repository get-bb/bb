import { useEffect, useRef, type RefObject } from "react";
import { Toaster, type ToasterProps } from "sonner";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { usePreferredTheme } from "@/hooks/useTheme";

const COMPACT_TOAST_TOP_OFFSET =
  "calc(env(safe-area-inset-top) + var(--bb-app-chrome-row-height) + 16px)";
const COMPACT_TOAST_SWIPE_DIRECTIONS: NonNullable<
  ToasterProps["swipeDirections"]
> = ["top", "left", "right"];
const TOAST_BUTTON_TAP_SLOP = 4;

type ToastSwipeDirection = NonNullable<ToasterProps["swipeDirections"]>[number];

interface ToastSwipeStart {
  axis: "x" | "y" | null;
  button: HTMLButtonElement | null;
  dragged: boolean;
  pointerId: number;
  toastElement: HTMLElement;
  x: number;
  y: number;
}

interface ReliableToastSwipesOptions {
  enabled: boolean;
  swipeDirections: readonly ToastSwipeDirection[] | undefined;
  toasterRef: RefObject<HTMLElement | null>;
}

function useReliableToastSwipes({
  enabled,
  swipeDirections,
  toasterRef,
}: ReliableToastSwipesOptions): void {
  const swipeStartRef = useRef<ToastSwipeStart | null>(null);

  useEffect(() => {
    const toasterElement = toasterRef.current;
    if (!enabled || toasterElement === null) {
      return;
    }
    const allowedDirections = new Set(swipeDirections);
    const ownerDocument = toasterElement.ownerDocument;
    const bridgedPointerDowns = new WeakSet<Event>();
    let suppressedClickButton: HTMLButtonElement | null = null;
    let suppressedClickTimeout: number | null = null;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        bridgedPointerDowns.has(event) ||
        event.button !== 0 ||
        event.pointerType !== "touch" ||
        !(target instanceof Element)
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
      const button = target.closest<HTMLButtonElement>("button");
      swipeStartRef.current = {
        axis: null,
        button,
        dragged: false,
        pointerId: event.pointerId,
        toastElement,
        x: event.clientX,
        y: event.clientY,
      };
      if (target === button) {
        const PointerEventConstructor = ownerDocument.defaultView?.PointerEvent;
        if (PointerEventConstructor === undefined) {
          return;
        }
        const bridgedPointerDown = new PointerEventConstructor("pointerdown", {
          bubbles: true,
          button: event.button,
          buttons: event.buttons,
          cancelable: true,
          clientX: event.clientX,
          clientY: event.clientY,
          composed: true,
          isPrimary: event.isPrimary,
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          pressure: event.pressure,
        });
        bridgedPointerDowns.add(bridgedPointerDown);
        toastElement.dispatchEvent(bridgedPointerDown);
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      const start = swipeStartRef.current;
      if (
        start === null ||
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
      if (
        start.button !== null &&
        Math.max(Math.abs(deltaX), Math.abs(deltaY)) > TOAST_BUTTON_TAP_SLOP
      ) {
        start.dragged = true;
        event.preventDefault();
      }
      start.axis ??= Math.abs(deltaX) > Math.abs(deltaY) ? "x" : "y";
      if (start.axis === "x") {
        const direction = deltaX > 0 ? "right" : "left";
        const amount = allowedDirections.has(direction) ? deltaX : 0;
        start.toastElement.style.setProperty("--swipe-amount-x", `${amount}px`);
        return;
      }
      const direction = deltaY > 0 ? "bottom" : "top";
      const amount = allowedDirections.has(direction) ? deltaY : 0;
      start.toastElement.style.setProperty("--swipe-amount-y", `${amount}px`);
    };

    const handlePointerEnd = (event: PointerEvent) => {
      const start = swipeStartRef.current;
      if (start?.pointerId !== event.pointerId) {
        return;
      }
      swipeStartRef.current = null;
      if (
        event.type === "pointerup" &&
        start.dragged &&
        start.button !== null
      ) {
        suppressedClickButton = start.button;
        if (suppressedClickTimeout !== null) {
          window.clearTimeout(suppressedClickTimeout);
        }
        suppressedClickTimeout = window.setTimeout(() => {
          suppressedClickButton = null;
          suppressedClickTimeout = null;
        }, 0);
      }
    };

    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (
        suppressedClickButton === null ||
        !(target instanceof Node) ||
        !suppressedClickButton.contains(target)
      ) {
        return;
      }
      suppressedClickButton = null;
      event.preventDefault();
      event.stopPropagation();
    };

    toasterElement.addEventListener("pointerdown", handlePointerDown);
    ownerDocument.addEventListener("pointermove", handlePointerMove);
    ownerDocument.addEventListener("pointerup", handlePointerEnd);
    ownerDocument.addEventListener("pointercancel", handlePointerEnd);
    ownerDocument.addEventListener("click", handleClick, true);
    return () => {
      swipeStartRef.current = null;
      if (suppressedClickTimeout !== null) {
        window.clearTimeout(suppressedClickTimeout);
      }
      toasterElement.removeEventListener("pointerdown", handlePointerDown);
      ownerDocument.removeEventListener("pointermove", handlePointerMove);
      ownerDocument.removeEventListener("pointerup", handlePointerEnd);
      ownerDocument.removeEventListener("pointercancel", handlePointerEnd);
      ownerDocument.removeEventListener("click", handleClick, true);
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
  useReliableToastSwipes({
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
