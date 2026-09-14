import { useId } from "react";
import {
  DIM_OPACITY,
  DOT_RADIUS,
  edgeStrokes,
  FADE_TRANSITION,
  laneX,
  MERGE_HALO_OPACITY,
  MERGE_HALO_RADIUS,
  MERGE_HALO_STROKE_WIDTH,
  RING_RADIUS,
  RING_STROKE_WIDTH,
  ROW_HEIGHT,
  rowCenterY,
  STROKE_WIDTH,
  UNCOMMITTED_DASHARRAY,
  type EdgeEnd,
} from "../graph/geometry.js";
import type { GraphEdge, GraphLayout, OpenGraphEdge } from "../graph/layout.js";
import { laneColor } from "../graph/palette.js";

export type GraphNodeKind = "commit" | "merge" | "head" | "uncommitted";

const UNCOMMITTED_STROKE = "var(--muted-foreground)";

interface EdgeView {
  key: string;
  route: OpenGraphEdge;
  end: EdgeEnd;
  open: boolean;
  dimmed: boolean;
}

function fade(dimmed: boolean): { opacity: number; transition: string } {
  return { opacity: dimmed ? DIM_OPACITY : 1, transition: FADE_TRANSITION };
}

function isRing(kind: GraphNodeKind): boolean {
  return kind === "head" || kind === "uncommitted";
}

export function GraphLanes({
  layout,
  edges,
  openEdges,
  nodeKinds,
  renderFrom,
  renderTo,
  width,
  highlightChain,
}: {
  layout: GraphLayout;
  edges: readonly GraphEdge[];
  openEdges: readonly OpenGraphEdge[];
  nodeKinds: readonly GraphNodeKind[];
  renderFrom: number;
  renderTo: number;
  width: number;
  highlightChain: ReadonlySet<string> | null;
}) {
  const maskId = `git-graph-rings-${useId().replace(/[^A-Za-z0-9_-]/gu, "")}`;
  const totalRows = layout.rows.length;
  const height = totalRows * ROW_HEIGHT;
  const nodes = layout.rows.slice(renderFrom, renderTo).map((row, offset) => {
    const index = renderFrom + offset;
    const kind: GraphNodeKind = nodeKinds[index] ?? "commit";
    return { row, index, kind };
  });
  const ringNodes = nodes.filter((node) => isRing(node.kind));
  const ringHashes = new Set(ringNodes.map((node) => node.row.hash));
  const views: EdgeView[] = [
    ...edges
      .filter((edge) => edge.fromIndex < renderTo && edge.toIndex >= renderFrom)
      .map((edge) => ({
        key: `edge:${edge.fromHash}:${edge.toHash}`,
        route: edge,
        end: { index: edge.toIndex, lane: edge.toLane },
        open: false,
        dimmed:
          highlightChain !== null &&
          !(
            highlightChain.has(edge.fromHash) && highlightChain.has(edge.toHash)
          ),
      })),
    ...openEdges
      .filter((edge) => edge.fromIndex < renderTo)
      .map((edge) => ({
        key: `open:${edge.fromHash}:${edge.toHash}`,
        route: edge,
        end: { index: totalRows, lane: edge.runLane },
        open: true,
        dimmed: highlightChain !== null && !highlightChain.has(edge.fromHash),
      })),
  ];
  const touchesRing = (view: EdgeView): boolean =>
    ringHashes.has(view.route.fromHash) || ringHashes.has(view.route.toHash);

  const renderEdge = (view: EdgeView) => {
    const uncommitted = nodeKinds[view.route.fromIndex] === "uncommitted";
    return (
      <g
        key={view.key}
        data-from={view.route.fromHash}
        data-to={view.route.toHash}
        data-open={view.open ? "true" : undefined}
        data-dim={view.dimmed ? "true" : undefined}
        style={fade(view.dimmed)}
      >
        {edgeStrokes(view.route, view.end).map((stroke, strokeIndex) => (
          <path
            key={strokeIndex}
            d={stroke.d}
            fill="none"
            stroke={
              uncommitted ? UNCOMMITTED_STROKE : laneColor(stroke.colorIndex)
            }
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={uncommitted ? UNCOMMITTED_DASHARRAY : undefined}
          />
        ))}
      </g>
    );
  };

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="pointer-events-none absolute left-0 top-0 select-none"
      data-testid="git-graph-lanes"
      aria-hidden="true"
    >
      {ringNodes.length > 0 ? (
        <defs>
          <mask
            id={maskId}
            maskUnits="userSpaceOnUse"
            x={0}
            y={0}
            width={width}
            height={height}
          >
            <rect x={0} y={0} width={width} height={height} fill="white" />
            {ringNodes.map((node) => (
              <circle
                key={node.row.hash}
                cx={laneX(node.row.lane)}
                cy={rowCenterY(node.index)}
                r={RING_RADIUS - RING_STROKE_WIDTH / 2}
                fill="black"
              />
            ))}
          </mask>
        </defs>
      ) : null}
      {views.filter((view) => !touchesRing(view)).map(renderEdge)}
      {ringNodes.length > 0 ? (
        <g mask={`url(#${maskId})`}>
          {views.filter(touchesRing).map(renderEdge)}
        </g>
      ) : null}
      {nodes.map(({ row, index, kind }) => {
        const dimmed = highlightChain !== null && !highlightChain.has(row.hash);
        const cx = laneX(row.lane);
        const cy = rowCenterY(index);
        const color =
          kind === "uncommitted"
            ? UNCOMMITTED_STROKE
            : laneColor(row.colorIndex);
        return (
          <g
            key={row.hash}
            data-hash={row.hash}
            data-node-kind={kind}
            data-dim={dimmed ? "true" : undefined}
            style={fade(dimmed)}
          >
            {kind === "merge" ? (
              <circle
                cx={cx}
                cy={cy}
                r={MERGE_HALO_RADIUS}
                fill="none"
                stroke={color}
                strokeWidth={MERGE_HALO_STROKE_WIDTH}
                strokeOpacity={MERGE_HALO_OPACITY}
              />
            ) : null}
            {isRing(kind) ? (
              <circle
                cx={cx}
                cy={cy}
                r={RING_RADIUS}
                fill="none"
                stroke={color}
                strokeWidth={RING_STROKE_WIDTH}
              />
            ) : (
              <circle cx={cx} cy={cy} r={DOT_RADIUS} fill={color} />
            )}
          </g>
        );
      })}
    </svg>
  );
}
