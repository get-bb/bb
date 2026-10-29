import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type Ref,
} from "react";
import type { MermaidConfig } from "mermaid";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Button } from "@bb/shared-ui/button";
import { CopyButton } from "./copy-button.js";
import { Icon } from "@bb/shared-ui/icon";
import { loadMermaid } from "./markdown-mermaid-loader.js";
import {
  buildMermaidRenderCacheKey,
  MERMAID_SOURCE_RENDER_DEBOUNCE_MS,
  observeMermaidViewportEntry,
  peekMermaidRenderCache,
  readMermaidRenderCache,
  storeMermaidRenderCache,
  type RenderedMermaidDiagram,
} from "./markdown-mermaid-render-cache.js";
import { useAppThemeEpoch } from "@/hooks/useAppTheme";
import type { Theme } from "@/hooks/useTheme";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  createPanZoomTransform,
  usePanZoom,
  type PanZoomScaleLimits,
} from "./pan-zoom.js";

interface MarkdownMermaidDiagramProps {
  preferredTheme: Theme;
  source: string;
}

interface MermaidThemePalette {
  actorBorder: string;
  actorBkg: string;
  actorTextColor: string;
  background: string;
  clusterBkg: string;
  clusterBorder: string;
  edgeLabelBackground: string;
  labelBoxBkgColor: string;
  labelBoxBorderColor: string;
  labelTextColor: string;
  lineColor: string;
  loopTextColor: string;
  mainBkg: string;
  nodeBorder: string;
  noteBkgColor: string;
  noteBorderColor: string;
  noteTextColor: string;
  primaryBorderColor: string;
  primaryColor: string;
  primaryTextColor: string;
  secondaryBorderColor: string;
  secondaryColor: string;
  secondaryTextColor: string;
  signalColor: string;
  signalTextColor: string;
  tertiaryBorderColor: string;
  tertiaryColor: string;
  tertiaryTextColor: string;
  textColor: string;
}

type MermaidDiagramOpenChangeHandler = (open: boolean) => void;
type MermaidDiagramDisplayMode = "preview" | "source";

interface MermaidDiagramDialogProps {
  diagram: RenderedMermaidDiagram;
  onOpenChange: MermaidDiagramOpenChangeHandler;
  open: boolean;
  source: string;
}

type MermaidRenderState =
  | { kind: "loading" }
  | { kind: "rendered"; diagram: RenderedMermaidDiagram }
  | { kind: "source" };

type MermaidTheme = NonNullable<MermaidConfig["theme"]>;
type MermaidDiagramContainerProps = ComponentPropsWithoutRef<"div"> & {
  ref?: Ref<HTMLDivElement>;
};

const MERMAID_THEME: MermaidTheme = "base";
const MERMAID_RENDER_ID_PREFIX = "bb-mermaid";
const MERMAID_RENDER_ID_SAFE_CHARACTER_PATTERN = /[^a-zA-Z0-9_-]/gu;
const MERMAID_DIAGRAM_SCALE_LIMITS: PanZoomScaleLimits = { max: 4, min: 0.5 };
const MERMAID_DIAGRAM_SCALE_STEP = 0.25;

const MERMAID_TOKEN = {
  nodeFill: "--secondary",
  altFill: "--muted",
  tertiaryFill: "--accent",
  border: "--border",
  text: "--foreground",
  line: "--primary",
  background: "--background",
} as const;

let srgbCanvasContext: CanvasRenderingContext2D | null | undefined;

function toSrgbColor(color: string): string {
  if (srgbCanvasContext === undefined) {
    srgbCanvasContext =
      document.createElement("canvas").getContext("2d", {
        willReadFrequently: true,
      }) ?? null;
  }
  const ctx = srgbCanvasContext;
  if (!ctx) return color;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return a === 255
    ? `rgb(${r}, ${g}, ${b})`
    : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

function resolveThemeColor(probe: HTMLElement, varName: string): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  probe.style.color = raw || "currentColor";
  return toSrgbColor(getComputedStyle(probe).color);
}

function resolveMermaidThemePalette(): MermaidThemePalette {
  const probe = document.createElement("span");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  document.body.appendChild(probe);
  const get = (name: string) => resolveThemeColor(probe, name);
  const palette: MermaidThemePalette = {
    actorBkg: get(MERMAID_TOKEN.nodeFill),
    actorBorder: get(MERMAID_TOKEN.border),
    actorTextColor: get(MERMAID_TOKEN.text),
    background: get(MERMAID_TOKEN.background),
    clusterBkg: get(MERMAID_TOKEN.altFill),
    clusterBorder: get(MERMAID_TOKEN.border),
    edgeLabelBackground: get(MERMAID_TOKEN.background),
    labelBoxBkgColor: get(MERMAID_TOKEN.nodeFill),
    labelBoxBorderColor: get(MERMAID_TOKEN.border),
    labelTextColor: get(MERMAID_TOKEN.text),
    lineColor: get(MERMAID_TOKEN.line),
    loopTextColor: get(MERMAID_TOKEN.text),
    mainBkg: get(MERMAID_TOKEN.nodeFill),
    nodeBorder: get(MERMAID_TOKEN.border),
    noteBkgColor: get(MERMAID_TOKEN.altFill),
    noteBorderColor: get(MERMAID_TOKEN.border),
    noteTextColor: get(MERMAID_TOKEN.text),
    primaryBorderColor: get(MERMAID_TOKEN.border),
    primaryColor: get(MERMAID_TOKEN.nodeFill),
    primaryTextColor: get(MERMAID_TOKEN.text),
    secondaryBorderColor: get(MERMAID_TOKEN.border),
    secondaryColor: get(MERMAID_TOKEN.altFill),
    secondaryTextColor: get(MERMAID_TOKEN.text),
    signalColor: get(MERMAID_TOKEN.line),
    signalTextColor: get(MERMAID_TOKEN.text),
    tertiaryBorderColor: get(MERMAID_TOKEN.border),
    tertiaryColor: get(MERMAID_TOKEN.tertiaryFill),
    tertiaryTextColor: get(MERMAID_TOKEN.text),
    textColor: get(MERMAID_TOKEN.text),
  };
  probe.remove();
  return palette;
}

function buildMermaidConfig(preferredTheme: Theme): MermaidConfig {
  return {
    darkMode: preferredTheme === "dark",
    fontFamily: "Inter, sans-serif",
    securityLevel: "strict",
    startOnLoad: false,
    suppressErrorRendering: true,
    theme: MERMAID_THEME,
    themeVariables: resolveMermaidThemePalette(),
  };
}

function buildMermaidRenderId(reactId: string): string {
  const safeId = reactId.replace(MERMAID_RENDER_ID_SAFE_CHARACTER_PATTERN, "");
  return `${MERMAID_RENDER_ID_PREFIX}-${safeId}`;
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
        "my-2 overflow-hidden rounded-md border border-border bg-surface-recessed",
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
  const [dialogViewportElement, setDialogViewportElement] =
    useState<HTMLDivElement | null>(null);
  const dialogDiagramRef = useRef<HTMLDivElement>(null);
  const { isDragging, pointerHandlers, resetView, view, zoomAroundCenter } =
    usePanZoom({
      enabled: open,
      limits: MERMAID_DIAGRAM_SCALE_LIMITS,
      viewportElement: dialogViewportElement,
    });

  useEffect(() => {
    if (!open) {
      return;
    }

    const diagramElement = dialogDiagramRef.current;
    if (!diagramElement) {
      return;
    }

    diagram.bindFunctions?.(diagramElement);
  }, [diagram, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(84dvh,58rem)] w-full max-w-none gap-0 overflow-hidden border-border bg-background p-0 shadow-sm md:w-[min(96vw,88rem)] [&>button]:right-2 [&>button]:top-2 [&>button]:z-20 [&>button]:flex [&>button]:size-8 [&>button]:items-center [&>button]:justify-center [&>button]:rounded-md [&>button]:bg-surface-scrim/95 [&>button]:text-muted-foreground [&>button]:opacity-100 [&>button]:backdrop-blur-sm [&>button]:hover:bg-state-hover [&>button]:hover:text-foreground">
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
            onClick={() => zoomAroundCenter(-MERMAID_DIAGRAM_SCALE_STEP)}
            aria-label="Zoom out"
          >
            <Icon name="ZoomOut" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            onClick={() => zoomAroundCenter(MERMAID_DIAGRAM_SCALE_STEP)}
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
          ref={setDialogViewportElement}
          className={cn(
            "min-h-0 flex-1 touch-none overflow-hidden bg-surface-recessed",
            isDragging ? "cursor-grabbing" : "cursor-grab",
          )}
          {...pointerHandlers}
        >
          <div className="flex h-full w-full items-center justify-center p-6">
            <div
              ref={dialogDiagramRef}
              className="flex h-full w-full select-none items-center justify-center [&_svg]:block [&_svg]:h-auto [&_svg]:max-h-full [&_svg]:max-w-full"
              role="img"
              aria-label="Mermaid diagram"
              style={{
                transform: createPanZoomTransform(view),
                transformOrigin: "center center",
              }}
              dangerouslySetInnerHTML={{ __html: diagram.svg }}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MarkdownMermaidDiagram({
  preferredTheme,
  source,
}: MarkdownMermaidDiagramProps) {
  const reactId = useId();
  const containerElementRef = useRef<HTMLDivElement>(null);
  const diagramElementRef = useRef<HTMLDivElement>(null);
  const renderId = useMemo(() => buildMermaidRenderId(reactId), [reactId]);
  const renderAttemptRef = useRef(0);
  const appThemeEpoch = useAppThemeEpoch();
  const [initialCachedDiagram] = useState(() =>
    peekMermaidRenderCache(
      buildMermaidRenderCacheKey({ appThemeEpoch, preferredTheme, source }),
    ),
  );
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
    const cacheKey = buildMermaidRenderCacheKey({
      appThemeEpoch,
      preferredTheme,
      source,
    });
    const cachedDiagram = readMermaidRenderCache(cacheKey);
    const isSourceUpdate =
      renderedSourceRef.current !== null &&
      renderedSourceRef.current !== source;
    renderedSourceRef.current = source;
    if (cachedDiagram !== null) {
      setRenderState((currentState) =>
        currentState.kind === "rendered" &&
        currentState.diagram === cachedDiagram
          ? currentState
          : { kind: "rendered", diagram: cachedDiagram },
      );
      setDisplayMode("preview");
      return;
    }

    let isCurrentRender = true;
    const runRender = () => {
      loadMermaid()
        .then((mermaid) => {
          if (!isCurrentRender) {
            return null;
          }
          mermaid.initialize(buildMermaidConfig(preferredTheme));
          return mermaid.render(
            `${renderId}-${++renderAttemptRef.current}`,
            source,
          );
        })
        .then((renderResult) => {
          if (!isCurrentRender || renderResult === null) {
            return;
          }
          const diagram: RenderedMermaidDiagram = {
            bindFunctions: renderResult.bindFunctions,
            svg: renderResult.svg,
          };
          storeMermaidRenderCache(cacheKey, diagram);
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
      setRenderState({ kind: "loading" });
      setDisplayMode("preview");
      runRender();
      return () => {
        isCurrentRender = false;
      };
    }
    const timeoutId = window.setTimeout(
      runRender,
      MERMAID_SOURCE_RENDER_DEBOUNCE_MS,
    );
    return () => {
      isCurrentRender = false;
      window.clearTimeout(timeoutId);
    };
  }, [appThemeEpoch, hasEnteredViewport, preferredTheme, renderId, source]);

  useEffect(() => {
    if (renderState.kind !== "rendered" || displayMode !== "preview") {
      return;
    }

    const diagramElement = diagramElementRef.current;
    if (!diagramElement) {
      return;
    }

    renderState.diagram.bindFunctions?.(diagramElement);
  }, [displayMode, renderState]);

  const isRendered = renderState.kind === "rendered";
  const showRenderedDiagram = isRendered && displayMode === "preview";
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
            ref={diagramElementRef}
            className="min-w-0 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
            role="img"
            aria-label="Mermaid diagram"
            dangerouslySetInnerHTML={{ __html: renderState.diagram.svg }}
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
