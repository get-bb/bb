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
import { createPluginArtifactMeta } from "./plugin-artifact-meta.js";
import { validatePluginBuildManifest } from "./plugin-manifest.js";
import { type PluginBuildToolchain } from "./toolchain.js";

/**
 * `bb plugin build` — compile a plugin's `bb.server` entry into a
 * self-contained backend bundle (prebuilt distribution, design §6):
 *
 * - `dist/server.js` (+ `.map`) — single node-platform ESM file with the
 *   plugin's npm deps inlined, so git:/npm: consumers never need npm or
 *   node_modules. `@get-bb/plugin-sdk` stays external — plugin authors only ever
 *   have its `.d.ts` types, so the specifier must survive to load time, where
 *   the server's loader aliases it to the SDK runtime bundle shipped next to
 *   the server (workspace resolution covers source checkouts). better-sqlite3
 *   is also external (plugins get sqlite from the host via `bb.storage`;
 *   native deps are unsupported in plugins regardless).
 * - `dist/server.meta.json` — SDK compatibility plus authoritative plugin,
 *   artifact-format, and build-version metadata.
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

/** The SDK package plugin server sources import. */
const PLUGIN_SDK_SPECIFIER = "@get-bb/plugin-sdk";

/**
 * Legacy alias for {@link PLUGIN_SDK_SPECIFIER}, kept so pre-rename plugin
 * sources still build. The server loader aliases both specifiers to the same
 * SDK runtime bundle; a later change removes it.
 */
const LEGACY_PLUGIN_SDK_SPECIFIER = "@bb/plugin-sdk";

/**
 * Specifiers the backend bundle leaves unresolved. Everything else a plugin's
 * server source imports is inlined from its node_modules, so it has to be a
 * real `dependency` — `packages/templates` scaffolds against this list.
 */
export const PLUGIN_SERVER_EXTERNALS: readonly string[] = [
  PLUGIN_SDK_SPECIFIER,
  LEGACY_PLUGIN_SDK_SPECIFIER,
  "better-sqlite3",
];

interface PluginServerConfig {
  /** Absolute path of the `bb.server` entry file. */
  serverEntry: string;
  packageName: string;
  pluginVersion: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  if (!isRecord(json) || !isRecord(json.bb) || json.bb.server === undefined) {
    throw new Error(
      `no server entry: ${packageJsonPath} has no "bb": { "server": "./server.ts" } field`,
    );
  }
  const manifest = await validatePluginBuildManifest(
    json,
    rootDir,
    packageJsonPath,
  );
  const server = manifest.bb.server;
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
  return {
    serverEntry,
    packageName: manifest.name,
    pluginVersion: manifest.version,
  };
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
  bbVersion: string,
  toolchain: PluginBuildToolchain,
): Promise<PluginServerBuildResult> {
  const { serverEntry, packageName, pluginVersion } =
    await readPluginServerConfig(rootDir);
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

    // Dynamic specifier: restate the module type (see build-plugin-app.ts).
    const esbuild = (await import(
      toolchain.esbuild
    )) as typeof import("esbuild");
    await esbuild.build({
      entryPoints: [serverEntry],
      outfile: stagedJsPath,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      sourcemap: true,
      banner: { js: NODE_ESM_REQUIRE_BANNER },
      // The server's loader aliases the SDK to its shipped runtime bundle at
      // load time; better-sqlite3 comes from the host (bb.storage). Node
      // builtins are auto-external via platform: "node".
      external: [...PLUGIN_SERVER_EXTERNALS],
      logLevel: "error",
    });
    await writeFile(
      stagedMetaPath,
      JSON.stringify(
        createPluginArtifactMeta({ packageName, pluginVersion, bbVersion }),
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
