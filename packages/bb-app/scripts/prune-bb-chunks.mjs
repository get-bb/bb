import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { pruneUnreferencedChunks } from "../../../scripts/build-utils.mjs";

/**
 * Delete the bb CLI chunks that host-daemon/dist/bb does not reach.
 *
 * Runs twice: from scripts/build.mjs right after the host-daemon copy, and as
 * this package's `prepack` hook. The build-time run cleans what the copy
 * brought over from apps/host-daemon/dist. The hook exists because
 * `bb-app#build` is itself a cached turbo task whose outputs include
 * host-daemon/**, and a cache-hit restore writes those outputs over whatever
 * is on disk without clearing the directory first, so the build-time prune
 * does not run and an earlier generation's content-hashed chunks sit next to
 * the live ones. npm runs `prepack` for `npm pack` and `npm publish` whether
 * or not the task body ran, so the packed tarball always matches a clean
 * build.
 *
 * The package root is the working directory, as for every package script:
 * npm runs lifecycle hooks, and turbo the build, from the package directory.
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
