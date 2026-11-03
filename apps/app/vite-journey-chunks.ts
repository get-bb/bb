import { resolve } from "node:path";

interface ModuleGraph {
  getModuleInfo(moduleId: string): { importedIds: readonly string[] } | null;
}

export interface JourneyChunk {
  name: string;
  entries: readonly string[];
}

export interface JourneyChunkGroup {
  name: (moduleId: string, graph: ModuleGraph) => string | null;
}

function firstPartyClosure(graph: ModuleGraph, entry: string): Set<string> {
  const seen = new Set<string>();
  const pending = [entry];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (seen.has(id) || id.startsWith("\0") || id.includes("/node_modules/")) {
      continue;
    }
    seen.add(id);
    const info = graph.getModuleInfo(id);
    if (info === null) {
      if (id === entry) throw new Error(`Missing journey entry ${entry}`);
      continue;
    }
    pending.push(...info.importedIds);
  }
  return seen;
}

export function assignJourneyChunks(
  graph: ModuleGraph,
  journeys: readonly JourneyChunk[],
): Map<string, string> {
  const closures = new Map<string, Set<string>>();
  const closureOf = (entry: string) => {
    let closure = closures.get(entry);
    if (closure === undefined) {
      closure = firstPartyClosure(graph, entry);
      closures.set(entry, closure);
    }
    return closure;
  };
  const assignment = new Map<string, string>();
  for (const journey of journeys) {
    const [first, ...rest] = journey.entries.map(closureOf);
    if (first === undefined) continue;
    for (const moduleId of first) {
      if (assignment.has(moduleId)) continue;
      if (rest.every((closure) => closure.has(moduleId))) {
        assignment.set(moduleId, journey.name);
      }
    }
  }
  return assignment;
}

export function journeyChunkGroups(
  rootDir: string,
  journeys: readonly JourneyChunk[],
): JourneyChunkGroup[] {
  const absolute = journeys.map((journey) => ({
    name: journey.name,
    entries: journey.entries.map((entry) => resolve(rootDir, entry)),
  }));
  let assignment: Map<string, string> | undefined;
  const chunkOf = (moduleId: string, graph: ModuleGraph) => {
    assignment ??= assignJourneyChunks(graph, absolute);
    return assignment.get(moduleId);
  };
  return journeys.map(({ name }) => ({
    name: (moduleId, graph) =>
      chunkOf(moduleId, graph) === name ? name : null,
  }));
}
