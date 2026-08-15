import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { validatePluginBuildManifest } from "./plugin-manifest.js";
import { type PluginBuildToolchain } from "./toolchain.js";

/**
 * `bb plugin build` — compile a plugin's `bb.providerBridge` entry into the
 * provider bridge bundle:
 *
 * - `dist/provider-bridge.mjs` — a single node-platform ESM file with
 *   everything inlined. Unlike `server.js` (which keeps the plugin SDK
 *   external because the server loader aliases it at load time), the bridge
 *   runs standalone under the host daemon's node with no loader in front of
 *   it, so nothing may stay external except node builtins.
 * - `dist/provider-bridge.meta.json` — `{sha256, byteLength}` of the emitted
 *   bundle. The server records these at install/reload and the daemon
 *   verifies the exact bytes before ever executing them.
 */

// Same CJS-compat shim as the server bundle: inlined deps may reference
// require/__dirname/__filename, which do not exist in ESM output.
const NODE_ESM_REQUIRE_BANNER = [
  'import { createRequire as __createRequire } from "node:module";',
  'import { dirname as __pathDirname } from "node:path";',
  'import { fileURLToPath as __fileURLToPath } from "node:url";',
  "const require = __createRequire(import.meta.url);",
  "var __filename = __fileURLToPath(import.meta.url);",
  "var __dirname = __pathDirname(__filename);",
].join("\n");

interface PluginProviderBridgeConfig {
  /** Absolute path of the `bb.providerBridge` entry file. */
  bridgeEntry: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read `<rootDir>/package.json` and resolve its `bb.providerBridge` entry, or
 * throw. Same escape rules as `bb.server`.
 */
async function readPluginProviderBridgeConfig(
  rootDir: string,
): Promise<PluginProviderBridgeConfig> {
  const packageJsonPath = join(rootDir, "package.json");
  let raw: string;
  try {
    raw = await readFile(packageJsonPath, "utf8");
  } catch {
    throw new Error(`no readable package.json at ${packageJsonPath}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`package.json is not valid JSON at ${packageJsonPath}`);
  }
  if (
    !isRecord(json) ||
    !isRecord(json.bb) ||
    json.bb.providerBridge === undefined
  ) {
    throw new Error(
      `no provider bridge entry: ${packageJsonPath} has no "bb": { "providerBridge": "./src/provider-bridge.ts" } field`,
    );
  }
  const manifest = await validatePluginBuildManifest(
    json,
    rootDir,
    packageJsonPath,
  );
  const providerBridge = manifest.bb.providerBridge;
  if (providerBridge === undefined) {
    throw new Error(`no provider bridge entry declared in ${packageJsonPath}`);
  }
  if (isAbsolute(providerBridge)) {
    throw new Error(
      `manifest bb.providerBridge must be relative, got "${providerBridge}"`,
    );
  }
  const bridgeEntry = resolve(rootDir, providerBridge);
  if (bridgeEntry !== rootDir && !bridgeEntry.startsWith(rootDir + "/")) {
    throw new Error(
      `manifest bb.providerBridge escapes the plugin directory: "${providerBridge}"`,
    );
  }
  try {
    await stat(bridgeEntry);
  } catch {
    throw new Error(
      `manifest bb.providerBridge points at a missing file: ${providerBridge}`,
    );
  }
  return { bridgeEntry };
}

export interface PluginProviderBridgeBuildResult {
  jsPath: string;
  metaPath: string;
  /** Hex sha256 of the emitted `provider-bridge.mjs` bytes. */
  sha256: string;
  byteLength: number;
}

/** Shape of `dist/provider-bridge.meta.json`. */
export interface PluginProviderBridgeMeta {
  sha256: string;
  byteLength: number;
}

/**
 * Build `<rootDir>`'s provider bridge bundle into `<rootDir>/dist/`. Throws
 * with a human-readable message on any problem (missing bb.providerBridge,
 * compile errors).
 */
export async function buildPluginProviderBridge(
  rootDir: string,
  toolchain: PluginBuildToolchain,
): Promise<PluginProviderBridgeBuildResult> {
  const { bridgeEntry } = await readPluginProviderBridgeConfig(rootDir);
  const distDir = join(rootDir, "dist");
  await mkdir(distDir, { recursive: true });
  const jsPath = join(distDir, "provider-bridge.mjs");
  const metaPath = join(distDir, "provider-bridge.meta.json");

  // Build into a staging directory and only rename into place once every step
  // succeeded — a failed rebuild must not clobber the previous bundle, and
  // the meta must never describe bytes other than the bundle beside it.
  const stageDir = await mkdtemp(join(distDir, ".stage-"));
  try {
    const stagedJsPath = join(stageDir, "provider-bridge.mjs");
    const stagedMetaPath = join(stageDir, "provider-bridge.meta.json");

    // Dynamic specifier: restate the module type (see build-plugin-app.ts).
    const esbuild = (await import(
      toolchain.esbuild
    )) as typeof import("esbuild");
    await esbuild.build({
      entryPoints: [bridgeEntry],
      outfile: stagedJsPath,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      banner: { js: NODE_ESM_REQUIRE_BANNER },
      // Fully self-contained: only node builtins stay external (implicit via
      // platform: "node"). The bridge executes standalone on the host.
      logLevel: "error",
    });

    const bundleBytes = await readFile(stagedJsPath);
    const meta: PluginProviderBridgeMeta = {
      sha256: createHash("sha256").update(bundleBytes).digest("hex"),
      byteLength: bundleBytes.byteLength,
    };
    await writeFile(stagedMetaPath, JSON.stringify(meta, null, 2) + "\n");

    // Same filesystem as dist/, so each rename is atomic.
    await rename(stagedJsPath, jsPath);
    await rename(stagedMetaPath, metaPath);
    return { jsPath, metaPath, ...meta };
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
}
