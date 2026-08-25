import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { pruneUnreferencedChunks } from "../../../scripts/build-utils.mjs";

/**
 * Delete the bb CLI chunks that host-daemon/dist/bb does not reach.
 *
 * Bundled into dist/prune-bb-chunks.mjs: the build runs that copy after
 * assembling the package, and npm prepack runs it again at the pack boundary.
 *
 * The package root is the working directory, as for every package script.
 */
const packageRoot = process.cwd();
const distDir = resolve(packageRoot, "host-daemon", "dist");
const entry = resolve(distDir, "bb");
const chunkDir = resolve(distDir, "bb-chunks");

for (const [label, pathToCheck] of [
  ["bundled bb CLI", entry],
  ["bundled bb CLI chunks", chunkDir],
]) {
  try {
    await access(pathToCheck);
  } catch {
    throw new Error(
      `Missing ${label} at ${pathToCheck}: run from packages/bb-app after building it.`,
    );
  }
}

const removed = await pruneUnreferencedChunks({ chunkDir, entry });
if (removed.length > 0) {
  // stderr, not stdout: npm forwards a lifecycle script's stdout into its
  // own, and `npm pack --json` (which scripts/smoke-tarball.mjs parses)
  // must stay pure JSON.
  process.stderr.write(
    `bb-app: pruned ${removed.length} stale bb CLI chunk file(s)\n`,
  );
}
