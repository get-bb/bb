import {
  MarkerType,
  type Edge,
  type Node,
  type XYPosition,
} from "@xyflow/react";

export type ArchitectureKind = "component" | "zone" | "asset" | "dataflow";

export interface ArchitectureInterface {
  name: string;
  protocol?: string;
  port?: number;
  direction?: string;
}

export interface ArchitectureNodeData extends Record<string, unknown> {
  slug: string;
  kind: Exclude<ArchitectureKind, "dataflow">;
  name: string;
  componentType?: string;
  criticality?: string;
  zone?: string;
  interfaces?: ArchitectureInterface[];
  sourceFile: string;
  description?: string;
  technologies?: string[];
  affectedAssets?: string[];
  threatCount?: number;
  isEntryPoint?: boolean;
  unresolvedRefs?: UnresolvedRef[];
}

export interface ArchitectureEdgeData extends Record<string, unknown> {
  slug: string;
  sourceSlug: string;
  targetSlug: string;
  protocol?: string;
  encrypted: boolean;
  authenticated: boolean;
  bidirectional: boolean;
  sourceFile: string;
  name?: string;
  description?: string;
  unresolvedRefs?: UnresolvedRef[];
}

export interface ArchitectureModel {
  revision: string;
  nodes: ArchitectureNodeData[];
  dataflows: ArchitectureEdgeData[];
  cache: { pulledAt: string | null; stale: boolean; message: string | null };
}

export interface UnresolvedRef {
  ownerSlug: string;
  ownerKind: ArchitectureKind;
  field: "zone" | "source" | "target" | "asset";
  targetSlug: string;
  sourceFile: string;
  message: string;
}

export interface ArchitectureAdjacency {
  connectedFlowSlugs: string[];
  neighborSlugs: string[];
}

export interface CanvasArchitectureGraph {
  nodes: Node<ArchitectureNodeData>[];
  edges: Edge<ArchitectureEdgeData>[];
  unresolved: UnresolvedRef[];
}

const NODE_WIDTH = 216;
const NODE_HEIGHT = 112;
const ZONE_WIDTH = 584;
const ZONE_HEIGHT = 356;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function positionForRoot(index: number): XYPosition {
  return { x: (index % 3) * 640, y: Math.floor(index / 3) * 416 };
}

function positionInZone(index: number): XYPosition {
  return { x: 28 + (index % 2) * 252, y: 76 + Math.floor(index / 2) * 140 };
}

function unresolved(
  ownerSlug: string,
  ownerKind: ArchitectureKind,
  field: UnresolvedRef["field"],
  targetSlug: string,
  sourceFile: string,
): UnresolvedRef {
  return {
    ownerSlug,
    ownerKind,
    field,
    targetSlug,
    sourceFile,
    message: `${field} reference “${targetSlug}” does not resolve to an architecture slug.`,
  };
}

function wouldCreateZoneCycle(
  node: ArchitectureNodeData,
  nodesBySlug: ReadonlyMap<string, ArchitectureNodeData>,
): boolean {
  const seen = new Set([node.slug]);
  let next = node.zone;
  while (next) {
    if (seen.has(next)) return true;
    seen.add(next);
    const parent = nodesBySlug.get(next);
    next = parent?.kind === "zone" ? parent.zone : undefined;
  }
  return false;
}

function zoneDepth(
  node: ArchitectureNodeData,
  nodesBySlug: ReadonlyMap<string, ArchitectureNodeData>,
): number {
  let depth = 0;
  let next = node.zone;
  const seen = new Set([node.slug]);
  while (next && !seen.has(next)) {
    seen.add(next);
    const parent = nodesBySlug.get(next);
    if (parent?.kind !== "zone") break;
    depth += 1;
    next = parent.zone;
  }
  return depth;
}

export function toCanvasGraph(
  model: ArchitectureModel,
): CanvasArchitectureGraph {
  const unresolvedRefs: UnresolvedRef[] = [];
  const nodesBySlug = new Map(model.nodes.map((node) => [node.slug, node]));
  const childCounts = new Map<string, number>();
  let rootIndex = 0;

  const nodes = [...model.nodes]
    .sort((left, right) => {
      const kindOrder =
        Number(right.kind === "zone") - Number(left.kind === "zone");
      const depthOrder =
        zoneDepth(left, nodesBySlug) - zoneDepth(right, nodesBySlug);
      return kindOrder || depthOrder || left.slug.localeCompare(right.slug);
    })
    .map((node): Node<ArchitectureNodeData> => {
      let parentId: string | undefined;
      let position: XYPosition;
      if (node.zone) {
        const parent = nodesBySlug.get(node.zone);
        if (
          parent?.kind === "zone" &&
          !wouldCreateZoneCycle(node, nodesBySlug)
        ) {
          parentId = parent.slug;
          const childIndex = childCounts.get(parent.slug) ?? 0;
          childCounts.set(parent.slug, childIndex + 1);
          position = positionInZone(childIndex);
        } else {
          unresolvedRefs.push(
            unresolved(
              node.slug,
              node.kind,
              "zone",
              node.zone,
              node.sourceFile,
            ),
          );
          position = positionForRoot(rootIndex++);
        }
      } else {
        position = positionForRoot(rootIndex++);
      }

      const ownUnresolved = unresolvedRefs.filter(
        (ref) => ref.ownerKind !== "dataflow" && ref.ownerSlug === node.slug,
      );
      const data =
        ownUnresolved.length > 0
          ? { ...node, unresolvedRefs: ownUnresolved }
          : node;
      const isZone = node.kind === "zone";
      return {
        id: node.slug,
        type: node.kind,
        data,
        position,
        parentId,
        extent: parentId ? "parent" : undefined,
        expandParent: Boolean(parentId),
        draggable: false,
        selectable: true,
        width: isZone ? ZONE_WIDTH : NODE_WIDTH,
        height: isZone ? ZONE_HEIGHT : NODE_HEIGHT,
        style: isZone
          ? { width: ZONE_WIDTH, height: ZONE_HEIGHT, zIndex: -1 }
          : { width: NODE_WIDTH, height: NODE_HEIGHT },
      };
    });

  const edges: Edge<ArchitectureEdgeData>[] = [];
  for (const flow of model.dataflows) {
    const ownUnresolved: UnresolvedRef[] = [];
    if (!nodesBySlug.has(flow.sourceSlug)) {
      ownUnresolved.push(
        unresolved(
          flow.slug,
          "dataflow",
          "source",
          flow.sourceSlug,
          flow.sourceFile,
        ),
      );
    }
    if (!nodesBySlug.has(flow.targetSlug)) {
      ownUnresolved.push(
        unresolved(
          flow.slug,
          "dataflow",
          "target",
          flow.targetSlug,
          flow.sourceFile,
        ),
      );
    }
    unresolvedRefs.push(...ownUnresolved);
    if (ownUnresolved.length > 0) continue;
    edges.push({
      id: flow.slug,
      type: "dataflow",
      source: flow.sourceSlug,
      target: flow.targetSlug,
      data: flow,
      label: flow.protocol ?? flow.name ?? flow.slug,
      markerEnd: { type: MarkerType.ArrowClosed },
      markerStart: flow.bidirectional
        ? { type: MarkerType.ArrowClosed }
        : undefined,
      selectable: true,
      animated: false,
    });
  }

  return { nodes, edges, unresolved: unresolvedRefs };
}

export function fromCanvasGraph(
  revision: string,
  graph: Pick<CanvasArchitectureGraph, "nodes" | "edges">,
  cache: ArchitectureModel["cache"] = {
    pulledAt: null,
    stale: false,
    message: null,
  },
): ArchitectureModel {
  return {
    revision,
    nodes: graph.nodes.map((node) => ({
      ...node.data,
      zone: node.parentId ?? node.data.zone,
    })),
    dataflows: graph.edges.flatMap((edge) =>
      edge.data
        ? [{ ...edge.data, sourceSlug: edge.source, targetSlug: edge.target }]
        : [],
    ),
    cache,
  };
}

export function buildArchitectureAdjacency(
  model: Pick<ArchitectureModel, "nodes" | "dataflows">,
): Map<string, ArchitectureAdjacency> {
  const mutable = new Map<
    string,
    { connectedFlowSlugs: string[]; neighborSlugs: string[] }
  >();
  for (const node of model.nodes) {
    mutable.set(node.slug, { connectedFlowSlugs: [], neighborSlugs: [] });
  }
  for (const flow of model.dataflows) {
    const source = mutable.get(flow.sourceSlug);
    const target = mutable.get(flow.targetSlug);
    if (source) {
      source.connectedFlowSlugs.push(flow.slug);
      source.neighborSlugs.push(flow.targetSlug);
    }
    if (target) {
      target.connectedFlowSlugs.push(flow.slug);
      target.neighborSlugs.push(flow.sourceSlug);
    }
  }
  return new Map(
    [...mutable].map(([slug, entry]) => [
      slug,
      {
        connectedFlowSlugs: unique(entry.connectedFlowSlugs),
        neighborSlugs: unique(entry.neighborSlugs),
      },
    ]),
  );
}
