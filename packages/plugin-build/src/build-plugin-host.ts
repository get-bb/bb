import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createPluginArtifactMeta } from "./plugin-artifact-meta.js";
import { zodLocaleStubPlugin } from "./zod-locale-stub.mjs";
import { zodResolutionPlugin } from "./zod-resolution.js";
import {
  isRecord,
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

const PLUGIN_SDK_ROOT_RUNTIME = `
export const PLUGIN_CLI_OUTPUT_MAX_BYTES = 1024 * 1024;
export function defineRpcContract(contract) { return contract; }
${PLUGIN_SDK_DEFINE_HOST_ENTRY_RUNTIME}`;

const PLUGIN_SDK_HOST_FALLBACK_SPECIFIER = "@get-bb/plugin-sdk/host";
const PLUGIN_SDK_HOST_FALLBACK_EXPORTS: ReadonlySet<string> = new Set([
  "experimental_defineHostEntry",
]);
const PLUGIN_SDK_HOST_FALLBACK_NAMESPACE = "bb-host-sdk-fallback";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

interface SourceToken {
  kind: "identifier" | "punctuation" | "string";
  value: string;
}

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
  const hostEntry = await resolveManifestEntryFile(rootDir, host, "bb.host");
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

export async function buildPluginHost(
  rootDir: string,
  bbVersion: string,
  toolchain: PluginBuildToolchain,
): Promise<PluginHostBuildResult> {
  const { hostEntry, packageName, pluginVersion } =
    await readPluginHostConfig(rootDir);
  const workingDir = await realpath(rootDir);
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
    const sourceImports = new Map<string, string[]>();
    const bundle = await esbuild.build({
      absWorkingDir: workingDir,
      metafile: true,
      entryPoints: [hostEntry],
      outfile: stagedJsPath,
      bundle: true,
      format: "esm",
      platform: "node",
      minify: true,
      keepNames: true,
      plugins: [
        zodResolutionPlugin("host"),
        zodLocaleStubPlugin(),
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
                      text: await describeUnresolvedSdkImport({
                        specifier: PLUGIN_SDK_HOST_FALLBACK_SPECIFIER,
                        resolveDir: args.resolveDir,
                        need: `a host entry that imports ${describeImportedNames(beyondStub)} needs`,
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
                contents: PLUGIN_SDK_DEFINE_HOST_ENTRY_RUNTIME,
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
              const specifiers = sourceImportSpecifiers(source);
              for (const specifier of specifiers) {
                if (specifier === "@bb" || specifier.startsWith("@bb/")) {
                  return {
                    errors: [{ text: privateBbImportError(specifier) }],
                  };
                }
              }
              sourceImports.set(args.path, specifiers);
              return undefined;
            });
          },
        },
      ],
      target: "node22",
      sourcemap: true,
      sourcesContent: false,
      banner: { js: NODE_ESM_REQUIRE_BANNER },
      logLevel: "error",
    });
    const skippedImports = new Map<
      string,
      { importer: string; specifiers: string[] }
    >();
    if (bundle.metafile === undefined)
      throw new Error("Missing host build import graph");
    for (const [input, metadata] of Object.entries(bundle.metafile.inputs)) {
      const importer = resolve(workingDir, input);
      const owner = await owningPackageName(importer, packageNameByDirectory);
      if (owner === "@bb" || owner?.startsWith("@bb/"))
        throw new Error(privateBbImportError(owner));
      const bundledImports = new Set(
        metadata.imports
          .filter((entry) => !entry.external)
          .map((entry) => entry.original ?? entry.path),
      );
      const specifiers = [...new Set(sourceImports.get(importer) ?? [])].filter(
        (specifier) =>
          !bundledImports.has(specifier) &&
          (specifier.startsWith(".") || isAbsolute(specifier)),
      );
      if (specifiers.length > 0)
        skippedImports.set(`bb-host-imports:${skippedImports.size}`, {
          importer,
          specifiers,
        });
    }
    if (skippedImports.size > 0) {
      await esbuild.build({
        absWorkingDir: workingDir,
        entryPoints: [...skippedImports.keys()],
        outdir: stageDir,
        bundle: true,
        write: false,
        platform: "node",
        logLevel: "error",
        plugins: [
          {
            name: "validate-erased-host-imports",
            setup(build) {
              build.onResolve(
                { filter: /.*/, namespace: "bb-host-imports" },
                async (args) => {
                  const resolved = await build.resolve(args.path, {
                    resolveDir: args.resolveDir,
                    importer: skippedImports.get(args.importer)?.importer,
                    kind: "import-statement",
                  });
                  return resolved.errors.length > 0 || !resolved.path
                    ? { path: args.path, external: true }
                    : resolved;
                },
              );
              build.onResolve({ filter: /^bb-host-imports:/ }, (args) => ({
                path: args.path,
                namespace: "bb-host-imports",
              }));
              build.onLoad(
                { filter: /.*/, namespace: "bb-host-imports" },
                (args) => {
                  const entry = skippedImports.get(args.path);
                  if (entry === undefined)
                    throw new Error(
                      `Unknown host import validation entry: ${args.path}`,
                    );
                  return {
                    contents: entry.specifiers
                      .map(
                        (specifier) => `import ${JSON.stringify(specifier)};`,
                      )
                      .join("\n"),
                    resolveDir: dirname(entry.importer),
                    loader: "js",
                  };
                },
              );
              build.onLoad(
                { filter: /.*/, namespace: "file" },
                async (args) => {
                  const owner = await owningPackageName(
                    args.path,
                    packageNameByDirectory,
                  );
                  if (owner === "@bb" || owner?.startsWith("@bb/"))
                    return { errors: [{ text: privateBbImportError(owner) }] };
                  return { contents: "", loader: "js" };
                },
              );
            },
          },
        ],
      });
    }
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
