import {
  useCallback,
  useLayoutEffect,
  useRef,
  type HTMLAttributes,
  type RefObject,
  type TouchEvent as ReactTouchEvent,
} from "react";

// A bottom sheet that sets Vaul's `handleOnly` can only be dragged by the
// grabber. `handleOnly` exists to stop Vaul from calling setPointerCapture on
// the body, which retargets clicks away from web-component shadow DOM (the
// diff panel's file tree). This hook re-adds the iOS-standard gesture Vaul's
// `handleOnly` removes — drag down anywhere once the content is scrolled to the
// top — by translating the sheet itself, without any pointer capture.

const SWIPE_DOWN_INTENT_PX = 8;
const SWIPE_DOWN_CLOSE_RATIO = 0.25;
const SWIPE_DOWN_FLING_VELOCITY_PX_PER_SEC = 500;
const SWIPE_DOWN_FLING_MIN_PX = 48;
const SNAP_BACK_TRANSITION = "transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)";

type DrawerSwipeDownSession = {
  id: number;
  sheet: HTMLElement;
  sheetHeight: number;
  startX: number;
  startY: number;
  lastY: number;
  lastTimeMs: number;
  velocityY: number;
  translateY: number;
  isDragging: boolean;
};

export type DrawerSwipeDownToCloseHandlers = Pick<
  HTMLAttributes<HTMLElement>,
  "onTouchStartCapture"
>;

interface UseDrawerSwipeDownToCloseArgs {
  enabled: boolean;
  sheetRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

function isVerticallyScrollableElement(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (view === null || !(element instanceof view.HTMLElement)) {
    return false;
  }

  const overflowY = view.getComputedStyle(element).overflowY;
  if (overflowY !== "auto" && overflowY !== "scroll" && overflowY !== "overlay") {
    return false;
  }

  return element.scrollHeight > element.clientHeight + 1;
}

// Mirror Vaul's shouldDrag scroll walk: a downward drag may only move the sheet
// when every scroll container between the touch and the sheet is at its top.
function isScrolledToTop(target: Element, sheet: HTMLElement): boolean {
  let element: Element | null = target;
  while (element !== null) {
    if (isVerticallyScrollableElement(element) && element.scrollTop > 0) {
      return false;
    }
    if (element === sheet) {
      break;
    }
    element = element.parentElement;
  }
  return true;
}

function shouldIgnoreSwipeDownTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return true;
  }

  return (
    target.closest(
      [
        "input",
        "textarea",
        "select",
        '[contenteditable="true"]',
        '[role="slider"]',
        "[data-vaul-handle]",
        "[data-vaul-no-drag]",
        "[data-no-drawer-swipe-close]",
      ].join(", "),
    ) !== null
  );
}

function getTouchByIdentifier(
  touches: TouchList,
  identifier: number,
): Touch | null {
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches[index];
    if (touch?.identifier === identifier) {
      return touch;
    }
  }
  return null;
}

function getTrackedTouch(event: TouchEvent, identifier: number): Touch | null {
  return (
    getTouchByIdentifier(event.touches, identifier) ??
    getTouchByIdentifier(event.changedTouches, identifier)
  );
}

export function useDrawerSwipeDownToClose({
  enabled,
  sheetRef,
  onClose,
}: UseDrawerSwipeDownToCloseArgs): DrawerSwipeDownToCloseHandlers {
  const sessionRef = useRef<DrawerSwipeDownSession | null>(null);
  const removeListenersRef = useRef<(() => void) | null>(null);
  const cancelSnapBackRef = useRef<(() => void) | null>(null);

  const resetSheetTransform = useCallback((sheet: HTMLElement) => {
    sheet.style.transform = "";
    sheet.style.transition = "";
  }, []);

  const clearSession = useCallback(() => {
    removeListenersRef.current?.();
    removeListenersRef.current = null;
    sessionRef.current = null;
  }, []);

  const handleTouchMove = useCallback(
    (event: TouchEvent) => {
      const session = sessionRef.current;
      if (session === null) {
        return;
      }

      const touch = getTrackedTouch(event, session.id);
      if (touch === null) {
        return;
      }

      const deltaX = touch.clientX - session.startX;
      const deltaY = touch.clientY - session.startY;

      if (!session.isDragging) {
        if (Math.abs(deltaY) <= SWIPE_DOWN_INTENT_PX) {
          return;
        }
        // Upward or dominantly-horizontal intent belongs to native scroll or a
        // horizontal pager, not to dismissing the sheet.
        if (deltaY <= 0 || Math.abs(deltaX) >= Math.abs(deltaY)) {
          clearSession();
          return;
        }
        if (
          event.target instanceof Element &&
          !isScrolledToTop(event.target, session.sheet)
        ) {
          clearSession();
          return;
        }
        session.isDragging = true;
      }

      if (event.cancelable) {
        event.preventDefault();
      }

      const nowMs = Date.now();
      const elapsedMs = nowMs - session.lastTimeMs;
      if (elapsedMs > 0) {
        session.velocityY = ((touch.clientY - session.lastY) / elapsedMs) * 1000;
        session.lastY = touch.clientY;
        session.lastTimeMs = nowMs;
      }

      session.translateY = Math.max(0, deltaY);
      session.sheet.style.transition = "none";
      session.sheet.style.transform = `translate3d(0, ${session.translateY}px, 0)`;
    },
    [clearSession],
  );

  const handleTouchEnd = useCallback(
    (event: TouchEvent) => {
      const session = sessionRef.current;
      if (session === null || getTrackedTouch(event, session.id) === null) {
        return;
      }

      clearSession();
      if (!session.isDragging) {
        return;
      }

      const shouldClose =
        session.translateY >= session.sheetHeight * SWIPE_DOWN_CLOSE_RATIO ||
        (session.velocityY >= SWIPE_DOWN_FLING_VELOCITY_PX_PER_SEC &&
          session.translateY >= SWIPE_DOWN_FLING_MIN_PX);

      if (shouldClose) {
        // Leave the sheet where the finger released it; Vaul's close animation
        // continues from this transform down to fully dismissed.
        onClose();
        return;
      }

      const sheet = session.sheet;
      sheet.style.transition = SNAP_BACK_TRANSITION;
      sheet.style.transform = "translate3d(0, 0, 0)";
      const handleSnapBackEnd = () => {
        resetSheetTransform(sheet);
        sheet.removeEventListener("transitionend", handleSnapBackEnd);
        cancelSnapBackRef.current = null;
      };
      sheet.addEventListener("transitionend", handleSnapBackEnd);
      cancelSnapBackRef.current = () => {
        sheet.removeEventListener("transitionend", handleSnapBackEnd);
        cancelSnapBackRef.current = null;
      };
    },
    [clearSession, onClose, resetSheetTransform],
  );

  const onTouchStartCapture = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      const sheet = sheetRef.current;
      if (
        !enabled ||
        sheet === null ||
        event.defaultPrevented ||
        event.touches.length !== 1 ||
        sessionRef.current !== null ||
        shouldIgnoreSwipeDownTarget(event.target)
      ) {
        return;
      }

      const touch = event.touches[0];
      if (touch === undefined) {
        return;
      }

      // A fresh drag interrupts any snap-back still settling on the sheet.
      cancelSnapBackRef.current?.();

      const nowMs = Date.now();
      sessionRef.current = {
        id: touch.identifier,
        sheet,
        sheetHeight: sheet.getBoundingClientRect().height,
        startX: touch.clientX,
        startY: touch.clientY,
        lastY: touch.clientY,
        lastTimeMs: nowMs,
        velocityY: 0,
        translateY: 0,
        isDragging: false,
      };

      const removeListeners = () => {
        window.removeEventListener("touchmove", handleTouchMove);
        window.removeEventListener("touchend", handleTouchEnd);
        window.removeEventListener("touchcancel", handleTouchEnd);
      };
      window.addEventListener("touchmove", handleTouchMove, { passive: false });
      window.addEventListener("touchend", handleTouchEnd);
      window.addEventListener("touchcancel", handleTouchEnd);
      removeListenersRef.current = removeListeners;
    },
    [enabled, handleTouchEnd, handleTouchMove, sheetRef],
  );

  useLayoutEffect(
    () => () => {
      cancelSnapBackRef.current?.();
      const session = sessionRef.current;
      if (session !== null) {
        resetSheetTransform(session.sheet);
      }
      clearSession();
    },
    [clearSession, resetSheetTransform],
  );

  return { onTouchStartCapture };
}
