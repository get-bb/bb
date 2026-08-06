#!/usr/bin/env node
/**
 * Bundle size budget check — fails if any JS chunk exceeds the limit.
 *
 * Run after `vite build`. Designed for CI so a merged PR that balloons a chunk
 * past the budget is caught before deploy.
 *
 * Usage: node scripts/check-bundle-budget.mjs [--max 500]
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const DIST_ASSETS = join(import.meta.dirname, "..", "dist", "assets");
const MAX_KB = Number(process.argv[process.argv.indexOf("--max") + 1]) || 500;
const MAX_BYTES = MAX_KB * 1024;

function formatKB(bytes) {
  return `${(bytes / 1024).toFixed(0)}KB`;
}

try {
  const files = readdirSync(DIST_ASSETS).filter((f) => f.endsWith(".js"));
  const oversized = [];

  for (const file of files) {
    const path = join(DIST_ASSETS, file);
    const { size } = statSync(path);
    if (size > MAX_BYTES) {
      oversized.push({ file, size });
    }
  }

  if (oversized.length === 0) {
    console.log(`✅ All chunks under ${MAX_KB}KB limit.`);
    process.exit(0);
  }

  console.error(
    `❌ ${oversized.length} chunk(s) exceed ${MAX_KB}KB limit:\n`,
  );
  for (const { file, size } of oversized.sort((a, b) => b.size - a.size)) {
    console.error(`   ${file}: ${formatKB(size)}`);
  }
  console.error(`\n   Total oversize: ${oversized.length} chunks`);
  process.exit(1);
} catch (err) {
  if (err.code === "ENOENT") {
    console.error("❌ dist/assets not found. Run `vite build` first.");
  } else {
    console.error("❌ Unexpected error:", err.message);
  }
  process.exit(1);
}
