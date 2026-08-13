import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import type { EdgeTypes, NodeTypes } from "@xyflow/react";
import type { CanvasModel, CanvasNodeModel } from "../foundation/types.js";
import { AssetNode } from "./AssetNode.js";
import { ComponentNode } from "./ComponentNode.js";
import { ContextMenu } from "./ContextMenu.js";
import { DataflowEdge } from "./DataflowEdge.js";
import { Inspector } from "./Inspector.js";
import { Stencil } from "./Stencil.js";
import { ZoneNode } from "./ZoneNode.js";
import type {
  ArchitectureAdjacency,
  ArchitectureModel,
  ArchitectureNodeData,
  CanvasArchitectureGraph,
} from "./adapters.js";
import {
  ArchitectureSelectionContext,
  type ArchitectureContextMenuState,
  type ArchitectureSelectionContextValue,
  type ArchitectureSelectionKind,
} from "./selection.js";

interface RichCanvasNodeModel extends CanvasNodeModel {
  architecture: ArchitectureNodeData;
}

export function toFoundationCanvasModel(
  model: ArchitectureModel,
  graph: CanvasArchitectureGraph,
): CanvasModel {
  const graphNodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const zoneOrder = new Map(
    graph.nodes
      .filter((node) => node.data.kind === "zone")
      .map((node, index) => [node.id, index]),
  );
  const orderedNodes = model.nodes
    .map((node, index) => ({ node, index }))
    .sort((left, right) => {
      const leftIsZone = left.node.kind === "zone";
      const rightIsZone = right.node.kind === "zone";
      if (leftIsZone !== rightIsZone) return leftIsZone ? -1 : 1;
      if (leftIsZone && rightIsZone) {
        return (
          (zoneOrder.get(left.node.slug) ?? left.index) -
          (zoneOrder.get(right.node.slug) ?? right.index)
        );
      }
      return left.index - right.index;
    });
  const nodes: RichCanvasNodeModel[] = orderedNodes.flatMap(({ node }) => {
    const graphNode = graphNodes.get(node.slug);
    if (!graphNode) return [];
    const isZone = node.kind === "zone";
    return [
      {
        id: node.slug,
        kind: node.kind,
        label: node.name,
        width: graphNode?.width ?? (isZone ? 584 : 216),
        height: graphNode?.height ?? (isZone ? 356 : 112),
        componentType: node.componentType ?? null,
        criticality: node.criticality ?? null,
        isEntryPoint: node.isEntryPoint ?? false,
        architecture: graphNode.data,
      },
    ];
  });
  return {
    nodes,
    edges: graph.edges.flatMap((edge) =>
      edge.data
        ? [
            {
              id: edge.id,
              source: edge.source,
              target: edge.target,
              label: edge.data.name ?? edge.data.slug,
              protocol: edge.data.protocol ?? null,
              encrypted: edge.data.encrypted,
              authenticated: edge.data.authenticated,
              architecture: edge.data,
            },
          ]
        : [],
    ),
    cache: model.cache,
  };
}

export async function loadProductSecurityNodeTypes(): Promise<NodeTypes> {
  return {
    component: ComponentNode,
    zone: ZoneNode,
    asset: AssetNode,
  };
}

export const productSecurityNodeEdgeTypes: EdgeTypes = {
  dataflow: DataflowEdge,
};

interface ProductSecurityCanvasWorkspaceProps {
  model: ArchitectureModel;
  graph: CanvasArchitectureGraph;
  adjacency: ReadonlyMap<string, ArchitectureAdjacency>;
  focusId: string | null;
  onFocusRoute(kind: ArchitectureSelectionKind, slug: string): void;
  children: ReactNode;
}

export function ProductSecurityCanvasWorkspace({
  model,
  graph,
  adjacency,
  focusId,
  onFocusRoute,
  children,
}: ProductSecurityCanvasWorkspaceProps): React.JSX.Element {
  const [selectedIds, setSelectedIdsState] = useState<readonly string[]>(
    focusId ? [focusId] : [],
  );
  const [menu, setMenu] = useState<ArchitectureContextMenuState | null>(null);
  const fitSelectionRef = useRef<(() => void) | null>(null);
  const setSelectedIds = useCallback((ids: readonly string[]) => {
    setSelectedIdsState([...new Set(ids)]);
  }, []);
  const setFitSelection = useCallback((callback: (() => void) | null) => {
    fitSelectionRef.current = callback;
  }, []);
  const fitSelection = useCallback(() => fitSelectionRef.current?.(), []);
  const openMenu = useCallback((nextMenu: ArchitectureContextMenuState) => {
    setMenu(nextMenu);
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);
  const nodesBySlug = useMemo(
    () => new Map(model.nodes.map((node) => [node.slug, node])),
    [model],
  );
  const edgesBySlug = useMemo(
    () => new Map(model.dataflows.map((edge) => [edge.slug, edge])),
    [model],
  );
  const coordinatorId = graph.nodes[0]?.id ?? null;
  const context = useMemo<ArchitectureSelectionContextValue>(
    () => ({
      graph,
      nodesBySlug,
      edgesBySlug,
      adjacency,
      unresolved: graph.unresolved,
      selectedIds,
      focusId,
      coordinatorId,
      menu,
      setSelectedIds,
      setFitSelection,
      fitSelection,
      openMenu,
      closeMenu,
      onFocusRoute,
    }),
    [
      adjacency,
      closeMenu,
      coordinatorId,
      edgesBySlug,
      fitSelection,
      focusId,
      graph,
      menu,
      nodesBySlug,
      onFocusRoute,
      openMenu,
      selectedIds,
      setFitSelection,
      setSelectedIds,
    ],
  );
  return (
    <ArchitectureSelectionContext.Provider value={context}>
      <div
        className="flex h-full min-h-0 bg-background text-foreground"
        onClick={closeMenu}
      >
        <Stencil />
        <div className="relative min-w-0 flex-1">{children}</div>
        <Inspector />
        <ContextMenu />
      </div>
    </ArchitectureSelectionContext.Provider>
  );
}
