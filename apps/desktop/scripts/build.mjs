import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const packageRoot = process.cwd();
const distDir = resolve(packageRoot, "dist");
const packageJsonPath = resolve(packageRoot, "package.json");

function readPackageVersion(packageJsonText) {
  const packageJson = JSON.parse(packageJsonText);
  if (
    typeof packageJson !== "object" ||
    packageJson === null ||
    typeof packageJson.version !== "string" ||
    packageJson.version.length === 0
  ) {
    throw new Error("apps/desktop/package.json must define a version");
  }
  return packageJson.version;
}

await rm(distDir, { force: true, recursive: true });

const desktopVersion = readPackageVersion(
  await readFile(packageJsonPath, "utf8"),
);

const commonOptions = {
  bundle: true,
  define: {
    "process.env.BB_DESKTOP_VERSION": JSON.stringify(desktopVersion),
  },
  legalComments: "none",
  platform: "node",
  sourcemap: true,
  target: "node24",
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
