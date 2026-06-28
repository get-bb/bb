#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const DEFAULT_DIST_DIR = "apps/app/dist";

function usage() {
  console.error(
    "Usage: node scripts/measure-app-startup-payload.mjs [dist-dir]",
  );
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(2)} MiB`;
}

function walkFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const filePath = join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(filePath) : [filePath];
  });
}

function measureFile(filePath, label) {
  const body = readFileSync(filePath);
  return {
    gzipBytes: gzipSync(body).length,
    label,
    rawBytes: body.length,
  };
}

function extractInitialReferences(html) {
  const references = [];
  const pattern = /<(script|link)\b[^>]+(?:src|href)="([^"]+)"/g;
  for (const match of html.matchAll(pattern)) {
    const url = match[2];
    if (url.startsWith("/")) {
      references.push(url);
    }
  }
  return references;
}

function sum(items, key) {
  return items.reduce((total, item) => total + item[key], 0);
}

function printTable(title, items) {
  console.log(`\n${title}`);
  for (const item of items) {
    console.log(
      `${formatBytes(item.rawBytes).padStart(10)} raw  ${formatBytes(
        item.gzipBytes,
      ).padStart(10)} gzip  ${item.label}`,
    );
  }
}

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  usage();
  process.exit(0);
}
if (args.length > 1) {
  usage();
  process.exit(1);
}

const distDir = resolve(args[0] ?? DEFAULT_DIST_DIR);
const indexPath = join(distDir, "index.html");
if (!existsSync(indexPath)) {
  console.error(
    `Missing ${indexPath}. Run: pnpm exec turbo run build --filter=@bb/app`,
  );
  process.exit(1);
}

const indexHtml = readFileSync(indexPath, "utf8");
const initialReferences = extractInitialReferences(indexHtml);
const initialFiles = [
  measureFile(indexPath, "/index.html"),
  ...initialReferences
    .map((reference) => {
      const filePath = join(distDir, reference.slice(1));
      return existsSync(filePath) && statSync(filePath).isFile()
        ? measureFile(filePath, reference)
        : null;
    })
    .filter(Boolean),
];
const allFiles = walkFiles(distDir)
  .filter((filePath) => !filePath.endsWith(".map"))
  .map((filePath) =>
    measureFile(filePath, `/${filePath.slice(distDir.length + 1)}`),
  )
  .sort((a, b) => b.rawBytes - a.rawBytes);

console.log(`dist: ${distDir}`);
console.log(`initial references: ${initialReferences.length}`);
console.log(
  `initial total: ${formatBytes(sum(initialFiles, "rawBytes"))} raw, ${formatBytes(
    sum(initialFiles, "gzipBytes"),
  )} gzip`,
);
console.log(
  `all non-map files: ${formatBytes(sum(allFiles, "rawBytes"))} raw, ${formatBytes(
    sum(allFiles, "gzipBytes"),
  )} gzip`,
);

printTable(
  "Largest initial files",
  [...initialFiles].sort((a, b) => b.rawBytes - a.rawBytes).slice(0, 20),
);
printTable("Largest app files", allFiles.slice(0, 20));
