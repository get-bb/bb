import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { toast } from "sonner";
import { copyImageToClipboard, toastError, toastSuccess } from "./clipboard";
import type { BrowserScreenshotEditorSnapshot } from "./annotation-state";
import { browserScreenshotEditorStateSchema } from "./contracts";

export type Tool = "pen" | "highlight" | "arrow" | "rect" | "ellipse" | "text";

type Point = { x: number; y: number };

type InkShape = {
  color: string;
  id: string;
  kind: "pen" | "highlight";
  points: Point[];
  width: number;
};

type ArrowShape = {
  color: string;
  from: Point;
  id: string;
  kind: "arrow";
  to: Point;
  width: number;
};

type BoxShape = {
  color: string;
  from: Point;
  id: string;
  kind: "rect" | "ellipse";
  to: Point;
  width: number;
};

type TextShape = {
  at: Point;
  color: string;
  fontSize: number;
  id: string;
  kind: "text";
  text: string;
};

export type Shape = InkShape | ArrowShape | BoxShape | TextShape;

type PendingText = NonNullable<BrowserScreenshotEditorSnapshot["pendingText"]>;

interface BrowserScreenshotAnnotationProps {
  screenshotUrl: string;
  onClose: () => void;
  initialEditorState?: BrowserScreenshotEditorSnapshot;
  onEditorStateChange?: (editor: BrowserScreenshotEditorSnapshot) => void;
}

const COLOR_OPTIONS = [
  { label: "Red ink", value: "#ef4444" },
  { label: "Orange ink", value: "#f97316" },
  { label: "Yellow ink", value: "#eab308" },
  { label: "Green ink", value: "#22c55e" },
  { label: "Blue ink", value: "#3b82f6" },
  { label: "Dark ink", value: "#111827" },
  { label: "White ink", value: "#ffffff" },
] as const;
const WIDTHS = [2, 4, 8];
const FONT_SIZES = [14, 18, 24, 32, 48];
const MAX_EDITOR_HISTORY_FRAMES = 50;
const MAX_SHAPE_POINTS = 4_096;

function ScreenshotToolbarTooltip({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

function normalizedRect(from: Point, to: Point) {
  return {
    height: Math.abs(to.y - from.y),
    width: Math.abs(to.x - from.x),
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
  };
}

function scalePoint(point: Point, scale: number): Point {
  return { x: point.x * scale, y: point.y * scale };
}

function drawInk(context: CanvasRenderingContext2D, shape: InkShape): void {
  if (shape.points.length === 0) return;
  context.beginPath();
  context.globalAlpha = shape.kind === "highlight" ? 0.35 : 1;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth =
    shape.kind === "highlight" ? shape.width * 4 : shape.width;
  context.strokeStyle = shape.color;
  context.moveTo(shape.points[0].x, shape.points[0].y);
  for (const point of shape.points.slice(1)) context.lineTo(point.x, point.y);
  if (shape.points.length === 1) {
    context.lineTo(shape.points[0].x + 0.01, shape.points[0].y + 0.01);
  }
  context.stroke();
  context.globalAlpha = 1;
}

function drawArrow(context: CanvasRenderingContext2D, shape: ArrowShape): void {
  const { from, to, width } = shape;
  context.beginPath();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = width;
  context.strokeStyle = shape.color;
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  if (Number.isFinite(angle)) {
    const length = Math.max(10, width * 3.5);
    context.lineTo(
      to.x + length * Math.cos(angle + Math.PI - 0.45),
      to.y + length * Math.sin(angle + Math.PI - 0.45),
    );
    context.moveTo(to.x, to.y);
    context.lineTo(
      to.x + length * Math.cos(angle + Math.PI + 0.45),
      to.y + length * Math.sin(angle + Math.PI + 0.45),
    );
  }
  context.stroke();
}

function drawShape(context: CanvasRenderingContext2D, shape: Shape): void {
  if ("points" in shape) {
    drawInk(context, shape);
    return;
  }
  if (shape.kind === "text") {
    context.fillStyle = shape.color;
    context.font = `600 ${shape.fontSize}px ui-sans-serif, system-ui, sans-serif`;
    context.textBaseline = "top";
    context.fillText(shape.text, shape.at.x, shape.at.y);
    return;
  }
  if (shape.kind === "arrow") {
    drawArrow(context, shape);
    return;
  }
  const rect = normalizedRect(shape.from, shape.to);
  context.beginPath();
  context.lineWidth = shape.width;
  context.strokeStyle = shape.color;
  if (shape.kind === "rect") {
    context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  } else {
    context.ellipse(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      rect.width / 2,
      rect.height / 2,
      0,
      0,
      Math.PI * 2,
    );
    context.stroke();
  }
}

export function annotatedScreenshotBlob(
  image: HTMLImageElement,
  shapes: readonly Shape[],
): Promise<Blob | null> {
  if (image.naturalWidth === 0 || image.naturalHeight === 0) {
    return Promise.resolve(null);
  }
  const output = document.createElement("canvas");
  output.width = image.naturalWidth;
  output.height = image.naturalHeight;
  const context = output.getContext("2d");
  if (context === null) return Promise.resolve(null);
  context.drawImage(image, 0, 0, output.width, output.height);
  for (const shape of shapes) {
    const scaled = scaleShape(shape, 1);
    drawShape(context, scaled);
  }
  return new Promise((resolve) => output.toBlob(resolve, "image/png"));
}

export function annotatedScreenshotDataUrl(
  image: HTMLImageElement,
  shapes: readonly Shape[],
): string | null {
  if (image.naturalWidth === 0 || image.naturalHeight === 0) {
    return null;
  }
  const output = document.createElement("canvas");
  output.width = image.naturalWidth;
  output.height = image.naturalHeight;
  const context = output.getContext("2d");
  if (context === null) return null;
  context.drawImage(image, 0, 0, output.width, output.height);
  for (const shape of shapes) {
    const scaled = scaleShape(shape, 1);
    drawShape(context, scaled);
  }
  return output.toDataURL("image/png");
}

export function loadScreenshotImage(
  dataUrl: string,
): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
}

function scaleShape(shape: Shape, scale: number): Shape {
  if ("points" in shape) {
    return {
      ...shape,
      points: shape.points.map((point) => scalePoint(point, scale)),
      width: shape.width * scale,
    };
  }
  if (shape.kind === "text") {
    return {
      ...shape,
      at: scalePoint(shape.at, scale),
      fontSize: shape.fontSize * scale,
    };
  }
  return {
    ...shape,
    from: scalePoint(shape.from, scale),
    to: scalePoint(shape.to, scale),
    width: shape.width * scale,
  };
}

export function BrowserScreenshotAnnotation({
  screenshotUrl,
  onClose,
  initialEditorState,
  onEditorStateChange,
}: BrowserScreenshotAnnotationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const imageSizeRef = useRef<{ width: number; height: number } | null>(null);
  const activeShapeRef = useRef<Shape | null>(null);
  const [imageSpace, setImageSpace] = useState(
    initialEditorState?.image ?? null,
  );
  const shapesRef = useRef<Shape[]>([]);
  const [color, setColor] = useState<string>(
    initialEditorState?.color ?? COLOR_OPTIONS[0].value,
  );
  const [fontSize, setFontSize] = useState(initialEditorState?.fontSize ?? 18);
  const [past, setPast] = useState<Shape[][]>(initialEditorState?.past ?? []);
  const [pendingText, setPendingText] = useState<PendingText | null>(
    initialEditorState?.pendingText ?? null,
  );
  const [redo, setRedo] = useState<Shape[][]>(initialEditorState?.redo ?? []);
  const [shapes, setShapes] = useState<Shape[]>(
    initialEditorState?.shapes ?? [],
  );
  const [tool, setTool] = useState<Tool>(initialEditorState?.tool ?? "pen");
  const [width, setWidth] = useState(initialEditorState?.width ?? 4);
  const publishedEditorRef = useRef<BrowserScreenshotEditorSnapshot | null>(
    null,
  );
  const [receivedEditor, setReceivedEditor] = useState(initialEditorState);
  const [displayScale, setDisplayScale] = useState<number | null>(null);

  useEffect(() => {
    if (imageSpace === null) return;
    const editor = {
      image: imageSpace,
      color,
      fontSize,
      past,
      pendingText,
      redo,
      shapes,
      tool,
      width,
    };
    publishedEditorRef.current = editor;
    onEditorStateChange?.(editor);
  }, [
    imageSpace,
    color,
    fontSize,
    onEditorStateChange,
    past,
    pendingText,
    redo,
    shapes,
    tool,
    width,
  ]);

  if (initialEditorState !== receivedEditor) {
    setReceivedEditor(initialEditorState);
    if (
      initialEditorState !== undefined &&
      initialEditorState !== publishedEditorRef.current
    ) {
      setImageSpace(initialEditorState.image);
      setColor(initialEditorState.color);
      setFontSize(initialEditorState.fontSize);
      setPast(initialEditorState.past);
      setPendingText(initialEditorState.pendingText);
      setRedo(initialEditorState.redo);
      setShapes(initialEditorState.shapes);
      setTool(initialEditorState.tool);
      setWidth(initialEditorState.width);
    }
  }

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (canvas === null || image === null) return;
    const imageSize = imageSizeRef.current;
    if (imageSize === null || imageSize.width <= 0 || imageSize.height <= 0) {
      return;
    }
    const context = canvas.getContext("2d");
    if (context === null) return;
    const imageRect = image.getBoundingClientRect();
    const scale = Math.min(
      imageRect.width / imageSize.width,
      imageRect.height / imageSize.height,
    );
    const displayedWidth = Math.max(1, imageSize.width * scale);
    const displayedHeight = Math.max(1, imageSize.height * scale);
    const offsetLeft = image.offsetLeft;
    const offsetTop = image.offsetTop;
    const devicePixelRatio = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(
      1,
      Math.round(displayedWidth * devicePixelRatio),
    );
    const pixelHeight = Math.max(
      1,
      Math.round(displayedHeight * devicePixelRatio),
    );
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    canvas.style.left = `${offsetLeft}px`;
    canvas.style.top = `${offsetTop}px`;
    canvas.style.width = `${displayedWidth}px`;
    canvas.style.height = `${displayedHeight}px`;
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.clearRect(0, 0, displayedWidth, displayedHeight);
    for (const shape of shapesRef.current) {
      drawShape(context, scaleShape(shape, scale));
    }
    if (activeShapeRef.current !== null) {
      drawShape(context, scaleShape(activeShapeRef.current, scale));
    }
  }, []);

  const displayScaleRef = useRef(1);
  const updateDisplayScale = useCallback(() => {
    const image = imageRef.current;
    const imageSize = imageSizeRef.current;
    if (image === null || imageSize === null) {
      displayScaleRef.current = 1;
      return;
    }
    const rect = image.getBoundingClientRect();
    const scale =
      rect.width > 0 && rect.height > 0 && imageSize.width > 0
        ? Math.min(rect.width / imageSize.width, rect.height / imageSize.height)
        : 1;
    displayScaleRef.current = scale > 0 ? scale : 1;
    setDisplayScale(displayScaleRef.current);
  }, []);

  const updateImageSize = useCallback(() => {
    const image = imageRef.current;
    if (image === null) return;
    if (image.naturalWidth === 0 || image.naturalHeight === 0) return;
    imageSizeRef.current = {
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
    setImageSpace(
      (current) =>
        current ?? {
          id: crypto.randomUUID(),
          width: image.naturalWidth,
          height: image.naturalHeight,
        },
    );
    updateDisplayScale();
    redraw();
  }, [redraw, updateDisplayScale]);

  useEffect(() => {
    shapesRef.current = shapes;
    redraw();
  }, [redraw, shapes]);

  useEffect(() => {
    const image = imageRef.current;
    if (image === null) return;
    const observer = new ResizeObserver(() => {
      updateImageSize();
    });
    observer.observe(image);
    image.addEventListener("load", updateImageSize);
    updateImageSize();
    return () => {
      observer.disconnect();
      image.removeEventListener("load", updateImageSize);
    };
  }, [updateImageSize]);

  const commitShapes = useCallback(
    (next: Shape[]) => {
      if (imageSpace === null) return;
      const nextPast = [...past, shapes].slice(-MAX_EDITOR_HISTORY_FRAMES);
      const candidate = {
        image: imageSpace,
        color,
        fontSize,
        past: nextPast,
        pendingText: null,
        redo: [],
        shapes: next,
        tool,
        width,
      };
      if (!browserScreenshotEditorStateSchema.safeParse(candidate).success) {
        toastError(toast, "Drawing exceeds the image or history limits");
        return;
      }
      setPast(nextPast);
      setRedo([]);
      setShapes(next);
    },
    [imageSpace, color, fontSize, past, shapes, tool, width],
  );

  const pointForEvent = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      const image = imageRef.current;
      const imageSize = imageSizeRef.current;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (image === null || imageSize === null) {
        return {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        };
      }
      const scaleX = bounds.width > 0 ? imageSize.width / bounds.width : 1;
      const scaleY = bounds.height > 0 ? imageSize.height / bounds.height : 1;
      return {
        x: Math.max(
          0,
          Math.min(imageSize.width, (event.clientX - bounds.left) * scaleX),
        ),
        y: Math.max(
          0,
          Math.min(imageSize.height, (event.clientY - bounds.top) * scaleY),
        ),
      };
    },
    [],
  );
  const naturalStrokeWidth = useCallback((cssWidth: number): number => {
    const scale = displayScaleRef.current;
    return scale > 0 ? cssWidth / scale : cssWidth;
  }, []);
  const naturalFontSize = useCallback((cssSize: number): number => {
    const scale = displayScaleRef.current;
    return scale > 0 ? cssSize / scale : cssSize;
  }, []);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (
        event.button !== 0 ||
        pendingText !== null ||
        imageSpace === null ||
        imageSizeRef.current === null
      )
        return;
      const point = pointForEvent(event);
      if (tool === "text") {
        event.preventDefault();
        const next = {
          at: point,
          fontSize: naturalFontSize(fontSize),
          id: crypto.randomUUID(),
          text: "",
        };
        if (
          browserScreenshotEditorStateSchema.safeParse({
            image: imageSpace,
            color,
            fontSize,
            past,
            redo,
            shapes,
            tool,
            width,
            pendingText: next,
          }).success
        )
          setPendingText(next);
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      const strokeWidth = naturalStrokeWidth(width);
      activeShapeRef.current =
        tool === "pen" || tool === "highlight"
          ? {
              color,
              id: crypto.randomUUID(),
              kind: tool,
              points: [point],
              width: strokeWidth,
            }
          : {
              color,
              from: point,
              id: crypto.randomUUID(),
              kind: tool,
              to: point,
              width: strokeWidth,
            };
      redraw();
    },
    [
      imageSpace,
      color,
      fontSize,
      naturalFontSize,
      naturalStrokeWidth,
      past,
      pendingText,
      pointForEvent,
      redo,
      redraw,
      shapes,
      tool,
      width,
    ],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      const active = activeShapeRef.current;
      if (
        active === null ||
        !event.currentTarget.hasPointerCapture(event.pointerId)
      ) {
        return;
      }
      const point = pointForEvent(event);
      if ("points" in active) {
        if (active.points.length < MAX_SHAPE_POINTS) {
          active.points.push(point);
        }
      } else if ("to" in active) {
        active.to = point;
      }
      redraw();
    },
    [pointForEvent, redraw],
  );

  const commitActiveShape = useCallback(
    (event: PointerEvent<HTMLCanvasElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      event.currentTarget.releasePointerCapture(event.pointerId);
      const active = activeShapeRef.current;
      activeShapeRef.current = null;
      if (active !== null) commitShapes([...shapesRef.current, active]);
      redraw();
    },
    [commitShapes, redraw],
  );

  const commitText = useCallback(
    (text: string) => {
      if (pendingText === null) return;
      const value = text.trim();
      if (value.length > 0) {
        commitShapes([
          ...shapesRef.current,
          {
            at: pendingText.at,
            color,
            fontSize: pendingText.fontSize,
            id: pendingText.id,
            kind: "text",
            text: value,
          },
        ]);
      }
      setPendingText(null);
    },
    [color, commitShapes, pendingText],
  );

  const undo = useCallback(() => {
    setPast((history) => {
      const previous = history.at(-1);
      if (previous === undefined) return history;
      setShapes((current) => {
        setRedo((future) => [current, ...future]);
        return previous;
      });
      return history.slice(0, -1);
    });
  }, []);

  const redoLast = useCallback(() => {
    setRedo((future) => {
      const next = future[0];
      if (next === undefined) return future;
      setShapes((current) => {
        setPast((history) => [...history, current]);
        return next;
      });
      return future.slice(1);
    });
  }, []);

  const clear = useCallback(() => {
    if (shapesRef.current.length > 0) commitShapes([]);
    setPendingText(null);
  }, [commitShapes]);

  const copy = useCallback(async () => {
    const image = imageRef.current;
    if (image === null) {
      toastError(toast, "Failed to copy annotated screenshot");
      return;
    }
    const blob = await annotatedScreenshotBlob(image, shapesRef.current);
    if (blob === null) {
      toastError(toast, "Failed to copy annotated screenshot");
      return;
    }
    const copied = await copyImageToClipboard(blob);
    if (copied) {
      toastSuccess(toast, "Annotated screenshot copied");
    } else {
      toastError(toast, "Failed to copy annotated screenshot");
    }
  }, []);

  const download = useCallback(async () => {
    const image = imageRef.current;
    if (image === null) {
      toastError(toast, "Failed to export annotated screenshot");
      return;
    }
    const blob = await annotatedScreenshotBlob(image, shapesRef.current);
    if (blob === null) {
      toastError(toast, "Failed to export annotated screenshot");
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "bb-browser-annotation.png";
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const canvasBounds = useCallback((): {
    scale: number;
    offsetX: number;
    offsetY: number;
  } | null => {
    const canvas = canvasRef.current;
    const imageSize = imageSizeRef.current;
    if (canvas === null || imageSize === null) return null;
    const bounds = canvas.getBoundingClientRect();
    const scale = Math.min(
      bounds.width / imageSize.width,
      bounds.height / imageSize.height,
    );
    const displayedWidth = imageSize.width * scale;
    const displayedHeight = imageSize.height * scale;
    return {
      scale,
      offsetX: (bounds.width - displayedWidth) / 2,
      offsetY: (bounds.height - displayedHeight) / 2,
    };
  }, []);

  const textPosition = useCallback((): {
    left: number;
    scale: number;
    top: number;
  } | null => {
    if (pendingText === null || displayScale === null) return null;
    const imageSize = imageSizeRef.current;
    const bounds = canvasBounds();
    if (imageSize === null || bounds === null) return null;
    return {
      left:
        bounds.offsetX +
        (pendingText.at.x / imageSize.width) * (imageSize.width * bounds.scale),
      scale: bounds.scale,
      top: bounds.offsetY + pendingText.at.y * bounds.scale,
    };
  }, [canvasBounds, displayScale, pendingText]);

  const pendingTextStyle = textPosition();

  return (
    <section
      role="document"
      aria-label="Screenshot annotation"
      className="absolute inset-0 z-30 flex min-h-0 flex-col bg-background"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground">
            Annotate screenshot
          </h2>
          <p className="text-xs text-muted-foreground">
            Draw on the page, then copy the PNG into chat.
          </p>
        </div>
        <button
          type="button"
          aria-label="Close screenshot annotation"
          onClick={onClose}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Icon name="X" className="size-4" aria-hidden />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-surface-recessed p-3">
        <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center">
          <img
            ref={imageRef}
            src={screenshotUrl}
            alt="Captured browser page"
            draggable={false}
            onError={() => toastError(toast, "Failed to decode screenshot")}
            onLoad={updateImageSize}
            className="block max-h-full max-w-full select-none object-contain"
          />
          <canvas
            ref={canvasRef}
            aria-label="Drawing canvas"
            className="absolute touch-none cursor-crosshair"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={commitActiveShape}
            onPointerCancel={commitActiveShape}
          />
          {pendingText === null || pendingTextStyle === null ? null : (
            <input
              autoFocus
              aria-label="Annotation text"
              value={pendingText.text}
              maxLength={4096}
              onChange={(event) => {
                const next = {
                  ...pendingText,
                  text: event.currentTarget.value,
                };
                if (
                  imageSpace !== null &&
                  browserScreenshotEditorStateSchema.safeParse({
                    image: imageSpace,
                    color,
                    fontSize,
                    past,
                    redo,
                    shapes,
                    tool,
                    width,
                    pendingText: next,
                  }).success
                )
                  setPendingText(next);
              }}
              className="absolute z-10 min-w-24 border-0 bg-transparent p-0 font-semibold leading-none outline-none"
              style={{
                color,
                fontFamily: "ui-sans-serif, system-ui, sans-serif",
                fontSize: Math.max(
                  12,
                  pendingText.fontSize * pendingTextStyle.scale,
                ),
                left: pendingTextStyle.left,
                top: pendingTextStyle.top,
              }}
              onBlur={(event) => commitText(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  commitText(event.currentTarget.value);
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setPendingText(null);
                }
              }}
            />
          )}
        </div>
      </div>
      <TooltipProvider delayDuration={250}>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
          <div
            className="flex flex-wrap items-center gap-1"
            aria-label="Annotation tools"
          >
            {(
              [
                ["pen", "EditFile", "Pen"],
                ["highlight", "Palette", "Highlighter"],
                ["arrow", "ArrowUpRight", "Arrow"],
                ["rect", "Square", "Rectangle"],
                ["ellipse", "CircleArrowShrink", "Ellipse"],
                ["text", "TextWrap", "Text"],
              ] as const
            ).map(([kind, icon, label]) => (
              <ScreenshotToolbarTooltip key={kind} label={label}>
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={tool === kind}
                  onClick={() => setTool(kind)}
                  className={cn(
                    "inline-flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    tool === kind && "bg-state-hover text-foreground",
                  )}
                >
                  <Icon name={icon} className="size-4" aria-hidden />
                </button>
              </ScreenshotToolbarTooltip>
            ))}
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            {COLOR_OPTIONS.map(({ label, value }) => (
              <ScreenshotToolbarTooltip key={value} label={label}>
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={color === value}
                  onClick={() => setColor(value)}
                  className={cn(
                    "inline-flex size-11 items-center justify-center rounded-full border-2 border-transparent transition-transform focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    color === value && "scale-110 border-foreground",
                  )}
                >
                  <span
                    aria-hidden
                    className="size-5 rounded-full"
                    style={{ backgroundColor: value }}
                  />
                </button>
              </ScreenshotToolbarTooltip>
            ))}
            <label className="ml-2 flex items-center gap-1 text-xs text-muted-foreground">
              Width
              <select
                aria-label="Ink width"
                value={width}
                onChange={(event) => setWidth(Number(event.target.value))}
                className="h-11 rounded border border-border bg-background px-1 text-xs text-foreground"
              >
                {WIDTHS.map((option) => (
                  <option key={option} value={option}>
                    {option}px
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              Text
              <select
                aria-label="Text size"
                value={fontSize}
                onChange={(event) => setFontSize(Number(event.target.value))}
                className="h-11 rounded border border-border bg-background px-1 text-xs text-foreground"
              >
                {FONT_SIZES.map((option) => (
                  <option key={option} value={option}>
                    {option}px
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-1.5">
            <ScreenshotToolbarTooltip label="Undo">
              <button
                type="button"
                aria-label="Undo"
                disabled={past.length === 0}
                onClick={undo}
                className="inline-flex h-11 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
              >
                <Icon
                  name="ArrowTurnBackward"
                  className="size-3.5"
                  aria-hidden
                />
              </button>
            </ScreenshotToolbarTooltip>
            <ScreenshotToolbarTooltip label="Redo">
              <button
                type="button"
                aria-label="Redo"
                disabled={redo.length === 0}
                onClick={redoLast}
                className="inline-flex h-11 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
              >
                <Icon
                  name="ArrowTurnForward"
                  className="size-3.5"
                  aria-hidden
                />
              </button>
            </ScreenshotToolbarTooltip>
            <ScreenshotToolbarTooltip label="Clear all annotations">
              <button
                type="button"
                aria-label="Clear all"
                disabled={shapes.length === 0}
                onClick={clear}
                className="inline-flex h-11 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
              >
                <Icon name="Clean" className="size-3.5" aria-hidden />
              </button>
            </ScreenshotToolbarTooltip>
            <ScreenshotToolbarTooltip label="Copy annotated PNG">
              <button
                type="button"
                onClick={() => void copy()}
                className="inline-flex h-11 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <Icon name="Copy" className="size-3.5" aria-hidden />
                Copy PNG
              </button>
            </ScreenshotToolbarTooltip>
            <ScreenshotToolbarTooltip label="Save annotated PNG">
              <button
                type="button"
                onClick={() => void download()}
                className="inline-flex h-11 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <Icon name="Download" className="size-3.5" aria-hidden />
                Save PNG
              </button>
            </ScreenshotToolbarTooltip>
          </div>
        </footer>
      </TooltipProvider>
    </section>
  );
}
