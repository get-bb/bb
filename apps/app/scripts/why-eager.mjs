#!/usr/bin/env node
// Answers "why does this module load before first paint?".
//
// Rolldown gives every chunk a modulepreload link when the entry can reach it
// through static imports only. This script rebuilds the app with a plugin that
// dumps the real module graph, walks it from the entry without crossing
// dynamic-import edges, and prints the shortest eager chain to each target.
//
// Usage: node scripts/why-eager.mjs <substring> [<substring> ...]
import { build, loadConfigFromFile } from "vite";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error("usage: node scripts/why-eager.mjs <substring> [...]");
  process.exit(1);
}

// Loaded through Vite rather than a bare import(): vite.config.ts is
// TypeScript and its sibling plugins use extensionless-to-.js specifiers that
// only a bundler resolves. Node would exit with ERR_MODULE_NOT_FOUND.
const loaded = await loadConfigFromFile(
  { command: "build", mode: "production" },
  path.join(appDir, "vite.config.ts"),
  appDir,
);
if (loaded === null) {
  console.error("could not load apps/app/vite.config.ts");
  process.exit(1);
}
const sharedViteConfig = loaded.config;

/** id -> { static: string[], dynamic: string[] } */
const graph = new Map();
let entryId = null;

const dumpGraph = {
  name: "bb:dump-module-graph",
  buildEnd() {
    for (const id of this.getModuleIds()) {
      const info = this.getModuleInfo(id);
      if (!info) continue;
      graph.set(id, {
        static: info.importedIds ?? [],
        dynamic: info.dynamicallyImportedIds ?? [],
      });
      if (info.isEntry) entryId = id;
    }
  },
};

await build({
  ...sharedViteConfig,
  root: appDir,
  logLevel: "error",
  plugins: [...sharedViteConfig.plugins, dumpGraph],
  build: {
    ...sharedViteConfig.build,
    write: false,
    outDir: "dist-graph",
  },
});

const rel = (id) => path.relative(path.resolve(appDir, "../.."), id).replace(/^\.\.\//, "");

// Breadth-first over static edges only: the first time we reach a module is the
// shortest eager chain to it.
const parent = new Map([[entryId, null]]);
const queue = [entryId];
while (queue.length > 0) {
  const id = queue.shift();
  for (const next of graph.get(id)?.static ?? []) {
    if (parent.has(next)) continue;
    parent.set(next, id);
    queue.push(next);
  }
}

const chainTo = (id) => {
  const chain = [];
  for (let cur = id; cur != null; cur = parent.get(cur)) chain.push(rel(cur));
  return chain.reverse();
};

console.log(`entry: ${rel(entryId)}`);
console.log(`modules in graph: ${graph.size}, statically reachable: ${parent.size}\n`);

for (const target of targets) {
  const hits = [...parent.keys()].filter((id) => id.includes(target));
  console.log(`### ${target}: ${hits.length} eagerly reachable module(s)`);
  if (hits.length === 0) {
    const anywhere = [...graph.keys()].filter((id) => id.includes(target));
    console.log(
      anywhere.length === 0
        ? "  not in the build at all\n"
        : `  only reachable behind a dynamic import (${anywhere.length} modules) — already lazy\n`,
    );
    continue;
  }
  // Show the shortest chain overall; that is the edge worth cutting.
  hits.sort((a, b) => chainTo(a).length - chainTo(b).length);
  const chain = chainTo(hits[0]);
  console.log(`  shortest chain (${chain.length} hops):`);
  for (const [i, step] of chain.entries()) console.log(`    ${String(i).padStart(2)}. ${step}`);
  // The last app-owned file before the dependency is where the cut goes.
  const cutIndex = chain.findLastIndex((step) => !step.includes("node_modules"));
  console.log(`  cut point: ${chain[cutIndex]} -> ${chain[cutIndex + 1] ?? "(self)"}\n`);
}
