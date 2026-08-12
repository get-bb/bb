export type CanvasNodeKind = "component" | "zone" | "asset";
export type CanvasTaraKind = CanvasNodeKind | "dataflow";

export interface CanvasNodeModel {
  id: string;
  kind: CanvasNodeKind;
  label: string;
  width: number;
  height: number;
  componentType: string | null;
  criticality: string | null;
  isEntryPoint: boolean;
}

export interface CanvasEdgeModel {
  id: string;
  source: string;
  target: string;
  label: string;
  protocol: string | null;
  encrypted: boolean;
  authenticated: boolean;
}

export interface CanvasModel {
  nodes: CanvasNodeModel[];
  edges: CanvasEdgeModel[];
  cache: { pulledAt: string | null; stale: boolean };
}

export interface CanvasViewportState {
  x: number;
  y: number;
  zoom: number;
  selectedIds: string[];
}

export interface CanvasDataSource {
  read(projectId: string): Promise<CanvasModel>;
  subscribe(onHint: () => void): () => void;
}

export interface LayoutRequest {
  nodes: Pick<CanvasNodeModel, "id" | "width" | "height">[];
  edges: Pick<CanvasEdgeModel, "source" | "target">[];
  direction: "RIGHT" | "DOWN";
}

export interface LayoutResult {
  positions: Record<string, { x: number; y: number }>;
  durationMs: number;
}

export type LayoutWorkerRequest =
  | {
      type: "layout";
      requestId: string;
      request: LayoutRequest;
    }
  | {
      type: "cancel";
      requestId: string;
    };

export type LayoutWorkerResponse =
  | {
      type: "progress";
      requestId: string;
      progress: number;
    }
  | {
      type: "result";
      requestId: string;
      result: LayoutResult;
    }
  | {
      type: "error";
      requestId: string;
      message: string;
    }
  | {
      type: "cancelled";
      requestId: string;
    };

export interface LayoutWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: LayoutWorkerRequest): void;
  terminate(): void;
}

export type LayoutWorkerFactory = () => LayoutWorkerLike;
