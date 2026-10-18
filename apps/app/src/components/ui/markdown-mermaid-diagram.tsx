import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type CSSProperties,
  type ComponentPropsWithoutRef,
  type PointerEventHandler,
  type Ref,
  type RefObject,
} from "react";
import type { RenderOptions } from "pele/lazy";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Button } from "@bb/shared-ui/button";
import { CopyButton } from "./copy-button.js";
import { Icon } from "@bb/shared-ui/icon";
import { loadPele } from "./markdown-mermaid-loader.js";
import {
  MERMAID_SOURCE_RENDER_DEBOUNCE_MS,
  observeMermaidViewportEntry,
  peekMermaidRenderCache,
  readMermaidRenderCache,
  storeMermaidRenderCache,
  type RenderedMermaidDiagram,
} from "./markdown-mermaid-render-cache.js";
import { cn } from "@bb/shared-ui/lib/utils";

interface MarkdownMermaidDiagramProps {
  source: string;
}

type MermaidDiagramOpenChangeHandler = (open: boolean) => void;
type MermaidDiagramDisplayMode = "preview" | "source";

interface MermaidDiagramDialogProps {
  diagram: RenderedMermaidDiagram;
  onOpenChange: MermaidDiagramOpenChangeHandler;
  open: boolean;
  source: string;
}

interface MermaidDiagramPoint {
  x: number;
  y: number;
}

interface MermaidDiagramOffset {
  x: number;
  y: number;
}

interface MermaidDiagramView {
  offset: MermaidDiagramOffset;
  scale: number;
}

interface MermaidDiagramDragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startOffset: MermaidDiagramOffset;
}

interface MermaidDiagramPinchState {
  startCenter: MermaidDiagramPoint;
  startDistance: number;
  startView: MermaidDiagramView;
}

interface MermaidDiagramGestureState {
  startScale: number;
  startView: MermaidDiagramView;
}

interface MermaidDiagramTouchPair {
  center: MermaidDiagramPoint;
  distance: number;
}

interface CreateMermaidDialogDiagramStyleArgs {
  view: MermaidDiagramView;
}

interface MermaidDialogDiagramStyle extends CSSProperties {
  transform: string;
  transformOrigin: string;
}

interface GetMermaidDiagramPointFromClientPositionArgs {
  clientX: number;
  clientY: number;
  container: HTMLElement;
}

interface GetMermaidDiagramFocalPointArgs {
  clientX: number;
  clientY: number;
  container: HTMLElement;
}

interface IsMermaidClientPointWithinContainerArgs {
  clientX: number;
  clientY: number;
  container: HTMLElement;
}

interface GetMermaidTouchPairArgs {
  container: HTMLElement;
  touches: TouchList;
}

interface GetMermaidWheelZoomFactorArgs {
  deltaMode: number;
  deltaY: number;
}

interface GetMermaidWheelZoomDeltaArgs {
  deltaX: number;
  deltaY: number;
  deltaZ: number;
}

interface MermaidWheelZoomEvent {
  cancelable: boolean;
  clientX: number;
  clientY: number;
  deltaMode: number;
  deltaX: number;
  deltaY: number;
  deltaZ: number;
  preventDefault(): void;
  stopPropagation(): void;
}

interface MermaidGestureEventData {
  clientX: number;
  clientY: number;
  scale: number;
}

interface GetMermaidGestureEventDataArgs {
  event: Event;
}

interface ShouldHandleMermaidWheelZoomArgs {
  zoomDelta: number;
}

interface ZoomMermaidDiagramViewArgs {
  focalPoint: MermaidDiagramPoint;
  nextScale: number;
  view: MermaidDiagramView;
}

interface PinchMermaidDiagramViewArgs {
  pinchState: MermaidDiagramPinchState;
  touchPair: MermaidDiagramTouchPair;
}

interface MermaidPointPairArgs {
  firstPoint: MermaidDiagramPoint;
  secondPoint: MermaidDiagramPoint;
}

type MermaidRenderState =
  | { kind: "loading" }
  | { kind: "rendered"; diagram: RenderedMermaidDiagram }
  | { kind: "source" };

type MermaidDiagramContainerProps = ComponentPropsWithoutRef<"div"> & {
  ref?: Ref<HTMLDivElement>;
};
type MermaidDiagramPointerHandler = PointerEventHandler<HTMLDivElement>;

const MERMAID_RENDER_ID_PREFIX = "bb-mermaid";
const MERMAID_RENDER_ID_SAFE_CHARACTER_PATTERN = /[^a-zA-Z0-9_-]/gu;
const MERMAID_DIAGRAM_MIN_SCALE = 0.5;
const MERMAID_DIAGRAM_MAX_SCALE = 4;
const MERMAID_DIAGRAM_SCALE_STEP = 0.25;
const MERMAID_WHEEL_DELTA_LINE_MODE = 1;
const MERMAID_WHEEL_DELTA_PAGE_MODE = 2;
const MERMAID_WHEEL_LINE_DELTA_PX = 16;
const MERMAID_WHEEL_PAGE_DELTA_PX = 800;
const MERMAID_WHEEL_ZOOM_INTENSITY = 0.01;
const MERMAID_WHEEL_MIN_ZOOM_FACTOR = 0.82;
const MERMAID_WHEEL_MAX_ZOOM_FACTOR = 1.22;
const MERMAID_DIAGRAM_CENTER_POINT: MermaidDiagramPoint = { x: 0, y: 0 };

const MERMAID_FONT_FAMILY = '"Inter Variable", Inter, sans-serif';
const MERMAID_DIRECTION_BREAKPOINT_PX = 900;
const MERMAID_INLINE_HORIZONTAL_PADDING_PX = 24;
const MERMAID_MAX_WIDTH_STEP_PX = 16;
const MERMAID_PELE_THEME_CLASS_NAME =
  "[--pele-accent:var(--primary)] [--pele-border:var(--border)] [--pele-fg:var(--foreground)] [--pele-font:var(--font-sans)] [--pele-line:var(--primary)] [--pele-muted:var(--muted-foreground)] [--pele-surface-alt:var(--muted)] [--pele-surface:var(--secondary)]";

function buildPeleRenderOptions(
  idPrefix: string,
  maxWidth: number | null,
): RenderOptions {
  return {
    directionBreakpoint: MERMAID_DIRECTION_BREAKPOINT_PX,
    fontFamily: MERMAID_FONT_FAMILY,
    idPrefix,
    images: false,
    links: false,
    ...(maxWidth === null ? {} : { maxWidth }),
  };
}

function toMermaidMaxWidth(containerWidth: number): number | null {
  const availableWidth = containerWidth - MERMAID_INLINE_HORIZONTAL_PADDING_PX;
  if (availableWidth <= 0) {
    return null;
  }
  return (
    Math.floor(availableWidth / MERMAID_MAX_WIDTH_STEP_PX) *
    MERMAID_MAX_WIDTH_STEP_PX
  );
}

function useMermaidMaxWidth(
  containerRef: RefObject<HTMLDivElement | null>,
): number | null {
  const [maxWidth, setMaxWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const containerElement = containerRef.current;
    if (containerElement === null) {
      return;
    }
    const updateMaxWidth = (containerWidth: number) => {
      const nextMaxWidth = toMermaidMaxWidth(containerWidth);
      if (nextMaxWidth !== null) {
        setMaxWidth(nextMaxWidth);
      }
    };
    updateMaxWidth(containerElement.clientWidth);
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        updateMaxWidth(entry.contentRect.width);
      }
    });
    resizeObserver.observe(containerElement);
    return () => {
      resizeObserver.disconnect();
    };
  }, [containerRef]);

  return maxWidth;
}

function buildMermaidRenderId(reactId: string): string {
  const safeId = reactId.replace(MERMAID_RENDER_ID_SAFE_CHARACTER_PATTERN, "");
  return `${MERMAID_RENDER_ID_PREFIX}-${safeId}`;
}

function createInitialMermaidDiagramView(): MermaidDiagramView {
  return { offset: { x: 0, y: 0 }, scale: 1 };
}

export function clampMermaidScale(scale: number): number {
  return Math.min(
    MERMAID_DIAGRAM_MAX_SCALE,
    Math.max(MERMAID_DIAGRAM_MIN_SCALE, scale),
  );
}

function getMermaidDiagramPointFromClientPosition({
  clientX,
  clientY,
  container,
}: GetMermaidDiagramPointFromClientPositionArgs): MermaidDiagramPoint {
  const containerRect = container.getBoundingClientRect();
  return {
    x: clientX - containerRect.left - containerRect.width / 2,
    y: clientY - containerRect.top - containerRect.height / 2,
  };
}

function isMermaidClientPointWithinContainer({
  clientX,
  clientY,
  container,
}: IsMermaidClientPointWithinContainerArgs): boolean {
  const containerRect = container.getBoundingClientRect();
  return (
    clientX >= containerRect.left &&
    clientX <= containerRect.right &&
    clientY >= containerRect.top &&
    clientY <= containerRect.bottom
  );
}

function getMermaidDiagramFocalPoint({
  clientX,
  clientY,
  container,
}: GetMermaidDiagramFocalPointArgs): MermaidDiagramPoint {
  if (
    !isMermaidClientPointWithinContainer({
      clientX,
      clientY,
      container,
    })
  ) {
    return MERMAID_DIAGRAM_CENTER_POINT;
  }

  return getMermaidDiagramPointFromClientPosition({
    clientX,
    clientY,
    container,
  });
}

function getMermaidPointDistance({
  firstPoint,
  secondPoint,
}: MermaidPointPairArgs): number {
  return Math.hypot(firstPoint.x - secondPoint.x, firstPoint.y - secondPoint.y);
}

function getMermaidPointMidpoint({
  firstPoint,
  secondPoint,
}: MermaidPointPairArgs): MermaidDiagramPoint {
  return {
    x: (firstPoint.x + secondPoint.x) / 2,
    y: (firstPoint.y + secondPoint.y) / 2,
  };
}

function getMermaidTouchPair({
  container,
  touches,
}: GetMermaidTouchPairArgs): MermaidDiagramTouchPair | null {
  const firstTouch = touches.item(0);
  const secondTouch = touches.item(1);

  if (firstTouch === null || secondTouch === null) {
    return null;
  }

  const firstPoint = getMermaidDiagramPointFromClientPosition({
    clientX: firstTouch.clientX,
    clientY: firstTouch.clientY,
    container,
  });
  const secondPoint = getMermaidDiagramPointFromClientPosition({
    clientX: secondTouch.clientX,
    clientY: secondTouch.clientY,
    container,
  });

  return {
    center: getMermaidPointMidpoint({ firstPoint, secondPoint }),
    distance: getMermaidPointDistance({ firstPoint, secondPoint }),
  };
}

export function getMermaidWheelZoomFactor({
  deltaMode,
  deltaY,
}: GetMermaidWheelZoomFactorArgs): number {
  const normalizedDeltaY =
    deltaMode === MERMAID_WHEEL_DELTA_LINE_MODE
      ? deltaY * MERMAID_WHEEL_LINE_DELTA_PX
      : deltaMode === MERMAID_WHEEL_DELTA_PAGE_MODE
        ? deltaY * MERMAID_WHEEL_PAGE_DELTA_PX
        : deltaY;

  return Math.min(
    MERMAID_WHEEL_MAX_ZOOM_FACTOR,
    Math.max(
      MERMAID_WHEEL_MIN_ZOOM_FACTOR,
      Math.exp(-normalizedDeltaY * MERMAID_WHEEL_ZOOM_INTENSITY),
    ),
  );
}

export function getMermaidWheelZoomDelta({
  deltaX,
  deltaY,
  deltaZ,
}: GetMermaidWheelZoomDeltaArgs): number {
  if (deltaY !== 0) {
    return deltaY;
  }
  if (deltaX !== 0) {
    return deltaX;
  }
  return deltaZ;
}

export function getMermaidGestureEventData({
  event,
}: GetMermaidGestureEventDataArgs): MermaidGestureEventData | null {
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

export function shouldHandleMermaidWheelZoom({
  zoomDelta,
}: ShouldHandleMermaidWheelZoomArgs): boolean {
  return zoomDelta !== 0;
}

export function zoomMermaidDiagramView({
  focalPoint,
  nextScale,
  view,
}: ZoomMermaidDiagramViewArgs): MermaidDiagramView {
  const clampedNextScale = clampMermaidScale(nextScale);
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

export function pinchMermaidDiagramView({
  pinchState,
  touchPair,
}: PinchMermaidDiagramViewArgs): MermaidDiagramView {
  if (pinchState.startDistance <= 0) {
    return pinchState.startView;
  }

  const zoomedView = zoomMermaidDiagramView({
    focalPoint: pinchState.startCenter,
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

function createMermaidDialogDiagramStyle({
  view,
}: CreateMermaidDialogDiagramStyleArgs): MermaidDialogDiagramStyle {
  return {
    transform: `translate(${view.offset.x}px, ${view.offset.y}px) scale(${view.scale})`,
    transformOrigin: "center center",
  };
}

function MermaidDiagramContainer({
  children,
  className,
  ref,
  ...containerProps
}: MermaidDiagramContainerProps) {
  return (
    <div
      {...containerProps}
      ref={ref}
      className={cn(
        "my-2 overflow-hidden rounded-md border border-border bg-surface-recessed [--pele-bg:var(--surface-recessed-solid)]",
        MERMAID_PELE_THEME_CLASS_NAME,
        className,
      )}
    >
      {children}
    </div>
  );
}

function MermaidDiagramDialog({
  diagram,
  onOpenChange,
  open,
  source,
}: MermaidDiagramDialogProps) {
  const dialogViewportRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<MermaidDiagramView>(
    createInitialMermaidDiagramView,
  );
  const viewRef = useRef<MermaidDiagramView>(view);
  const pinchStateRef = useRef<MermaidDiagramPinchState | null>(null);
  const gestureStateRef = useRef<MermaidDiagramGestureState | null>(null);
  const [dragState, setDragState] = useState<MermaidDiagramDragState | null>(
    null,
  );
  const diagramStyle = createMermaidDialogDiagramStyle({ view });
  const isDragging = dragState !== null;
  const zoomFromWheelEvent = useCallback((event: MermaidWheelZoomEvent) => {
    const viewportElement = dialogViewportRef.current;
    if (!viewportElement) {
      return;
    }

    const zoomDelta = getMermaidWheelZoomDelta({
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaZ: event.deltaZ,
    });

    if (!shouldHandleMermaidWheelZoom({ zoomDelta })) {
      return;
    }

    if (event.cancelable) {
      event.preventDefault();
    }
    event.stopPropagation();

    const focalPoint = getMermaidDiagramFocalPoint({
      clientX: event.clientX,
      clientY: event.clientY,
      container: viewportElement,
    });
    const zoomFactor = getMermaidWheelZoomFactor({
      deltaMode: event.deltaMode,
      deltaY: zoomDelta,
    });

    setView((currentView) =>
      zoomMermaidDiagramView({
        focalPoint,
        nextScale: currentView.scale * zoomFactor,
        view: currentView,
      }),
    );
  }, []);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    if (!open) {
      const initialView = createInitialMermaidDiagramView();
      viewRef.current = initialView;
      setView(initialView);
      setDragState(null);
      pinchStateRef.current = null;
      gestureStateRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const viewportElement = dialogViewportRef.current;
    if (!viewportElement) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      zoomFromWheelEvent(event);
    };

    const handleGestureStart = (event: Event) => {
      const gestureEventData = getMermaidGestureEventData({ event });
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
      const gestureEventData = getMermaidGestureEventData({ event });
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

      const focalPoint = getMermaidDiagramFocalPoint({
        clientX: gestureEventData.clientX,
        clientY: gestureEventData.clientY,
        container: viewportElement,
      });

      setView(
        zoomMermaidDiagramView({
          focalPoint,
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

      const touchPair = getMermaidTouchPair({
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

      const touchPair = getMermaidTouchPair({
        container: viewportElement,
        touches: event.touches,
      });
      if (touchPair === null) {
        return;
      }

      setView(pinchMermaidDiagramView({ pinchState, touchPair }));
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
  }, [open, zoomFromWheelEvent]);

  const zoomOut = () => {
    setView((currentView) =>
      zoomMermaidDiagramView({
        focalPoint: MERMAID_DIAGRAM_CENTER_POINT,
        nextScale: currentView.scale - MERMAID_DIAGRAM_SCALE_STEP,
        view: currentView,
      }),
    );
  };

  const zoomIn = () => {
    setView((currentView) =>
      zoomMermaidDiagramView({
        focalPoint: MERMAID_DIAGRAM_CENTER_POINT,
        nextScale: currentView.scale + MERMAID_DIAGRAM_SCALE_STEP,
        view: currentView,
      }),
    );
  };

  const resetView = () => {
    const initialView = createInitialMermaidDiagramView();
    viewRef.current = initialView;
    setView(initialView);
    setDragState(null);
    pinchStateRef.current = null;
    gestureStateRef.current = null;
  };

  const handlePointerDown: MermaidDiagramPointerHandler = (event) => {
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
      startOffset: view.offset,
    });
  };

  const handlePointerMove: MermaidDiagramPointerHandler = (event) => {
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

  const handlePointerEnd: MermaidDiagramPointerHandler = (event) => {
    if (dragState?.pointerId !== event.pointerId) {
      return;
    }

    setDragState(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          MERMAID_PELE_THEME_CLASS_NAME,
          "[--pele-bg:var(--background)]",
          "flex h-[min(84dvh,58rem)] w-full max-w-none gap-0 overflow-hidden border-border bg-background p-0 shadow-sm md:w-[min(96vw,88rem)] [&>button]:right-2 [&>button]:top-2 [&>button]:z-20 [&>button]:flex [&>button]:size-8 [&>button]:items-center [&>button]:justify-center [&>button]:rounded-md [&>button]:bg-surface-scrim/95 [&>button]:text-muted-foreground [&>button]:opacity-100 [&>button]:backdrop-blur-sm [&>button]:hover:bg-state-hover [&>button]:hover:text-foreground",
        )}
      >
        <DialogTitle className="sr-only">Mermaid diagram</DialogTitle>
        <DialogDescription className="sr-only">
          Expanded Mermaid diagram preview with zoom and pan controls.
        </DialogDescription>
        <div className="absolute right-2 top-8 z-10 flex h-8 items-center gap-1 rounded-md bg-surface-scrim/95 p-0.5 backdrop-blur-sm md:right-11 md:top-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            onClick={zoomOut}
            aria-label="Zoom out"
          >
            <Icon name="ZoomOut" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            onClick={zoomIn}
            aria-label="Zoom in"
          >
            <Icon name="ZoomIn" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            onClick={resetView}
            aria-label="Reset view"
          >
            <Icon name="RotateCcw" />
          </Button>
          <CopyButton
            text={source}
            label="Copy Mermaid source"
            className="size-7 rounded-md hover:bg-state-hover hover:text-foreground"
            iconClassName="size-4"
          />
        </div>
        <div
          ref={dialogViewportRef}
          className={cn(
            "min-h-0 flex-1 touch-none overflow-hidden bg-surface-recessed",
            isDragging ? "cursor-grabbing" : "cursor-grab",
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onWheelCapture={zoomFromWheelEvent}
        >
          <div className="flex h-full w-full items-center justify-center p-6">
            <div
              className="flex h-full w-full select-none items-center justify-center [&_svg]:block [&_svg]:h-auto [&_svg]:max-h-full [&_svg]:max-w-full"
              role="img"
              aria-label="Mermaid diagram"
              style={diagramStyle}
              dangerouslySetInnerHTML={{ __html: diagram.svg }}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MarkdownMermaidDiagram({
  source,
}: MarkdownMermaidDiagramProps) {
  const reactId = useId();
  const containerElementRef = useRef<HTMLDivElement>(null);
  const renderId = useMemo(() => buildMermaidRenderId(reactId), [reactId]);
  const renderAttemptRef = useRef(0);
  const maxWidth = useMermaidMaxWidth(containerElementRef);
  const [initialCachedDiagram] = useState(() => peekMermaidRenderCache(source));
  const [renderState, setRenderState] = useState<MermaidRenderState>(() =>
    initialCachedDiagram === null
      ? { kind: "loading" }
      : { kind: "rendered", diagram: initialCachedDiagram },
  );
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [displayMode, setDisplayMode] =
    useState<MermaidDiagramDisplayMode>("preview");
  const [hasEnteredViewport, setHasEnteredViewport] = useState(
    initialCachedDiagram !== null,
  );
  const renderedSourceRef = useRef<string | null>(
    initialCachedDiagram === null ? null : source,
  );

  useEffect(() => {
    const containerElement = containerElementRef.current;
    if (hasEnteredViewport || containerElement === null) {
      return;
    }
    return observeMermaidViewportEntry(containerElement, () => {
      setHasEnteredViewport(true);
    });
  }, [hasEnteredViewport]);

  useEffect(() => {
    if (!hasEnteredViewport) {
      return;
    }
    const cachedDiagram = readMermaidRenderCache(source);
    const isSourceUpdate =
      renderedSourceRef.current !== null &&
      renderedSourceRef.current !== source;
    renderedSourceRef.current = source;
    if (cachedDiagram !== null && cachedDiagram.maxWidth === maxWidth) {
      setRenderState((currentState) =>
        currentState.kind === "rendered" &&
        currentState.diagram === cachedDiagram
          ? currentState
          : { kind: "rendered", diagram: cachedDiagram },
      );
      if (isSourceUpdate) {
        setDisplayMode("preview");
      }
      return;
    }

    let isCurrentRender = true;
    const runRender = () => {
      loadPele()
        .then((pele) => {
          if (!isCurrentRender) {
            return null;
          }
          return pele.renderAsync(
            source,
            buildPeleRenderOptions(
              `${renderId}-${++renderAttemptRef.current}`,
              maxWidth,
            ),
          );
        })
        .then((renderResult) => {
          if (!isCurrentRender || renderResult === null) {
            return;
          }
          const diagram: RenderedMermaidDiagram = {
            maxWidth,
            svg: renderResult.svg,
          };
          storeMermaidRenderCache(source, diagram);
          setRenderState({ kind: "rendered", diagram });
        })
        .catch(() => {
          if (!isCurrentRender) {
            return;
          }
          setRenderState((currentState) =>
            currentState.kind === "rendered"
              ? currentState
              : { kind: "source" },
          );
        });
    };

    if (!isSourceUpdate) {
      runRender();
      return () => {
        isCurrentRender = false;
      };
    }
    setDisplayMode("preview");
    const timeoutId = window.setTimeout(
      runRender,
      MERMAID_SOURCE_RENDER_DEBOUNCE_MS,
    );
    return () => {
      isCurrentRender = false;
      window.clearTimeout(timeoutId);
    };
  }, [hasEnteredViewport, maxWidth, renderId, source]);

  const isRendered = renderState.kind === "rendered";
  const showRenderedDiagram = isRendered && displayMode === "preview";
  const renderedSvg = isRendered ? renderState.diagram.svg : null;
  const renderedMarkup = useMemo(
    () => (renderedSvg === null ? null : { __html: renderedSvg }),
    [renderedSvg],
  );
  const showSource =
    renderState.kind === "source" || (isRendered && displayMode === "source");
  const toggleDisplayMode = () => {
    setDisplayMode((currentDisplayMode) =>
      currentDisplayMode === "preview" ? "source" : "preview",
    );
  };

  return (
    <MermaidDiagramContainer ref={containerElementRef}>
      <div className="flex items-center justify-between pl-3 pr-1.5 pt-1.5">
        <span className="font-mono text-xs uppercase text-muted-foreground">
          mermaid
        </span>
        <div className="flex items-center gap-1">
          {isRendered ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              onClick={toggleDisplayMode}
              aria-label="Show Mermaid source"
              aria-pressed={displayMode === "source"}
            >
              <Icon name="Code" />
            </Button>
          ) : null}
          {isRendered ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              onClick={() => setIsDialogOpen(true)}
              aria-label="Open Mermaid diagram"
            >
              <Icon name="Maximize2" />
            </Button>
          ) : null}
          <CopyButton text={source} label="Copy Mermaid source" />
        </div>
      </div>
      {showRenderedDiagram ? (
        <div className="overflow-x-auto px-3 pb-3 pt-2">
          <div
            className="min-w-0 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
            role="img"
            aria-label="Mermaid diagram"
            dangerouslySetInnerHTML={renderedMarkup ?? undefined}
          />
        </div>
      ) : null}
      {renderState.kind === "loading" ? (
        <div className="flex min-h-24 items-center justify-center px-3 pb-3 pt-2 text-xs text-muted-foreground">
          Rendering diagram...
        </div>
      ) : null}
      {showSource ? (
        <pre className="overflow-x-auto px-3 pb-3 pt-1">
          <code className="font-mono text-xs language-mermaid">{source}</code>
        </pre>
      ) : null}
      {isRendered ? (
        <MermaidDiagramDialog
          diagram={renderState.diagram}
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          source={source}
        />
      ) : null}
    </MermaidDiagramContainer>
  );
}
