import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  ApiIcon,
  CircleIcon,
  CloudIcon,
  CloudServerIcon,
  ComputerTerminal01Icon,
  ConnectIcon,
  DatabaseIcon,
  ElectricPlugsIcon,
  InternetIcon,
  LaptopIcon,
  LockIcon,
  MicrochipIcon,
  MobileProgrammingIcon,
  QuestionIcon,
  SourceCodeIcon,
  TestTube01Icon,
  ViewIcon,
  WebProgrammingIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useMemo } from "react";
import { Badge } from "@bb/shared-ui/badge";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import type { CanvasFlowNodeData } from "../foundation/CanvasViewport.js";
import type { ASSURANCE_STUDIO_COMPONENT_TYPES } from "../editing/schema.js";
import type { ArchitectureNodeData } from "./adapters.js";
import { useOptionalArchitectureSelection } from "./selection.js";

interface RichCanvasNodeData extends CanvasFlowNodeData {
  architecture?: ArchitectureNodeData;
}

type RichCanvasNode = Node<RichCanvasNodeData>;

type AssuranceStudioComponentType =
  (typeof ASSURANCE_STUDIO_COMPONENT_TYPES)[number];

interface ComponentIconDefinition {
  icon: IconSvgElement;
  name: string;
}

const COMPONENT_ICONS: Record<string, ComponentIconDefinition> &
  Record<AssuranceStudioComponentType, ComponentIconDefinition> = {
  firmware: { icon: MicrochipIcon, name: "Microchip" },
  software: { icon: SourceCodeIcon, name: "SourceCode" },
  hardware: { icon: LaptopIcon, name: "Laptop" },
  network: { icon: InternetIcon, name: "Internet" },
  cloud_service: { icon: CloudServerIcon, name: "CloudServer" },
  mobile_app: { icon: MobileProgrammingIcon, name: "MobileProgramming" },
  web_app: { icon: WebProgrammingIcon, name: "WebProgramming" },
  database: { icon: DatabaseIcon, name: "Database" },
  api: { icon: ApiIcon, name: "Api" },
  sensor: { icon: ViewIcon, name: "View" },
  actuator: { icon: ElectricPlugsIcon, name: "ElectricPlugs" },
  communication: { icon: ConnectIcon, name: "Connect" },
  external_service: { icon: CloudIcon, name: "Cloud" },
  medical_device: { icon: TestTube01Icon, name: "TestTube01" },
  other: { icon: QuestionIcon, name: "Question" },
};

const RETIRED_COMPONENT_ICONS: Record<string, ComponentIconDefinition> = {
  ecu: { icon: ComputerTerminal01Icon, name: "ComputerTerminal01" },
  hsm: { icon: LockIcon, name: "Lock" },
  tee: { icon: CloudIcon, name: "Cloud" },
};

const FALLBACK_COMPONENT_ICON: ComponentIconDefinition = {
  icon: CircleIcon,
  name: "Circle",
};

export function componentIcon(
  componentType: string | undefined,
): ComponentIconDefinition {
  if (!componentType) return FALLBACK_COMPONENT_ICON;
  if (Object.hasOwn(COMPONENT_ICONS, componentType)) {
    return COMPONENT_ICONS[componentType];
  }
  if (Object.hasOwn(RETIRED_COMPONENT_ICONS, componentType)) {
    return RETIRED_COMPONENT_ICONS[componentType];
  }
  return FALLBACK_COMPONENT_ICON;
}

export function ComponentTypeIcon({
  className,
  componentType,
}: {
  className?: string;
  componentType: string | undefined;
}): React.JSX.Element {
  const definition = componentIcon(componentType);
  return (
    <HugeiconsIcon
      aria-hidden="true"
      className={className}
      data-component-icon={definition.name}
      icon={definition.icon}
    />
  );
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
  icon: IconName | React.JSX.Element;
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
          {typeof icon === "string" ? (
            <Icon aria-hidden="true" className="size-4" name={icon} />
          ) : (
            icon
          )}
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
      icon={
        <ComponentTypeIcon
          className="size-4"
          componentType={architecture.componentType}
        />
      }
      selected={selected}
    >
      <Badge variant="secondary">
        <ComponentTypeIcon
          className="mr-1 size-3"
          componentType={architecture.componentType}
        />
        {architecture.componentType ?? "component"}
      </Badge>
      {architecture.isEntryPoint ? (
        <Badge variant="outline">Entry point</Badge>
      ) : null}
    </CanvasNodeFrame>
  );
}
