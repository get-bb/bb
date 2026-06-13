import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentPropsWithoutRef,
  type PointerEventHandler,
} from "react";
import type { MermaidConfig, RenderResult } from "mermaid";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./dialog.js";
import { Button } from "./button.js";
import { CopyButton } from "./copy-button.js";
import { Icon } from "./icon.js";
import { loadMermaid } from "./markdown-mermaid-loader.js";
import type { Theme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

export interface MarkdownMermaidDiagramProps {
  preferredTheme: Theme;
  source: string;
}

interface RenderedMermaidDiagram {
  bindFunctions: RenderResult["bindFunctions"];
  svg: string;
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

interface MermaidDiagramDialogProps {
  diagram: RenderedMermaidDiagram;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  source: string;
}

interface MermaidDiagramOffset {
  x: number;
  y: number;
}

interface MermaidDiagramDragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startOffset: MermaidDiagramOffset;
}

interface CreateMermaidDialogDiagramStyleArgs {
  offset: MermaidDiagramOffset;
  scale: number;
}

interface MermaidDialogDiagramStyle extends CSSProperties {
  transform: string;
  transformOrigin: string;
}

type MermaidRenderState =
  | { kind: "loading" }
  | { kind: "rendered"; diagram: RenderedMermaidDiagram }
  | { kind: "source" };

type MermaidTheme = NonNullable<MermaidConfig["theme"]>;
type MermaidDiagramContainerProps = ComponentPropsWithoutRef<"div">;
type MermaidDiagramPointerHandler = PointerEventHandler<HTMLDivElement>;

const MERMAID_THEME: MermaidTheme = "base";
const MERMAID_RENDER_ID_PREFIX = "bb-mermaid";
const MERMAID_RENDER_ID_SAFE_CHARACTER_PATTERN = /[^a-zA-Z0-9_-]/gu;
const MERMAID_DIAGRAM_MIN_SCALE = 0.5;
const MERMAID_DIAGRAM_MAX_SCALE = 4;
const MERMAID_DIAGRAM_SCALE_STEP = 0.25;

const MERMAID_LIGHT_PALETTE: MermaidThemePalette = {
  actorBkg: "#f1f1f1",
  actorBorder: "#dedede",
  actorTextColor: "#333333",
  background: "#ffffff",
  clusterBkg: "#f9f9f9",
  clusterBorder: "#dedede",
  edgeLabelBackground: "#ffffff",
  labelBoxBkgColor: "#f1f1f1",
  labelBoxBorderColor: "#dedede",
  labelTextColor: "#333333",
  lineColor: "#4075aa",
  loopTextColor: "#333333",
  mainBkg: "#f1f1f1",
  nodeBorder: "#cfcfcf",
  noteBkgColor: "#f9f9f9",
  noteBorderColor: "#cfcfcf",
  noteTextColor: "#333333",
  primaryBorderColor: "#cfcfcf",
  primaryColor: "#f1f1f1",
  primaryTextColor: "#333333",
  secondaryBorderColor: "#dedede",
  secondaryColor: "#f9f9f9",
  secondaryTextColor: "#333333",
  signalColor: "#4075aa",
  signalTextColor: "#333333",
  tertiaryBorderColor: "#cfcfcf",
  tertiaryColor: "#edf4fb",
  tertiaryTextColor: "#333333",
  textColor: "#333333",
};

const MERMAID_DARK_PALETTE: MermaidThemePalette = {
  actorBkg: "#1f1f1f",
  actorBorder: "#303030",
  actorTextColor: "#c1c1c1",
  background: "#151515",
  clusterBkg: "#1a1a1a",
  clusterBorder: "#303030",
  edgeLabelBackground: "#151515",
  labelBoxBkgColor: "#1f1f1f",
  labelBoxBorderColor: "#303030",
  labelTextColor: "#c1c1c1",
  lineColor: "#79a9db",
  loopTextColor: "#c1c1c1",
  mainBkg: "#1f1f1f",
  nodeBorder: "#3b3b3b",
  noteBkgColor: "#1a1a1a",
  noteBorderColor: "#3b3b3b",
  noteTextColor: "#c1c1c1",
  primaryBorderColor: "#3b3b3b",
  primaryColor: "#1f1f1f",
  primaryTextColor: "#c1c1c1",
  secondaryBorderColor: "#303030",
  secondaryColor: "#1a1a1a",
  secondaryTextColor: "#c1c1c1",
  signalColor: "#79a9db",
  signalTextColor: "#c1c1c1",
  tertiaryBorderColor: "#3b3b3b",
  tertiaryColor: "#172334",
  tertiaryTextColor: "#c1c1c1",
  textColor: "#c1c1c1",
};

function getMermaidThemePalette(preferredTheme: Theme): MermaidThemePalette {
  return preferredTheme === "dark"
    ? MERMAID_DARK_PALETTE
    : MERMAID_LIGHT_PALETTE;
}

function buildMermaidConfig(preferredTheme: Theme): MermaidConfig {
  return {
    darkMode: preferredTheme === "dark",
    fontFamily: "Inter, sans-serif",
    securityLevel: "strict",
    startOnLoad: false,
    suppressErrorRendering: true,
    theme: MERMAID_THEME,
    themeVariables: getMermaidThemePalette(preferredTheme),
  };
}

function buildMermaidRenderId(reactId: string): string {
  const safeId = reactId.replace(MERMAID_RENDER_ID_SAFE_CHARACTER_PATTERN, "");
  return `${MERMAID_RENDER_ID_PREFIX}-${safeId}`;
}

function clampMermaidScale(scale: number): number {
  return Math.min(
    MERMAID_DIAGRAM_MAX_SCALE,
    Math.max(MERMAID_DIAGRAM_MIN_SCALE, scale),
  );
}

function createMermaidDialogDiagramStyle({
  offset,
  scale,
}: CreateMermaidDialogDiagramStyleArgs): MermaidDialogDiagramStyle {
  return {
    transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
    transformOrigin: "center center",
  };
}

function MermaidDiagramContainer({
  children,
  className,
  ...containerProps
}: MermaidDiagramContainerProps) {
  return (
    <div
      {...containerProps}
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
  const dialogDiagramRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<MermaidDiagramOffset>({ x: 0, y: 0 });
  const [dragState, setDragState] = useState<MermaidDiagramDragState | null>(
    null,
  );
  const diagramStyle = createMermaidDialogDiagramStyle({ offset, scale });
  const isDragging = dragState !== null;

  useEffect(() => {
    if (!open) {
      setScale(1);
      setOffset({ x: 0, y: 0 });
      setDragState(null);
    }
  }, [open]);

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

  const zoomOut = () => {
    setScale((currentScale) =>
      clampMermaidScale(currentScale - MERMAID_DIAGRAM_SCALE_STEP),
    );
  };

  const zoomIn = () => {
    setScale((currentScale) =>
      clampMermaidScale(currentScale + MERMAID_DIAGRAM_SCALE_STEP),
    );
  };

  const resetView = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setDragState(null);
  };

  const handlePointerDown: MermaidDiagramPointerHandler = (event) => {
    if (event.button !== 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startOffset: offset,
    });
  };

  const handlePointerMove: MermaidDiagramPointerHandler = (event) => {
    if (dragState === null || dragState.pointerId !== event.pointerId) {
      return;
    }

    setOffset({
      x: dragState.startOffset.x + event.clientX - dragState.startClientX,
      y: dragState.startOffset.y + event.clientY - dragState.startClientY,
    });
  };

  const handlePointerEnd: MermaidDiagramPointerHandler = (event) => {
    if (dragState?.pointerId !== event.pointerId) {
      return;
    }

    setDragState(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(84vh,58rem)] w-[min(96vw,88rem)] max-w-none gap-0 overflow-hidden border-border bg-background p-0 shadow-xl">
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border-seam bg-surface-raised pl-4 pr-12">
            <DialogTitle className="text-sm leading-5">
              Mermaid diagram
            </DialogTitle>
            <DialogDescription className="sr-only">
              Expanded Mermaid diagram preview with zoom and pan controls.
            </DialogDescription>
            <div className="ml-auto flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground"
                onClick={zoomOut}
                aria-label="Zoom out"
                title="Zoom out"
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
                title="Zoom in"
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
                title="Reset view"
              >
                <Icon name="RotateCcw" />
              </Button>
              <CopyButton text={source} label="Copy Mermaid source" />
            </div>
          </div>
          <div
            className={cn(
              "min-h-0 flex-1 overflow-hidden bg-surface-recessed",
              isDragging ? "cursor-grabbing" : "cursor-grab",
            )}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
          >
            <div className="flex h-full w-full items-center justify-center p-6">
              <div
                ref={dialogDiagramRef}
                className="select-none [&_svg]:h-auto [&_svg]:max-h-none [&_svg]:max-w-none"
                role="img"
                aria-label="Mermaid diagram"
                style={diagramStyle}
                dangerouslySetInnerHTML={{ __html: diagram.svg }}
              />
            </div>
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
  const diagramElementRef = useRef<HTMLDivElement>(null);
  const renderId = useMemo(() => buildMermaidRenderId(reactId), [reactId]);
  const [renderState, setRenderState] = useState<MermaidRenderState>({
    kind: "loading",
  });
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    let isCurrentRender = true;

    setRenderState({ kind: "loading" });
    loadMermaid()
      .then((mermaid) => {
        mermaid.initialize(buildMermaidConfig(preferredTheme));
        return mermaid.render(renderId, source);
      })
      .then((renderResult) => {
        if (!isCurrentRender) {
          return;
        }

        setRenderState({
          kind: "rendered",
          diagram: {
            bindFunctions: renderResult.bindFunctions,
            svg: renderResult.svg,
          },
        });
      })
      .catch(() => {
        if (!isCurrentRender) {
          return;
        }

        setRenderState({ kind: "source" });
      });

    return () => {
      isCurrentRender = false;
    };
  }, [preferredTheme, renderId, source]);

  useEffect(() => {
    if (renderState.kind !== "rendered") {
      return;
    }

    const diagramElement = diagramElementRef.current;
    if (!diagramElement) {
      return;
    }

    renderState.diagram.bindFunctions?.(diagramElement);
  }, [renderState]);

  return (
    <MermaidDiagramContainer>
      <div className="flex items-center justify-between pl-3 pr-1.5 pt-1.5">
        <span className="font-mono text-xs uppercase text-muted-foreground">
          mermaid
        </span>
        <div className="flex items-center gap-1">
          {renderState.kind === "rendered" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              onClick={() => setIsDialogOpen(true)}
              aria-label="Open Mermaid diagram"
              title="Open diagram"
            >
              <Icon name="Maximize2" />
            </Button>
          ) : null}
          <CopyButton text={source} label="Copy Mermaid source" />
        </div>
      </div>
      {renderState.kind === "rendered" ? (
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
      {renderState.kind === "source" ? (
        <pre className="overflow-x-auto px-3 pb-3 pt-1">
          <code className="font-mono text-xs language-mermaid">{source}</code>
        </pre>
      ) : null}
      {renderState.kind === "rendered" ? (
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
