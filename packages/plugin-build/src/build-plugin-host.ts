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
import { validatePluginBuildManifest } from "./plugin-manifest.js";
import type { PluginBuildToolchain } from "./toolchain.js";

const NODE_ESM_REQUIRE_BANNER = [
  'import { createRequire as __createRequire } from "node:module";',
  'import { dirname as __pathDirname } from "node:path";',
  'import { fileURLToPath as __fileURLToPath } from "node:url";',
  "const require = __createRequire(import.meta.url);",
  "var __filename = __fileURLToPath(import.meta.url);",
  "var __dirname = __pathDirname(__filename);",
].join("\n");

const PLUGIN_SDK_HOST_RUNTIME_NAMESPACE = "bb-host-sdk-runtime";
const HOST_STAGE_DIRECTORY_PREFIX = ".host-stage-";
const HOST_STAGE_STALE_AFTER_MS = 60 * 60 * 1_000;

// Managed plugins are installed with production dependencies only. The SDK
// is intentionally a development/type dependency for plugin authors, so the
// builder supplies its side-effect-free runtime helpers while bundling.
const PLUGIN_SDK_ROOT_RUNTIME = `
export const PLUGIN_CLI_OUTPUT_MAX_BYTES = 1024 * 1024;
export function defineRpcContract(contract) { return contract; }
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

const PLUGIN_SDK_HOST_RUNTIME = `
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
 * Build-time runtime stubs for public SDK entrypoints usable from a bb.host
 * artifact. Keep this table declarative so another daemon-side consumer can
 * add its published authoring surface without adding another manifest entry
 * or a parallel artifact builder.
 *
 * An entry belongs here only when the surface's *runtime* must come from the
 * host rather than from the plugin's own node_modules — the members below are
 * host-implemented and the SDK is a type-only devDependency for authors.
 * `@get-bb/plugin-sdk/provider-bridge` is deliberately absent: it is pure schema and
 * helper code with no daemon-pinned behavior, so a provider plugin depends on
 * the SDK for real and the build inlines its published bundle.
 */
export const HOST_ARTIFACT_RUNTIME_STUBS: Record<string, string> = {
  "@get-bb/plugin-sdk": PLUGIN_SDK_ROOT_RUNTIME,
  "@get-bb/plugin-sdk/host": PLUGIN_SDK_HOST_RUNTIME,
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export interface PluginHostBuildResult {
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
            const runtimeStubFilter = new RegExp(
              `^(?:${Object.keys(HOST_ARTIFACT_RUNTIME_STUBS)
                .map(escapeRegex)
                .join("|")})$`,
            );
            build.onResolve({ filter: runtimeStubFilter }, (args) => ({
              path: args.path,
              namespace: PLUGIN_SDK_HOST_RUNTIME_NAMESPACE,
            }));
            build.onLoad(
              {
                filter: /.*/,
                namespace: PLUGIN_SDK_HOST_RUNTIME_NAMESPACE,
              },
              (args) => {
                const contents = HOST_ARTIFACT_RUNTIME_STUBS[args.path];
                if (contents === undefined) {
                  throw new Error(
                    `no host artifact runtime stub registered for "${args.path}"`,
                  );
                }
                return { contents, loader: "js" };
              },
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
