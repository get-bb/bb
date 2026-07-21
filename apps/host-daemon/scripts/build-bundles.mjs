import { chmod, copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { bundleTargets } from "./bundle-manifest.mjs";
import {
  createNativeExternalPatterns,
  generateTemplatesIfRequested,
} from "../../../scripts/build-utils.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptsDir, "..");
const workspaceRoot = resolve(packageRoot, "..", "..");

async function main() {
  await import("../../../packages/plugin-build/scripts/generate-runtime-export-manifest.mjs");
  await generateTemplatesIfRequested(true);

  for (const target of bundleTargets) {
    await mkdir(dirname(target.outfile), { recursive: true });
    await build({
      banner: {
        js: target.banner,
      },
      bundle: true,
      conditions: ["source"],
      entryPoints: [target.entryPoint],
      external: createNativeExternalPatterns(),
      format: "esm",
      legalComments: "none",
      minify: true,
      outfile: target.outfile,
      platform: "node",
      sourcemap: false,
      target: "node22",
    });
    if (target.executable) {
      await chmod(target.outfile, 0o755);
    }
    const bundleStats = await stat(target.outfile);
    console.log(`${target.label}: ${bundleStats.size} bytes`);
  }

  const titleCommandPath = resolve(
    workspaceRoot,
    "apps",
    "cli",
    "bin",
    "title",
  );
  const outputTitleCommandPath = resolve(packageRoot, "dist", "title");
  await copyFile(titleCommandPath, outputTitleCommandPath);
  await chmod(outputTitleCommandPath, 0o755);
}

void main().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
