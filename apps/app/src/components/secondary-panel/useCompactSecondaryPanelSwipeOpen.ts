import {
  useCallback,
  useLayoutEffect,
  useRef,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";

const COMPACT_SECONDARY_PANEL_SWIPE_BROWSER_EDGE_GUARD_PX = 24;
const COMPACT_SECONDARY_PANEL_SWIPE_OPEN_INTENT_PX = 12;
const COMPACT_SECONDARY_PANEL_SWIPE_OPEN_RATIO = 0.33;
const COMPACT_SECONDARY_PANEL_SWIPE_OPEN_FLING_MIN_RATIO = 0.12;
const COMPACT_SECONDARY_PANEL_SWIPE_OPEN_FLING_VELOCITY_PX_PER_SEC = 450;

type CompactSecondaryPanelSwipeSession = {
  kind: "pointer" | "touch";
  id: number;
  startX: number;
  startY: number;
  panelWidth: number;
  lastProgress: number;
  lastClientX: number;
  lastTimeMs: number;
  velocityX: number;
  isDragging: boolean;
};

export type CompactSecondaryPanelSwipeOpenHandlers = Pick<
  HTMLAttributes<HTMLElement>,
  "onPointerDownCapture" | "onTouchStartCapture"
>;

interface UseCompactSecondaryPanelSwipeOpenArgs {
  enabled: boolean;
  onOpen: () => void;
}

function getCompactSecondaryPanelWidth(): number {
  if (typeof window === "undefined") {
    return 320;
  }

  return Math.min(window.innerWidth * 0.9, 320);
}

function clampCompactSecondaryPanelSwipeProgress(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function createCompactSecondaryPanelSwipeSession({
  kind,
  id,
  startX,
  startY,
}: {
  kind: "pointer" | "touch";
  id: number;
  startX: number;
  startY: number;
}): CompactSecondaryPanelSwipeSession {
  const nowMs = Date.now();
  return {
    kind,
    id,
    startX,
    startY,
    panelWidth: getCompactSecondaryPanelWidth(),
    lastProgress: 0,
    lastClientX: startX,
    lastTimeMs: nowMs,
    velocityX: 0,
    isDragging: false,
  };
}

function shouldOpenCompactSecondaryPanelSwipe(
  session: CompactSecondaryPanelSwipeSession,
): boolean {
  return (
    session.lastProgress >= COMPACT_SECONDARY_PANEL_SWIPE_OPEN_RATIO ||
    (session.lastProgress >=
      COMPACT_SECONDARY_PANEL_SWIPE_OPEN_FLING_MIN_RATIO &&
      -session.velocityX >=
        COMPACT_SECONDARY_PANEL_SWIPE_OPEN_FLING_VELOCITY_PX_PER_SEC)
  );
}

function isHorizontallyScrollableElement(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (view === null || !(element instanceof view.HTMLElement)) {
    return false;
  }

  const overflowX = view.getComputedStyle(element).overflowX;
  if (
    overflowX !== "auto" &&
    overflowX !== "scroll" &&
    overflowX !== "overlay"
  ) {
    return false;
  }

  return element.scrollWidth > element.clientWidth + 1;
}

function isInsideHorizontalScrollRegion(
  target: Element,
  root: HTMLElement,
): boolean {
  let element: Element | null = target;
  while (element !== null && root.contains(element)) {
    if (isHorizontallyScrollableElement(element)) {
      return true;
    }
    if (element === root) {
      return false;
    }
    element = element.parentElement;
  }

  return false;
}

function shouldIgnoreSecondaryPanelSwipeTarget(
  target: EventTarget | null,
  root: HTMLElement,
): boolean {
  if (!(target instanceof Element) || !root.contains(target)) {
    return true;
  }

  if (
    target.closest(
      [
        "input",
        "textarea",
        "select",
        '[contenteditable="true"]',
        '[role="slider"]',
        '[data-sidebar="panel"]',
        '[data-sidebar="trigger"]',
        "[data-vaul-drawer]",
        "[data-vaul-no-drag]",
        "[data-no-sidebar-swipe]",
        "[data-no-secondary-panel-swipe]",
      ].join(", "),
    ) !== null
  ) {
    return true;
  }

  return isInsideHorizontalScrollRegion(target, root);
}

function getTouchByIdentifier(
  touches: TouchList,
  identifier: number,
): Touch | null {
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches.item(index);
    if (touch?.identifier === identifier) {
      return touch;
    }
  }
  return null;
}

function getTrackedSwipeTouch(
  event: TouchEvent,
  identifier: number,
): Touch | null {
  return (
    getTouchByIdentifier(event.touches, identifier) ??
    getTouchByIdentifier(event.changedTouches, identifier)
  );
}

function isInsideRightBrowserEdgeGuard(clientX: number): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    clientX >
    window.innerWidth - COMPACT_SECONDARY_PANEL_SWIPE_BROWSER_EDGE_GUARD_PX
  );
}

export function useCompactSecondaryPanelSwipeOpen({
  enabled,
  onOpen,
}: UseCompactSecondaryPanelSwipeOpenArgs): CompactSecondaryPanelSwipeOpenHandlers {
  const swipeSessionRef = useRef<CompactSecondaryPanelSwipeSession | null>(
    null,
  );
  const removeSwipeListenersRef = useRef<(() => void) | null>(null);
  const removeSwipeClickSuppressorRef = useRef<(() => void) | null>(null);
  const swipeClickSuppressorTimeoutRef = useRef<number | null>(null);

  const clearSwipeSession = useCallback(() => {
    removeSwipeListenersRef.current?.();
    removeSwipeListenersRef.current = null;
    swipeSessionRef.current = null;
  }, []);

  const suppressNextSwipeClick = useCallback(() => {
    removeSwipeClickSuppressorRef.current?.();
    if (swipeClickSuppressorTimeoutRef.current !== null) {
      window.clearTimeout(swipeClickSuppressorTimeoutRef.current);
      swipeClickSuppressorTimeoutRef.current = null;
    }

    const suppressClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      removeSwipeClickSuppressorRef.current?.();
    };
    const removeSuppressor = () => {
      window.removeEventListener("click", suppressClick, {
        capture: true,
      });
      removeSwipeClickSuppressorRef.current = null;
      if (swipeClickSuppressorTimeoutRef.current !== null) {
        window.clearTimeout(swipeClickSuppressorTimeoutRef.current);
        swipeClickSuppressorTimeoutRef.current = null;
      }
    };

    window.addEventListener("click", suppressClick, {
      capture: true,
      once: true,
    });
    removeSwipeClickSuppressorRef.current = removeSuppressor;
    swipeClickSuppressorTimeoutRef.current = window.setTimeout(
      removeSuppressor,
      400,
    );
  }, []);

  const continueSwipe = useCallback(
    (clientX: number, clientY: number, event: PointerEvent | TouchEvent) => {
      const session = swipeSessionRef.current;
      if (session === null) {
        return;
      }

      const deltaX = clientX - session.startX;
      const deltaY = clientY - session.startY;
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);
      const nowMs = Date.now();

      if (
        !session.isDragging &&
        absDeltaY > COMPACT_SECONDARY_PANEL_SWIPE_OPEN_INTENT_PX &&
        absDeltaY > absDeltaX * 1.15
      ) {
        clearSwipeSession();
        return;
      }

      const progress = clampCompactSecondaryPanelSwipeProgress(
        -deltaX / session.panelWidth,
      );

      if (!session.isDragging) {
        if (
          deltaX > -COMPACT_SECONDARY_PANEL_SWIPE_OPEN_INTENT_PX ||
          absDeltaX <= absDeltaY * 1.25
        ) {
          return;
        }

        session.isDragging = true;
      }

      if (event.cancelable) {
        event.preventDefault();
      }

      const elapsedMs = nowMs - session.lastTimeMs;
      if (elapsedMs > 0) {
        session.velocityX =
          ((clientX - session.lastClientX) / elapsedMs) * 1000;
        session.lastClientX = clientX;
        session.lastTimeMs = nowMs;
      }
      session.lastProgress = progress;
    },
    [clearSwipeSession],
  );

  const finishSwipe = useCallback(
    (event: PointerEvent | TouchEvent) => {
      const session = swipeSessionRef.current;
      if (session === null) {
        return;
      }

      clearSwipeSession();
      if (!session.isDragging) {
        return;
      }

      if (event.cancelable) {
        event.preventDefault();
      }

      suppressNextSwipeClick();
      if (shouldOpenCompactSecondaryPanelSwipe(session)) {
        onOpen();
      }
    },
    [clearSwipeSession, onOpen, suppressNextSwipeClick],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      const session = swipeSessionRef.current;
      if (
        session === null ||
        session.kind !== "pointer" ||
        event.pointerId !== session.id
      ) {
        return;
      }

      continueSwipe(event.clientX, event.clientY, event);
    },
    [continueSwipe],
  );

  const handlePointerEnd = useCallback(
    (event: PointerEvent) => {
      const session = swipeSessionRef.current;
      if (
        session === null ||
        session.kind !== "pointer" ||
        event.pointerId !== session.id
      ) {
        return;
      }

      finishSwipe(event);
    },
    [finishSwipe],
  );

  const handleTouchMove = useCallback(
    (event: TouchEvent) => {
      const session = swipeSessionRef.current;
      if (session === null || session.kind !== "touch") {
        return;
      }

      const touch = getTrackedSwipeTouch(event, session.id);
      if (touch == null) {
        return;
      }

      continueSwipe(touch.clientX, touch.clientY, event);
    },
    [continueSwipe],
  );

  const handleTouchEnd = useCallback(
    (event: TouchEvent) => {
      const session = swipeSessionRef.current;
      if (session === null || session.kind !== "touch") {
        return;
      }

      if (getTrackedSwipeTouch(event, session.id) === null) {
        return;
      }

      finishSwipe(event);
    },
    [finishSwipe],
  );

  const onPointerDownCapture = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (
        !enabled ||
        event.defaultPrevented ||
        event.pointerType !== "touch" ||
        event.button !== 0 ||
        isInsideRightBrowserEdgeGuard(event.clientX) ||
        swipeSessionRef.current !== null ||
        shouldIgnoreSecondaryPanelSwipeTarget(event.target, event.currentTarget)
      ) {
        return;
      }

      swipeSessionRef.current = createCompactSecondaryPanelSwipeSession({
        kind: "pointer",
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      });

      const removeListeners = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerEnd);
        window.removeEventListener("pointercancel", handlePointerEnd);
      };
      window.addEventListener("pointermove", handlePointerMove, {
        passive: false,
      });
      window.addEventListener("pointerup", handlePointerEnd);
      window.addEventListener("pointercancel", handlePointerEnd);
      removeSwipeListenersRef.current = removeListeners;
    },
    [enabled, handlePointerEnd, handlePointerMove],
  );

  const onTouchStartCapture = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      if (
        !enabled ||
        event.defaultPrevented ||
        event.touches.length !== 1 ||
        shouldIgnoreSecondaryPanelSwipeTarget(event.target, event.currentTarget)
      ) {
        return;
      }

      const touch = event.touches.item(0);
      if (touch == null || isInsideRightBrowserEdgeGuard(touch.clientX)) {
        return;
      }

      const currentSession = swipeSessionRef.current;
      if (currentSession !== null) {
        if (currentSession.kind !== "pointer") {
          return;
        }
        clearSwipeSession();
      }

      swipeSessionRef.current = createCompactSecondaryPanelSwipeSession({
        kind: "touch",
        id: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
      });

      const removeListeners = () => {
        window.removeEventListener("touchmove", handleTouchMove);
        window.removeEventListener("touchend", handleTouchEnd);
        window.removeEventListener("touchcancel", handleTouchEnd);
      };
      window.addEventListener("touchmove", handleTouchMove, {
        passive: false,
      });
      window.addEventListener("touchend", handleTouchEnd);
      window.addEventListener("touchcancel", handleTouchEnd);
      removeSwipeListenersRef.current = removeListeners;
    },
    [clearSwipeSession, enabled, handleTouchEnd, handleTouchMove],
  );

  useLayoutEffect(
    () => () => {
      clearSwipeSession();
      removeSwipeClickSuppressorRef.current?.();
      if (swipeClickSuppressorTimeoutRef.current !== null) {
        window.clearTimeout(swipeClickSuppressorTimeoutRef.current);
        swipeClickSuppressorTimeoutRef.current = null;
      }
    },
    [clearSwipeSession],
  );

  return {
    onPointerDownCapture,
    onTouchStartCapture,
  };
}
