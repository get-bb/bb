import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEventHandler,
} from "react";

interface PanZoomPoint {
  x: number;
  y: number;
}

export interface PanZoomView {
  offset: PanZoomPoint;
  scale: number;
}

export interface PanZoomScaleLimits {
  max: number;
  min: number;
}

interface PanZoomSize {
  height: number;
  width: number;
}

interface PanZoomDragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startOffset: PanZoomPoint;
}

interface PanZoomPinchState {
  startCenter: PanZoomPoint;
  startDistance: number;
  startView: PanZoomView;
}

interface PanZoomGestureState {
  startScale: number;
  startView: PanZoomView;
}

interface PanZoomTouchPair {
  center: PanZoomPoint;
  distance: number;
}

interface ClientPositionArgs {
  clientX: number;
  clientY: number;
  container: HTMLElement;
}

interface GetPanZoomTouchPairArgs {
  container: HTMLElement;
  touches: TouchList;
}

interface GetPanZoomWheelZoomFactorArgs {
  deltaMode: number;
  deltaY: number;
}

interface GetPanZoomWheelZoomDeltaArgs {
  deltaX: number;
  deltaY: number;
  deltaZ: number;
}

interface PanZoomGestureEventData {
  clientX: number;
  clientY: number;
  scale: number;
}

interface ZoomPanZoomViewArgs {
  focalPoint: PanZoomPoint;
  limits: PanZoomScaleLimits;
  nextScale: number;
  view: PanZoomView;
}

interface PinchPanZoomViewArgs {
  limits: PanZoomScaleLimits;
  pinchState: PanZoomPinchState;
  touchPair: PanZoomTouchPair;
}

interface ConstrainPanZoomOffsetArgs {
  contentSize: PanZoomSize;
  view: PanZoomView;
  viewportSize: PanZoomSize;
}

interface PointPairArgs {
  firstPoint: PanZoomPoint;
  secondPoint: PanZoomPoint;
}

type PanZoomViewConstraint = (view: PanZoomView) => PanZoomView;
type PanZoomPointerHandler = PointerEventHandler<HTMLElement>;

interface UsePanZoomArgs {
  constrainView?: PanZoomViewConstraint;
  enabled: boolean;
  limits: PanZoomScaleLimits;
  viewportElement: HTMLElement | null;
}

interface PanZoomPointerHandlers {
  onPointerCancel: PanZoomPointerHandler;
  onPointerDown: PanZoomPointerHandler;
  onPointerMove: PanZoomPointerHandler;
  onPointerUp: PanZoomPointerHandler;
}

interface PanZoomControls {
  isDragging: boolean;
  pointerHandlers: PanZoomPointerHandlers;
  resetView: () => void;
  view: PanZoomView;
  zoomAroundCenter: (scaleDelta: number) => void;
}

const WHEEL_DELTA_LINE_MODE = 1;
const WHEEL_DELTA_PAGE_MODE = 2;
const WHEEL_LINE_DELTA_PX = 16;
const WHEEL_PAGE_DELTA_PX = 800;
const WHEEL_ZOOM_INTENSITY = 0.01;
const WHEEL_MIN_ZOOM_FACTOR = 0.82;
const WHEEL_MAX_ZOOM_FACTOR = 1.22;
const CENTER_POINT: PanZoomPoint = { x: 0, y: 0 };

function createInitialPanZoomView(): PanZoomView {
  return { offset: { x: 0, y: 0 }, scale: 1 };
}

function clampPanZoomScale(
  scale: number,
  limits: PanZoomScaleLimits,
): number {
  return Math.min(limits.max, Math.max(limits.min, scale));
}

function getPointFromClientPosition({
  clientX,
  clientY,
  container,
}: ClientPositionArgs): PanZoomPoint {
  const containerRect = container.getBoundingClientRect();
  return {
    x: clientX - containerRect.left - containerRect.width / 2,
    y: clientY - containerRect.top - containerRect.height / 2,
  };
}

function isClientPointWithinContainer({
  clientX,
  clientY,
  container,
}: ClientPositionArgs): boolean {
  const containerRect = container.getBoundingClientRect();
  return (
    clientX >= containerRect.left &&
    clientX <= containerRect.right &&
    clientY >= containerRect.top &&
    clientY <= containerRect.bottom
  );
}

function getFocalPoint(args: ClientPositionArgs): PanZoomPoint {
  if (!isClientPointWithinContainer(args)) {
    return CENTER_POINT;
  }
  return getPointFromClientPosition(args);
}

function getPointDistance({ firstPoint, secondPoint }: PointPairArgs): number {
  return Math.hypot(firstPoint.x - secondPoint.x, firstPoint.y - secondPoint.y);
}

function getPointMidpoint({
  firstPoint,
  secondPoint,
}: PointPairArgs): PanZoomPoint {
  return {
    x: (firstPoint.x + secondPoint.x) / 2,
    y: (firstPoint.y + secondPoint.y) / 2,
  };
}

function getPanZoomTouchPair({
  container,
  touches,
}: GetPanZoomTouchPairArgs): PanZoomTouchPair | null {
  const firstTouch = touches.item(0);
  const secondTouch = touches.item(1);

  if (firstTouch === null || secondTouch === null) {
    return null;
  }

  const firstPoint = getPointFromClientPosition({
    clientX: firstTouch.clientX,
    clientY: firstTouch.clientY,
    container,
  });
  const secondPoint = getPointFromClientPosition({
    clientX: secondTouch.clientX,
    clientY: secondTouch.clientY,
    container,
  });

  return {
    center: getPointMidpoint({ firstPoint, secondPoint }),
    distance: getPointDistance({ firstPoint, secondPoint }),
  };
}

export function getPanZoomWheelZoomFactor({
  deltaMode,
  deltaY,
}: GetPanZoomWheelZoomFactorArgs): number {
  const normalizedDeltaY =
    deltaMode === WHEEL_DELTA_LINE_MODE
      ? deltaY * WHEEL_LINE_DELTA_PX
      : deltaMode === WHEEL_DELTA_PAGE_MODE
        ? deltaY * WHEEL_PAGE_DELTA_PX
        : deltaY;

  return Math.min(
    WHEEL_MAX_ZOOM_FACTOR,
    Math.max(
      WHEEL_MIN_ZOOM_FACTOR,
      Math.exp(-normalizedDeltaY * WHEEL_ZOOM_INTENSITY),
    ),
  );
}

export function getPanZoomWheelZoomDelta({
  deltaX,
  deltaY,
  deltaZ,
}: GetPanZoomWheelZoomDeltaArgs): number {
  if (deltaY !== 0) {
    return deltaY;
  }
  if (deltaX !== 0) {
    return deltaX;
  }
  return deltaZ;
}

export function getPanZoomGestureEventData(
  event: Event,
): PanZoomGestureEventData | null {
  if (
    !("clientX" in event) ||
    typeof event.clientX !== "number" ||
    !("clientY" in event) ||
    typeof event.clientY !== "number" ||
    !("scale" in event) ||
    typeof event.scale !== "number"
  ) {
    return null;
  }

  return {
    clientX: event.clientX,
    clientY: event.clientY,
    scale: event.scale,
  };
}

export function zoomPanZoomView({
  focalPoint,
  limits,
  nextScale,
  view,
}: ZoomPanZoomViewArgs): PanZoomView {
  const clampedNextScale = clampPanZoomScale(nextScale, limits);
  if (clampedNextScale === view.scale) {
    return view;
  }

  const scaleRatio = clampedNextScale / view.scale;
  return {
    offset: {
      x: focalPoint.x - scaleRatio * (focalPoint.x - view.offset.x),
      y: focalPoint.y - scaleRatio * (focalPoint.y - view.offset.y),
    },
    scale: clampedNextScale,
  };
}

export function pinchPanZoomView({
  limits,
  pinchState,
  touchPair,
}: PinchPanZoomViewArgs): PanZoomView {
  if (pinchState.startDistance <= 0) {
    return pinchState.startView;
  }

  const zoomedView = zoomPanZoomView({
    focalPoint: pinchState.startCenter,
    limits,
    nextScale:
      pinchState.startView.scale *
      (touchPair.distance / pinchState.startDistance),
    view: pinchState.startView,
  });

  return {
    offset: {
      x: zoomedView.offset.x + touchPair.center.x - pinchState.startCenter.x,
      y: zoomedView.offset.y + touchPair.center.y - pinchState.startCenter.y,
    },
    scale: zoomedView.scale,
  };
}

function clampOffset(offset: number, limit: number): number {
  return limit === 0 ? 0 : Math.min(limit, Math.max(-limit, offset));
}

export function constrainPanZoomOffset({
  contentSize,
  view,
  viewportSize,
}: ConstrainPanZoomOffsetArgs): PanZoomView {
  const maxX = Math.max(
    0,
    (contentSize.width * view.scale - viewportSize.width) / 2,
  );
  const maxY = Math.max(
    0,
    (contentSize.height * view.scale - viewportSize.height) / 2,
  );
  const x = clampOffset(view.offset.x, maxX);
  const y = clampOffset(view.offset.y, maxY);
  if (x === view.offset.x && y === view.offset.y) {
    return view;
  }
  return { offset: { x, y }, scale: view.scale };
}

export function createPanZoomTransform(view: PanZoomView): string {
  return `translate(${view.offset.x}px, ${view.offset.y}px) scale(${view.scale})`;
}

export function usePanZoom({
  constrainView,
  enabled,
  limits,
  viewportElement,
}: UsePanZoomArgs): PanZoomControls {
  const [view, setRawView] = useState<PanZoomView>(createInitialPanZoomView);
  const viewRef = useRef<PanZoomView>(view);
  const pinchStateRef = useRef<PanZoomPinchState | null>(null);
  const gestureStateRef = useRef<PanZoomGestureState | null>(null);
  const [dragState, setDragState] = useState<PanZoomDragState | null>(null);
  const constrainRef = useRef(constrainView);
  const limitsRef = useRef(limits);
  useEffect(() => {
    constrainRef.current = constrainView;
    limitsRef.current = limits;
  }, [constrainView, limits]);

  const setView = useCallback(
    (update: (current: PanZoomView) => PanZoomView) => {
      setRawView((current) => {
        const next = update(current);
        return constrainRef.current?.(next) ?? next;
      });
    },
    [],
  );

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const resetView = useCallback(() => {
    const initialView = createInitialPanZoomView();
    viewRef.current = initialView;
    setRawView(initialView);
    setDragState(null);
    pinchStateRef.current = null;
    gestureStateRef.current = null;
  }, []);

  useEffect(() => {
    if (!enabled) {
      resetView();
    }
  }, [enabled, resetView]);

  useEffect(() => {
    if (!enabled || viewportElement === null) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      const zoomDelta = getPanZoomWheelZoomDelta({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaZ: event.deltaZ,
      });
      if (zoomDelta === 0) {
        return;
      }

      if (event.cancelable) {
        event.preventDefault();
      }
      event.stopPropagation();

      const focalPoint = getFocalPoint({
        clientX: event.clientX,
        clientY: event.clientY,
        container: viewportElement,
      });
      const zoomFactor = getPanZoomWheelZoomFactor({
        deltaMode: event.deltaMode,
        deltaY: zoomDelta,
      });

      setView((currentView) =>
        zoomPanZoomView({
          focalPoint,
          limits: limitsRef.current,
          nextScale: currentView.scale * zoomFactor,
          view: currentView,
        }),
      );
    };

    const handleGestureStart = (event: Event) => {
      const gestureEventData = getPanZoomGestureEventData(event);
      if (gestureEventData === null || gestureEventData.scale <= 0) {
        gestureStateRef.current = null;
        return;
      }

      if (event.cancelable) {
        event.preventDefault();
      }

      gestureStateRef.current = {
        startScale: gestureEventData.scale,
        startView: viewRef.current,
      };
      setDragState(null);
    };

    const handleGestureChange = (event: Event) => {
      const gestureState = gestureStateRef.current;
      const gestureEventData = getPanZoomGestureEventData(event);
      if (
        gestureState === null ||
        gestureEventData === null ||
        gestureState.startScale <= 0 ||
        gestureEventData.scale <= 0
      ) {
        return;
      }

      if (event.cancelable) {
        event.preventDefault();
      }

      const focalPoint = getFocalPoint({
        clientX: gestureEventData.clientX,
        clientY: gestureEventData.clientY,
        container: viewportElement,
      });

      setView(() =>
        zoomPanZoomView({
          focalPoint,
          limits: limitsRef.current,
          nextScale:
            gestureState.startView.scale *
            (gestureEventData.scale / gestureState.startScale),
          view: gestureState.startView,
        }),
      );
    };

    const handleGestureEnd = () => {
      gestureStateRef.current = null;
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length < 2) {
        pinchStateRef.current = null;
        return;
      }

      if (event.cancelable) {
        event.preventDefault();
      }

      const touchPair = getPanZoomTouchPair({
        container: viewportElement,
        touches: event.touches,
      });
      if (touchPair === null) {
        return;
      }

      pinchStateRef.current = {
        startCenter: touchPair.center,
        startDistance: touchPair.distance,
        startView: viewRef.current,
      };
      setDragState(null);
    };

    const handleTouchMove = (event: TouchEvent) => {
      const pinchState = pinchStateRef.current;
      if (pinchState === null || event.touches.length < 2) {
        return;
      }

      if (event.cancelable) {
        event.preventDefault();
      }

      const touchPair = getPanZoomTouchPair({
        container: viewportElement,
        touches: event.touches,
      });
      if (touchPair === null) {
        return;
      }

      setView(() =>
        pinchPanZoomView({
          limits: limitsRef.current,
          pinchState,
          touchPair,
        }),
      );
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) {
        pinchStateRef.current = null;
      }
    };

    window.addEventListener("wheel", handleWheel, {
      capture: true,
      passive: false,
    });
    window.addEventListener("gesturestart", handleGestureStart, {
      capture: true,
      passive: false,
    });
    window.addEventListener("gesturechange", handleGestureChange, {
      capture: true,
      passive: false,
    });
    window.addEventListener("gestureend", handleGestureEnd, {
      capture: true,
    });
    viewportElement.addEventListener("touchstart", handleTouchStart, {
      passive: false,
    });
    viewportElement.addEventListener("touchmove", handleTouchMove, {
      passive: false,
    });
    viewportElement.addEventListener("touchend", handleTouchEnd);
    viewportElement.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      window.removeEventListener("wheel", handleWheel, { capture: true });
      window.removeEventListener("gesturestart", handleGestureStart, {
        capture: true,
      });
      window.removeEventListener("gesturechange", handleGestureChange, {
        capture: true,
      });
      window.removeEventListener("gestureend", handleGestureEnd, {
        capture: true,
      });
      viewportElement.removeEventListener("touchstart", handleTouchStart);
      viewportElement.removeEventListener("touchmove", handleTouchMove);
      viewportElement.removeEventListener("touchend", handleTouchEnd);
      viewportElement.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [enabled, setView, viewportElement]);

  const zoomAroundCenter = useCallback(
    (scaleDelta: number) => {
      setView((currentView) =>
        zoomPanZoomView({
          focalPoint: CENTER_POINT,
          limits: limitsRef.current,
          nextScale: currentView.scale + scaleDelta,
          view: currentView,
        }),
      );
    },
    [setView],
  );

  const onPointerDown: PanZoomPointerHandler = (event) => {
    if (
      !event.isPrimary ||
      pinchStateRef.current !== null ||
      (event.pointerType === "mouse" && event.button !== 0)
    ) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startOffset: viewRef.current.offset,
    });
  };

  const onPointerMove: PanZoomPointerHandler = (event) => {
    if (dragState === null || dragState.pointerId !== event.pointerId) {
      return;
    }

    setView((currentView) => ({
      offset: {
        x: dragState.startOffset.x + event.clientX - dragState.startClientX,
        y: dragState.startOffset.y + event.clientY - dragState.startClientY,
      },
      scale: currentView.scale,
    }));
  };

  const onPointerEnd: PanZoomPointerHandler = (event) => {
    if (dragState?.pointerId !== event.pointerId) {
      return;
    }

    setDragState(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return {
    isDragging: dragState !== null,
    pointerHandlers: {
      onPointerCancel: onPointerEnd,
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
    },
    resetView,
    view,
    zoomAroundCenter,
  };
}
