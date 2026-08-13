import { type Node, type NodeProps } from "@xyflow/react";
import { Badge } from "@bb/shared-ui/badge";
import type { CanvasFlowNodeData } from "../foundation/CanvasViewport.js";
import type { ArchitectureNodeData } from "./adapters.js";
import {
  architectureDataFromNode,
  CanvasNodeFrame,
  useCanvasCoordinator,
} from "./ComponentNode.js";

interface ZoneCanvasNodeData extends CanvasFlowNodeData {
  architecture?: ArchitectureNodeData;
}

type ZoneCanvasNode = Node<ZoneCanvasNodeData>;

export function ZoneNode({
  data,
  id,
  selected,
}: NodeProps<ZoneCanvasNode>): React.JSX.Element {
  useCanvasCoordinator(id);
  const architecture = architectureDataFromNode(data);
  return (
    <CanvasNodeFrame
      architecture={architecture}
      className="border-dashed bg-muted/35"
      icon="Layers"
      selected={selected}
    >
      <Badge variant="outline">Trust zone container</Badge>
    </CanvasNodeFrame>
  );
}
