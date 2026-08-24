#!/usr/bin/env node
import { constants as zlibConstants, brotliCompress, gzip } from "node:zlib";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const DEFAULT_DIST_DIR = "apps/app/dist";
const DEFAULT_COMPRESSION_CONCURRENCY = 8;
const MIN_COMPRESS_BYTES = 1024;
const COMPRESSIBLE_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".svg",
  ".txt",
  ".wasm",
  ".webmanifest",
  ".xml",
]);

const compressBrotli = promisify(brotliCompress);
const compressGzip = promisify(gzip);

function usage() {
  console.error("Usage: node scripts/precompress-app-dist.mjs [dist-dir]");
}

async function walkFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map((entry) => {
      const filePath = join(dir, entry.name);
      return entry.isDirectory() ? walkFiles(filePath) : [filePath];
    }),
  );
  return nestedFiles.flat();
}

function shouldPrecompress(filePath) {
  if (filePath.endsWith(".br") || filePath.endsWith(".gz")) {
    return false;
  }
  return COMPRESSIBLE_EXTENSIONS.has(extname(filePath));
}

async function writeIfSmaller(args) {
  if (args.compressed.length >= args.rawLength) {
    return false;
  }
  await writeFile(args.outputPath, args.compressed);
  return true;
}

async function compressFile(filePath) {
  const body = await readFile(filePath);
  const [brotli, gzipped] = await Promise.all([
    compressBrotli(body, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 10,
      },
    }),
    compressGzip(body, { level: 9 }),
  ]);
  const [wroteBrotli, wroteGzip] = await Promise.all([
    writeIfSmaller({
      compressed: brotli,
      outputPath: `${filePath}.br`,
      rawLength: body.length,
    }),
    writeIfSmaller({
      compressed: gzipped,
      outputPath: `${filePath}.gz`,
      rawLength: body.length,
    }),
  ]);
  return {
    brotliFiles: wroteBrotli ? 1 : 0,
    gzipFiles: wroteGzip ? 1 : 0,
  };
}

async function precompressDirectory(args) {
  const candidateFiles = [];
  for (const filePath of await walkFiles(args.distDir)) {
    if (!shouldPrecompress(filePath)) {
      continue;
    }
    const fileStat = await stat(filePath);
    if (fileStat.isFile() && fileStat.size >= MIN_COMPRESS_BYTES) {
      candidateFiles.push(filePath);
    }
  }

  let nextFileIndex = 0;
  let brotliFiles = 0;
  let gzipFiles = 0;
  const workerCount = Math.min(
    args.concurrency ?? DEFAULT_COMPRESSION_CONCURRENCY,
    candidateFiles.length,
  );
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextFileIndex < candidateFiles.length) {
      const filePath = candidateFiles[nextFileIndex];
      nextFileIndex += 1;
      const result = await compressFile(filePath);
      brotliFiles += result.brotliFiles;
      gzipFiles += result.gzipFiles;
    }
  });
  await Promise.all(workers);

  return {
    brotliFiles,
    gzipFiles,
    sourceFiles: candidateFiles.length,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage();
    return;
  }
  if (args.length > 1) {
    usage();
    process.exitCode = 1;
    return;
  }

  const distDir = resolve(args[0] ?? DEFAULT_DIST_DIR);
  if (!existsSync(distDir)) {
    console.error(
      `Missing ${distDir}. Run: pnpm exec turbo run build --filter=@bb/app`,
    );
    process.exitCode = 1;
    return;
  }

  const result = await precompressDirectory({ distDir });
  console.log(
    `precompressed ${result.sourceFiles} files (${result.brotliFiles} br, ${result.gzipFiles} gzip) in ${distDir}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
