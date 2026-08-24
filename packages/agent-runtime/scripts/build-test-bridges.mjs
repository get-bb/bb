import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildNodeEsmEntry } from "../../../scripts/build-utils.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(packageRoot, "..", "..");
const outputDir = resolve(packageRoot, "dist", "test-bridges");

await mkdir(outputDir, { recursive: true });
await Promise.all([
  buildNodeEsmEntry({
    cleanDist: false,
    entryPoint: resolve(
      workspaceRoot,
      "packages/provider-bridge-protocol/src/bridge-worker-entry.ts",
    ),
    outfile: resolve(outputDir, "bb-provider-bridge-worker.mjs"),
    packageRoot,
    sourcemap: false,
  }),
  buildNodeEsmEntry({
    cleanDist: false,
    entryPoint: resolve(
      workspaceRoot,
      "tests/scripted-echo-provider/src/provider-bridge.ts",
    ),
    outfile: resolve(outputDir, "scripted-echo-provider.mjs"),
    packageRoot,
    sourcemap: false,
  }),
]);
