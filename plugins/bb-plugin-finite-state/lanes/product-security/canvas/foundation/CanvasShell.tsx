import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import type { EdgeTypes, NodeTypes } from "@xyflow/react";
import {
  CanvasViewport,
  type CanvasFlowEdge,
  type CanvasFlowNode,
} from "./CanvasViewport.js";
import {
  browserCanvasLayoutStorage,
  type CanvasLayoutStorage,
} from "./layout-storage.js";
import type {
  CanvasModel,
  CanvasViewportState,
  LayoutRequest,
  LayoutResult,
} from "./types.js";
import type { ResolvedTaraScope } from "../scope/index.js";

export interface CanvasLayerScopeProps {
  scope?: ResolvedTaraScope;
  createRequest?: number;
}

export interface CanvasFoundationFeatures {
  nodeTypes: NodeTypes;
  edgeTypes: EdgeTypes;
  ThreatOverlay: ComponentType<CanvasLayerScopeProps>;
  LinksLayer: ComponentType<CanvasLayerScopeProps>;
  EditingLayer: ComponentType<CanvasLayerScopeProps>;
}

type LayoutRunner = (request: LayoutRequest) => Promise<LayoutResult>;

interface CanvasShellProps {
  projectId: string;
  scope?: ResolvedTaraScope;
  model: CanvasModel;
  features: CanvasFoundationFeatures;
  arrange?: LayoutRunner;
  layoutStorage?: CanvasLayoutStorage;
}

type LayoutStatus = "idle" | "running" | "error";

interface LayoutUiState {
  status: LayoutStatus;
  error: string | null;
  durationMs: number | null;
}

function defaultPositions(model: CanvasModel): LayoutResult["positions"] {
  return Object.fromEntries(
    model.nodes.map((node, index) => [
      node.id,
      { x: (index % 4) * 288, y: Math.floor(index / 4) * 176 },
    ]),
  );
}

function positionsForModel(
  model: CanvasModel,
  preferred: LayoutResult["positions"] | null,
): LayoutResult["positions"] {
  const fallback = defaultPositions(model);
  return Object.fromEntries(
    model.nodes.map((node) => [
      node.id,
      preferred?.[node.id] ?? fallback[node.id] ?? { x: 0, y: 0 },
    ]),
  );
}

function flowNodes(
  model: CanvasModel,
  positions: LayoutResult["positions"],
): CanvasFlowNode[] {
  return model.nodes.map((node) => ({
    id: node.id,
    type: "component",
    data: { model: node },
    position: positions[node.id] ?? { x: 0, y: 0 },
    width: node.width,
    height: node.height,
    selectable: true,
    draggable: false,
  }));
}

function flowEdges(model: CanvasModel): CanvasFlowEdge[] {
  return model.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.protocol ?? edge.label,
    data: { model: edge },
    selectable: true,
    animated: false,
  }));
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function nextFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== "function") {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function paintArrangingState(): Promise<void> {
  await nextFrame();
  await nextFrame();
}

async function runMainThreadLayout(
  request: LayoutRequest,
): Promise<LayoutResult> {
  const { runElkLayout } = await import("./elk-worker.js");
  return runElkLayout(request);
}

function safeLayoutError(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message.slice(0, 300)
    : "ELK could not arrange this canvas.";
}

function CanvasShellState({
  projectId,
  scope,
  model,
  features,
  arrange = runMainThreadLayout,
  layoutStorage = browserCanvasLayoutStorage,
}: CanvasShellProps): React.JSX.Element {
  const [positions, setPositions] = useState(() =>
    positionsForModel(
      model,
      layoutStorage.read(
        projectId,
        model.nodes.map((node) => node.id),
      ),
    ),
  );
  const [viewport, setViewport] = useState<CanvasViewportState>({
    x: 0,
    y: 0,
    zoom: 1,
    selectedIds: [],
  });
  const [layout, setLayout] = useState<LayoutUiState>({
    status: "idle",
    error: null,
    durationMs: null,
  });
  const requestIdRef = useRef(0);
  const reducedMotion = useReducedMotion();

  useEffect(
    () => () => {
      requestIdRef.current += 1;
    },
    [],
  );

  const startLayout = useCallback(async () => {
    if (layout.status === "running") return;
    const requestId = ++requestIdRef.current;
    setLayout({ status: "running", error: null, durationMs: null });

    await paintArrangingState();
    if (requestIdRef.current !== requestId) return;

    try {
      const result = await arrange({
        nodes: model.nodes.map(({ id, width, height }) => ({
          id,
          width,
          height,
        })),
        edges: model.edges.map(({ source, target }) => ({ source, target })),
        direction: "RIGHT",
      });
      if (requestIdRef.current !== requestId) return;
      const nextPositions = positionsForModel(model, result.positions);
      layoutStorage.write(projectId, nextPositions);
      setPositions(nextPositions);
      setLayout({
        status: "idle",
        error: null,
        durationMs: result.durationMs,
      });
    } catch (error: unknown) {
      if (requestIdRef.current !== requestId) return;
      setLayout({
        status: "error",
        error: safeLayoutError(error),
        durationMs: null,
      });
    }
  }, [arrange, layout.status, layoutStorage, model, projectId]);

  const nodes = useMemo(() => flowNodes(model, positions), [model, positions]);
  const edges = useMemo(() => flowEdges(model), [model]);
  const updateViewport = useCallback((nextViewport: CanvasViewportState) => {
    setViewport(nextViewport);
  }, []);
  const updateSelection = useCallback((selectedIds: string[]) => {
    setViewport((current) => ({ ...current, selectedIds }));
  }, []);
  const ThreatOverlay = features.ThreatOverlay;
  const LinksLayer = features.LinksLayer;
  const EditingLayer = features.EditingLayer;

  return (
    <section
      aria-busy={layout.status === "running"}
      className="relative h-full min-h-0 overflow-hidden bg-background text-foreground"
    >
      <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-lg border border-border bg-card/95 p-2 text-card-foreground shadow-sm">
        <button
          aria-label={
            layout.status === "error" ? "Retry arrange" : "Arrange canvas"
          }
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-70"
          disabled={layout.status === "running"}
          onClick={() => void startLayout()}
          type="button"
        >
          {layout.status === "running"
            ? "Arranging…"
            : layout.status === "error"
              ? "Retry"
              : "Arrange"}
        </button>
        {layout.status === "running" ? (
          <span className="text-xs text-muted-foreground" role="status">
            Arranging {model.nodes.length} nodes locally. Dense models can pause
            this panel for several seconds.
          </span>
        ) : null}
        {layout.durationMs !== null ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            Arranged in {Math.round(layout.durationMs)} ms
          </span>
        ) : null}
      </div>

      {layout.error ? (
        <div
          className="absolute left-3 right-3 top-16 z-10 rounded-md border border-destructive/40 bg-background px-3 py-2 text-sm text-destructive shadow-sm"
          role="alert"
        >
          Arrange failed. Existing positions are unchanged. {layout.error}
        </div>
      ) : null}

      <CanvasViewport
        edgeTypes={features.edgeTypes}
        edges={edges}
        nodeTypes={features.nodeTypes}
        nodes={nodes}
        onSelectionIdsChange={updateSelection}
        onViewportChange={updateViewport}
        reducedMotion={reducedMotion}
      />
      <ThreatOverlay scope={scope} />
      <LinksLayer scope={scope} />
      <EditingLayer scope={scope} />
      <output className="sr-only" data-canvas-selection="">
        {viewport.selectedIds.join(",")}
      </output>
    </section>
  );
}

export default function CanvasShell(
  props: CanvasShellProps,
): React.JSX.Element {
  const stateKey = `${props.projectId}:${JSON.stringify(
    props.model.nodes.map((node) => node.id),
  )}`;
  return <CanvasShellState {...props} key={stateKey} />;
}
