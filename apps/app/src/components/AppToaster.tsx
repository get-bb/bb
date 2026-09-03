import { useEffect, useRef, type RefObject } from "react";
import {
  toast,
  Toaster,
  type ToasterProps,
  type ToastT,
  type ToastToDismiss,
} from "sonner";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { usePreferredTheme } from "@/hooks/useTheme";

const COMPACT_TOAST_TOP_OFFSET =
  "calc(env(safe-area-inset-top) + var(--bb-app-chrome-row-height) + 16px)";
const TOUCH_TOAST_SWIPE_DIRECTION_LOCK_PX = 1;
const TOUCH_TOAST_SWIPE_DISTANCE_PX = 20;
const TOUCH_TOAST_SWIPE_VELOCITY_PX_PER_MS = 0.11;
const TOUCH_TOAST_SWIPE_DIRECTIONS: NonNullable<
  ToasterProps["swipeDirections"]
> = ["top", "right", "bottom", "left"];

type ToastPosition = NonNullable<ToasterProps["position"]>;
type ToastSwipeDirection = NonNullable<ToasterProps["swipeDirections"]>[number];

interface ToastSwipeStart {
  lastX: number;
  lastY: number;
  pointerId: number;
  startTime: number;
  startX: number;
  startY: number;
  toastId: ToastT["id"];
  toastElement: HTMLElement;
}

interface TouchToastSwipeFallbackOptions {
  enabled: boolean;
  position: ToastPosition;
  swipeDirections: readonly ToastSwipeDirection[] | undefined;
  toasterRef: RefObject<HTMLElement | null>;
}

function isActiveToast(entry: ToastT | ToastToDismiss): entry is ToastT {
  return !("dismiss" in entry);
}

function toastPositionForElement(toastElement: HTMLElement): string {
  return `${toastElement.dataset.yPosition}-${toastElement.dataset.xPosition}`;
}

function activeToastById(id: ToastT["id"]): ToastT | null {
  return (
    toast
      .getToasts()
      .find(
        (entry): entry is ToastT => isActiveToast(entry) && entry.id === id,
      ) ?? null
  );
}

function associateToastElements(
  toasterElement: HTMLElement,
  defaultPosition: ToastPosition,
  toastIdsByElement: WeakMap<HTMLElement, ToastT["id"]>,
): void {
  const activeToastsByPosition = new Map<string, ToastT[]>();
  const activeToasts = toast.getToasts();
  for (
    let storeIndex = activeToasts.length - 1;
    storeIndex >= 0;
    storeIndex--
  ) {
    const candidate = activeToasts[storeIndex];
    if (candidate === undefined || !isActiveToast(candidate)) {
      continue;
    }
    const candidatePosition = candidate.position ?? defaultPosition;
    const positionToasts = activeToastsByPosition.get(candidatePosition) ?? [];
    positionToasts.push(candidate);
    activeToastsByPosition.set(candidatePosition, positionToasts);
  }

  const activeElementsByPosition = new Map<string, HTMLElement[]>();
  const toastElements = toasterElement.querySelectorAll<HTMLElement>(
    "[data-sonner-toast]",
  );
  for (const toastElement of toastElements) {
    if (toastElement.dataset.removed === "true") {
      continue;
    }
    const elementPosition = toastPositionForElement(toastElement);
    const positionElements =
      activeElementsByPosition.get(elementPosition) ?? [];
    positionElements.push(toastElement);
    activeElementsByPosition.set(elementPosition, positionElements);
  }

  for (const [elementPosition, positionElements] of activeElementsByPosition) {
    const positionToasts = activeToastsByPosition.get(elementPosition);
    if (
      positionToasts === undefined ||
      positionElements.length > positionToasts.length
    ) {
      continue;
    }
    for (let index = 0; index < positionElements.length; index++) {
      const toastElement = positionElements[index];
      const activeToast = positionToasts[index];
      if (
        toastElement !== undefined &&
        activeToast !== undefined &&
        !toastIdsByElement.has(toastElement)
      ) {
        toastIdsByElement.set(toastElement, activeToast.id);
      }
    }
  }
}

function allowedSwipeDistance(
  deltaX: number,
  deltaY: number,
  allowedDirections: ReadonlySet<ToastSwipeDirection>,
): number {
  return Math.max(
    deltaX < 0 && allowedDirections.has("left") ? -deltaX : 0,
    deltaX > 0 && allowedDirections.has("right") ? deltaX : 0,
    deltaY < 0 && allowedDirections.has("top") ? -deltaY : 0,
    deltaY > 0 && allowedDirections.has("bottom") ? deltaY : 0,
  );
}

function toastContainsSelection(toastElement: HTMLElement): boolean {
  const selection = toastElement.ownerDocument.getSelection();
  if (selection === null || selection.isCollapsed) {
    return false;
  }
  return (
    (selection.anchorNode !== null &&
      toastElement.contains(selection.anchorNode)) ||
    (selection.focusNode !== null && toastElement.contains(selection.focusNode))
  );
}

function useTouchToastSwipeFallback({
  enabled,
  position,
  swipeDirections,
  toasterRef,
}: TouchToastSwipeFallbackOptions): void {
  const swipeStartRef = useRef<ToastSwipeStart | null>(null);

  useEffect(() => {
    const toasterElement = toasterRef.current;
    if (!enabled || toasterElement === null) {
      return;
    }
    const allowedDirections = new Set(swipeDirections);
    const toastIdsByElement = new WeakMap<HTMLElement, ToastT["id"]>();

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
      associateToastElements(toasterElement, position, toastIdsByElement);
      const toastId = toastIdsByElement.get(toastElement);
      if (toastId === undefined || activeToastById(toastId) === null) {
        return;
      }
      swipeStartRef.current = {
        lastX: event.clientX,
        lastY: event.clientY,
        pointerId: event.pointerId,
        startTime: event.timeStamp,
        startX: event.clientX,
        startY: event.clientY,
        toastId,
        toastElement,
      };
    };

    const handlePointerMove = (event: PointerEvent) => {
      const start = swipeStartRef.current;
      if (start === null || start.pointerId !== event.pointerId) {
        return;
      }
      start.lastX = event.clientX;
      start.lastY = event.clientY;
    };

    const finishSwipe = (event: PointerEvent, useLastPosition: boolean) => {
      const start = swipeStartRef.current;
      if (start === null || start.pointerId !== event.pointerId) {
        return;
      }
      swipeStartRef.current = null;
      if (toastContainsSelection(start.toastElement)) {
        return;
      }
      const endX = useLastPosition ? start.lastX : event.clientX;
      const endY = useLastPosition ? start.lastY : event.clientY;
      const distance = allowedSwipeDistance(
        endX - start.startX,
        endY - start.startY,
        allowedDirections,
      );
      const elapsed = Math.max(event.timeStamp - start.startTime, 1);
      const velocity = distance / elapsed;
      if (
        distance <= TOUCH_TOAST_SWIPE_DIRECTION_LOCK_PX ||
        (distance < TOUCH_TOAST_SWIPE_DISTANCE_PX &&
          velocity <= TOUCH_TOAST_SWIPE_VELOCITY_PX_PER_MS)
      ) {
        return;
      }
      queueMicrotask(() => {
        if (
          !start.toastElement.isConnected ||
          start.toastElement.dataset.removed === "true" ||
          start.toastElement.dataset.swipeOut === "true"
        ) {
          return;
        }
        const activeToast = activeToastById(start.toastId);
        if (activeToast === null) {
          return;
        }
        activeToast.onDismiss?.(activeToast);
        toast.dismiss(activeToast.id);
      });
    };

    const handlePointerUp = (event: PointerEvent) => finishSwipe(event, false);
    const handlePointerTermination = (event: PointerEvent) =>
      finishSwipe(event, true);
    const ownerDocument = toasterElement.ownerDocument;

    toasterElement.addEventListener("pointerdown", handlePointerDown);
    ownerDocument.addEventListener("pointermove", handlePointerMove, true);
    ownerDocument.addEventListener("pointerup", handlePointerUp, true);
    ownerDocument.addEventListener(
      "pointercancel",
      handlePointerTermination,
      true,
    );
    ownerDocument.addEventListener(
      "lostpointercapture",
      handlePointerTermination,
      true,
    );
    return () => {
      swipeStartRef.current = null;
      toasterElement.removeEventListener("pointerdown", handlePointerDown);
      ownerDocument.removeEventListener("pointermove", handlePointerMove, true);
      ownerDocument.removeEventListener("pointerup", handlePointerUp, true);
      ownerDocument.removeEventListener(
        "pointercancel",
        handlePointerTermination,
        true,
      );
      ownerDocument.removeEventListener(
        "lostpointercapture",
        handlePointerTermination,
        true,
      );
    };
  }, [enabled, position, swipeDirections, toasterRef]);
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
  const isPointerCoarse = usePointerCoarse();
  const toasterRef = useRef<HTMLElement | null>(null);
  const renderedPosition = isCompactViewport ? "top-center" : position;
  const touchSwipeEnabled = isCompactViewport || isPointerCoarse;
  const renderedSwipeDirections =
    swipeDirections ??
    (touchSwipeEnabled ? TOUCH_TOAST_SWIPE_DIRECTIONS : undefined);
  useTouchToastSwipeFallback({
    enabled: touchSwipeEnabled,
    position: renderedPosition,
    swipeDirections: renderedSwipeDirections,
    toasterRef,
  });
  return (
    <Toaster
      ref={toasterRef}
      theme={theme}
      position={renderedPosition}
      {...props}
      offset={isCompactViewport ? withCompactTopOffset(offset) : offset}
      mobileOffset={
        isCompactViewport ? withCompactTopOffset(mobileOffset) : mobileOffset
      }
      swipeDirections={renderedSwipeDirections}
    />
  );
}
