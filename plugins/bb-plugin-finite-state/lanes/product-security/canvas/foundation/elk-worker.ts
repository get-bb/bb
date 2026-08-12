import type {
  ELK,
  ELKConstructorArguments,
  ElkNode,
} from "elkjs/lib/elk-api.js";
import type {
  LayoutRequest,
  LayoutResult,
  LayoutWorkerRequest,
  LayoutWorkerResponse,
} from "./types.js";

interface LayoutWorkerPort {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  postMessage(message: LayoutWorkerResponse): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ElkConstructor = new (args?: ELKConstructorArguments) => ELK;

function isElkConstructor(value: unknown): value is ElkConstructor {
  return typeof value === "function";
}

async function loadElkConstructor(): Promise<ElkConstructor> {
  const module: unknown = await import("elkjs/lib/elk.bundled.js");
  if (!isRecord(module)) throw new Error("ELK module did not load");
  const candidate = module.default;
  if (isElkConstructor(candidate)) return candidate;
  if (isRecord(candidate) && isElkConstructor(candidate.default)) {
    return candidate.default;
  }
  throw new Error("ELK constructor is unavailable");
}

function isLayoutWorkerPort(value: unknown): value is LayoutWorkerPort {
  return (
    isRecord(value) &&
    typeof value.addEventListener === "function" &&
    typeof value.postMessage === "function"
  );
}

function isLayoutWorkerRequest(value: unknown): value is LayoutWorkerRequest {
  if (!isRecord(value) || value.type !== "layout") return false;
  if (typeof value.requestId !== "string" || !isRecord(value.request)) {
    return false;
  }
  return (
    Array.isArray(value.request.nodes) &&
    Array.isArray(value.request.edges) &&
    (value.request.direction === "RIGHT" || value.request.direction === "DOWN")
  );
}

function safeWorkerMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message.slice(0, 300)
    : "ELK layout failed";
}

export async function runElkLayout(
  request: LayoutRequest,
): Promise<LayoutResult> {
  const startedAt = performance.now();
  const ELK = await loadElkConstructor();
  const elk = new ELK();
  const laidOut: ElkNode = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": request.direction,
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": "72",
      "elk.spacing.nodeNode": "48",
    },
    children: request.nodes.map((node) => ({
      id: node.id,
      width: node.width,
      height: node.height,
    })),
    edges: request.edges.map((edge, index) => ({
      id: `layout-edge-${index}`,
      sources: [edge.source],
      targets: [edge.target],
    })),
  });

  const positions: LayoutResult["positions"] = {};
  for (const node of laidOut.children ?? []) {
    positions[node.id] = { x: node.x ?? 0, y: node.y ?? 0 };
  }

  return {
    positions,
    durationMs: performance.now() - startedAt,
  };
}

export function installElkWorker(port: LayoutWorkerPort): void {
  port.addEventListener("message", (event) => {
    if (!isLayoutWorkerRequest(event.data)) return;
    const { requestId, request } = event.data;
    port.postMessage({ type: "progress", requestId, progress: 0.1 });
    void runElkLayout(request)
      .then((result) => {
        port.postMessage({ type: "progress", requestId, progress: 1 });
        port.postMessage({ type: "result", requestId, result });
      })
      .catch((error: unknown) => {
        port.postMessage({
          type: "error",
          requestId,
          message: safeWorkerMessage(error),
        });
      });
  });
}

if (typeof document === "undefined" && isLayoutWorkerPort(globalThis)) {
  installElkWorker(globalThis);
}
