import type { Node, NodeProps, NodeTypes } from "@xyflow/react";
import type { CanvasNodeModel } from "../foundation/types.js";

interface CanvasNodeData extends Record<string, unknown> {
  model: CanvasNodeModel;
}

type CanvasFlowNode = Node<CanvasNodeData, "component">;

export async function loadProductSecurityNodeTypes(): Promise<NodeTypes> {
  const { Handle, Position } = await import("@xyflow/react");

  function RepresentativeComponentNode({
    data,
    selected,
  }: NodeProps<CanvasFlowNode>): React.JSX.Element {
    const { model } = data;
    return (
      <article
        aria-label={`${model.kind} ${model.label}`}
        className={`h-full w-full rounded-lg border bg-card px-3 py-2 text-card-foreground shadow-sm ${
          selected ? "border-primary ring-2 ring-ring" : "border-border"
        }`}
        data-canvas-node-id={model.id}
      >
        <Handle
          aria-hidden="true"
          className="border-border bg-muted-foreground"
          position={Position.Left}
          type="target"
        />
        <p className="truncate font-mono text-xs text-muted-foreground">
          {model.id}
        </p>
        <p className="mt-1 truncate text-sm font-medium">{model.label}</p>
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded border border-border px-1.5 py-0.5">
            {model.componentType ?? model.kind}
          </span>
          {model.criticality ? <span>{model.criticality}</span> : null}
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

  return { component: RepresentativeComponentNode };
}
