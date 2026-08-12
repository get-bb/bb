import { useCallback, useEffect, useState } from "react";
import {
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type EdgeTypes,
  type ColorMode,
  type Node,
  type NodeTypes,
  type OnMove,
  type OnSelectionChangeFunc,
} from "@xyflow/react";
// @ts-expect-error The plugin app builder consumes this declared package CSS export.
import "@xyflow/react/dist/style.css";
import type {
  CanvasEdgeModel,
  CanvasNodeModel,
  CanvasViewportState,
} from "./types.js";

export interface CanvasFlowNodeData extends Record<string, unknown> {
  model: CanvasNodeModel;
}

export interface CanvasFlowEdgeData extends Record<string, unknown> {
  model: CanvasEdgeModel;
}

export type CanvasFlowNode = Node<CanvasFlowNodeData, "component">;
export type CanvasFlowEdge = Edge<CanvasFlowEdgeData>;

interface CanvasViewportProps {
  nodes: CanvasFlowNode[];
  edges: CanvasFlowEdge[];
  nodeTypes: NodeTypes;
  edgeTypes: EdgeTypes;
  reducedMotion: boolean;
  onViewportChange(viewport: CanvasViewportState): void;
  onSelectionIdsChange(selectedIds: string[]): void;
}

function currentHostColorMode(): ColorMode {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function useHostColorMode(): ColorMode {
  const [colorMode, setColorMode] = useState(currentHostColorMode);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setColorMode(currentHostColorMode());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);
  return colorMode;
}

export function CanvasViewport({
  nodes: nextNodes,
  edges: nextEdges,
  nodeTypes,
  edgeTypes,
  reducedMotion,
  onViewportChange,
  onSelectionIdsChange,
}: CanvasViewportProps): React.JSX.Element {
  const [nodes, setNodes, onNodesChange] = useNodesState(nextNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(nextEdges);
  const colorMode = useHostColorMode();

  useEffect(() => setNodes(nextNodes), [nextNodes, setNodes]);
  useEffect(() => setEdges(nextEdges), [nextEdges, setEdges]);

  const onMoveEnd: OnMove = useCallback(
    (_event, viewport) => {
      onViewportChange({
        ...viewport,
        selectedIds: nodes
          .filter((node) => node.selected)
          .map((node) => node.id),
      });
    },
    [nodes, onViewportChange],
  );
  const onSelectionChange: OnSelectionChangeFunc = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }) => {
      onSelectionIdsChange([
        ...selectedNodes.map((node) => node.id),
        ...selectedEdges.map((edge) => edge.id),
      ]);
    },
    [onSelectionIdsChange],
  );

  return (
    <div
      aria-label="Product security architecture canvas"
      className="h-full min-h-0 w-full bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-canvas-viewport=""
      role="application"
      tabIndex={0}
    >
      <ReactFlow<CanvasFlowNode, CanvasFlowEdge>
        colorMode={colorMode}
        defaultEdgeOptions={{ animated: false, selectable: true }}
        edges={edges}
        edgeTypes={edgeTypes}
        elementsSelectable
        fitView
        fitViewOptions={{ duration: reducedMotion ? 0 : 250, padding: 0.2 }}
        minZoom={0.2}
        multiSelectionKeyCode="Shift"
        nodes={nodes}
        nodesConnectable={false}
        nodesDraggable={false}
        nodesFocusable
        nodeTypes={nodeTypes}
        onEdgesChange={onEdgesChange}
        onMoveEnd={onMoveEnd}
        onNodesChange={onNodesChange}
        onSelectionChange={onSelectionChange}
        onlyRenderVisibleElements
        panActivationKeyCode="Space"
        panOnDrag
        proOptions={{ hideAttribution: true }}
        selectionKeyCode="Shift"
        zoomOnDoubleClick={false}
      >
        <Controls
          fitViewOptions={{ duration: reducedMotion ? 0 : 250, padding: 0.2 }}
          position="bottom-right"
          showInteractive={false}
        />
      </ReactFlow>
    </div>
  );
}
