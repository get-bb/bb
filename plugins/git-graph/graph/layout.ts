import { LANE_COLOR_COUNT } from "./palette.js";

export interface LayoutCommit {
  hash: string;
  parents: readonly string[];
}

export interface LaneRun {
  lane: number;
  colorIndex: number;
}

export interface GraphRowLayout {
  hash: string;
  lane: number;
  colorIndex: number;
  parentRuns: ReadonlyArray<LaneRun>;
}

export interface GraphLayout {
  rows: ReadonlyArray<GraphRowLayout>;
  maxLane: number;
}

export interface OpenGraphEdge {
  fromHash: string;
  toHash: string;
  fromIndex: number;
  fromLane: number;
  runLane: number;
  colorIndex: number;
  departColorIndex: number;
}

export interface GraphEdge extends OpenGraphEdge {
  toIndex: number;
  toLane: number;
}

export interface GraphEdges {
  edges: ReadonlyArray<GraphEdge>;
  openEdges: ReadonlyArray<OpenGraphEdge>;
}

interface LaneSlot {
  target: string;
  colorIndex: number;
}

export function computeGraphLayout(
  commits: readonly LayoutCommit[],
): GraphLayout {
  const rows: GraphRowLayout[] = [];
  const lanes: Array<LaneSlot | null> = [];
  let colorCounter = 0;
  let maxLane = 0;

  const nextColorIndex = (): number => {
    const colorIndex = colorCounter % LANE_COLOR_COUNT;
    colorCounter += 1;
    return colorIndex;
  };

  const firstFreeLane = (): number => {
    const free = lanes.indexOf(null);
    return free >= 0 ? free : lanes.length;
  };

  const runsTargeting = (hash: string): LaneRun[] => {
    const runs: LaneRun[] = [];
    lanes.forEach((slot, lane) => {
      if (slot !== null && slot.target === hash) {
        runs.push({ lane, colorIndex: slot.colorIndex });
      }
    });
    return runs;
  };

  for (const commit of commits) {
    const incoming = runsTargeting(commit.hash);
    const dot: LaneRun = incoming[0] ?? {
      lane: firstFreeLane(),
      colorIndex: nextColorIndex(),
    };
    for (const run of incoming) {
      lanes[run.lane] = null;
    }

    const parentRuns = commit.parents.map((parent, ordinal): LaneRun => {
      const existing = runsTargeting(parent)[0];
      if (ordinal === 0) {
        if (existing !== undefined && existing.lane < dot.lane) {
          return existing;
        }
        lanes[dot.lane] = { target: parent, colorIndex: dot.colorIndex };
        return dot;
      }
      if (existing !== undefined) {
        return existing;
      }
      const run: LaneRun = {
        lane: firstFreeLane(),
        colorIndex: nextColorIndex(),
      };
      lanes[run.lane] = { target: parent, colorIndex: run.colorIndex };
      return run;
    });

    maxLane = Math.max(maxLane, dot.lane, ...parentRuns.map((run) => run.lane));
    rows.push({
      hash: commit.hash,
      lane: dot.lane,
      colorIndex: dot.colorIndex,
      parentRuns,
    });
  }

  return { rows, maxLane };
}

export function computeGraphEdges(
  commits: readonly LayoutCommit[],
  layout: GraphLayout,
): GraphEdges {
  const indexByHash = new Map(
    commits.map((commit, index) => [commit.hash, index] as const),
  );
  const edges: GraphEdge[] = [];
  const openEdges: OpenGraphEdge[] = [];
  layout.rows.forEach((row, fromIndex) => {
    const parents = commits[fromIndex]?.parents ?? [];
    row.parentRuns.forEach((run, ordinal) => {
      const toHash = parents[ordinal];
      if (toHash === undefined) return;
      const route: OpenGraphEdge = {
        fromHash: row.hash,
        toHash,
        fromIndex,
        fromLane: row.lane,
        runLane: run.lane,
        colorIndex: run.colorIndex,
        departColorIndex: ordinal === 0 ? row.colorIndex : run.colorIndex,
      };
      const toIndex = indexByHash.get(toHash);
      const parentRow =
        toIndex !== undefined && toIndex > fromIndex
          ? layout.rows[toIndex]
          : undefined;
      if (toIndex === undefined || parentRow === undefined) {
        openEdges.push(route);
        return;
      }
      edges.push({ ...route, toIndex, toLane: parentRow.lane });
    });
  });
  return { edges, openEdges };
}

export function restrictToLoadedParents(
  commits: readonly LayoutCommit[],
): LayoutCommit[] {
  const loaded = new Set(commits.map((commit) => commit.hash));
  return commits.map((commit) =>
    commit.parents.every((parent) => loaded.has(parent))
      ? commit
      : {
          hash: commit.hash,
          parents: commit.parents.filter((parent) => loaded.has(parent)),
        },
  );
}

export function ancestorsOf(
  commits: readonly LayoutCommit[],
  hash: string,
): Set<string> {
  const parentsByHash = new Map(
    commits.map((commit) => [commit.hash, commit.parents] as const),
  );
  const seen = new Set<string>([hash]);
  const stack = [hash];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    const parents = parentsByHash.get(current);
    if (parents === undefined) continue;
    for (const parent of parents) {
      if (!seen.has(parent)) {
        seen.add(parent);
        stack.push(parent);
      }
    }
  }
  return seen;
}
