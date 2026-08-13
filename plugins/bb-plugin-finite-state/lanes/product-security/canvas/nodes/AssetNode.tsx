import { type Node, type NodeProps } from "@xyflow/react";
import { Badge } from "@bb/shared-ui/badge";
import type { CanvasFlowNodeData } from "../foundation/CanvasViewport.js";
import type { ArchitectureNodeData } from "./adapters.js";
import { architectureDataFromNode, CanvasNodeFrame } from "./ComponentNode.js";

interface AssetCanvasNodeData extends CanvasFlowNodeData {
  architecture?: ArchitectureNodeData;
}

type AssetCanvasNode = Node<AssetCanvasNodeData>;

export function AssetNode({
  data,
  selected,
}: NodeProps<AssetCanvasNode>): React.JSX.Element {
  const architecture = architectureDataFromNode(data);
  return (
    <CanvasNodeFrame
      architecture={architecture}
      icon="FileText"
      selected={selected}
    >
      <Badge variant="secondary">Protected asset</Badge>
    </CanvasNodeFrame>
  );
}
