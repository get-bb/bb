import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { Icon } from "@bb/shared-ui/icon";
import type { CanvasEdgeModel } from "../foundation/types.js";
import type { ArchitectureEdgeData } from "./adapters.js";
import { useArchitectureSelection } from "./selection.js";

interface RichEdgeData extends Record<string, unknown> {
  architecture?: ArchitectureEdgeData;
  model?: CanvasEdgeModel;
}

type RichEdge = Edge<RichEdgeData>;

function architectureData(
  id: string,
  data: RichEdgeData | undefined,
): ArchitectureEdgeData {
  if (data?.architecture) return data.architecture;
  const model = data?.model;
  return {
    slug: id,
    sourceSlug: model?.source ?? "unresolved-source",
    targetSlug: model?.target ?? "unresolved-target",
    protocol: model?.protocol ?? undefined,
    encrypted: model?.encrypted ?? false,
    authenticated: model?.authenticated ?? false,
    bidirectional: false,
    sourceFile: `product-security/architecture/dataflows/${id}.yaml`,
    name: model?.label ?? id,
  };
}

export function DataflowEdge({
  id,
  data,
  markerEnd,
  markerStart,
  selected,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps<RichEdge>): React.JSX.Element {
  const selection = useArchitectureSelection();
  const flow = architectureData(id, data);
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  return (
    <>
      <BaseEdge
        id={id}
        markerEnd={markerEnd}
        markerStart={markerStart}
        path={path}
        style={{
          stroke: selected ? "var(--primary)" : "var(--muted-foreground)",
          strokeWidth: selected ? 2.5 : 1.5,
        }}
      />
      <EdgeLabelRenderer>
        <button
          aria-label={`Dataflow ${flow.name ?? flow.slug}: ${flow.sourceSlug} to ${flow.targetSlug}`}
          className="nodrag nopan absolute flex max-w-64 -translate-x-1/2 -translate-y-1/2 flex-wrap items-center gap-1 rounded-md border border-border bg-card/95 px-2 py-1 text-xs text-card-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-canvas-edge-id={flow.slug}
          onClick={() => {
            selection.setSelectedIds([flow.slug]);
            selection.onFocusRoute("edge", flow.slug);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            selection.openMenu({
              targetId: flow.slug,
              targetKind: "edge",
              x: event.clientX,
              y: event.clientY,
            });
          }}
          style={{ left: labelX, top: labelY }}
          type="button"
        >
          <span className="font-medium">
            {flow.protocol ?? flow.name ?? flow.slug}
          </span>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Icon aria-hidden="true" className="size-3" name="ArrowRight" />
            {flow.bidirectional ? "Bidirectional" : "One way"}
          </span>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Icon aria-hidden="true" className="size-3" name="Lock" />
            {flow.encrypted ? "Encrypted" : "Unencrypted"}
          </span>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Icon aria-hidden="true" className="size-3" name="CircleCheck" />
            {flow.authenticated ? "Authenticated" : "Unauthenticated"}
          </span>
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
