#!/usr/bin/env node
// Bounds the size of a local Turbo cache directory.
//
// CI restores `.turbo/cache` from the previous run, adds this run's task
// outputs, and saves the union under a new key. Nothing ever removes an entry,
// so the directory grows without limit: the `checks` cache reached 2.9 GB, and
// restoring it cost ~40s at the head of every job — more than the build,
// typecheck and lint it was there to skip.
//
// Turbo writes each task output as a content-addressed pair, `<hash>.tar.zst`
// plus `<hash>-meta.json`, so entries are independent and dropping the least
// recently written ones only costs a recomputation of tasks that are already
// stale. Run this right after the cache is restored: the pruned directory is
// what the job then adds to and saves.

import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

const ENTRY_PATTERN = /^([0-9a-f]+)(-meta\.json|\.tar\.zst)$/;

function parseArgs(argv) {
  const args = { dir: ".turbo/cache", maxSizeMb: 1024 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dir") {
      args.dir = argv[i + 1];
      i += 1;
    } else if (arg === "--max-size-mb") {
      args.maxSizeMb = Number(argv[i + 1]);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.dir) {
    throw new Error("--dir requires a value");
  }
  if (!Number.isFinite(args.maxSizeMb) || args.maxSizeMb <= 0) {
    throw new Error("--max-size-mb requires a positive number");
  }
  return args;
}

// Groups the `<hash>.tar.zst` / `<hash>-meta.json` pair into a single entry so
// pruning can never strand a meta file without its archive, which Turbo reads
// as a corrupt cache hit rather than a miss.
async function collectEntries(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }

  const entries = new Map();
  for (const name of names) {
    const match = ENTRY_PATTERN.exec(name);
    if (!match) {
      continue;
    }
    const hash = match[1];
    const stats = await stat(path.join(dir, name));
    if (!stats.isFile()) {
      continue;
    }
    const entry = entries.get(hash) ?? { hash, files: [], size: 0, mtimeMs: 0 };
    entry.files.push(name);
    entry.size += stats.size;
    entry.mtimeMs = Math.max(entry.mtimeMs, stats.mtimeMs);
    entries.set(hash, entry);
  }
  return [...entries.values()];
}

function formatMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  const { dir, maxSizeMb } = parseArgs(process.argv.slice(2));
  const entries = await collectEntries(dir);
  if (entries === null) {
    console.log(`Turbo cache prune: ${dir} does not exist yet; nothing to do.`);
    return;
  }

  const totalSize = entries.reduce((sum, entry) => sum + entry.size, 0);
  const maxSizeBytes = maxSizeMb * 1024 * 1024;
  if (totalSize <= maxSizeBytes) {
    console.log(
      `Turbo cache prune: ${entries.length} entries, ${formatMb(totalSize)} of ${maxSizeMb} MB budget; nothing to remove.`,
    );
    return;
  }

  // Newest first, so the entries most likely to be reused by the next run are
  // the ones that fit inside the budget.
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);

  let keptSize = 0;
  let removedSize = 0;
  let removedCount = 0;
  for (const entry of entries) {
    if (keptSize + entry.size <= maxSizeBytes) {
      keptSize += entry.size;
      continue;
    }
    await Promise.all(entry.files.map((name) => unlink(path.join(dir, name))));
    removedSize += entry.size;
    removedCount += 1;
  }

  console.log(
    `Turbo cache prune: removed ${removedCount} of ${entries.length} entries ` +
      `(${formatMb(removedSize)}); ${formatMb(keptSize)} kept of ${maxSizeMb} MB budget.`,
  );
}

await main();
