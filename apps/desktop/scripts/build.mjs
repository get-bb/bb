import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const packageRoot = process.cwd();
const distDir = resolve(packageRoot, "dist");

await rm(distDir, { force: true, recursive: true });

const commonOptions = {
  bundle: true,
  legalComments: "none",
  platform: "node",
  sourcemap: true,
  target: "node22",
};

await Promise.all([
  build({
    ...commonOptions,
    entryPoints: [resolve(packageRoot, "src", "main.ts")],
    external: ["electron"],
    format: "esm",
    outfile: resolve(distDir, "main.js"),
  }),
  build({
    ...commonOptions,
    entryPoints: [resolve(packageRoot, "src", "preload.ts")],
    external: ["electron"],
    format: "cjs",
    outfile: resolve(distDir, "preload.cjs"),
  }),
  build({
    ...commonOptions,
    entryPoints: [resolve(packageRoot, "src", "bb-app-bridge.ts")],
    external: ["bb-app", "bb-app/*"],
    format: "esm",
    outfile: resolve(distDir, "bb-app-bridge.js"),
  }),
]);

process.stdout.write("@bb/desktop: built Electron entries\n");
