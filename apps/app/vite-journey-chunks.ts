import { basename, extname, resolve } from "node:path";
import { normalizePath, parseAst } from "vite";

interface ModuleGraphInfo {
  code: string | null;
  exports: readonly string[];
  importedIds: readonly string[];
}

interface ModuleGraph {
  getModuleInfo(moduleId: string): ModuleGraphInfo | null;
}

export interface JourneyChunk {
  name: string;
  entries: readonly string[];
}

export interface JourneyChunkGroup {
  name: (moduleId: string, graph: ModuleGraph) => string | null;
}

const EVERY_NAME = "*";
const ALL_NAMES: ReadonlySet<string> = new Set([EVERY_NAME]);

type SourceEdge =
  | { kind: "import"; names: ReadonlySet<string> }
  | { kind: "reexport"; locals: ReadonlyMap<string, string> }
  | { kind: "star" }
  | { kind: "namespace"; name: string };

type Edge = SourceEdge & { target: string };

interface ExportName {
  type: string;
  name?: string;
  value?: unknown;
}

function exportNameOf(node: ExportName): string {
  if (typeof node.name === "string") return node.name;
  if (typeof node.value === "string") return node.value;
  throw new Error(`Unsupported export name node ${node.type}`);
}

function sourceEdges(code: string): Map<string, SourceEdge[]> | null {
  let program;
  try {
    program = parseAst(code);
  } catch {
    return null;
  }
  const bySource = new Map<string, SourceEdge[]>();
  const add = (source: string, edge: SourceEdge) => {
    const edges = bySource.get(source);
    if (edges === undefined) bySource.set(source, [edge]);
    else edges.push(edge);
  };
  for (const node of program.body) {
    if (node.type === "ImportDeclaration") {
      const names = new Set<string>();
      for (const specifier of node.specifiers) {
        if (specifier.type === "ImportSpecifier") {
          names.add(exportNameOf(specifier.imported));
        } else if (specifier.type === "ImportDefaultSpecifier") {
          names.add("default");
        } else {
          names.add(EVERY_NAME);
        }
      }
      add(node.source.value, {
        kind: "import",
        names: names.size === 0 ? ALL_NAMES : names,
      });
    } else if (node.type === "ExportNamedDeclaration" && node.source) {
      const locals = new Map<string, string>();
      for (const specifier of node.specifiers) {
        locals.set(
          exportNameOf(specifier.exported),
          exportNameOf(specifier.local),
        );
      }
      add(node.source.value, { kind: "reexport", locals });
    } else if (node.type === "ExportAllDeclaration") {
      add(
        node.source.value,
        node.exported === null
          ? { kind: "star" }
          : { kind: "namespace", name: exportNameOf(node.exported) },
      );
    }
  }
  return bySource;
}

function specifierNamesModule(specifier: string, moduleId: string): boolean {
  const segments = specifier.split("/").filter((segment) => segment !== "");
  const last = segments.at(-1);
  if (last === undefined || last === "." || last === "..") return true;
  const stem = basename(last, extname(last));
  return stem === "" || moduleId.includes(stem);
}

function moduleEdges(info: ModuleGraphInfo): Edge[] {
  const conservative = info.importedIds.map(
    (target): Edge => ({ kind: "import", target, names: ALL_NAMES }),
  );
  if (info.code === null) return conservative;
  const bySource = sourceEdges(info.code);
  if (bySource === null) return conservative;
  const sources = [...bySource.keys()];
  if (
    sources.length !== info.importedIds.length ||
    !sources.every((source, index) =>
      specifierNamesModule(source, info.importedIds[index] ?? ""),
    )
  ) {
    return conservative;
  }
  return sources.flatMap((source, index) => {
    const target = info.importedIds[index] ?? "";
    return (bySource.get(source) ?? []).map(
      (edge): Edge => ({ ...edge, target }),
    );
  });
}

function requests(names: ReadonlySet<string>, name: string): boolean {
  return names.has(EVERY_NAME) || names.has(name);
}

function newNames(
  requested: ReadonlySet<string> | undefined,
  names: ReadonlySet<string>,
): ReadonlySet<string> {
  if (requested === undefined) return names;
  if (requested.has(EVERY_NAME)) return new Set();
  if (names.has(EVERY_NAME)) return ALL_NAMES;
  return new Set([...names].filter((name) => !requested.has(name)));
}

function firstPartyClosure(
  graph: ModuleGraph,
  edgesOf: (moduleId: string, info: ModuleGraphInfo) => Edge[],
  entry: string,
): Set<string> {
  const requested = new Map<string, Set<string>>();
  const pending: [string, ReadonlySet<string>][] = [[entry, ALL_NAMES]];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const [id, names] = next;
    if (id.startsWith("\0") || id.includes("/node_modules/")) continue;
    const previous = requested.get(id);
    const added = newNames(previous, names);
    if (previous !== undefined && added.size === 0) continue;
    if (previous === undefined) requested.set(id, new Set(added));
    else for (const name of added) previous.add(name);
    const info = graph.getModuleInfo(id);
    if (info === null) {
      if (id === entry) throw new Error(`Missing journey entry ${entry}`);
      continue;
    }
    for (const edge of edgesOf(id, info)) {
      if (edge.kind === "import") {
        if (previous === undefined) pending.push([edge.target, edge.names]);
      } else if (edge.kind === "reexport") {
        const forwarded = new Set<string>();
        for (const [exported, local] of edge.locals) {
          if (requests(added, exported)) forwarded.add(local);
        }
        if (forwarded.size > 0) pending.push([edge.target, forwarded]);
      } else if (edge.kind === "namespace") {
        if (requests(added, edge.name)) pending.push([edge.target, ALL_NAMES]);
      } else if (added.has(EVERY_NAME)) {
        pending.push([edge.target, ALL_NAMES]);
      } else {
        const exported = graph.getModuleInfo(edge.target)?.exports;
        const forwarded = new Set(
          [...added].filter(
            (name) =>
              name !== "default" &&
              (exported === undefined || exported.includes(name)),
          ),
        );
        if (forwarded.size > 0) pending.push([edge.target, forwarded]);
      }
    }
  }
  return new Set(requested.keys());
}

export function assignJourneyChunks(
  graph: ModuleGraph,
  journeys: readonly JourneyChunk[],
): Map<string, string> {
  const edges = new Map<string, Edge[]>();
  const edgesOf = (moduleId: string, info: ModuleGraphInfo) => {
    let moduleEdgeList = edges.get(moduleId);
    if (moduleEdgeList === undefined) {
      moduleEdgeList = moduleEdges(info);
      edges.set(moduleId, moduleEdgeList);
    }
    return moduleEdgeList;
  };
  const closures = new Map<string, Set<string>>();
  const closureOf = (entry: string) => {
    let closure = closures.get(entry);
    if (closure === undefined) {
      closure = firstPartyClosure(graph, edgesOf, entry);
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
    entries: journey.entries.map((entry) =>
      normalizePath(resolve(rootDir, entry)),
    ),
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
