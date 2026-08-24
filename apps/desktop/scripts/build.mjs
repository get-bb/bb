import { execFileSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { resolveDesktopReleaseChannel } from "./desktop-release-channel.mjs";

const packageRoot = process.cwd();
const distDir = resolve(packageRoot, "dist");
const packageJsonPath = resolve(packageRoot, "package.json");
const pluginSdkPackageJsonPath = resolve(
  packageRoot,
  "..",
  "..",
  "packages",
  "plugin-sdk",
  "package.json",
);

function readPackageVersion(packageJsonText, label) {
  const packageJson = JSON.parse(packageJsonText);
  if (
    typeof packageJson !== "object" ||
    packageJson === null ||
    typeof packageJson.version !== "string" ||
    packageJson.version.length === 0
  ) {
    throw new Error(`${label} must define a version`);
  }
  return packageJson.version;
}

/**
 * The About panel reports the commit a build came from. A tarball checkout or
 * a shallow CI clone can have no usable git metadata, so an unknown commit is
 * reported as such rather than failing the build.
 */
function readBuildCommit(env) {
  const injected =
    env.BB_DESKTOP_COMMIT?.trim() ?? env.GITHUB_SHA?.trim() ?? "";
  if (injected.length > 0) {
    return injected;
  }
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: packageRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function readBuildDate(env) {
  const injected = env.BB_DESKTOP_BUILD_DATE?.trim() ?? "";
  if (injected.length > 0) {
    return injected;
  }
  return new Date().toISOString();
}

await rm(distDir, { force: true, recursive: true });

const desktopVersion = readPackageVersion(
  await readFile(packageJsonPath, "utf8"),
  "apps/desktop/package.json",
);
const pluginSdkVersion = readPackageVersion(
  await readFile(pluginSdkPackageJsonPath, "utf8"),
  "packages/plugin-sdk/package.json",
);
const desktopReleaseChannel = resolveDesktopReleaseChannel(process.env);
const desktopCommit = readBuildCommit(process.env);
const desktopBuildDate = readBuildDate(process.env);

const commonOptions = {
  bundle: true,
  define: {
    "process.env.BB_DESKTOP_BUILD_DATE": JSON.stringify(desktopBuildDate),
    "process.env.BB_DESKTOP_COMMIT": JSON.stringify(desktopCommit),
    "process.env.BB_DESKTOP_PLUGIN_SDK_VERSION":
      JSON.stringify(pluginSdkVersion),
    "process.env.BB_DESKTOP_RELEASE_CHANNEL": JSON.stringify(
      desktopReleaseChannel,
    ),
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
    format: "cjs",
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
    entryPoints: [resolve(packageRoot, "src", "log-viewer-preload.ts")],
    external: ["electron"],
    format: "cjs",
    outfile: resolve(distDir, "log-viewer-preload.cjs"),
  }),
  build({
    ...commonOptions,
    entryPoints: [resolve(packageRoot, "src", "server-url-dialog-preload.ts")],
    external: ["electron"],
    format: "cjs",
    outfile: resolve(distDir, "server-url-dialog-preload.cjs"),
  }),
  build({
    ...commonOptions,
    entryPoints: [
      resolve(packageRoot, "src", "existing-server-dialog-preload.ts"),
    ],
    external: ["electron"],
    format: "cjs",
    outfile: resolve(distDir, "existing-server-dialog-preload.cjs"),
  }),
  build({
    ...commonOptions,
    entryPoints: [resolve(packageRoot, "src", "bb-app-bridge.ts")],
    external: ["bb-app", "bb-app/*"],
    format: "esm",
    outfile: resolve(distDir, "bb-app-bridge.mjs"),
  }),
]);

process.stdout.write("@bb/desktop: built Electron entries\n");
