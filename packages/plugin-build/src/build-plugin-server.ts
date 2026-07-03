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
import { PLUGIN_SDK_MAJOR, PLUGIN_SDK_VERSION } from "@bb/domain";

/**
 * `bb plugin build` — compile a plugin's `bb.server` entry into a
 * self-contained backend bundle (prebuilt distribution, design §6):
 *
 * - `dist/server.js` (+ `.map`) — single node-platform ESM file with the
 *   plugin's npm deps inlined, so git:/npm: consumers never need npm or
 *   node_modules. `@bb/plugin-sdk` stays external (the server's loader
 *   resolves it to the live in-process implementation) and so does
 *   better-sqlite3 (plugins get sqlite from the host via `bb.storage`;
 *   native deps are unsupported in plugins regardless).
 * - `dist/server.meta.json` — `{ sdkMajor, sdkVersion }` sidecar the loader
 *   checks before preferring the bundle over jiti-from-source.
 */

// Same shim scripts/build-utils.mjs applies to our own node bundles: plugin
// deps may be CJS and reference require/__dirname/__filename, which do not
// exist in ESM output.
const NODE_ESM_REQUIRE_BANNER = [
  'import { createRequire as __createRequire } from "node:module";',
  'import { dirname as __pathDirname } from "node:path";',
  'import { fileURLToPath as __fileURLToPath } from "node:url";',
  "const require = __createRequire(import.meta.url);",
  "var __filename = __fileURLToPath(import.meta.url);",
  "var __dirname = __pathDirname(__filename);",
].join("\n");

interface PluginServerConfig {
  /** Absolute path of the `bb.server` entry file. */
  serverEntry: string;
}

/** Read `<rootDir>/package.json` and resolve its `bb.server` entry, or throw. */
async function readPluginServerConfig(
  rootDir: string,
): Promise<PluginServerConfig> {
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
  const pkg = json as { bb?: { server?: unknown } };
  const server = pkg.bb?.server;
  if (typeof server !== "string" || server.length === 0) {
    throw new Error(
      `no server entry: ${packageJsonPath} has no "bb": { "server": "./server.ts" } field`,
    );
  }
  if (isAbsolute(server)) {
    throw new Error(`manifest bb.server must be relative, got "${server}"`);
  }
  const serverEntry = resolve(rootDir, server);
  if (serverEntry !== rootDir && !serverEntry.startsWith(rootDir + "/")) {
    throw new Error(
      `manifest bb.server escapes the plugin directory: "${server}"`,
    );
  }
  try {
    await stat(serverEntry);
  } catch {
    throw new Error(`manifest bb.server points at a missing file: ${server}`);
  }
  return { serverEntry };
}

export interface PluginServerBuildResult {
  jsPath: string;
  mapPath: string;
  metaPath: string;
}

/**
 * Build `<rootDir>`'s backend bundle into `<rootDir>/dist/`. Throws with a
 * human-readable message on any problem (missing bb.server, compile errors).
 */
export async function buildPluginServer(
  rootDir: string,
): Promise<PluginServerBuildResult> {
  const { serverEntry } = await readPluginServerConfig(rootDir);
  const distDir = join(rootDir, "dist");
  await mkdir(distDir, { recursive: true });
  const jsPath = join(distDir, "server.js");
  const mapPath = join(distDir, "server.js.map");
  const metaPath = join(distDir, "server.meta.json");

  // Build every artifact into a staging directory and only rename into place
  // once all steps succeeded — a failed rebuild must not clobber the previous
  // dist/server.js the loader may still prefer.
  const stageDir = await mkdtemp(join(distDir, ".stage-"));
  try {
    const stagedJsPath = join(stageDir, "server.js");
    const stagedMetaPath = join(stageDir, "server.meta.json");

    const esbuild = await import("esbuild");
    await esbuild.build({
      entryPoints: [serverEntry],
      outfile: stagedJsPath,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      sourcemap: true,
      banner: { js: NODE_ESM_REQUIRE_BANNER },
      // The SDK resolves to the server's live in-process implementation at
      // load time; better-sqlite3 comes from the host (bb.storage). Node
      // builtins are auto-external via platform: "node".
      external: ["@bb/plugin-sdk", "better-sqlite3"],
      logLevel: "error",
    });
    await writeFile(
      stagedMetaPath,
      JSON.stringify(
        { sdkMajor: PLUGIN_SDK_MAJOR, sdkVersion: PLUGIN_SDK_VERSION },
        null,
        2,
      ) + "\n",
    );

    // Same filesystem as dist/, so each rename is atomic.
    await rename(stagedJsPath, jsPath);
    await rename(join(stageDir, "server.js.map"), mapPath);
    await rename(stagedMetaPath, metaPath);
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
  return { jsPath, mapPath, metaPath };
}
