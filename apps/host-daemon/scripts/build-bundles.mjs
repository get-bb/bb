import { readFileSync } from "node:fs";
import { chmod, copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { bundleTargets } from "./bundle-manifest.mjs";
import {
  createNativeExternalPatterns,
  externalPackagePatterns,
} from "../../../scripts/build-utils.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptsDir, "..");
const workspaceRoot = resolve(packageRoot, "..", "..");

/**
 * esbuild `define` that inlines the SDK declaration bundles for
 * packages/templates/src/plugin-sdk-dts.ts. Read from the
 * @get-bb/plugin-sdk#build:types output, a turbo dependency of this build.
 */
function pluginSdkDeclarationsDefine() {
  const typesDir = resolve(
    workspaceRoot,
    "packages",
    "plugin-sdk",
    "bundled-types",
  );
  const declarations = {
    root: readFileSync(resolve(typesDir, "bb-plugin-sdk.d.ts"), "utf8"),
    app: readFileSync(resolve(typesDir, "bb-plugin-sdk-app.d.ts"), "utf8"),
  };
  return {
    __BB_PLUGIN_SDK_DTS_JSON__: JSON.stringify(JSON.stringify(declarations)),
  };
}

async function main() {
  for (const target of bundleTargets) {
    await mkdir(dirname(target.outfile), { recursive: true });
    await build({
      banner: {
        js: target.banner,
      },
      bundle: true,
      conditions: ["source"],
      define: target.inlinePluginSdkDeclarations
        ? pluginSdkDeclarationsDefine()
        : undefined,
      entryPoints: [target.entryPoint],
      external: [
        ...createNativeExternalPatterns({
          bundledPackages: target.bundledPackages,
        }),
        ...externalPackagePatterns(target.externalPackages ?? []),
      ],
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
