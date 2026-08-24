import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  buildNodeEsmEntry,
  copyDirectory,
} from "../../../scripts/build-utils.mjs";

const execFileAsync = promisify(execFile);
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptsDir, "..");
const workspaceRoot = resolve(packageRoot, "..", "..");

async function assertPathExists(pathToCheck, label) {
  try {
    await access(pathToCheck);
  } catch {
    throw new Error(
      `Missing ${label} at ${pathToCheck}. Build @bb/app, @bb/server, and @bb/host-daemon before packaging bb-app.`,
    );
  }
}

async function copyBuildOutput({ from, label, to }) {
  await assertPathExists(from, label);
  await copyDirectory({ from, to });
}

async function buildPublicSdkDeclarations() {
  await execFileAsync(
    "node",
    [resolve(scriptsDir, "build-public-sdk-dts.mjs")],
    { cwd: packageRoot },
  );
}

const entrypoints = [
  ["bb-app", "bb-app.js"],
  ["bb", "bb.js"],
  ["bb-server", "bb-server.js"],
  ["bb-host-daemon", "bb-host-daemon.js"],
];

for (const [sourceName, outputName] of entrypoints) {
  await buildNodeEsmEntry({
    cleanDist: sourceName === "bb-app",
    entryPoint: resolve(packageRoot, "src", "bin", `${sourceName}.ts`),
    executable: true,
    outfile: resolve(packageRoot, "dist", outputName),
    packageRoot,
  });
}

await buildNodeEsmEntry({
  cleanDist: false,
  entryPoint: resolve(packageRoot, "src", "public-sdk.ts"),
  outfile: resolve(packageRoot, "dist", "index.js"),
  packageRoot,
});
await buildPublicSdkDeclarations();

await copyBuildOutput({
  from: resolve(workspaceRoot, "apps", "app", "dist"),
  label: "@bb/app dist",
  to: resolve(packageRoot, "app", "dist"),
});
await copyBuildOutput({
  from: resolve(workspaceRoot, "apps", "server", "dist"),
  label: "@bb/server dist",
  to: resolve(packageRoot, "server", "dist"),
});
// Builtin plugins are bundled at packaging time (not in @bb/server's build,
// which source checkouts don't need — the registry falls back to the repo's
// plugins/<name> there). Runs in apps/server so tsx + workspace imports
// resolve; writes straight into the packaged server dist.
await execFileAsync(
  "node",
  [
    "--conditions=source",
    "--import",
    "tsx",
    resolve(
      workspaceRoot,
      "apps",
      "server",
      "scripts",
      "copy-builtin-plugins.ts",
    ),
    "--target",
    resolve(packageRoot, "server", "dist", "builtin-plugins"),
  ],
  { cwd: resolve(workspaceRoot, "apps", "server") },
);
await copyBuildOutput({
  from: resolve(workspaceRoot, "apps", "host-daemon", "dist"),
  label: "@bb/host-daemon dist",
  to: resolve(packageRoot, "host-daemon", "dist"),
});
// The bb CLI is code-split into host-daemon/dist/bb-chunks. A turbo cache hit
// restores apps/host-daemon/dist without clearing it first, so the copy can
// carry an earlier build's hashed chunks; ship only the ones `bb` reaches.
// The same script is this package's `prepack` hook: this task's own output
// is restored the same way on a cache hit, when nothing here runs.
await assertPathExists(
  resolve(packageRoot, "host-daemon", "dist", "bb-chunks"),
  "bundled bb CLI chunks",
);
const pruneRun = await execFileAsync(
  "node",
  [resolve(scriptsDir, "prune-bb-chunks.mjs")],
  { cwd: packageRoot },
);
process.stderr.write(pruneRun.stderr);

process.stdout.write("bb-app: built package assets\n");
