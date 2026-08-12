import { runElkLayout } from "./elk-worker.js";
import type { LayoutRequest } from "./types.js";

export interface LayoutDensityMeasurement {
  nodeCount: number;
  edgesPerNode: number;
  edgeCount: number;
  firstMs: number;
  warmRunsMs: number[];
  warmMedianMs: number;
  warmP95Ms: number;
}

export function connectedDensityFixture(
  nodeCount: number,
  edgesPerNode: number,
): LayoutRequest {
  if (!Number.isInteger(nodeCount) || nodeCount < 2) {
    throw new Error("nodeCount must be an integer of at least 2");
  }
  if (
    !Number.isInteger(edgesPerNode) ||
    edgesPerNode < 1 ||
    edgesPerNode >= nodeCount
  ) {
    throw new Error("edgesPerNode must be between 1 and nodeCount - 1");
  }

  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    id: `node-${index}`,
    width: 216,
    height: 112,
  }));
  const edges: LayoutRequest["edges"] = [];

  for (let sourceIndex = 0; sourceIndex < nodeCount; sourceIndex += 1) {
    const targets = new Set<number>();
    for (let edgeIndex = 0; edgeIndex < edgesPerNode; edgeIndex += 1) {
      let targetIndex =
        edgeIndex === 0
          ? (sourceIndex + 1) % nodeCount
          : (sourceIndex * 17 + edgeIndex * 53 + 31) % nodeCount;
      while (targetIndex === sourceIndex || targets.has(targetIndex)) {
        targetIndex = (targetIndex + 1) % nodeCount;
      }
      targets.add(targetIndex);
      edges.push({
        source: `node-${sourceIndex}`,
        target: `node-${targetIndex}`,
      });
    }
  }

  return { nodes, edges, direction: "RIGHT" };
}

function percentile(sorted: readonly number[], ratio: number): number {
  const index = Math.ceil(sorted.length * ratio) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

export async function benchmarkLayoutDensity(
  nodeCount: number,
  edgesPerNode: number,
  warmRunCount = 5,
): Promise<LayoutDensityMeasurement> {
  if (!Number.isInteger(warmRunCount) || warmRunCount < 1) {
    throw new Error("warmRunCount must be a positive integer");
  }
  const fixture = connectedDensityFixture(nodeCount, edgesPerNode);
  const first = await runElkLayout(fixture);
  const warmRunsMs: number[] = [];
  for (let index = 0; index < warmRunCount; index += 1) {
    warmRunsMs.push((await runElkLayout(fixture)).durationMs);
  }
  const sorted = [...warmRunsMs].sort((left, right) => left - right);
  return {
    nodeCount,
    edgesPerNode,
    edgeCount: fixture.edges.length,
    firstMs: first.durationMs,
    warmRunsMs,
    warmMedianMs: percentile(sorted, 0.5),
    warmP95Ms: percentile(sorted, 0.95),
  };
}
