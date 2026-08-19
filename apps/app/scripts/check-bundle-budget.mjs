#!/usr/bin/env node
// Fails when the boot payload grows past bundle-budget.json, when a heavy
// package that should load on demand reaches the boot path again, or when an
// on-demand package leaks out of its dynamic-import gate into some other
// chunk's static import closure.
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

// A boot chunk with no .br file would otherwise weigh zero against the
// compressed budget, so an unrun precompression step could hide real growth.
// Treat it as an error rather than guessing a size.
const missingBrotli = [];
let bootBytes = 0;
let bootBrotliBytes = 0;
for (const chunk of stats.bootChunks) {
  bootBytes += chunk.bytes;
  const brotliPath = path.join(distDir, `${chunk.fileName}.br`);
  if (fs.existsSync(brotliPath)) {
    bootBrotliBytes += fs.statSync(brotliPath).size;
  } else if (chunk.bytes < MIN_PRECOMPRESS_BYTES) {
    // precompress-app-dist intentionally skips sub-1 KiB assets. Counting the
    // raw bytes is a conservative upper bound for those tiny boot chunks.
    bootBrotliBytes += chunk.bytes;
  } else {
    missingBrotli.push(chunk.fileName);
  }
}

const forbidden = new Set(budget.forbiddenBootPackages);
const offenders = new Map();
for (const chunk of stats.bootChunks) {
  for (const pkg of chunk.packages) {
    if (!forbidden.has(pkg)) continue;
    if (!offenders.has(pkg)) offenders.set(pkg, []);
    offenders.get(pkg).push(chunk.fileName);
  }
}

// On-demand packages may enter the graph only through their named gate: the
// module a dynamic import() resolves to (its chunk's facade). Every chunk whose
// static-import closure contains the package must sit inside the gate chunk's
// own static closure. A static edge from anywhere else (say, markdown-preview)
// into a chunk holding the package would download it whenever the importer
// loads, whether or not the content ever needs it — and would show up here as
// a chunk outside the gate's closure that still reaches the package.
const chunksByFile = new Map(stats.chunks.map((chunk) => [chunk.fileName, chunk]));
const staticClosureOf = (fileName) => {
  const closure = new Set();
  const walk = (file) => {
    if (closure.has(file)) return;
    closure.add(file);
    for (const imported of chunksByFile.get(file)?.imports ?? []) walk(imported);
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
    .filter((chunk) => !allowed.has(chunk.fileName) && closureHasPackage(chunk.fileName, pkg))
    .map((chunk) => chunk.fileName);
  if (leaks.length > 0) {
    onDemandFailures.push(
      `${pkg} is in the static import closure of ${leaks.join(", ")}, outside its gate ${gateModule}. It must load only behind that dynamic import().`,
    );
  }
}

console.log(`boot payload: ${kb(bootBytes)} raw / ${kb(bootBrotliBytes)} brotli`);
console.log(`  budget:     ${kb(budget.maxBootBytes)} raw / ${kb(budget.maxBootBrotliBytes)} brotli`);
console.log(`  chunks:     ${stats.bootChunks.length}`);

if (missingBrotli.length > 0) {
  failures.push(
    `${missingBrotli.length} boot chunk(s) have no .br file, so the compressed total is understated: ${missingBrotli.join(", ")}. Run scripts/precompress-app-dist.mjs.`,
  );
}
if (bootBytes > budget.maxBootBytes) {
  failures.push(
    `boot payload is ${kb(bootBytes)}, over the ${kb(budget.maxBootBytes)} raw budget by ${kb(bootBytes - budget.maxBootBytes)}.`,
  );
}
if (bootBrotliBytes > budget.maxBootBrotliBytes) {
  failures.push(
    `boot payload is ${kb(bootBrotliBytes)} brotli, over the ${kb(budget.maxBootBrotliBytes)} budget by ${kb(bootBrotliBytes - budget.maxBootBrotliBytes)}.`,
  );
}
for (const [pkg, chunks] of offenders) {
  failures.push(`${pkg} is in the boot payload (${chunks.join(", ")}). It must load on demand.`);
}
failures.push(...onDemandFailures);

if (failures.length > 0) {
  console.error("\nBundle budget failed:\n");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("\nBoot chunks, largest first:");
  for (const chunk of [...stats.bootChunks].sort((a, b) => b.bytes - a.bytes)) {
    console.error(`  ${kb(chunk.bytes).padStart(10)}  ${chunk.fileName}`);
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
