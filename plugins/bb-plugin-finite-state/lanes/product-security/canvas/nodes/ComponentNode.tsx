import {
  Handle,
  Position,
  useOnSelectionChange,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo } from "react";
import { Badge } from "@bb/shared-ui/badge";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import type { CanvasFlowNodeData } from "../foundation/CanvasViewport.js";
import type {
  ArchitectureEdgeData,
  ArchitectureNodeData,
  CanvasArchitectureGraph,
} from "./adapters.js";
import { useOptionalArchitectureSelection } from "./selection.js";

interface RichCanvasNodeData extends CanvasFlowNodeData {
  architecture?: ArchitectureNodeData;
}

interface RichCanvasEdgeData extends Record<string, unknown> {
  architecture?: ArchitectureEdgeData;
}

type RichCanvasNode = Node<RichCanvasNodeData>;
type RichCanvasEdge = Edge<RichCanvasEdgeData>;

const EMPTY_GRAPH_NODES: CanvasArchitectureGraph["nodes"] = [];
const EMPTY_GRAPH_EDGES: CanvasArchitectureGraph["edges"] = [];
const EMPTY_SELECTED_IDS: readonly string[] = [];

const COMPONENT_ICONS: Record<string, IconName> = {
  software: "Code",
  hardware: "Laptop",
  sensor: "Eye",
  actuator: "ElectricPlugs",
  ecu: "ComputerTerminal01",
  hsm: "Lock",
  tee: "Container",
  medical_device: "Beaker",
  network: "Globe",
};

export function componentIcon(componentType: string | undefined): IconName {
  return componentType
    ? (COMPONENT_ICONS[componentType] ?? "Circle")
    : "Circle";
}

export function architectureDataFromNode(
  data: RichCanvasNodeData,
): ArchitectureNodeData {
  if (data.architecture) return data.architecture;
  const model = data.model;
  return {
    slug: model.id,
    kind: model.kind,
    name: model.label,
    sourceFile: `product-security/architecture/${model.kind}s/${model.id}.yaml`,
    ...(model.componentType ? { componentType: model.componentType } : {}),
    ...(model.criticality ? { criticality: model.criticality } : {}),
    ...(model.isEntryPoint ? { isEntryPoint: true } : {}),
  };
}

export function useCanvasCoordinator(id: string): void {
  const selection = useOptionalArchitectureSelection();
  const { setNodes, setEdges, fitView } = useReactFlow<
    RichCanvasNode,
    RichCanvasEdge
  >();
  const coordinatorId = selection?.coordinatorId ?? null;
  const edgesBySlug = selection?.edgesBySlug;
  const focusId = selection?.focusId ?? null;
  const graphNodes = selection?.graph.nodes ?? EMPTY_GRAPH_NODES;
  const graphEdges = selection?.graph.edges ?? EMPTY_GRAPH_EDGES;
  const nodesBySlug = selection?.nodesBySlug;
  const onFocusRoute = selection?.onFocusRoute;
  const selectedIds = selection?.selectedIds ?? EMPTY_SELECTED_IDS;
  const setFitSelection = selection?.setFitSelection;
  const setSelectedIds = selection?.setSelectedIds;
  const isCoordinator = id === coordinatorId;

  const synchronizeSelection = useCallback(
    ({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) => {
      if (!isCoordinator) return;
      const ids = [
        ...nodes.map((node) => node.id),
        ...edges.map((edge) => edge.id),
      ];
      setSelectedIds?.(ids);
      if (ids.length !== 1) return;
      const selectedId = ids[0];
      if (!selectedId) return;
      onFocusRoute?.(
        edgesBySlug?.has(selectedId) ? "edge" : "node",
        selectedId,
      );
    },
    [edgesBySlug, isCoordinator, onFocusRoute, setSelectedIds],
  );
  useOnSelectionChange({ onChange: synchronizeSelection });

  useEffect(() => {
    if (!isCoordinator) return;
    const desiredNodes = new Map(graphNodes.map((node) => [node.id, node]));
    const desiredEdges = new Map(graphEdges.map((edge) => [edge.id, edge]));
    setNodes((current) =>
      current.map((node) => {
        const desired = desiredNodes.get(node.id);
        if (!desired) return node;
        return {
          ...node,
          type: desired.type,
          parentId: desired.parentId,
          extent: desired.extent,
          expandParent: desired.expandParent,
          position: desired.parentId ? desired.position : node.position,
          style: desired.style,
          data: { ...node.data, architecture: desired.data },
        };
      }),
    );
    setEdges((current) =>
      current.map((edge) => {
        const desired = desiredEdges.get(edge.id);
        return desired
          ? {
              ...edge,
              type: "dataflow",
              data: { ...edge.data, architecture: desired.data },
              markerStart: desired.markerStart,
              markerEnd: desired.markerEnd,
            }
          : edge;
      }),
    );
  }, [graphEdges, graphNodes, isCoordinator, setEdges, setNodes]);

  useEffect(() => {
    if (!isCoordinator || !focusId) return;
    setNodes((current) =>
      current.map((node) => ({ ...node, selected: node.id === focusId })),
    );
    setEdges((current) =>
      current.map((edge) => ({ ...edge, selected: edge.id === focusId })),
    );
    setSelectedIds?.([focusId]);
    void fitView({ nodes: [{ id: focusId }], duration: 180, padding: 0.45 });
  }, [fitView, focusId, isCoordinator, setEdges, setNodes, setSelectedIds]);

  useEffect(() => {
    if (!isCoordinator || !setFitSelection) return;
    setFitSelection(() => {
      const ids = selectedIds;
      if (ids.length === 0) return;
      const nodeIds = ids.flatMap((selectedId) => {
        if (nodesBySlug?.has(selectedId)) return [selectedId];
        const edge = edgesBySlug?.get(selectedId);
        return edge ? [edge.sourceSlug, edge.targetSlug] : [];
      });
      void fitView({
        nodes: [...new Set(nodeIds)].map((selectedId) => ({ id: selectedId })),
        duration: 180,
        padding: 0.35,
      });
    });
    return () => setFitSelection(null);
  }, [
    edgesBySlug,
    fitView,
    isCoordinator,
    nodesBySlug,
    selectedIds,
    setFitSelection,
  ]);
}

interface CanvasNodeFrameProps {
  architecture: ArchitectureNodeData;
  icon: IconName;
  selected: boolean;
  children?: React.ReactNode;
  className?: string;
}

export function CanvasNodeFrame({
  architecture,
  icon,
  selected,
  children,
  className = "",
}: CanvasNodeFrameProps): React.JSX.Element {
  const selection = useOptionalArchitectureSelection();
  const unresolvedCount = architecture.unresolvedRefs?.length ?? 0;
  return (
    <article
      aria-label={`${architecture.kind} ${architecture.name}`}
      className={`h-full w-full rounded-lg border bg-card px-3 py-2 text-card-foreground shadow-sm ${
        selected ? "border-primary ring-2 ring-ring" : "border-border"
      } ${className}`}
      data-canvas-node-id={architecture.slug}
      onContextMenu={(event) => {
        event.preventDefault();
        selection?.openMenu({
          targetId: architecture.slug,
          targetKind: "node",
          x: event.clientX,
          y: event.clientY,
        });
      }}
    >
      <Handle
        aria-hidden="true"
        className="border-border bg-muted-foreground"
        position={Position.Left}
        type="target"
      />
      <div className="flex min-w-0 items-center gap-2">
        <span className="rounded-md border border-border bg-muted p-1.5">
          <Icon aria-hidden="true" className="size-4" name={icon} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{architecture.name}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {architecture.slug}
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {children}
        {architecture.criticality ? (
          <Badge variant="outline">
            Criticality: {architecture.criticality}
          </Badge>
        ) : null}
        {unresolvedCount > 0 ? (
          <Badge
            aria-label={`${unresolvedCount} unresolved references`}
            variant="destructive"
          >
            <Icon aria-hidden="true" className="mr-1 size-3" name="CircleX" />
            {unresolvedCount} unresolved
          </Badge>
        ) : null}
      </div>
      <Handle
        aria-hidden="true"
        className="border-border bg-muted-foreground"
        position={Position.Right}
        type="source"
      />
    </article>
  );
}

export function ComponentNode({
  data,
  id,
  selected,
}: NodeProps<RichCanvasNode>): React.JSX.Element {
  useCanvasCoordinator(id);
  const architecture = useMemo(() => architectureDataFromNode(data), [data]);
  return (
    <CanvasNodeFrame
      architecture={architecture}
      icon={componentIcon(architecture.componentType)}
      selected={selected}
    >
      <Badge variant="secondary">
        <Icon
          aria-hidden="true"
          className="mr-1 size-3"
          name={componentIcon(architecture.componentType)}
        />
        {architecture.componentType ?? "component"}
      </Badge>
      {architecture.isEntryPoint ? (
        <Badge variant="outline">Entry point</Badge>
      ) : null}
    </CanvasNodeFrame>
  );
}
