import { chmod, cp, rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

export const NODE_ESM_REQUIRE_BANNER = [
  'import { createRequire as __createRequire } from "node:module";',
  'import { dirname as __pathDirname } from "node:path";',
  'import { fileURLToPath as __fileURLToPath } from "node:url";',
  "const require = __createRequire(import.meta.url);",
  "var __filename = __fileURLToPath(import.meta.url);",
  "var __dirname = __pathDirname(__filename);",
].join("\n");

export const NATIVE_EXTERNAL_PACKAGES = [
  "@parcel/watcher",
  "better-sqlite3",
  "bufferutil",
  "fsevents",
  "node-pty",
  "pino",
  "pino-pretty",
  "pino-roll",
  "thread-stream",
  "utf-8-validate",
  // The plugin frontend build toolchain (@bb/plugin-build). Only the bb CLI
  // and server invoke it, but it is reachable through @bb/cli's import graph,
  // so any bundle that includes the CLI (the host-daemon bundles) otherwise
  // drags in esbuild + Tailwind's native .node addons and fails to bundle.
  // Externalized everywhere: they resolve from node_modules at runtime when a
  // plugin build actually runs, and are never loaded otherwise. They must be
  // runtime `dependencies` of every package that ships a bundle importing them
  // (packages/bb-app) so npm/pnpm installs them alongside the bundle.
  "esbuild",
  "@tailwindcss/node",
  "@tailwindcss/oxide",
  "lightningcss",
  // jiti loads plugin server entries as TypeScript at runtime and lazily
  // require()s its own transform files (babel.cjs); bundling it breaks that
  // lazy resolution, so it must stay external + a shipped dependency.
  "jiti",
];

export function externalPackagePatterns(packageNames) {
  return packageNames.flatMap((packageName) => [
    packageName,
    `${packageName}/*`,
  ]);
}

export function createNativeExternalPatterns() {
  return externalPackagePatterns(NATIVE_EXTERNAL_PACKAGES);
}

export async function removeFileAndMap(outfile) {
  await Promise.all([
    rm(outfile, { force: true }),
    rm(`${outfile}.map`, { force: true }),
  ]);
}

export async function copyDirectory({ from, to }) {
  await rm(to, { force: true, recursive: true });
  await cp(from, to, { recursive: true });
}

export async function buildNodeEsmEntry({
  cleanDist,
  entryPoint,
  executable = false,
  external = [],
  outfile,
  packageRoot,
  sourcemap = true,
  target = "node22",
}) {
  if (cleanDist) {
    await rm(path.join(packageRoot, "dist"), { force: true, recursive: true });
  } else {
    await removeFileAndMap(outfile);
  }

  await build({
    banner: {
      js: NODE_ESM_REQUIRE_BANNER,
    },
    bundle: true,
    conditions: ["source"],
    entryPoints: [entryPoint],
    external: [...createNativeExternalPatterns(), ...external],
    format: "esm",
    legalComments: "none",
    outfile,
    platform: "node",
    sourcemap,
    target,
  });

  if (executable) {
    await chmod(outfile, 0o755);
  }
}

export async function generateTemplatesIfRequested(enabled) {
  if (!enabled) {
    return;
  }

  await import("../packages/templates/scripts/generate-templates.mjs");
}
