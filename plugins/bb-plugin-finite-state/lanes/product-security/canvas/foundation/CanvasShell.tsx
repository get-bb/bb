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
import type {
  CanvasModel,
  CanvasViewportState,
  LayoutResult,
  LayoutWorkerFactory,
  LayoutWorkerResponse,
} from "./types.js";

const DEFAULT_LAYOUT_TIMEOUT_MS = 10_000;

export interface CanvasFoundationFeatures {
  nodeTypes: NodeTypes;
  edgeTypes: EdgeTypes;
  ThreatOverlay: ComponentType;
  LinksLayer: ComponentType;
  EditingLayer: ComponentType;
}

interface CanvasShellProps {
  model: CanvasModel;
  features: CanvasFoundationFeatures;
  createLayoutWorker?: LayoutWorkerFactory;
  layoutTimeoutMs?: number;
}

type LayoutStatus = "idle" | "running" | "error" | "cancelled";

interface LayoutUiState {
  status: LayoutStatus;
  progress: number;
  error: string | null;
  durationMs: number | null;
}

function initialPositions(model: CanvasModel): LayoutResult["positions"] {
  return Object.fromEntries(
    model.nodes.map((node, index) => [
      node.id,
      { x: (index % 4) * 288, y: Math.floor(index / 4) * 176 },
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLayoutResponse(value: unknown): value is LayoutWorkerResponse {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  return typeof value.requestId === "string";
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

export function shouldAutoLayout(nodeCount: number): boolean {
  return nodeCount <= 200;
}

export default function CanvasShell({
  model,
  features,
  createLayoutWorker,
  layoutTimeoutMs = DEFAULT_LAYOUT_TIMEOUT_MS,
}: CanvasShellProps): React.JSX.Element {
  const [positions, setPositions] = useState(() => initialPositions(model));
  const [viewport, setViewport] = useState<CanvasViewportState>({
    x: 0,
    y: 0,
    zoom: 1,
    selectedIds: [],
  });
  const [layout, setLayout] = useState<LayoutUiState>({
    status: "idle",
    progress: 0,
    error: null,
    durationMs: null,
  });
  const workerRef = useRef<ReturnType<LayoutWorkerFactory> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    setPositions(initialPositions(model));
  }, [model]);

  const clearWorker = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  useEffect(() => clearWorker, [clearWorker]);

  const failLayout = useCallback(
    (message: string) => {
      clearWorker();
      setLayout((current) => ({
        ...current,
        status: "error",
        error: message,
      }));
    },
    [clearWorker],
  );

  const startLayout = useCallback(() => {
    if (!createLayoutWorker || !shouldAutoLayout(model.nodes.length)) return;
    clearWorker();
    const worker = createLayoutWorker();
    const requestId = `layout-${++requestIdRef.current}`;
    workerRef.current = worker;
    setLayout({
      status: "running",
      progress: 0,
      error: null,
      durationMs: null,
    });

    worker.onmessage = (event) => {
      if (!isLayoutResponse(event.data) || event.data.requestId !== requestId) {
        return;
      }
      const response = event.data;
      if (response.type === "progress") {
        setLayout((current) => ({ ...current, progress: response.progress }));
        return;
      }
      if (response.type === "result") {
        clearWorker();
        setPositions(response.result.positions);
        setLayout({
          status: "idle",
          progress: 1,
          error: null,
          durationMs: response.result.durationMs,
        });
        return;
      }
      if (response.type === "cancelled") {
        clearWorker();
        setLayout((current) => ({ ...current, status: "cancelled" }));
        return;
      }
      if (response.type === "error") failLayout(response.message);
    };
    worker.onerror = () => {
      failLayout("Auto-layout worker stopped unexpectedly.");
    };
    timeoutRef.current = setTimeout(() => {
      failLayout("Auto-layout timed out. The existing layout is unchanged.");
    }, layoutTimeoutMs);
    worker.postMessage({
      type: "layout",
      requestId,
      request: {
        nodes: model.nodes.map(({ id, width, height }) => ({
          id,
          width,
          height,
        })),
        edges: model.edges.map(({ source, target }) => ({ source, target })),
        direction: "RIGHT",
      },
    });
  }, [clearWorker, createLayoutWorker, failLayout, layoutTimeoutMs, model]);

  const cancelLayout = useCallback(() => {
    const worker = workerRef.current;
    const requestId = `layout-${requestIdRef.current}`;
    if (worker) worker.postMessage({ type: "cancel", requestId });
    clearWorker();
    setLayout((current) => ({ ...current, status: "cancelled" }));
  }, [clearWorker]);

  const nodes = useMemo(() => flowNodes(model, positions), [model, positions]);
  const edges = useMemo(() => flowEdges(model), [model]);
  const updateViewport = useCallback((nextViewport: CanvasViewportState) => {
    setViewport(nextViewport);
  }, []);
  const updateSelection = useCallback((selectedIds: string[]) => {
    setViewport((current) => ({ ...current, selectedIds }));
  }, []);
  const layoutAllowed = shouldAutoLayout(model.nodes.length);
  const ThreatOverlay = features.ThreatOverlay;
  const LinksLayer = features.LinksLayer;
  const EditingLayer = features.EditingLayer;

  return (
    <section className="relative h-full min-h-0 overflow-hidden bg-background text-foreground">
      <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-lg border border-border bg-card/95 p-2 text-card-foreground shadow-sm">
        {createLayoutWorker ? (
          <button
            aria-label={
              layout.status === "error" ? "Retry auto-layout" : "Tidy canvas"
            }
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!layoutAllowed || layout.status === "running"}
            onClick={startLayout}
            type="button"
          >
            {layout.status === "error" ? "Retry" : "Tidy"}
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">
            Worker auto-layout unavailable in this plugin build
          </span>
        )}
        {layout.status === "running" ? (
          <>
            <progress
              aria-label="Auto-layout progress"
              className="h-2 w-24 accent-primary"
              max={1}
              value={layout.progress}
            />
            <button
              aria-label="Cancel auto-layout"
              className="rounded-md px-2 py-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={cancelLayout}
              type="button"
            >
              Cancel
            </button>
          </>
        ) : null}
        {!layoutAllowed ? (
          <span className="text-xs text-muted-foreground">
            Automatic layout is disabled above 200 nodes
          </span>
        ) : null}
        {layout.durationMs !== null ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {Math.round(layout.durationMs)} ms
          </span>
        ) : null}
      </div>

      {layout.error ? (
        <div
          className="absolute left-3 right-3 top-16 z-10 rounded-md border border-destructive/40 bg-background px-3 py-2 text-sm text-destructive shadow-sm"
          role="alert"
        >
          {layout.error}
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
      <ThreatOverlay />
      <LinksLayer />
      <EditingLayer />
      <output className="sr-only" data-canvas-selection="">
        {viewport.selectedIds.join(",")}
      </output>
    </section>
  );
}
