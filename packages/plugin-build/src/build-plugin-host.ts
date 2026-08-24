import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
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

const PLUGIN_SDK_HOST_RUNTIME_NAMESPACE = "bb-host-sdk-runtime";
const HOST_STAGE_DIRECTORY_PREFIX = ".host-stage-";
const HOST_STAGE_STALE_AFTER_MS = 60 * 60 * 1_000;

const PLUGIN_SDK_DEFINE_HOST_ENTRY_RUNTIME = `
export function experimental_defineHostEntry(args) {
  return {
    experimental_apiVersion: 1,
    contract: args.contract,
    handlers: args.handlers,
    ...(args.experimental_signals === undefined ? {} : { experimental_signals: args.experimental_signals }),
    ...(args.dispose === undefined ? {} : { dispose: args.dispose }),
  };
}
`;

/**
 * Build-time runtime stub for the SDK root, `@get-bb/plugin-sdk`. Managed
 * plugins are installed with production dependencies only and the SDK is
 * intentionally a development/type dependency for plugin authors, so the
 * builder supplies the root's side-effect-free, host-implemented runtime
 * helpers while bundling.
 *
 * `@get-bb/plugin-sdk/provider-bridge`, `/ai-services` and `/host` are
 * deliberately not stubbed: they are pure schema and helper code with no
 * daemon-pinned behavior (`experimental_defineHostEntry` only shapes a record;
 * the host contracts are zod schemas), so a plugin depends on the SDK for real
 * and the build inlines its published bundle. A stub that re-implemented
 * `/host` had to be kept in step with every export the subpath gained, and
 * silently broke the first artifact that imported a host contract from it.
 */
const PLUGIN_SDK_ROOT_RUNTIME = `
export const PLUGIN_CLI_OUTPUT_MAX_BYTES = 1024 * 1024;
export function defineRpcContract(contract) { return contract; }
${PLUGIN_SDK_DEFINE_HOST_ENTRY_RUNTIME}`;

/**
 * `@get-bb/plugin-sdk/host` is bundled from the plugin's own SDK install when
 * it has one — a host entry that serves a published host contract
 * (`experimental_nativeRootsHostContract`) needs the real module. A plugin that
 * only shapes a host entry and keeps the SDK type-only gets this stub instead,
 * so such a plugin still builds without `node_modules`. A file that imports
 * more than the stub serves fails with the real cause (SDK not installed, or
 * installed but its dist not built) instead of esbuild's "No matching export"
 * against the stub.
 */
const PLUGIN_SDK_HOST_SUBPATH = "./host";
const PLUGIN_SDK_HOST_FALLBACK_SPECIFIER = "@get-bb/plugin-sdk/host";
/** Every runtime export the fallback stub below serves. */
const PLUGIN_SDK_HOST_FALLBACK_EXPORTS: ReadonlySet<string> = new Set([
  "experimental_defineHostEntry",
]);
const PLUGIN_SDK_HOST_FALLBACK_RUNTIME = PLUGIN_SDK_DEFINE_HOST_ENTRY_RUNTIME;
const PLUGIN_SDK_HOST_FALLBACK_NAMESPACE = "bb-host-sdk-fallback";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

interface SourceToken {
  kind: "identifier" | "punctuation" | "string";
  value: string;
}

/** A small lexical scan avoids treating examples in comments/strings as imports. */
function sourceTokens(source: string): SourceToken[] {
  const tokens: SourceToken[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index] ?? "";
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      index = source.indexOf("\n", index + 2);
      if (index === -1) break;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      const quote = character;
      let value = "";
      index += 1;
      while (index < source.length) {
        const next = source[index] ?? "";
        if (next === "\\") {
          // Module package names never need escapes. Preserve the following
          // character so an escaped quote cannot terminate the token early.
          value += source[index + 1] ?? "";
          index += 2;
          continue;
        }
        if (next === quote) {
          index += 1;
          break;
        }
        value += next;
        index += 1;
      }
      tokens.push({ kind: "string", value });
      continue;
    }
    if (character === "`") {
      // Static module specifiers cannot be template literals. Skip the whole
      // literal; runtime imports inside substitutions still reach onResolve.
      index += 1;
      while (index < source.length) {
        const next = source[index] ?? "";
        if (next === "\\") index += 2;
        else if (next === "`") {
          index += 1;
          break;
        } else index += 1;
      }
      continue;
    }
    if (/[A-Za-z0-9_$]/u.test(character)) {
      const start = index;
      index += 1;
      while (/[A-Za-z0-9_$]/u.test(source[index] ?? "")) index += 1;
      tokens.push({
        kind: "identifier",
        value: source.slice(start, index),
      });
      continue;
    }
    tokens.push({ kind: "punctuation", value: character });
    index += 1;
  }
  return tokens;
}

function sourceImportSpecifiers(source: string): string[] {
  const tokens = sourceTokens(source);
  const specifiers: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.kind !== "string") continue;
    const previous = tokens[index - 1]?.value;
    const callee = previous === "(" ? tokens[index - 2]?.value : undefined;
    if (
      previous === "from" ||
      previous === "import" ||
      callee === "import" ||
      callee === "require"
    ) {
      specifiers.push(token.value);
    }
  }
  return specifiers;
}

/**
 * The runtime names `source` imports or re-exports from `specifier`:
 * `import { a, b as c } from`, `export { a } from`, a default import
 * (`"default"`), or a namespace/star form (`"*"`). Type-only forms
 * (`import type`, `{ type X }`) are dropped, as esbuild drops them before
 * resolution. Dynamic `import()` calls carry no names and are ignored.
 */
function importedRuntimeNames(source: string, specifier: string): string[] {
  const tokens = sourceTokens(source);
  const names: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.kind !== "string" || token.value !== specifier) continue;
    if (tokens[index - 1]?.value !== "from") continue;
    let start = index - 2;
    while (start >= 0) {
      const candidate = tokens[start];
      if (
        candidate?.kind === "identifier" &&
        (candidate.value === "import" || candidate.value === "export")
      ) {
        break;
      }
      start -= 1;
    }
    if (start < 0) continue;
    const clause = tokens.slice(start + 1, index - 1);
    if (clause[0]?.kind === "identifier" && clause[0].value === "type") {
      continue;
    }
    let braceDepth = 0;
    let entry: SourceToken[] = [];
    let previousTopLevel: SourceToken | undefined;
    const flushEntry = () => {
      const first = entry[0];
      if (first !== undefined) {
        const typeOnly =
          first.kind === "identifier" &&
          first.value === "type" &&
          entry.length > 1 &&
          entry[1]?.value !== "as";
        if (!typeOnly) names.push(first.value);
      }
      entry = [];
    };
    for (const item of clause) {
      if (item.kind === "punctuation" && item.value === "{") {
        braceDepth += 1;
        continue;
      }
      if (item.kind === "punctuation" && item.value === "}") {
        flushEntry();
        braceDepth -= 1;
        continue;
      }
      if (item.kind === "punctuation" && item.value === ",") {
        if (braceDepth > 0) flushEntry();
        continue;
      }
      if (braceDepth > 0) {
        entry.push(item);
        continue;
      }
      if (item.kind === "punctuation" && item.value === "*") {
        names.push("*");
      } else if (
        item.kind === "identifier" &&
        item.value !== "as" &&
        previousTopLevel?.value !== "as"
      ) {
        names.push("default");
      }
      previousTopLevel = item;
    }
  }
  return names;
}

function describeImportedNames(names: readonly string[]): string {
  return [...new Set(names)]
    .map((name) =>
      name === "*"
        ? "the whole module"
        : name === "default"
          ? "the default export"
          : name,
    )
    .join(", ");
}

/**
 * Why `@get-bb/plugin-sdk/host` did not resolve for a host entry that needs
 * more of it than the fallback stub serves. esbuild's own report is a
 * misleading "No matching export in bb-host-sdk-fallback:…"; this names the
 * real cause so the author fixes the dependency, not the import.
 */
async function unresolvedHostSdkError(args: {
  resolveDir: string;
  names: readonly string[];
  esbuildErrors: readonly { text: string }[];
}): Promise<string> {
  const need = `a host entry that imports ${describeImportedNames(args.names)} needs`;
  const packageDir = await installedPluginSdkDirectory(args.resolveDir);
  if (packageDir === null) {
    return `"${PLUGIN_SDK_HOST_FALLBACK_SPECIFIER}" is not installed for this plugin (no node_modules/${PLUGIN_SDK_PACKAGE_NAME}); ${need} the SDK as a dependency`;
  }
  const target = await installedPluginSdkExportTarget(
    packageDir,
    PLUGIN_SDK_HOST_SUBPATH,
  );
  if (target === null) {
    return `"${PLUGIN_SDK_HOST_FALLBACK_SPECIFIER}" is not exported by the ${PLUGIN_SDK_PACKAGE_NAME} installed at ${packageDir}; ${need} an SDK version that ships it`;
  }
  const targetPath = resolve(packageDir, target);
  if (!(await pathExists(targetPath))) {
    return `"${PLUGIN_SDK_HOST_FALLBACK_SPECIFIER}" is installed for this plugin but its dist is not built: run the SDK build (${targetPath} is missing); ${need} the built SDK`;
  }
  return `"${PLUGIN_SDK_HOST_FALLBACK_SPECIFIER}" could not be resolved from ${packageDir}: ${args.esbuildErrors.map((error) => error.text).join("; ")}`;
}

function privateBbImportError(specifier: string): string {
  return `host entries cannot import private BB workspace package "${specifier}"; use @get-bb/plugin-sdk, Node APIs, or a regular plugin dependency`;
}

async function owningPackageName(
  filePath: string,
  cache: Map<string, string | null>,
): Promise<string | null> {
  let directory = dirname(filePath);
  const visited: string[] = [];
  while (true) {
    const cached = cache.get(directory);
    if (cached !== undefined || cache.has(directory)) {
      for (const entry of visited) cache.set(entry, cached ?? null);
      return cached ?? null;
    }
    visited.push(directory);
    try {
      const parsed: unknown = JSON.parse(
        await readFile(join(directory, "package.json"), "utf8"),
      );
      const name =
        isRecord(parsed) && typeof parsed.name === "string"
          ? parsed.name
          : null;
      for (const entry of visited) cache.set(entry, name);
      return name;
    } catch {
      const parent = dirname(directory);
      if (parent === directory) {
        for (const entry of visited) cache.set(entry, null);
        return null;
      }
      directory = parent;
    }
  }
}

async function readPluginHostConfig(rootDir: string): Promise<{
  hostEntry: string;
  packageName: string;
  pluginVersion: string;
}> {
  const packageJsonPath = join(rootDir, "package.json");
  let json: unknown;
  try {
    json = JSON.parse(await readFile(packageJsonPath, "utf8"));
  } catch {
    throw new Error(`no readable valid package.json at ${packageJsonPath}`);
  }
  if (!isRecord(json) || !isRecord(json.bb) || json.bb.host === undefined) {
    throw new Error(
      `no host entry: ${packageJsonPath} has no "bb": { "host": "./host.ts" } field`,
    );
  }
  const manifest = await validatePluginBuildManifest(
    json,
    rootDir,
    packageJsonPath,
  );
  const host = manifest.bb.host;
  if (host === undefined) {
    throw new Error(`no host entry in ${packageJsonPath}`);
  }
  if (isAbsolute(host)) {
    throw new Error(`manifest bb.host must be relative, got "${host}"`);
  }
  const hostEntry = resolve(rootDir, host);
  if (hostEntry !== rootDir && !hostEntry.startsWith(rootDir + "/")) {
    throw new Error(`manifest bb.host escapes the plugin directory: "${host}"`);
  }
  try {
    await stat(hostEntry);
  } catch {
    throw new Error(`manifest bb.host points at a missing file: ${host}`);
  }
  return {
    hostEntry,
    packageName: manifest.name,
    pluginVersion: manifest.version,
  };
}

interface PluginHostBuildResult {
  jsPath: string;
  mapPath: string;
  metaPath: string;
  artifactDigest: string;
}

async function removeStaleHostStageDirectories(distDir: string): Promise<void> {
  const entries = await readdir(distDir, { withFileTypes: true });
  const staleBefore = Date.now() - HOST_STAGE_STALE_AFTER_MS;
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.startsWith(HOST_STAGE_DIRECTORY_PREFIX),
      )
      .map(async (entry) => {
        const stageDir = join(distDir, entry.name);
        const stageStats = await stat(stageDir).catch(() => null);
        if (stageStats !== null && stageStats.mtimeMs <= staleBefore) {
          await rm(stageDir, { recursive: true, force: true });
        }
      }),
  );
}

/** Build the optional Node host entry into a self-contained remote artifact. */
export async function buildPluginHost(
  rootDir: string,
  bbVersion: string,
  toolchain: PluginBuildToolchain,
): Promise<PluginHostBuildResult> {
  const { hostEntry, packageName, pluginVersion } =
    await readPluginHostConfig(rootDir);
  const distDir = join(rootDir, "dist");
  await mkdir(distDir, { recursive: true });
  const jsPath = join(distDir, "host.js");
  const mapPath = join(distDir, "host.js.map");
  const metaPath = join(distDir, "host.meta.json");
  await removeStaleHostStageDirectories(distDir);
  const stageDir = await mkdtemp(join(distDir, HOST_STAGE_DIRECTORY_PREFIX));
  try {
    const stagedJsPath = join(stageDir, "host.js");
    const stagedMetaPath = join(stageDir, "host.meta.json");
    const esbuild = (await import(
      toolchain.esbuild
    )) as typeof import("esbuild");
    const packageNameByDirectory = new Map<string, string | null>();
    await esbuild.build({
      entryPoints: [hostEntry],
      outfile: stagedJsPath,
      bundle: true,
      format: "esm",
      platform: "node",
      plugins: [
        {
          name: "provide-public-host-sdk-runtime",
          setup(build) {
            const rootFilter = new RegExp(
              `^${escapeRegex(PLUGIN_SDK_PACKAGE_NAME)}$`,
            );
            build.onResolve({ filter: rootFilter }, (args) => ({
              path: args.path,
              namespace: PLUGIN_SDK_HOST_RUNTIME_NAMESPACE,
            }));
            build.onLoad(
              { filter: /.*/, namespace: PLUGIN_SDK_HOST_RUNTIME_NAMESPACE },
              () => ({ contents: PLUGIN_SDK_ROOT_RUNTIME, loader: "js" }),
            );
            const hostFilter = new RegExp(
              `^${escapeRegex(PLUGIN_SDK_HOST_FALLBACK_SPECIFIER)}$`,
            );
            build.onResolve({ filter: hostFilter }, async (args) => {
              if (args.pluginData === PLUGIN_SDK_HOST_FALLBACK_NAMESPACE) {
                return undefined;
              }
              const installed = await build.resolve(args.path, {
                resolveDir: args.resolveDir,
                kind: args.kind,
                importer: args.importer,
                pluginData: PLUGIN_SDK_HOST_FALLBACK_NAMESPACE,
              });
              if (installed.errors.length === 0 && installed.path !== "") {
                return { path: installed.path };
              }
              // The stub serves `experimental_defineHostEntry` only. A file
              // that imports anything else (a host contract, say) needs the
              // real module, and esbuild's "No matching export" against the
              // stub would hide that; say what is actually missing.
              const importerSource = /\.[cm]?[jt]sx?$/u.test(args.importer)
                ? await readFile(args.importer, "utf8").catch(() => null)
                : null;
              const beyondStub =
                importerSource === null
                  ? []
                  : importedRuntimeNames(importerSource, args.path).filter(
                      (name) => !PLUGIN_SDK_HOST_FALLBACK_EXPORTS.has(name),
                    );
              if (beyondStub.length > 0) {
                return {
                  errors: [
                    {
                      text: await unresolvedHostSdkError({
                        resolveDir: args.resolveDir,
                        names: beyondStub,
                        esbuildErrors: installed.errors,
                      }),
                    },
                  ],
                };
              }
              return {
                path: args.path,
                namespace: PLUGIN_SDK_HOST_FALLBACK_NAMESPACE,
              };
            });
            build.onLoad(
              { filter: /.*/, namespace: PLUGIN_SDK_HOST_FALLBACK_NAMESPACE },
              () => ({
                contents: PLUGIN_SDK_HOST_FALLBACK_RUNTIME,
                loader: "js",
              }),
            );
          },
        },
        {
          name: "reject-private-bb-host-imports",
          setup(build) {
            build.onResolve({ filter: /^@bb(?:\/|$)/ }, (args) => ({
              errors: [{ text: privateBbImportError(args.path) }],
            }));
            // esbuild removes type-only imports before resolution. Inspect
            // loaded source too, so in-repo plugins cannot use private BB
            // types that an external plugin would not be able to resolve.
            build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
              const owner = await owningPackageName(
                args.path,
                packageNameByDirectory,
              );
              if (owner === "@bb" || owner?.startsWith("@bb/")) {
                return {
                  errors: [{ text: privateBbImportError(owner) }],
                };
              }
              const source = await readFile(args.path, "utf8");
              for (const specifier of sourceImportSpecifiers(source)) {
                if (specifier === "@bb" || specifier.startsWith("@bb/")) {
                  return {
                    errors: [{ text: privateBbImportError(specifier) }],
                  };
                }
                // Resolve imports esbuild may erase (notably `import type`) so
                // a builtin cannot bypass the package boundary with a relative
                // path into a private workspace package.
                if (!specifier.startsWith(".") && !isAbsolute(specifier)) {
                  continue;
                }
                const resolvedImport = await build.resolve(specifier, {
                  importer: args.path,
                  kind: "import-statement",
                  resolveDir: dirname(args.path),
                });
                if (resolvedImport.errors.length > 0 || !resolvedImport.path) {
                  continue;
                }
                const importedOwner = await owningPackageName(
                  resolvedImport.path,
                  packageNameByDirectory,
                );
                if (
                  importedOwner === "@bb" ||
                  importedOwner?.startsWith("@bb/")
                ) {
                  return {
                    errors: [{ text: privateBbImportError(importedOwner) }],
                  };
                }
              }
              return undefined;
            });
          },
        },
      ],
      target: "node22",
      sourcemap: true,
      banner: { js: NODE_ESM_REQUIRE_BANNER },
      logLevel: "error",
    });
    const artifactDigest = createHash("sha256")
      .update(await readFile(stagedJsPath))
      .digest("hex");
    await writeFile(
      stagedMetaPath,
      JSON.stringify(
        {
          ...createPluginArtifactMeta({
            packageName,
            pluginVersion,
            bbVersion,
          }),
          artifactDigest,
        },
        null,
        2,
      ) + "\n",
    );
    await rename(stagedJsPath, jsPath);
    await rename(join(stageDir, "host.js.map"), mapPath);
    await rename(stagedMetaPath, metaPath);
    return { jsPath, mapPath, metaPath, artifactDigest };
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
}
