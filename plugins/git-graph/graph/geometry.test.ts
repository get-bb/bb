import { describe, expect, it } from "vitest";
import {
  edgeStrokes,
  GRAPH_MIN_WIDTH,
  GRAPH_PADDING_LEFT,
  graphColumnWidth,
  LANE_WIDTH,
  laneX,
  ROW_HEIGHT,
  rowCenterY,
} from "./geometry.js";
import {
  computeGraphEdges,
  computeGraphLayout,
  type LayoutCommit,
  type OpenGraphEdge,
} from "./layout.js";

type Point = [number, number];

interface CurveSegment {
  from: Point;
  control1: Point;
  control2: Point;
  to: Point;
}

function curveSegments(d: string): CurveSegment[] {
  const commands = d.match(/[MC][^MC]*/gu) ?? [];
  const segments: CurveSegment[] = [];
  let cursor: Point | null = null;
  for (const command of commands) {
    const values = command
      .slice(1)
      .split(/[\s,]+/u)
      .filter((value) => value.length > 0)
      .map(Number);
    if (command.startsWith("M")) {
      cursor = [values[0] ?? Number.NaN, values[1] ?? Number.NaN];
      continue;
    }
    if (cursor === null) throw new Error(`path has no start: ${d}`);
    const segment: CurveSegment = {
      from: cursor,
      control1: [values[0] ?? Number.NaN, values[1] ?? Number.NaN],
      control2: [values[2] ?? Number.NaN, values[3] ?? Number.NaN],
      to: [values[4] ?? Number.NaN, values[5] ?? Number.NaN],
    };
    segments.push(segment);
    cursor = segment.to;
  }
  return segments;
}

function anchors(d: string): Point[] {
  const segments = curveSegments(d);
  const first = segments[0];
  return first === undefined ? [] : [first.from, ...segments.map((s) => s.to)];
}

function at(lane: number, index: number): Point {
  return [laneX(lane), rowCenterY(index)];
}

function route(overrides: Partial<OpenGraphEdge>): OpenGraphEdge {
  return {
    fromHash: "child",
    toHash: "parent",
    fromIndex: 0,
    fromLane: 0,
    runLane: 0,
    colorIndex: 0,
    departColorIndex: 0,
    ...overrides,
  };
}

describe("graph column width", () => {
  it("fits every lane with a fixed left padding and never depends on the scroll window", () => {
    expect(graphColumnWidth(0)).toBe(GRAPH_MIN_WIDTH);
    expect(graphColumnWidth(9)).toBe(GRAPH_PADDING_LEFT + 10 * LANE_WIDTH);
    expect(graphColumnWidth(9)).toBe(laneX(9) + LANE_WIDTH / 2);
    for (let lane = 3; lane < 40; lane += 1) {
      expect(graphColumnWidth(lane + 1) - graphColumnWidth(lane)).toBe(
        LANE_WIDTH,
      );
    }
  });
});

describe("edgeStrokes", () => {
  it("links adjacent rows with one curve that leaves and enters dots vertically", () => {
    const strokes = edgeStrokes(route({ fromLane: 1, departColorIndex: 3 }), {
      index: 1,
      lane: 0,
    });
    expect(strokes).toHaveLength(1);
    expect(strokes[0]?.colorIndex).toBe(3);
    const [segment] = curveSegments(strokes[0]?.d ?? "");
    expect(segment?.from).toEqual(at(1, 0));
    expect(segment?.to).toEqual(at(0, 1));
    expect(segment?.control1[0]).toBe(laneX(1));
    expect(segment?.control2[0]).toBe(laneX(0));
  });

  it("keeps same-lane edges straight from dot center to dot center", () => {
    const strokes = edgeStrokes(route({ fromLane: 2, runLane: 2 }), {
      index: 9,
      lane: 2,
    });
    expect(strokes).toHaveLength(1);
    const points = anchors(strokes[0]?.d ?? "");
    expect(points[0]).toEqual(at(2, 0));
    expect(points.at(-1)).toEqual(at(2, 9));
    for (const segment of curveSegments(strokes[0]?.d ?? "")) {
      expect(segment.control1[0]).toBe(laneX(2));
      expect(segment.control2[0]).toBe(laneX(2));
    }
  });

  it("switches into the run lane within the first row, then runs straight to the parent", () => {
    const strokes = edgeStrokes(route({ fromLane: 2, runLane: 0 }), {
      index: 6,
      lane: 0,
    });
    expect(strokes).toHaveLength(1);
    expect(anchors(strokes[0]?.d ?? "")).toEqual([
      at(2, 0),
      at(0, 1),
      at(0, 6),
    ]);
  });

  it("joins a lower parent lane within the last row", () => {
    const strokes = edgeStrokes(
      route({ fromLane: 1, runLane: 1, colorIndex: 1, departColorIndex: 1 }),
      { index: 5, lane: 0 },
    );
    expect(strokes).toHaveLength(1);
    expect(strokes[0]?.colorIndex).toBe(1);
    expect(anchors(strokes[0]?.d ?? "")).toEqual([
      at(1, 0),
      at(1, 4),
      at(0, 5),
    ]);
  });

  it("gives two-row routes one row per lane change", () => {
    expect(
      anchors(
        edgeStrokes(route({ fromLane: 2, runLane: 1 }), {
          index: 2,
          lane: 0,
        })[0]?.d ?? "",
      ),
    ).toEqual([at(2, 0), at(1, 1), at(0, 2)]);
    expect(
      anchors(
        edgeStrokes(route({ fromLane: 1, runLane: 1 }), {
          index: 2,
          lane: 0,
        })[0]?.d ?? "",
      ),
    ).toEqual([at(1, 0), at(1, 1), at(0, 2)]);
  });

  it("splits a branch-off into the child's color and the joined run's color without a gap", () => {
    const strokes = edgeStrokes(
      route({ fromLane: 1, runLane: 0, colorIndex: 0, departColorIndex: 4 }),
      { index: 4, lane: 0 },
    );
    expect(strokes.map((stroke) => stroke.colorIndex)).toEqual([4, 0]);
    expect(anchors(strokes[0]?.d ?? "")).toEqual([at(1, 0), at(0, 1)]);
    expect(anchors(strokes[1]?.d ?? "")).toEqual([at(0, 1), at(0, 4)]);
  });

  it("extends open edges past the last loaded row", () => {
    const strokes = edgeStrokes(
      route({ fromIndex: 3, fromLane: 0, runLane: 1 }),
      { index: 5, lane: 1 },
    );
    const points = strokes.flatMap((stroke) => anchors(stroke.d));
    expect(points.at(-1)?.[1]).toBeGreaterThan(5 * ROW_HEIGHT);
    expect(points[0]).toEqual(at(0, 3));
  });

  it("starts and ends every edge of a merge history exactly on dot centers", () => {
    const commits: LayoutCommit[] = [
      { hash: "m2", parents: ["a3", "f2"] },
      { hash: "a3", parents: ["m1"] },
      { hash: "f2", parents: ["f1"] },
      { hash: "m1", parents: ["a2", "g1"] },
      { hash: "g1", parents: ["a1"] },
      { hash: "f1", parents: ["a1"] },
      { hash: "a2", parents: ["a1"] },
      { hash: "a1", parents: [] },
    ];
    const layout = computeGraphLayout(commits);
    const { edges } = computeGraphEdges(commits, layout);
    expect(edges).toHaveLength(9);
    for (const edge of edges) {
      const strokes = edgeStrokes(edge, {
        index: edge.toIndex,
        lane: edge.toLane,
      });
      const first = anchors(strokes[0]?.d ?? "");
      const last = anchors(strokes.at(-1)?.d ?? "");
      expect(first[0]).toEqual(at(edge.fromLane, edge.fromIndex));
      expect(last.at(-1)).toEqual(at(edge.toLane, edge.toIndex));
      for (let index = 1; index < strokes.length; index += 1) {
        expect(anchors(strokes[index]?.d ?? "")[0]).toEqual(
          anchors(strokes[index - 1]?.d ?? "").at(-1),
        );
      }
    }
  });
});
