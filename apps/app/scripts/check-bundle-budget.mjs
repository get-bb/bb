#!/usr/bin/env node
// Fails when the boot payload grows past bundle-budget.json, when a heavy
// package that should load on demand reaches the boot path again, or when an
// on-demand package leaks out of its dynamic-import gate into some other
// chunk's static import closure. Applies the same ratchet to each measured
// lazy route closure (the JavaScript between "app shell painted" and "route
// content painted").
//
// Run after `pnpm build` in apps/app. Reads bundle-stats.json (written by the
// bb:bundle-stats Vite plugin) and the brotli files written by
// scripts/precompress-app-dist.mjs.
//
// Usage: check-bundle-budget.mjs [distDir] [budgetDir]
//   distDir   defaults to apps/app/dist
//   budgetDir directory holding bundle-stats.json and bundle-budget.json;
//             defaults to apps/app (tests point it at a fixture directory)
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.resolve(appDir, process.argv[2] ?? "dist");
const budgetDir = path.resolve(appDir, process.argv[3] ?? ".");
const statsPath = path.join(budgetDir, "bundle-stats.json");
const budgetPath = path.join(budgetDir, "bundle-budget.json");

const die = (message) => {
  console.error(message);
  process.exit(1);
};

if (!fs.existsSync(statsPath)) {
  die(`missing ${path.relative(appDir, statsPath)} — run the app build first`);
}
if (!fs.existsSync(budgetPath)) {
  die(`missing ${path.relative(appDir, budgetPath)}`);
}
if (!fs.existsSync(distDir)) {
  die(`missing ${path.relative(appDir, distDir)} — run the app build first`);
}

const stats = JSON.parse(fs.readFileSync(statsPath, "utf8"));
const budget = JSON.parse(fs.readFileSync(budgetPath, "utf8"));

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const failures = [];
const MIN_PRECOMPRESS_BYTES = 1024;

/**
 * Sums a chunk list's raw and brotli bytes and finds forbidden packages.
 *
 * A chunk with no .br file would otherwise weigh zero against the compressed
 * budget, so an unrun precompression step could hide real growth. Treat it as
 * an error rather than guessing a size.
 */
function measureClosure(chunks, forbiddenPackages, brotliSizeOf) {
  const forbidden = new Set(forbiddenPackages);
  const offenders = new Map();
  const missingBrotli = [];
  let bytes = 0;
  let brotliBytes = 0;
  for (const chunk of chunks) {
    bytes += chunk.bytes;
    const brotliSize = brotliSizeOf(chunk.fileName);
    if (brotliSize !== null) {
      brotliBytes += brotliSize;
    } else if (chunk.bytes < MIN_PRECOMPRESS_BYTES) {
      // precompress-app-dist intentionally skips sub-1 KiB assets. Counting the
      // raw bytes is a conservative upper bound for those tiny chunks.
      brotliBytes += chunk.bytes;
    } else {
      missingBrotli.push(chunk.fileName);
    }
    for (const pkg of chunk.packages) {
      if (!forbidden.has(pkg)) continue;
      if (!offenders.has(pkg)) offenders.set(pkg, []);
      offenders.get(pkg).push(chunk.fileName);
    }
  }
  return { bytes, brotliBytes, missingBrotli, offenders };
}

const brotliSizeOf = (fileName) => {
  const brotliPath = path.join(distDir, `${fileName}.br`);
  return fs.existsSync(brotliPath) ? fs.statSync(brotliPath).size : null;
};

const boot = measureClosure(
  stats.bootChunks,
  budget.forbiddenBootPackages,
  brotliSizeOf,
);

// On-demand packages may enter the graph only through their named gate: the
// module a dynamic import() resolves to (its chunk's facade). Every chunk whose
// static-import closure contains the package must sit inside the gate chunk's
// own static closure. A static edge from anywhere else (say, markdown-preview)
// into a chunk holding the package would download it whenever the importer
// loads, whether or not the content ever needs it — and would show up here as
// a chunk outside the gate's closure that still reaches the package.
const chunksByFile = new Map(
  stats.chunks.map((chunk) => [chunk.fileName, chunk]),
);
const staticClosureOf = (fileName) => {
  const closure = new Set();
  const walk = (file) => {
    if (closure.has(file)) return;
    closure.add(file);
    for (const imported of chunksByFile.get(file)?.imports ?? [])
      walk(imported);
  };
  walk(fileName);
  return closure;
};
const closureHasPackage = (fileName, pkg) => {
  for (const file of staticClosureOf(fileName)) {
    if (chunksByFile.get(file)?.packages.includes(pkg)) return true;
  }
  return false;
};
const onDemandFailures = [];
for (const [pkg, gateModule] of Object.entries(budget.onDemandPackages ?? {})) {
  const gates = stats.chunks.filter((chunk) => chunk.facade === gateModule);
  if (gates.length === 0) {
    onDemandFailures.push(
      `${pkg} has no gate chunk for ${gateModule}: the module is missing, renamed, or no longer a dynamic import() target.`,
    );
    continue;
  }
  const allowed = new Set();
  for (const gate of gates) {
    for (const file of staticClosureOf(gate.fileName)) allowed.add(file);
  }
  const leaks = stats.chunks
    .filter(
      (chunk) =>
        !allowed.has(chunk.fileName) && closureHasPackage(chunk.fileName, pkg),
    )
    .map((chunk) => chunk.fileName);
  if (leaks.length > 0) {
    onDemandFailures.push(
      `${pkg} is in the static import closure of ${leaks.join(", ")}, outside its gate ${gateModule}. It must load only behind that dynamic import().`,
    );
  }
}

console.log(
  `boot payload: ${kb(boot.bytes)} raw / ${kb(boot.brotliBytes)} brotli`,
);
console.log(
  `  budget:     ${kb(budget.maxBootBytes)} raw / ${kb(budget.maxBootBrotliBytes)} brotli`,
);
console.log(`  chunks:     ${stats.bootChunks.length}`);

if (boot.missingBrotli.length > 0) {
  failures.push(
    `${boot.missingBrotli.length} boot chunk(s) have no .br file, so the compressed total is understated: ${boot.missingBrotli.join(", ")}. Run scripts/precompress-app-dist.mjs.`,
  );
}
if (boot.bytes > budget.maxBootBytes) {
  failures.push(
    `boot payload is ${kb(boot.bytes)}, over the ${kb(budget.maxBootBytes)} raw budget by ${kb(boot.bytes - budget.maxBootBytes)}.`,
  );
}
if (boot.brotliBytes > budget.maxBootBrotliBytes) {
  failures.push(
    `boot payload is ${kb(boot.brotliBytes)} brotli, over the ${kb(budget.maxBootBrotliBytes)} budget by ${kb(boot.brotliBytes - budget.maxBootBrotliBytes)}.`,
  );
}
for (const [pkg, chunks] of boot.offenders) {
  failures.push(
    `${pkg} is in the boot payload (${chunks.join(", ")}). It must load on demand.`,
  );
}
failures.push(...onDemandFailures);

const failingRouteChunkLists = [];
for (const [routeName, routeBudget] of Object.entries(
  budget.routeClosures ?? {},
)) {
  const closure = stats.routeClosures?.[routeName];
  if (closure === undefined) {
    failures.push(
      `bundle-stats.json has no "${routeName}" route closure. Add it to MEASURED_ROUTE_CLOSURES in vite-bundle-stats.ts or remove it from bundle-budget.json.`,
    );
    continue;
  }
  const route = measureClosure(
    closure.chunks,
    routeBudget.forbiddenPackages,
    brotliSizeOf,
  );
  console.log(
    `\n${routeName} closure: ${kb(route.bytes)} raw / ${kb(route.brotliBytes)} brotli`,
  );
  console.log(
    `  budget:     ${kb(routeBudget.maxBytes)} raw / ${kb(routeBudget.maxBrotliBytes)} brotli`,
  );
  console.log(
    `  chunks:     ${closure.chunks.length} (beyond the boot payload)`,
  );

  const routeFailures = [];
  if (route.missingBrotli.length > 0) {
    routeFailures.push(
      `${route.missingBrotli.length} ${routeName} chunk(s) have no .br file, so the compressed total is understated: ${route.missingBrotli.join(", ")}. Run scripts/precompress-app-dist.mjs.`,
    );
  }
  if (route.bytes > routeBudget.maxBytes) {
    routeFailures.push(
      `${routeName} closure is ${kb(route.bytes)}, over the ${kb(routeBudget.maxBytes)} raw budget by ${kb(route.bytes - routeBudget.maxBytes)}.`,
    );
  }
  if (route.brotliBytes > routeBudget.maxBrotliBytes) {
    routeFailures.push(
      `${routeName} closure is ${kb(route.brotliBytes)} brotli, over the ${kb(routeBudget.maxBrotliBytes)} budget by ${kb(route.brotliBytes - routeBudget.maxBrotliBytes)}.`,
    );
  }
  for (const [pkg, chunks] of route.offenders) {
    routeFailures.push(
      `${pkg} is in the ${routeName} closure (${chunks.join(", ")}). It must load on demand (behind React.lazy or import()).`,
    );
  }
  if (routeFailures.length > 0) {
    failures.push(...routeFailures);
    failingRouteChunkLists.push([routeName, closure.chunks]);
  }
}

if (failures.length > 0) {
  console.error("\nBundle budget failed:\n");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("\nBoot chunks, largest first:");
  for (const chunk of [...stats.bootChunks].sort((a, b) => b.bytes - a.bytes)) {
    console.error(`  ${kb(chunk.bytes).padStart(10)}  ${chunk.fileName}`);
  }
  for (const [routeName, chunks] of failingRouteChunkLists) {
    console.error(`\n${routeName} closure chunks, largest first:`);
    for (const chunk of [...chunks].sort((a, b) => b.bytes - a.bytes)) {
      console.error(`  ${kb(chunk.bytes).padStart(10)}  ${chunk.fileName}`);
    }
  }
  console.error(
    "\nA package usually reaches the boot path through a barrel re-export: some" +
      "\nmodule that App renders eagerly imports one small helper from an index.ts" +
      "\nthat also exports heavy components. Import from the defining module" +
      "\ninstead, or move the caller behind React.lazy.\n" +
      "\nRun `node scripts/why-eager.mjs <package>` in apps/app to print the exact" +
      "\nstatic import chain from the entry to the package.\n",
  );
  process.exit(1);
}

console.log("\nBundle budget OK.");
