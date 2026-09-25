import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { init as initModuleLexer, parse as parseModule } from "es-module-lexer";
import { createPluginArtifactMeta } from "./plugin-artifact-meta.js";
import { zodLocaleStubPlugin } from "./zod-locale-stub.mjs";
import { zodResolutionPlugin } from "./zod-resolution.js";
import {
  isRecord,
  readPluginPackageJsonFile,
  resolveManifestEntryFile,
  validatePluginBuildManifest,
} from "./plugin-manifest.js";
import {
  describeUnresolvedSdkImport,
  PLUGIN_SDK_PACKAGE_NAME,
} from "./plugin-sdk-install.js";
import {
  NODE_ESM_REQUIRE_BANNER,
  type PluginBuildToolchain,
} from "./toolchain.js";

const LEGACY_PLUGIN_SDK_SPECIFIER = "@bb/plugin-sdk";

export const PLUGIN_SERVER_EXTERNALS: readonly string[] = [
  PLUGIN_SDK_PACKAGE_NAME,
  LEGACY_PLUGIN_SDK_SPECIFIER,
  "better-sqlite3",
];

const PLUGIN_SDK_ROOT_FILTER = /^@get-bb\/plugin-sdk$|^@bb\/plugin-sdk$/;
const PLUGIN_SDK_SUBPATH_FILTER = /^@get-bb\/plugin-sdk\//;
const PLUGIN_SDK_SUBPATH_RESOLVE_MARK = "bb-server-sdk-subpath";
const PLUGIN_RUNTIME_FALLBACK_RESOLVE_MARK = "bb-server-runtime-fallback";
const PLUGIN_SOURCE_BOUNDARY_RESOLVE_MARK = "bb-server-source-boundary";
const PLUGIN_BUNDLED_DEPENDENCY_MARK = "bb-server-bundled-dependency";
const BARE_PACKAGE_FILTER = /^[^./]|^@[^/]+\/[^/]+/;
const FILE_IMPORT_FILTER = /^(?:\.{1,2}\/|\/)/;

interface PluginServerConfig {
  serverEntry: string;
  packageName: string;
  pluginVersion: string;
}

async function readPluginServerConfig(
  rootDir: string,
): Promise<PluginServerConfig> {
  const packageJsonPath = join(rootDir, "package.json");
  const json = await readPluginPackageJsonFile(packageJsonPath);
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
  const serverEntry = await resolveManifestEntryFile(
    rootDir,
    manifest.bb.server,
    "bb.server",
  );
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

export interface PluginServerBuildOptions {
  hostProvidedZod?: boolean;
  outDir?: string;
  format?: "esm" | "cjs";
  validatedConfig?: PluginServerConfig;
  runtimeImports?: Record<string, { path: string; external?: boolean }>;
  fallbackResolve?: (specifier: string) => string | undefined;
  preserveSourceModuleLocation?: boolean;
  externalizeSourceOutsideRoot?: boolean;
  externalizeBareImports?: boolean;
}

async function transformSourceModuleLocation(
  esbuild: typeof import("esbuild"),
  path: string,
): Promise<string> {
  const sourceUrl = pathToFileURL(path).href;
  const transformed = await esbuild.transform(await readFile(path, "utf8"), {
    loader: loaderForSourcePath(path),
    target: "node22",
    sourcefile: path,
    define: {
      "import.meta.url": JSON.stringify(sourceUrl),
      "import.meta.dirname": JSON.stringify(dirname(path)),
      "import.meta.filename": JSON.stringify(path),
    },
  });
  await initModuleLexer;
  const [imports] = parseModule(transformed.code);
  let code = transformed.code;
  for (const entry of [...imports].reverse()) {
    if (entry.d < 0 || entry.n !== undefined) continue;
    const expression = code.slice(entry.s, entry.e);
    const resolved = `((specifier) => typeof specifier === "string" && (specifier.startsWith("./") || specifier.startsWith("../")) ? new URL(specifier, ${JSON.stringify(sourceUrl)}).href : specifier)(${expression})`;
    code = `${code.slice(0, entry.s)}${resolved}${code.slice(entry.e)}`;
  }
  return code;
}

function loaderForSourcePath(path: string): "js" | "jsx" | "ts" | "tsx" {
  const extension = extname(path);
  if (extension === ".ts" || extension === ".mts" || extension === ".cts") {
    return "ts";
  }
  if (extension === ".tsx") return "tsx";
  if (extension === ".jsx") return "jsx";
  return "js";
}

export async function buildPluginServer(
  rootDir: string,
  bbVersion: string,
  toolchain: PluginBuildToolchain,
  options: PluginServerBuildOptions = {},
): Promise<PluginServerBuildResult> {
  const { serverEntry, packageName, pluginVersion } =
    options.validatedConfig ?? (await readPluginServerConfig(rootDir));
  const format = options.format ?? "esm";
  const sourceRoot = await realpath(rootDir);
  const distDir = options.outDir ?? join(rootDir, "dist");
  await mkdir(distDir, { recursive: true });
  const fileName = format === "esm" ? "server.js" : "server.cjs";
  const jsPath = join(distDir, fileName);
  const mapPath = join(distDir, `${fileName}.map`);
  const metaPath = join(distDir, "server.meta.json");

  const stageDir = await mkdtemp(join(distDir, ".stage-"));
  try {
    const stagedJsPath = join(stageDir, fileName);
    const stagedMetaPath = join(stageDir, "server.meta.json");

    const esbuild = (await import(
      toolchain.esbuild
    )) as typeof import("esbuild");
    const runtimeImports = options.runtimeImports ?? {};
    await esbuild.build({
      entryPoints: [serverEntry],
      outfile: stagedJsPath,
      bundle: true,
      format,
      platform: "node",
      target: "node22",
      sourcemap: true,
      sourcesContent: false,
      ...(format === "esm" ? { banner: { js: NODE_ESM_REQUIRE_BANNER } } : {}),
      external: PLUGIN_SERVER_EXTERNALS.filter(
        (specifier) =>
          !PLUGIN_SDK_ROOT_FILTER.test(specifier) &&
          runtimeImports[specifier] === undefined,
      ).concat(
        Object.values(runtimeImports)
          .filter((entry) => entry.external === true)
          .map((entry) => entry.path),
      ),
      minify: true,
      keepNames: true,
      plugins: [
        zodResolutionPlugin("server", {
          hostProvidedBareZod: options.hostProvidedZod,
          fallbackResolve: options.fallbackResolve,
        }),
        zodLocaleStubPlugin(),
        ...(options.preserveSourceModuleLocation === true
          ? [
              {
                name: "bb-plugin-source-url",
                setup(build: import("esbuild").PluginBuild) {
                  build.onLoad(
                    { filter: /\.(?:[cm]?[jt]s|[jt]sx)$/ },
                    async (args: import("esbuild").OnLoadArgs) => ({
                      contents: await transformSourceModuleLocation(
                        esbuild,
                        args.path,
                      ),
                      loader: "js",
                      pluginData: args.pluginData,
                    }),
                  );
                },
              },
            ]
          : []),
        {
          name: "bb-plugin-sdk-resolution",
          setup(build) {
            for (const [specifier, entry] of Object.entries(runtimeImports)) {
              const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              build.onResolve({ filter: new RegExp(`^${escaped}$`) }, () => ({
                path: entry.path,
                external: entry.external === true,
                pluginData: PLUGIN_BUNDLED_DEPENDENCY_MARK,
              }));
            }
            build.onResolve({ filter: PLUGIN_SDK_ROOT_FILTER }, (args) => ({
              path: args.path,
              external: true,
            }));
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
                  return {
                    path: installed.path,
                    pluginData: PLUGIN_BUNDLED_DEPENDENCY_MARK,
                  };
                }
                return {
                  errors: [
                    {
                      text: await describeUnresolvedSdkImport({
                        specifier: args.path,
                        resolveDir: args.resolveDir,
                        need: `a server entry's "${args.path}" import is bundled from the plugin's own SDK install (bb serves only the bare "${PLUGIN_SDK_PACKAGE_NAME}" at load time), so the plugin needs`,
                        esbuildErrors: installed.errors,
                      }),
                    },
                  ],
                };
              },
            );
            build.onResolve({ filter: BARE_PACKAGE_FILTER }, async (args) => {
              if (
                args.pluginData === PLUGIN_RUNTIME_FALLBACK_RESOLVE_MARK ||
                PLUGIN_SDK_SUBPATH_FILTER.test(args.path) ||
                /^zod($|\/)/.test(args.path) ||
                options.fallbackResolve === undefined
              ) {
                return undefined;
              }
              const installed = await build.resolve(args.path, {
                resolveDir: args.resolveDir,
                kind: args.kind,
                importer: args.importer,
                pluginData: PLUGIN_RUNTIME_FALLBACK_RESOLVE_MARK,
              });
              if (installed.errors.length === 0 && installed.path !== "") {
                return {
                  path: installed.path,
                  external:
                    options.externalizeBareImports === true ||
                    installed.external ||
                    installed.path.startsWith("node:"),
                  pluginData: PLUGIN_BUNDLED_DEPENDENCY_MARK,
                };
              }
              const fallback = options.fallbackResolve(args.path);
              return fallback === undefined || fallback.startsWith("node:")
                ? undefined
                : {
                    path: fallback,
                    external: options.externalizeBareImports === true,
                    pluginData: PLUGIN_BUNDLED_DEPENDENCY_MARK,
                  };
            });
            if (options.externalizeSourceOutsideRoot === true) {
              build.onResolve({ filter: FILE_IMPORT_FILTER }, async (args) => {
                if (
                  args.importer === "" ||
                  args.kind === "entry-point" ||
                  args.pluginData === PLUGIN_BUNDLED_DEPENDENCY_MARK ||
                  args.pluginData === PLUGIN_SOURCE_BOUNDARY_RESOLVE_MARK
                ) {
                  return undefined;
                }
                const importerFromRoot = relative(sourceRoot, args.importer);
                if (
                  importerFromRoot === ".." ||
                  importerFromRoot.startsWith(`..${sep}`) ||
                  importerFromRoot.split(sep).includes("node_modules")
                ) {
                  return undefined;
                }
                const resolved = await build.resolve(args.path, {
                  resolveDir: args.resolveDir,
                  kind: args.kind,
                  importer: args.importer,
                  pluginData: PLUGIN_SOURCE_BOUNDARY_RESOLVE_MARK,
                });
                if (resolved.errors.length > 0 || resolved.path === "") {
                  return undefined;
                }
                const fromRoot = relative(sourceRoot, resolved.path);
                if (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`)) {
                  return { path: resolved.path };
                }
                if (args.kind === "dynamic-import") {
                  return { path: resolved.path, external: true };
                }
                return {
                  errors: [
                    {
                      text: `server source import escapes the plugin directory: ${args.path}`,
                    },
                  ],
                };
              });
            }
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

    if (format === "esm") {
      await writeFile(join(stageDir, "package.json"), '{"type":"module"}\n');
    }

    await rename(stagedJsPath, jsPath);
    await rename(join(stageDir, `${fileName}.map`), mapPath);
    await rename(stagedMetaPath, metaPath);
    if (format === "esm") {
      await rename(
        join(stageDir, "package.json"),
        join(distDir, "package.json"),
      );
    }
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
  return { jsPath, mapPath, metaPath };
}
