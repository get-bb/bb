import { curveBumpY, line } from "d3-shape";
import type { OpenGraphEdge } from "./layout.js";

export const ROW_HEIGHT = 22;
export const LANE_WIDTH = 15;
export const GRAPH_PADDING_LEFT = 6;
export const GRAPH_MIN_WIDTH = 44;
export const STROKE_WIDTH = 1.5;
export const DOT_RADIUS = 3.5;
export const RING_RADIUS = 4;
export const RING_STROKE_WIDTH = 1.75;
export const MERGE_HALO_RADIUS = 6.25;
export const MERGE_HALO_STROKE_WIDTH = 1;
export const MERGE_HALO_OPACITY = 0.5;
export const UNCOMMITTED_DASHARRAY = "2 3";
export const DIM_OPACITY = 0.2;
export const FADE_TRANSITION = "opacity 140ms ease";

type Point = [number, number];

export interface EdgeEnd {
  index: number;
  lane: number;
}

export interface EdgeStroke {
  d: string;
  colorIndex: number;
}

const bumpY = line<Point>().curve(curveBumpY);

export function laneX(lane: number): number {
  return GRAPH_PADDING_LEFT + lane * LANE_WIDTH + LANE_WIDTH / 2;
}

export function rowCenterY(index: number): number {
  return index * ROW_HEIGHT + ROW_HEIGHT / 2;
}

export function graphColumnWidth(maxLane: number): number {
  return Math.max(
    GRAPH_MIN_WIDTH,
    GRAPH_PADDING_LEFT + (maxLane + 1) * LANE_WIDTH,
  );
}

function lanePoint(lane: number, index: number): Point {
  return [laneX(lane), rowCenterY(index)];
}

function pathThrough(points: Point[]): string {
  return bumpY(points) ?? "";
}

export function edgeStrokes(route: OpenGraphEdge, end: EdgeEnd): EdgeStroke[] {
  const start = lanePoint(route.fromLane, route.fromIndex);
  const finish = lanePoint(end.lane, end.index);
  if (end.index - route.fromIndex <= 1) {
    return [
      { d: pathThrough([start, finish]), colorIndex: route.departColorIndex },
    ];
  }
  const departs = route.fromLane !== route.runLane;
  const joinsLate = end.lane !== route.runLane;
  const runStart = lanePoint(route.runLane, route.fromIndex + 1);
  const tail: Point[] =
    joinsLate && (!departs || end.index - route.fromIndex > 2)
      ? [lanePoint(route.runLane, end.index - 1), finish]
      : [finish];
  if (!departs) {
    return [{ d: pathThrough([start, ...tail]), colorIndex: route.colorIndex }];
  }
  if (route.departColorIndex === route.colorIndex) {
    return [
      {
        d: pathThrough([start, runStart, ...tail]),
        colorIndex: route.colorIndex,
      },
    ];
  }
  return [
    { d: pathThrough([start, runStart]), colorIndex: route.departColorIndex },
    { d: pathThrough([runStart, ...tail]), colorIndex: route.colorIndex },
  ];
}
