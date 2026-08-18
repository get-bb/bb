#!/usr/bin/env node
// Fails when the boot payload grows past bundle-budget.json, or when a heavy
// package that should load on demand reaches the boot path again.
//
// Run after `pnpm build` in apps/app. Reads bundle-stats.json (written by the
// bb:bundle-stats Vite plugin) and the brotli files written by
// scripts/precompress-app-dist.mjs.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.resolve(appDir, process.argv[2] ?? "dist");
const statsPath = path.join(appDir, "bundle-stats.json");
const budgetPath = path.join(appDir, "bundle-budget.json");

const die = (message) => {
  console.error(message);
  process.exit(1);
};

if (!fs.existsSync(statsPath)) {
  die(`missing ${path.relative(appDir, statsPath)} — run the app build first`);
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
