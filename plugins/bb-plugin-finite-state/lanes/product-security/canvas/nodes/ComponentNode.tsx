import {
  Handle,
  Position,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useMemo } from "react";
import { Badge } from "@bb/shared-ui/badge";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import type { CanvasFlowNodeData } from "../foundation/CanvasViewport.js";
import type {
  ArchitectureNodeData,
} from "./adapters.js";
import { useOptionalArchitectureSelection } from "./selection.js";

interface RichCanvasNodeData extends CanvasFlowNodeData {
  architecture?: ArchitectureNodeData;
}

type RichCanvasNode = Node<RichCanvasNodeData>;

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
  selected,
}: NodeProps<RichCanvasNode>): React.JSX.Element {
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
