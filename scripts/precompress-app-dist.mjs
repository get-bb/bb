#!/usr/bin/env node
import {
  constants as zlibConstants,
  brotliCompressSync,
  gzipSync,
} from "node:zlib";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, join, resolve } from "node:path";

const DEFAULT_DIST_DIR = "apps/app/dist";
const MIN_COMPRESS_BYTES = 1024;
const COMPRESSIBLE_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".json",
  ".mjs",
  ".svg",
  ".txt",
  ".wasm",
  ".webmanifest",
  ".xml",
]);

function usage() {
  console.error("Usage: node scripts/precompress-app-dist.mjs [dist-dir]");
}

function walkFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const filePath = join(dir, entry.name);
    return entry.isDirectory() ? walkFiles(filePath) : [filePath];
  });
}

function shouldPrecompress(filePath) {
  if (filePath.endsWith(".br") || filePath.endsWith(".gz")) {
    return false;
  }
  return COMPRESSIBLE_EXTENSIONS.has(extname(filePath));
}

function writeIfSmaller(args) {
  if (args.compressed.length >= args.rawLength) {
    return false;
  }
  writeFileSync(args.outputPath, args.compressed);
  return true;
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
if (!existsSync(distDir)) {
  console.error(
    `Missing ${distDir}. Run: pnpm exec turbo run build --filter=@bb/app`,
  );
  process.exit(1);
}

let sourceFiles = 0;
let brotliFiles = 0;
let gzipFiles = 0;

for (const filePath of walkFiles(distDir)) {
  if (!shouldPrecompress(filePath)) {
    continue;
  }
  const fileStat = statSync(filePath);
  if (!fileStat.isFile() || fileStat.size < MIN_COMPRESS_BYTES) {
    continue;
  }

  sourceFiles += 1;
  const body = readFileSync(filePath);
  const brotli = brotliCompressSync(body, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 10,
    },
  });
  const gzip = gzipSync(body, { level: 9 });

  if (
    writeIfSmaller({
      compressed: brotli,
      outputPath: `${filePath}.br`,
      rawLength: body.length,
    })
  ) {
    brotliFiles += 1;
  }
  if (
    writeIfSmaller({
      compressed: gzip,
      outputPath: `${filePath}.gz`,
      rawLength: body.length,
    })
  ) {
    gzipFiles += 1;
  }
}

console.log(
  `precompressed ${sourceFiles} files (${brotliFiles} br, ${gzipFiles} gzip) in ${distDir}`,
);
