import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const appDir = dirname(fileURLToPath(import.meta.url));

export interface BundleBootChunk {
  fileName: string;
  bytes: number;
  /** npm package names whose code landed in this chunk. */
  packages: string[];
}

export interface BundleChunk extends BundleBootChunk {
  /** Chunks this one imports statically (its `import` edges, not `import()`). */
  imports: string[];
  /**
   * The app-relative source module this chunk was created for (an entry or a
   * dynamic-import target), or null for a shared chunk Rolldown split out.
   */
  facade: string | null;
}

/**
 * The static-import closure of one lazy route chunk, minus the chunks that
 * are already on the boot path. This is the JavaScript that must arrive
 * between "app shell painted" and "route content painted".
 */
export interface BundleRouteClosure {
  /** The route's own chunk (the target of App's `lazy(() => import(...))`). */
  entry: string;
  chunks: BundleBootChunk[];
}

export interface BundleStats {
  entry: string;
  bootChunks: BundleBootChunk[];
  /** Every JS chunk in the build, so checks can reason about lazy closures too. */
  chunks: BundleChunk[];
  routeClosures: Record<string, BundleRouteClosure>;
}

/**
 * Lazy routes whose static closure the budget check ratchets, keyed by the
 * name used in bundle-budget.json. The value is the route module's source
 * path suffix, matched against the output chunk's `facadeModuleId`.
 */
export const MEASURED_ROUTE_CLOSURES: Record<string, string> = {
  SplitWorkspaceRoute: "/src/views/SplitWorkspaceRoute.tsx",
};

/**
 * A minimal view of Rollup's output bundle: enough for the closure walk, and
 * simple enough for a test to hand-build.
 */
export interface BundleStatsChunkInput {
  fileName: string;
  isEntry: boolean;
  facadeModuleId: string | null;
  imports: readonly string[];
  moduleIds: readonly string[];
  code: string;
}

/**
 * Computes the boot payload (the entry chunk plus its static-import closure),
 * the full chunk graph (static edges only, so the budget check can verify that
 * on-demand packages such as KaTeX are only ever reached through a dynamic
 * `import()`), and, for each measured lazy route, the route chunk's static
 * closure minus the boot chunks. Returns null when the bundle has no entry
 * chunk.
 */
export function computeBundleStats(
  chunks: readonly BundleStatsChunkInput[],
  measuredRouteClosures: Record<string, string>,
  warn: (message: string) => void,
): BundleStats | null {
  const byFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const entry = chunks.find((chunk) => chunk.isEntry);
  if (entry === undefined) return null;

  const staticClosure = (
    startFileName: string,
    skip: ReadonlySet<string>,
  ): Set<string> => {
    const closure = new Set<string>();
    const walk = (fileName: string): void => {
      if (closure.has(fileName) || skip.has(fileName)) return;
      closure.add(fileName);
      const chunk = byFileName.get(fileName);
      if (chunk === undefined) return;
      for (const imported of chunk.imports) walk(imported);
    };
    walk(startFileName);
    return closure;
  };

  const describeChunk = (chunk: BundleStatsChunkInput): BundleBootChunk => {
    const packages = new Set<string>();
    for (const moduleId of chunk.moduleIds) {
      const name = packageNameOf(moduleId);
      if (name !== null) packages.add(name);
    }
    return {
      fileName: chunk.fileName,
      bytes: Buffer.byteLength(chunk.code),
      packages: [...packages].sort(),
    };
  };

  const describeChunks = (
    fileNames: ReadonlySet<string>,
  ): BundleBootChunk[] => {
    const described: BundleBootChunk[] = [];
    for (const fileName of [...fileNames].sort()) {
      const chunk = byFileName.get(fileName);
      if (chunk === undefined) continue;
      described.push(describeChunk(chunk));
    }
    return described;
  };

  const bootFileNames = staticClosure(entry.fileName, new Set());
  const bootChunks = describeChunks(bootFileNames);

  const allChunks: BundleChunk[] = [];
  for (const chunk of [...chunks].sort((a, b) =>
    a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0,
  )) {
    allChunks.push({
      ...describeChunk(chunk),
      imports: [...chunk.imports].sort(),
      facade:
        chunk.facadeModuleId === null
          ? null
          : relative(appDir, chunk.facadeModuleId).split(sep).join("/"),
    });
  }

  const routeClosures: Record<string, BundleRouteClosure> = {};
  for (const [name, sourceSuffix] of Object.entries(measuredRouteClosures)) {
    const routeChunk = chunks.find(
      (chunk) =>
        chunk.facadeModuleId !== null &&
        chunk.facadeModuleId.endsWith(sourceSuffix),
    );
    if (routeChunk === undefined) {
      warn(
        `no chunk has facadeModuleId ending in ${sourceSuffix}; the ${name} route closure is not recorded`,
      );
      continue;
    }
    routeClosures[name] = {
      entry: routeChunk.fileName,
      chunks: describeChunks(staticClosure(routeChunk.fileName, bootFileNames)),
    };
  }

  return {
    entry: entry.fileName,
    bootChunks,
    chunks: allChunks,
    routeClosures,
  };
}

/**
 * Writes `bundle-stats.json` describing the boot payload: the entry chunk and
 * its static-import closure, with the npm packages each one contains — plus
 * the full chunk graph (static edges only), so the budget check can also
 * verify that on-demand packages such as KaTeX are only ever reached through a
 * dynamic `import()`. Also records the static closure of each measured lazy
 * route, minus the boot chunks, so the thread route's payload is ratcheted
 * like the boot payload.
 *
 * scripts/check-bundle-budget.mjs reads this instead of pattern-matching
 * minified output, so the budget check knows exactly which packages block
 * first paint.
 */
export function bundleStats(): Plugin {
  return {
    name: "bb:bundle-stats",
    apply: "build",
    async writeBundle(_options, bundle) {
      const chunks: BundleStatsChunkInput[] = [];
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        chunks.push({
          fileName: output.fileName,
          isEntry: output.isEntry,
          facadeModuleId: output.facadeModuleId,
          imports: output.imports,
          moduleIds: output.moduleIds ?? [],
          code: output.code,
        });
      }
      const stats = computeBundleStats(
        chunks,
        MEASURED_ROUTE_CLOSURES,
        (message) => this.warn(message),
      );
      if (stats === null) return;
      const target = resolve(appDir, "bundle-stats.json");
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `${JSON.stringify(stats, null, 2)}\n`);
    },
  };
}

/** `.../node_modules/@scope/name/dist/x.js` -> `@scope/name`; app code -> null. */
function packageNameOf(moduleId: string): string | null {
  const marker = moduleId.lastIndexOf("node_modules/");
  if (marker < 0) return null;
  const segments = moduleId.slice(marker + "node_modules/".length).split("/");
  const [first, second] = segments;
  if (first === undefined) return null;
  if (first.startsWith("@"))
    return second === undefined ? null : `${first}/${second}`;
  return first;
}
