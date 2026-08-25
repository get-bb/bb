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
import { isRecord, validatePluginBuildManifest } from "./plugin-manifest.js";
import {
  installedPluginSdkDirectory,
  installedPluginSdkExportTarget,
  pathExists,
  PLUGIN_SDK_PACKAGE_NAME,
} from "./plugin-sdk-install.js";
import {
  NODE_ESM_REQUIRE_BANNER,
  type PluginBuildToolchain,
} from "./toolchain.js";

/**
 * `bb plugin build` — compile a plugin's `bb.server` entry into a
 * self-contained backend bundle (prebuilt distribution, design §6):
 *
 * - `dist/server.js` (+ `.map`) — single node-platform ESM file with the
 *   plugin's npm deps inlined, so git:/npm: consumers never need npm or
 *   node_modules. The bare `@get-bb/plugin-sdk` stays external — plugin
 *   authors only ever have its `.d.ts` types, so the specifier must survive
 *   to load time, where the server's loader aliases it to the SDK runtime
 *   bundle shipped next to the server (workspace resolution covers source
 *   checkouts). An SDK subpath (`@get-bb/plugin-sdk/host`,
 *   `/provider-bridge/acp`, …) is bundled from the plugin's own SDK install,
 *   as the host artifact bundles it: the loader serves nothing but the bare
 *   specifier. better-sqlite3 is also external (plugins get sqlite from the
 *   host via `bb.storage`; native deps are unsupported in plugins regardless).
 * - `dist/server.meta.json` — SDK compatibility plus authoritative plugin,
 *   artifact-format, and build-version metadata.
 */

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
 *
 * The two SDK specifiers are external by exact match only: esbuild's
 * `external` option would keep every subpath of the package external too,
 * and the server's loader aliases only the bare specifier to its runtime
 * bundle, so a bundled `@get-bb/plugin-sdk/host` import resolved to
 * `plugin-sdk-runtime.js/host` on a packaged server and failed the plugin's
 * load. Subpaths go through {@link unresolvedSdkSubpathError}'s resolver.
 */
export const PLUGIN_SERVER_EXTERNALS: readonly string[] = [
  PLUGIN_SDK_SPECIFIER,
  LEGACY_PLUGIN_SDK_SPECIFIER,
  "better-sqlite3",
];

const PLUGIN_SDK_ROOT_FILTER = /^@get-bb\/plugin-sdk$|^@bb\/plugin-sdk$/;
const PLUGIN_SDK_SUBPATH_FILTER = /^@get-bb\/plugin-sdk\//;
/** Marks the resolver's own re-entrant `build.resolve` call. */
const PLUGIN_SDK_SUBPATH_RESOLVE_MARK = "bb-server-sdk-subpath";

/**
 * Why an SDK subpath did not resolve for a server entry. A subpath is
 * bundled from the plugin's own SDK install (the loader serves only the bare
 * specifier), so the cause is the dependency, not the import; esbuild's
 * "Could not resolve" would send the author after the wrong one.
 */
async function unresolvedSdkSubpathError(args: {
  specifier: string;
  resolveDir: string;
  esbuildErrors: readonly { text: string }[];
}): Promise<string> {
  const need = `a server entry's "${args.specifier}" import is bundled from the plugin's own SDK install (bb serves only the bare "${PLUGIN_SDK_SPECIFIER}" at load time), so the plugin needs`;
  const packageDir = await installedPluginSdkDirectory(args.resolveDir);
  if (packageDir === null) {
    return `"${args.specifier}" is not installed for this plugin (no node_modules/${PLUGIN_SDK_PACKAGE_NAME}); ${need} the SDK as a dependency`;
  }
  const subpath = `.${args.specifier.slice(PLUGIN_SDK_PACKAGE_NAME.length)}`;
  const target = await installedPluginSdkExportTarget(packageDir, subpath);
  if (target === null) {
    return `"${args.specifier}" is not exported by the ${PLUGIN_SDK_PACKAGE_NAME} installed at ${packageDir}; ${need} an SDK version that ships it`;
  }
  const targetPath = resolve(packageDir, target);
  if (!(await pathExists(targetPath))) {
    return `"${args.specifier}" is installed for this plugin but its dist is not built: run the SDK build (${targetPath} is missing); ${need} the built SDK`;
  }
  return `"${args.specifier}" could not be resolved from ${packageDir}: ${args.esbuildErrors.map((error) => error.text).join("; ")}`;
}

interface PluginServerConfig {
  /** Absolute path of the `bb.server` entry file. */
  serverEntry: string;
  packageName: string;
  pluginVersion: string;
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

interface PluginServerBuildResult {
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
      // better-sqlite3 comes from the host (bb.storage). Node builtins are
      // auto-external via platform: "node". The SDK specifiers are handled by
      // the plugin below, not here: `external` would take their subpaths too.
      external: PLUGIN_SERVER_EXTERNALS.filter(
        (specifier) => !PLUGIN_SDK_ROOT_FILTER.test(specifier),
      ),
      plugins: [
        {
          name: "bb-plugin-sdk-resolution",
          setup(build) {
            // The bare specifier (and its legacy alias) survives to load
            // time, where the server's loader aliases it to its runtime.
            build.onResolve({ filter: PLUGIN_SDK_ROOT_FILTER }, (args) => ({
              path: args.path,
              external: true,
            }));
            // A subpath is bundled from the plugin's installed SDK; when that
            // fails, name the cause.
            build.onResolve(
              { filter: PLUGIN_SDK_SUBPATH_FILTER },
              async (args) => {
                if (args.pluginData === PLUGIN_SDK_SUBPATH_RESOLVE_MARK) {
                  return undefined;
                }
                const installed = await build.resolve(args.path, {
                  resolveDir: args.resolveDir,
                  kind: args.kind,
                  importer: args.importer,
                  pluginData: PLUGIN_SDK_SUBPATH_RESOLVE_MARK,
                });
                if (installed.errors.length === 0 && installed.path !== "") {
                  return { path: installed.path };
                }
                return {
                  errors: [
                    {
                      text: await unresolvedSdkSubpathError({
                        specifier: args.path,
                        resolveDir: args.resolveDir,
                        esbuildErrors: installed.errors,
                      }),
                    },
                  ],
                };
              },
            );
          },
        },
      ],
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
