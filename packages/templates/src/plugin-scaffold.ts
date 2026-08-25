import { randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { derivePluginId, PLUGIN_SDK_VERSION } from "@bb/domain";
import { loadPluginSdkDeclarations } from "./plugin-sdk-dts.js";
import {
  PLUGIN_STARTER_DEPENDENCIES,
  PLUGIN_STARTER_FILES,
  PLUGIN_STARTER_TYPE_DEPENDENCIES,
} from "./generated/plugin-starter-files.generated.js";

/**
 * `bb plugin new` scaffold. Lives in @bb/templates because both the CLI
 * (which writes it) and the server test suite (which verifies the scaffold
 * actually loads through the plugin service) consume it.
 */
interface ScaffoldPluginArgs {
  /** Directory to create; scaffolding fails if it already exists. */
  targetDir: string;
  /** Full package name, e.g. "bb-plugin-hello". */
  packageName: string;
  /** BB app version; engines.bb is pinned to ">=<major.minor>". */
  bbVersion: string;
}

/** Arguments for {@link syncPluginTypes}. */
interface SyncPluginTypesArgs {
  /** Plugin root directory (the one holding `package.json`). */
  rootDir: string;
  /**
   * Also refresh the frontend declaration. Callers pass whether the manifest
   * declares `bb.app`; an existing `bb-plugin-sdk-app.d.ts` refreshes either
   * way, so a headless read of the manifest never strands a stale copy.
   */
  app: boolean;
  /**
   * Report what a write would do and touch nothing (`bb plugin types
   * --check`, CI). Stale or missing files come back as `stale`.
   */
  check?: boolean;
}

/** One declaration file considered by {@link syncPluginTypes}. */
interface SyncedPluginTypeFile {
  /** Path relative to the plugin root, e.g. `types/bb-plugin-sdk.d.ts`. */
  path: string;
  /**
   * `written` when the file was created or its contents changed, `stale` when
   * a check found it missing or outdated, `unchanged` when it already matches.
   */
  outcome: "written" | "unchanged" | "stale";
}

/**
 * Write this build's bundled `@get-bb/plugin-sdk` declarations into a plugin's
 * `types/` directory, creating it when absent.
 *
 * `bb plugin new` seeds these once, but the SDK surface grows with every BB
 * release, so a copy scaffolded months ago silently under-reports the API.
 * `bb plugin types`, `bb plugin build`, and `bb plugin dev` all call this so
 * the local declarations track the bb that is actually running the plugin.
 * Files are compared before writing, so an already-current plugin reports
 * `unchanged` and keeps its mtime.
 */
export async function syncPluginTypes(
  args: SyncPluginTypesArgs,
): Promise<SyncedPluginTypeFile[]> {
  const { rootDir, app, check = false } = args;
  const typesDir = join(rootDir, "types");
  const declarations = await loadPluginSdkDeclarations();
  const candidates: { name: string; content: string; optional: boolean }[] = [
    { name: "bb-plugin-sdk.d.ts", content: declarations.root, optional: false },
    {
      name: "bb-plugin-sdk-app.d.ts",
      content: declarations.app,
      // Refresh a frontend declaration the plugin already has even when the
      // caller did not detect bb.app; never create one it never asked for.
      optional: !app,
    },
  ];
  await assertWritableTypesDir(rootDir, typesDir);
  const results: SyncedPluginTypeFile[] = [];
  for (const candidate of candidates) {
    const filePath = join(typesDir, candidate.name);
    const relativePath = `types/${candidate.name}`;
    const existing = await statNoFollow(filePath, relativePath);
    if (existing !== null && !existing.isFile()) {
      throw new Error(`${relativePath} is not a regular file`);
    }
    const current = existing === null ? null : await readFile(filePath, "utf8");
    if (current === null && candidate.optional) continue;
    if (current === candidate.content) {
      results.push({ path: relativePath, outcome: "unchanged" });
      continue;
    }
    if (check) {
      results.push({ path: relativePath, outcome: "stale" });
      continue;
    }
    await mkdir(typesDir, { recursive: true });
    await writeFileAtomically(filePath, relativePath, candidate.content);
    results.push({ path: relativePath, outcome: "written" });
  }
  return results;
}

/**
 * How a plugin on disk gets its `@get-bb/plugin-sdk` declarations.
 *
 * - `vendored`: the pre-npm layout — a `types/bb-plugin-sdk.d.ts` copy, and/or
 *   a tsconfig that maps `@get-bb/plugin-sdk` onto it. {@link syncPluginTypes}
 *   owns these, and `bb plugin types|build|dev` keep refreshing them.
 * - `package`: what `bb plugin new` writes now — no `types/`, no path map, an
 *   exact `@get-bb/plugin-sdk` pin in the manifest whose installed
 *   `bundled-types/*.d.ts` are the surface. Nothing is written into these.
 */
interface PluginSdkLayout {
  kind: "vendored" | "package";
  /**
   * Exact version the manifest pins `@get-bb/plugin-sdk` to (dev or runtime
   * dependency), or null when it declares none. A range rather than an exact
   * version comes back verbatim; callers compare it against the running host.
   */
  pin: string | null;
}

/**
 * Classify a plugin directory so callers refresh vendored declarations without
 * ever writing `types/` into a plugin that resolves the SDK from npm.
 *
 * Vendored wins whenever either half of the old layout is present: a plugin
 * mid-migration (declarations deleted but the path map still in tsconfig, or
 * the reverse) must keep typechecking rather than silently lose its types.
 */
export async function resolvePluginSdkLayout(
  rootDir: string,
): Promise<PluginSdkLayout> {
  const pin = await readDeclaredSdkPin(rootDir);
  const hasVendoredTypes =
    (await pathExists(join(rootDir, "types", "bb-plugin-sdk.d.ts"))) ||
    (await pathExists(join(rootDir, "types", "bb-plugin-sdk-app.d.ts")));
  const hasPathMap = await tsconfigMapsSdk(rootDir);
  return {
    kind: hasVendoredTypes || hasPathMap ? "vendored" : "package",
    pin,
  };
}

/**
 * Both names a vendored tsconfig can map the SDK under. `@bb/plugin-sdk` is
 * the pre-rename spelling; plugins scaffolded before the rename still carry it
 * and {@link resolvePluginSdkLayout} still counts it as vendored, so the
 * migration has to remove it too.
 */
const SDK_PATH_MAP_PREFIXES = ["@get-bb/plugin-sdk", "@bb/plugin-sdk"] as const;

/** The two declaration files the vendored layout carries. */
const VENDORED_DECLARATIONS = [
  "bb-plugin-sdk.d.ts",
  "bb-plugin-sdk-app.d.ts",
] as const;

/**
 * A quoted `@bb/plugin-sdk` specifier — the pre-rename package name — with its
 * optional subpath, in either quote style. Matching the quotes is what keeps
 * the rewrite predictable: `@bb/plugin-sdk-extras` and prose mentioning the old
 * name without quotes are left alone, while `"@bb/plugin-sdk/app"` in an
 * import, an export, a dynamic `import()`, or a `require()` is caught by the
 * same rule. A quoted specifier inside a comment is rewritten too — the
 * comment is talking about the import that just moved.
 */
const LEGACY_SDK_SPECIFIER_PATTERN =
  /(["'])@bb\/plugin-sdk((?:\/[^"'\n]*)?)\1/g;

/**
 * Source extensions the migration scans, and the directories it never enters.
 * The ignore set matches the plugin dev loop's (`dist`, `node_modules`,
 * `.git`), plus `types/` — whose vendored declarations this same migration is
 * deleting — and any other dot-directory.
 */
const PLUGIN_SOURCE_EXTENSIONS = [".ts", ".tsx"] as const;
const UNSCANNED_DIRECTORIES = new Set([
  "dist",
  "node_modules",
  ".git",
  "types",
]);
/** Depth guard for a pathological tree; real plugins nest a few levels. */
const MAX_SOURCE_SCAN_DEPTH = 12;

/** Arguments for {@link migratePluginToPackageLayout}. */
interface MigratePluginArgs {
  /** Plugin root directory (the one holding `package.json`). */
  rootDir: string;
  /** SDK version to pin exactly and to raise the engines floor to. */
  sdkVersion: string;
  /** Compute the result without touching disk (`bb plugin migrate`'s plan). */
  dryRun?: boolean;
}

/** What {@link migratePluginToPackageLayout} did, or would do under `dryRun`. */
export interface PluginPackageLayoutMigration {
  /**
   * Whether anything needed changing. False is the idempotent case: the plugin
   * is already on the package layout at this SDK version.
   */
  changed: boolean;
  /**
   * The `@get-bb/plugin-sdk` devDependency pin, when it was added or repointed.
   * `from` is null when the manifest declared none. Null when already exact.
   */
  pin: { from: string | null; to: string } | null;
  /**
   * Whether the SDK declaration was moved out of `dependencies` into
   * `devDependencies` (including collapsing a manifest that declared it in
   * both). The section is wrong regardless of the version, so this can be true
   * while {@link pin} is null.
   */
  movedFromDependencies: boolean;
  /**
   * `engines.bbPluginSdk`, when the floor was raised. Null when the manifest
   * already required this SDK or a later one — a floor is never lowered.
   */
  enginesFloor: { from: string | null; to: string } | null;
  /** `compilerOptions.paths` keys dropped from tsconfig.json. */
  removedPathMaps: string[];
  /** `include` entries dropped from tsconfig.json. */
  removedIncludes: string[];
  /** Declaration files deleted, relative to the plugin root. */
  deletedFiles: string[];
  /**
   * Whether `types/` itself was removed because the migration emptied it. On an
   * applied run this is the verified outcome, not the intent: a file that
   * appeared between the plan and the removal keeps the directory, and this
   * comes back false.
   */
  removedTypesDir: boolean;
  /**
   * Source files whose `@bb/plugin-sdk` specifiers were rewritten to
   * `@get-bb/plugin-sdk`, with how many each file carried.
   */
  rewrittenImports: RewrittenSdkImportFile[];
}

/** One source file the migration rewrites off the pre-rename SDK name. */
interface RewrittenSdkImportFile {
  /** Path relative to the plugin root, `/`-separated (e.g. `lib/rpc.ts`). */
  path: string;
  /** How many quoted `@bb/plugin-sdk` specifiers the file carries. */
  imports: number;
}

/**
 * Convert a vendored-layout plugin to the npm package layout: pin
 * `@get-bb/plugin-sdk` exactly, drop the tsconfig path map that shadowed it,
 * delete the vendored declarations, and rewrite source imports of the
 * pre-rename `@bb/plugin-sdk` name onto the published one.
 *
 * The import rewrite is part of the same job as removing the path map: that map
 * is what made `@bb/plugin-sdk` resolve, so a migration that dropped it and
 * left the specifiers behind would hand back a plugin that no longer
 * typechecks. Only quoted specifiers are replaced (`"@bb/plugin-sdk"`,
 * `'@bb/plugin-sdk/app'`), subpath and quote style preserved — which does
 * include a quoted specifier written inside a comment.
 *
 * This is a workspace-local file transform, not product policy — the CLI owns
 * the consent gate (`bb plugin migrate` never runs without confirmation),
 * because the legacy layout keeps working this release and a plugin must never
 * be migrated out from under its author.
 *
 * Idempotent by construction: every step is expressed as a difference against
 * what is on disk, so a second run reports `changed: false` rather than
 * failing, and a half-migrated plugin (pin already added, `types/` still
 * present) converges instead of being rejected.
 *
 * A plugin with no vendored artifacts left is not a special case: the manifest
 * steps still run, so a half-migrated plugin that lost its `types/` and path
 * maps without ever gaining the pin reports `changed: true` and gets the pin
 * and floor.
 *
 * Safety mirrors {@link syncPluginTypes}: symlinks are refused rather than
 * followed, `types/` must resolve inside the plugin, and both manifests are
 * replaced through an atomic rename. Planning happens before any write, so a
 * refusal leaves the plugin exactly as it was, and every destructive step
 * re-validates immediately before it runs.
 *
 * Both JSON files are rewritten through `JSON.parse`/`JSON.stringify`, so a
 * pathological numeric literal in a field this transform does not touch
 * (`1e400`, an integer above 2^53) can come back normalized. Manifest and
 * tsconfig fields are strings, objects, and small integers in practice, so
 * this is accepted rather than worked around with a JSON-preserving editor.
 */
export async function migratePluginToPackageLayout(
  args: MigratePluginArgs,
): Promise<PluginPackageLayoutMigration> {
  const { rootDir, sdkVersion, dryRun = false } = args;
  const manifestPlan = await planManifest(rootDir, sdkVersion, {
    raiseFloor: true,
  });
  const typesPlan = await planVendoredDeletions(rootDir);
  // The `types` include entries only stop being the author's once the
  // migration actually removes the directory they point at.
  const tsconfigPlan = await planTsconfig(rootDir, {
    removeTypesIncludes: typesPlan.removedTypesDir,
  });
  const importPlan = await planSdkImportRewrites(rootDir);
  const result: PluginPackageLayoutMigration = {
    changed:
      manifestPlan.text !== null ||
      tsconfigPlan.text !== null ||
      typesPlan.deletedFiles.length > 0 ||
      typesPlan.removedTypesDir ||
      importPlan.length > 0,
    pin: manifestPlan.pin,
    movedFromDependencies: manifestPlan.movedFromDependencies,
    enginesFloor: manifestPlan.enginesFloor,
    removedPathMaps: tsconfigPlan.removedPathMaps,
    removedIncludes: tsconfigPlan.removedIncludes,
    deletedFiles: typesPlan.deletedFiles,
    removedTypesDir: typesPlan.removedTypesDir,
    rewrittenImports: importPlan,
  };
  if (dryRun) return result;
  if (manifestPlan.text !== null) {
    await writeJsonFileAtomically(rootDir, "package.json", manifestPlan.text);
  }
  const typesDir = join(rootDir, "types");
  for (const relativePath of typesPlan.deletedFiles) {
    // Re-validate against the state at this instant rather than the state the
    // plan saw: `types/` or the declaration itself could have been swapped for
    // a link in between. Node has no dirfd-relative unlink, so this narrows
    // the window rather than closing it — the refusal is what matters.
    await assertWritableTypesDir(rootDir, typesDir);
    const filePath = join(rootDir, relativePath);
    const stats = await statNoFollow(filePath, relativePath);
    if (stats === null) continue;
    if (!stats.isFile()) {
      throw new Error(`${relativePath} is not a regular file`);
    }
    await rm(filePath, { force: true });
  }
  if (typesPlan.removedTypesDir) {
    await assertWritableTypesDir(rootDir, typesDir);
    // Between the plan and here someone could have added a file; rmdir fails
    // on a non-empty directory, which is exactly the outcome we want — but the
    // report and the tsconfig edit below must then follow the directory that is
    // still there, not the plan that expected it gone.
    await rmdir(typesDir).catch(() => undefined);
    result.removedTypesDir = (await statNoFollow(typesDir, "types")) === null;
  }
  // The tsconfig write happens last so the `types` include entries are dropped
  // only against a directory that is verifiably gone. When the rmdir did not
  // happen, the include has to stay: a file that appeared under `types/` would
  // otherwise sit on disk outside the program.
  const appliedTsconfigPlan =
    typesPlan.removedTypesDir && !result.removedTypesDir
      ? await planTsconfig(rootDir, { removeTypesIncludes: false })
      : tsconfigPlan;
  result.removedIncludes = appliedTsconfigPlan.removedIncludes;
  if (appliedTsconfigPlan.text !== null) {
    await writeJsonFileAtomically(
      rootDir,
      "tsconfig.json",
      appliedTsconfigPlan.text,
    );
  }
  for (const file of importPlan) {
    await rewriteSdkImportsInFile(rootDir, file.path);
  }
  return result;
}

/**
 * Rewrite one source file's quoted `@bb/plugin-sdk` specifiers in place.
 *
 * The plan's content is not trusted here: the file is re-read and re-matched,
 * so an editor save between planning and applying loses nothing and a file that
 * became a link — or whose directory did — is refused rather than written
 * through, the same rule `types/` gets.
 */
async function rewriteSdkImportsInFile(
  rootDir: string,
  relativePath: string,
): Promise<void> {
  const filePath = join(rootDir, ...relativePath.split("/"));
  await assertInsidePlugin(rootDir, dirname(filePath), relativePath);
  const stats = await statNoFollow(filePath, relativePath);
  if (stats === null || !stats.isFile()) return;
  const current = await readFile(filePath, "utf8");
  const rewritten = rewriteLegacySdkSpecifiers(current);
  if (rewritten.imports === 0) return;
  await writeFileAtomically(filePath, relativePath, rewritten.text);
}

/**
 * Replace every quoted pre-rename SDK specifier, preserving the subpath and the
 * quote style, and report how many were replaced.
 */
function rewriteLegacySdkSpecifiers(content: string): {
  text: string;
  imports: number;
} {
  let imports = 0;
  const text = content.replace(
    LEGACY_SDK_SPECIFIER_PATTERN,
    (_match, quote: string, subpath: string) => {
      imports += 1;
      return `${quote}@get-bb/plugin-sdk${subpath}${quote}`;
    },
  );
  return { text, imports };
}

/**
 * Which of the plugin's own source files still import the pre-rename package
 * name, and how many specifiers each carries.
 *
 * Dropping the tsconfig path map is what makes this necessary: `@bb/plugin-sdk`
 * resolved only through that map, so a migration that removed it and left the
 * imports behind would hand the author a plugin that no longer typechecks. The
 * walk covers the plugin root and its subdirectories — `server.ts` and
 * `app.tsx` are just the two files every plugin has — and never follows a
 * symlink, so it cannot read or later write outside the plugin.
 */
async function planSdkImportRewrites(
  rootDir: string,
): Promise<RewrittenSdkImportFile[]> {
  const found: RewrittenSdkImportFile[] = [];
  const walk = async (
    dir: string,
    prefix: string,
    depth: number,
  ): Promise<void> => {
    if (depth > MAX_SOURCE_SCAN_DEPTH) return;
    // An unreadable directory is not a reason to fail the migration; the
    // manifest and tsconfig steps still land.
    const entries = await readdir(dir, { withFileTypes: true }).catch(
      () => null,
    );
    if (entries === null) return;
    for (const entry of entries) {
      // Dirent.isSymbolicLink is the lstat-equivalent readdir reports, so a
      // linked file or directory is skipped rather than followed.
      if (entry.isSymbolicLink()) continue;
      const relativePath =
        prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (UNSCANNED_DIRECTORIES.has(entry.name)) continue;
        if (entry.name.startsWith(".")) continue;
        await walk(join(dir, entry.name), relativePath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!PLUGIN_SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        continue;
      }
      let content: string;
      try {
        content = await readFile(join(dir, entry.name), "utf8");
      } catch {
        continue;
      }
      const { imports } = rewriteLegacySdkSpecifiers(content);
      if (imports > 0) found.push({ path: relativePath, imports });
    }
  };
  await walk(rootDir, "", 0);
  found.sort((left, right) => (left.path < right.path ? -1 : 1));
  return found;
}

/** Refuse a path that resolves outside the plugin (a linked ancestor). */
async function assertInsidePlugin(
  rootDir: string,
  path: string,
  label: string,
): Promise<void> {
  const [realRoot, realPath] = await Promise.all([
    realpath(rootDir),
    realpath(path),
  ]);
  const rel = relative(realRoot, realPath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`${label} resolves outside the plugin (${realPath})`);
  }
}

/** Arguments for {@link setPluginSdkPin}. */
interface SetPluginSdkPinArgs {
  /** Plugin root directory (the one holding `package.json`). */
  rootDir: string;
  /** Exact version to pin `@get-bb/plugin-sdk` to. */
  sdkVersion: string;
  /** Report the change without writing (`bb plugin types --check`). */
  dryRun?: boolean;
}

/** What {@link setPluginSdkPin} changed. */
interface PluginSdkPinChange {
  /**
   * The version change, or null when the manifest already declared this exact
   * version and only the section it lived in was wrong.
   */
  pin: { from: string | null; to: string } | null;
  /**
   * Whether the declaration was moved out of `dependencies` into
   * `devDependencies`, collapsing a manifest that declared it in both.
   */
  movedFromDependencies: boolean;
}

/**
 * Point a package-layout plugin's `@get-bb/plugin-sdk` devDependency at
 * `sdkVersion` exactly, leaving `engines.bbPluginSdk` alone.
 *
 * `bb plugin types` is the command that keeps a plugin's declarations matched
 * to the bb actually running it. Under the vendored layout it rewrote
 * `types/*.d.ts`; under the package layout the equivalent is repointing the
 * pin, which is why this is a write rather than a report. The engines floor is
 * deliberately untouched: it states what the plugin's *source* requires, and
 * merely reading newer declarations does not raise that.
 *
 * Returns null when the manifest already pins this version in the right
 * section.
 */
export async function setPluginSdkPin(
  args: SetPluginSdkPinArgs,
): Promise<PluginSdkPinChange | null> {
  const { rootDir, sdkVersion, dryRun = false } = args;
  const plan = await planManifest(rootDir, sdkVersion, { raiseFloor: false });
  if (plan.text === null) return null;
  if (!dryRun) {
    await writeJsonFileAtomically(rootDir, "package.json", plan.text);
  }
  return { pin: plan.pin, movedFromDependencies: plan.movedFromDependencies };
}

interface ManifestPlan {
  pin: { from: string | null; to: string } | null;
  movedFromDependencies: boolean;
  enginesFloor: { from: string | null; to: string } | null;
  /** Replacement file text, or null when the manifest already matches. */
  text: string | null;
}

/**
 * Compute the package.json rewrite. Parsing failures throw here rather than
 * being swallowed: unlike layout detection, a migration that silently skipped
 * the manifest would leave the plugin with neither a pin nor its declarations.
 */
async function planManifest(
  rootDir: string,
  sdkVersion: string,
  options: { raiseFloor: boolean },
): Promise<ManifestPlan> {
  const path = join(rootDir, "package.json");
  await statNoFollow(path, "package.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error("package.json could not be read");
  }
  let manifest: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error("not an object");
    }
    manifest = parsed as Record<string, unknown>;
  } catch {
    throw new Error("package.json is not valid JSON");
  }

  const declaredPin = readSdkPinFrom(manifest);
  const pin =
    declaredPin.version === sdkVersion
      ? null
      : { from: declaredPin.version, to: sdkVersion };
  // The pin belongs in devDependencies: bb provides the SDK runtime, so it is
  // types-only, and a runtime declaration makes npm install a second copy that
  // shadows it. That is wrong at every version, so the move happens even when
  // the declared version is already exact — and a manifest that declared the
  // SDK in both sections collapses to the devDependencies one.
  const movedFromDependencies = declaredPin.inDependencies;
  if (pin !== null || movedFromDependencies) {
    if (movedFromDependencies) {
      const deps = asRecord(manifest.dependencies);
      delete deps["@get-bb/plugin-sdk"];
      if (Object.keys(deps).length === 0) {
        delete manifest.dependencies;
      } else {
        manifest.dependencies = deps;
      }
    }
    manifest.devDependencies = insertDependency(
      asRecord(manifest.devDependencies),
      "@get-bb/plugin-sdk",
      sdkVersion,
    );
  }

  let enginesFloor: ManifestPlan["enginesFloor"] = null;
  if (options.raiseFloor) {
    const engines = asRecord(manifest.engines);
    const current = engines.bbPluginSdk;
    const from = typeof current === "string" ? current : null;
    if (isFloorBelow(from, sdkVersion)) {
      enginesFloor = { from, to: `>=${sdkVersion}` };
      manifest.engines = { ...engines, bbPluginSdk: `>=${sdkVersion}` };
    }
  }

  if (pin === null && !movedFromDependencies && enginesFloor === null) {
    return {
      pin: null,
      movedFromDependencies: false,
      enginesFloor: null,
      text: null,
    };
  }
  return {
    pin,
    movedFromDependencies,
    enginesFloor,
    text: reserialize(raw, manifest),
  };
}

/**
 * Where the manifest declares `@get-bb/plugin-sdk`, and at what version. A
 * manifest that declares it in both sections reports the devDependencies
 * version — that is the one the migration keeps.
 */
function readSdkPinFrom(manifest: Record<string, unknown>): {
  inDependencies: boolean;
  version: string | null;
} {
  const inDependencies =
    typeof asRecord(manifest.dependencies)["@get-bb/plugin-sdk"] === "string";
  for (const field of ["devDependencies", "dependencies"] as const) {
    const declared = asRecord(manifest[field])["@get-bb/plugin-sdk"];
    if (typeof declared === "string")
      return { inDependencies, version: declared };
  }
  return { inDependencies, version: null };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Add a dependency, keeping the block's existing order. Dependency blocks are
 * conventionally sorted (npm rewrites them that way), so a sorted block takes
 * the new entry in its sorted position; a hand-ordered one takes it at the end
 * rather than being reshuffled.
 */
function insertDependency(
  deps: Record<string, unknown>,
  name: string,
  version: string,
): Record<string, unknown> {
  if (name in deps) return { ...deps, [name]: version };
  const keys = Object.keys(deps);
  const sorted = keys.every(
    (key, index) => index === 0 || keys[index - 1]! < key,
  );
  if (!sorted) return { ...deps, [name]: version };
  const next: Record<string, unknown> = {};
  let inserted = false;
  for (const key of keys) {
    if (!inserted && name < key) {
      next[name] = version;
      inserted = true;
    }
    next[key] = deps[key];
  }
  if (!inserted) next[name] = version;
  return next;
}

/**
 * Whether an existing `engines.bbPluginSdk` range admits something older than
 * `version` — the only case in which the migration raises the floor.
 *
 * Deliberately narrow: it reads the first `major.minor[.patch]` in the range,
 * which is the floor of every form a plugin manifest carries in practice
 * (`>=0.4.3`, `^0.4.3`, `0.4.3`). Anything it cannot read is treated as
 * already sufficient, so an exotic range is left alone rather than rewritten
 * on a guess. A floor is never lowered.
 *
 * The `||` union is the known limitation: only the first version in the range
 * is read, so `>=9.0.0 || >=0.1.0` reads as a 9.0.0 floor and is left alone
 * even though it admits 0.1.0. Raising it would mean rewriting a range this
 * function does not fully understand, which is the one thing it refuses to
 * do — the author keeps whatever they deliberately wrote.
 */
function isFloorBelow(range: string | null, version: string): boolean {
  if (range === null || range.trim().length === 0) return true;
  const floor = parseVersionTuple(range);
  const target = parseVersionTuple(version);
  if (floor === null || target === null) return false;
  for (let index = 0; index < 3; index += 1) {
    if (floor[index]! !== target[index]!) return floor[index]! < target[index]!;
  }
  return false;
}

function parseVersionTuple(value: string): [number, number, number] | null {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(value);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

interface TsconfigPlan {
  removedPathMaps: string[];
  removedIncludes: string[];
  text: string | null;
}

/**
 * Compute the tsconfig.json rewrite: drop the SDK path maps that shadow the
 * installed package, and — only when the migration is also removing `types/`
 * itself — the `types` include that compiled the vendored declarations.
 *
 * Both spellings of the map are dropped. Plugins scaffolded before the package
 * rename map `@bb/plugin-sdk`; leaving those behind would keep the plugin
 * classifying as vendored after a "successful" migration.
 *
 * The include entries survive whenever `types/` does: a plugin with its own
 * `types/custom.d.ts` keeps that directory, and dropping `include: ["types"]`
 * would leave the file on disk but silently outside the program. Every other
 * mapping (`@/*` and friends) is left untouched — those are the author's.
 */
async function planTsconfig(
  rootDir: string,
  options: { removeTypesIncludes: boolean },
): Promise<TsconfigPlan> {
  const empty: TsconfigPlan = {
    removedPathMaps: [],
    removedIncludes: [],
    text: null,
  };
  const path = join(rootDir, "tsconfig.json");
  if ((await statNoFollow(path, "tsconfig.json")) === null) return empty;
  const raw = await readFile(path, "utf8");
  let tsconfig: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error("not an object");
    }
    tsconfig = parsed as Record<string, unknown>;
  } catch {
    // A tsconfig with comments or a trailing comma parses here as invalid.
    // Rewriting it would destroy the author's file, so refuse the whole
    // migration and let them remove the two entries by hand.
    throw new Error(
      "tsconfig.json is not valid JSON — remove the @get-bb/plugin-sdk paths entry by hand",
    );
  }

  const compilerOptions = asRecord(tsconfig.compilerOptions);
  const paths = asRecord(compilerOptions.paths);
  const removedPathMaps = Object.keys(paths).filter((key) =>
    SDK_PATH_MAP_PREFIXES.some(
      (name) => key === name || key.startsWith(`${name}/`),
    ),
  );
  const include = Array.isArray(tsconfig.include) ? tsconfig.include : null;
  const removedIncludes =
    include === null || !options.removeTypesIncludes
      ? []
      : include.filter(
          (entry): entry is string =>
            typeof entry === "string" &&
            (entry === "types" || entry.startsWith("types/")),
        );
  if (removedPathMaps.length === 0 && removedIncludes.length === 0) {
    return empty;
  }

  if (removedPathMaps.length > 0) {
    const nextPaths = Object.fromEntries(
      Object.entries(paths).filter(([key]) => !removedPathMaps.includes(key)),
    );
    if (Object.keys(nextPaths).length === 0) {
      delete compilerOptions.paths;
    } else {
      compilerOptions.paths = nextPaths;
    }
    tsconfig.compilerOptions = compilerOptions;
  }
  if (removedIncludes.length > 0 && include !== null) {
    tsconfig.include = include.filter(
      (entry) => typeof entry !== "string" || !removedIncludes.includes(entry),
    );
  }
  return {
    removedPathMaps,
    removedIncludes,
    text: reserialize(raw, tsconfig),
  };
}

/**
 * Which vendored declarations exist and whether removing them empties
 * `types/`. Refuses a linked or out-of-plugin `types/`, and a declaration that
 * is not a regular file, before anything is deleted.
 */
async function planVendoredDeletions(
  rootDir: string,
): Promise<{ deletedFiles: string[]; removedTypesDir: boolean }> {
  const typesDir = join(rootDir, "types");
  await assertWritableTypesDir(rootDir, typesDir);
  if ((await statNoFollow(typesDir, "types")) === null) {
    return { deletedFiles: [], removedTypesDir: false };
  }
  const deletedFiles: string[] = [];
  for (const name of VENDORED_DECLARATIONS) {
    const stats = await statNoFollow(join(typesDir, name), `types/${name}`);
    if (stats === null) continue;
    if (!stats.isFile()) throw new Error(`types/${name} is not a regular file`);
    deletedFiles.push(`types/${name}`);
  }
  const remaining = (await readdir(typesDir)).filter(
    (name) => !deletedFiles.includes(`types/${name}`),
  );
  return { deletedFiles, removedTypesDir: remaining.length === 0 };
}

/**
 * Re-serialize an edited manifest with the indentation and trailing newline
 * the file already used, so the diff shows the fields that changed rather than
 * a whole-file reformat.
 */
function reserialize(raw: string, value: Record<string, unknown>): string {
  const indentMatch = /\n([ \t]+)"/.exec(raw);
  const indent = indentMatch === null ? 2 : indentMatch[1]!;
  const serialized = JSON.stringify(value, null, indent);
  return raw.endsWith("\n") ? `${serialized}\n` : serialized;
}

async function writeJsonFileAtomically(
  rootDir: string,
  name: string,
  text: string,
): Promise<void> {
  await writeFileAtomically(join(rootDir, name), name, text);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/** `@get-bb/plugin-sdk` as declared in the plugin manifest, or null. */
async function readDeclaredSdkPin(rootDir: string): Promise<string | null> {
  const manifest = await readJsonFile(join(rootDir, "package.json"));
  if (manifest === null) return null;
  for (const field of ["devDependencies", "dependencies"] as const) {
    const deps = manifest[field];
    if (typeof deps !== "object" || deps === null) continue;
    const declared = (deps as Record<string, unknown>)["@get-bb/plugin-sdk"];
    if (typeof declared === "string") return declared;
  }
  return null;
}

/**
 * Whether tsconfig.json still maps the SDK at a local file. Pre-rename
 * plugins map `@bb/plugin-sdk`, so both names count. tsconfig.json is JSONC
 * (tsc accepts comments and trailing commas), so when strict parsing fails
 * fall back to a raw-text scan — misreading a commented-out map as vendored
 * only keeps the legacy refresh alive, while the opposite mistake silently
 * strips a working plugin of its declarations.
 */
async function tsconfigMapsSdk(rootDir: string): Promise<boolean> {
  const tsconfigPath = join(rootDir, "tsconfig.json");
  const tsconfig = await readJsonFile(tsconfigPath);
  if (tsconfig === null) {
    let raw: string;
    try {
      raw = await readFile(tsconfigPath, "utf8");
    } catch {
      return false;
    }
    return (
      raw.includes('"@get-bb/plugin-sdk') || raw.includes('"@bb/plugin-sdk')
    );
  }
  const compilerOptions = tsconfig.compilerOptions;
  if (typeof compilerOptions !== "object" || compilerOptions === null) {
    return false;
  }
  const paths = (compilerOptions as Record<string, unknown>).paths;
  if (typeof paths !== "object" || paths === null) return false;
  return Object.keys(paths).some(
    (key) =>
      key === "@get-bb/plugin-sdk" ||
      key.startsWith("@get-bb/plugin-sdk/") ||
      key === "@bb/plugin-sdk" ||
      key.startsWith("@bb/plugin-sdk/"),
  );
}

/**
 * Parse a JSON file, or null when it is missing or unparseable. Layout
 * detection is a hint for whether to refresh declarations; a plugin with a
 * broken manifest is rejected with a real error by the caller, not here.
 */
async function readJsonFile(
  path: string,
): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * `lstat` that never follows the final path component. Returns null when the
 * path does not exist, and refuses a symbolic link.
 *
 * `bb plugin build` and `bb plugin dev` refresh declarations automatically, so
 * a plugin that ships `types/` — or a declaration inside it — as a link would
 * otherwise redirect that write onto a file outside the plugin. Building a
 * plugin does not run its code, so cloning an untrusted plugin and building it
 * must not write anywhere but that plugin.
 */
async function statNoFollow(
  path: string,
  label: string,
): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  let stats: Awaited<ReturnType<typeof lstat>>;
  try {
    stats = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (stats.isSymbolicLink()) {
    throw new Error(`refusing to write through the symbolic link ${label}`);
  }
  return stats;
}

/**
 * Reject a `types/` that is a link, is not a directory, or resolves outside
 * the plugin. Resolving both sides keeps a plugin inside a symlinked checkout
 * (a bb worktree, for example) working.
 */
async function assertWritableTypesDir(
  rootDir: string,
  typesDir: string,
): Promise<void> {
  const stats = await statNoFollow(typesDir, "types");
  if (stats === null) return;
  if (!stats.isDirectory())
    throw new Error("types exists but is not a directory");
  const [realRoot, realTypes] = await Promise.all([
    realpath(rootDir),
    realpath(typesDir),
  ]);
  const rel = relative(realRoot, realTypes);
  if (rel.length === 0 || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`types resolves outside the plugin (${realTypes})`);
  }
}

/**
 * Write through a temporary regular file and rename it into place, so a
 * concurrent reader never sees a partial file and the rename replaces the
 * entry itself rather than following anything at the destination.
 *
 * The temporary name carries the pid and random bytes, so it cannot collide
 * with a file the plugin ships or with a concurrent write, and nothing
 * pre-existing is ever deleted to make room for it: an occupied temp path is
 * refused (`wx` would fail anyway; the explicit check is what makes the reason
 * legible).
 */
async function writeFileAtomically(
  filePath: string,
  label: string,
  content: string,
): Promise<void> {
  const suffix = `${process.pid}-${randomBytes(6).toString("hex")}.bb-tmp`;
  const tempPath = `${filePath}.${suffix}`;
  if (await pathExists(tempPath)) {
    throw new Error(
      `refusing to overwrite the temporary file ${label}.${suffix}`,
    );
  }
  await writeFile(tempPath, content, { flag: "wx" });
  try {
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

function pluginNameOf(packageName: string): string {
  return derivePluginId(packageName)
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function enginesRange(bbVersion: string): string {
  const match = /^(\d+)\.(\d+)/.exec(bbVersion);
  return match ? `>=${match[1]}.${match[2]}` : ">=0.0";
}

/**
 * Git ref the scaffold's component registry URL pins to: the release tag
 * matching the running BB, so `npx shadcn add @bb/<name>` vendors component
 * source version-matched to this install by construction. Dev builds
 * (0.0.0) track main.
 */
function registryRef(bbVersion: string): string {
  return bbVersion === "0.0.0" ? "main" : `desktop-v${bbVersion}`;
}

/**
 * shadcn `components.json`: lets stock `npx shadcn add @bb/<name>` pull more
 * components from the BB registry (checked-in items served raw from GitHub;
 * see packages/plugin-registry). Registry components install into
 * components/ui/ + lib/ + hooks/ via the aliases below; `bb plugin build`
 * resolves the `@/*` alias through tsconfig paths.
 */
function componentsJsonSource(bbVersion: string): string {
  return `${JSON.stringify(
    {
      $schema: "https://ui.shadcn.com/schema.json",
      style: "new-york",
      tsx: true,
      tailwind: {
        config: "",
        css: "app.css",
        baseColor: "neutral",
        cssVariables: true,
      },
      aliases: {
        components: "@/components",
        ui: "@/components/ui",
        lib: "@/lib",
        utils: "@/lib/utils",
        hooks: "@/hooks",
      },
      registries: {
        "@bb": `https://raw.githubusercontent.com/get-bb/bb/${registryRef(bbVersion)}/packages/plugin-registry/r/{name}.json`,
      },
    },
    null,
    2,
  )}\n`;
}

function serverEntrySource(packageName: string): string {
  const id = derivePluginId(packageName);
  const name = pluginNameOf(packageName);
  return `// ${packageName} — a BB plugin backend entry.
//
// The default export is a factory that receives the plugin API. BB supplies
// the tiny defineRpcContract runtime helper; the API type remains type-only.
//
// The example is a todo list. One store in bb.storage.kv serves three
// surfaces: the Example todos page (app.tsx, over RPC), the \`bb ${id}\` CLI
// command (below), and the skill in skills/example-todos/SKILL.md that tells
// agents how to use that command. A write from any surface publishes a realtime signal so
// every open page refetches.
import { randomUUID } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const todoSchema = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
  createdAt: z.string(),
});
export type Todo = z.infer<typeof todoSchema>;

// Both schemas run at the wire boundary. Handler input/output are inferred
// from the shared contract; app.tsx imports only its type.
export const rpcContract = defineRpcContract({
  todos_list: {
    input: z.null(),
    output: z.object({ todos: z.array(todoSchema) }),
  },
  todos_add: {
    input: z.object({ title: z.string().trim().min(1).max(200) }),
    output: todoSchema,
  },
  todos_set_done: {
    input: z.object({ id: z.string(), done: z.boolean() }),
    output: todoSchema,
  },
  todos_remove: {
    input: z.object({ id: z.string() }),
    output: z.object({ removed: z.boolean() }),
  },
});

/** Realtime channel app.tsx listens on; the payload is the todo count. */
const TODOS_CHANGED = "todos-changed";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  // Declarative settings — rendered in BB's settings UI and editable with
  // \`bb plugin config ${id}\`. Add \`secret: true\` for values like API keys.
  // Settings are read once per load: reload the plugin after changing one.
  const settings = bb.settings.define({
    showDone: {
      type: "boolean",
      label: "Show completed todos",
      default: true,
    },
  });
  const { showDone } = await settings.get();

  // Namespaced key-value storage in bb.db (JSON values, up to 256KB each).
  // For bigger or relational data use bb.storage.database().
  async function readTodos(): Promise<Todo[]> {
    return (await bb.storage.kv.get<Todo[]>("todos")) ?? [];
  }
  async function writeTodos(todos: Todo[]): Promise<void> {
    await bb.storage.kv.set("todos", todos);
    // Ephemeral broadcast to every connected client; nothing is persisted.
    bb.realtime.publish(TODOS_CHANGED, { count: todos.length });
  }

  async function listTodos(): Promise<Todo[]> {
    const todos = await readTodos();
    return showDone ? todos : todos.filter((todo) => !todo.done);
  }
  async function addTodo(title: string): Promise<Todo> {
    const todo: Todo = {
      id: randomUUID().slice(0, 8),
      title,
      done: false,
      createdAt: new Date().toISOString(),
    };
    await writeTodos([...(await readTodos()), todo]);
    return todo;
  }
  async function setTodoDone(id: string, done: boolean): Promise<Todo | null> {
    const todos = await readTodos();
    const todo = todos.find((candidate) => candidate.id === id);
    if (todo === undefined) return null;
    todo.done = done;
    await writeTodos(todos);
    return todo;
  }
  async function removeTodo(id: string): Promise<boolean> {
    const todos = await readTodos();
    const remaining = todos.filter((todo) => todo.id !== id);
    if (remaining.length === todos.length) return false;
    await writeTodos(remaining);
    return true;
  }

  bb.rpc.register(rpcContract, {
    todos_list: async () => ({ todos: await listTodos() }),
    todos_add: ({ title }) => addTodo(title),
    todos_set_done: async ({ id, done }) => {
      const todo = await setTodoDone(id, done);
      if (todo === null) throw new Error(\`No todo with id \${id}\`);
      return todo;
    },
    todos_remove: async ({ id }) => ({ removed: await removeTodo(id) }),
  });

  // The \`bb ${id}\` command: what agents (and you) use from a shell. Parsing
  // argv is plugin-owned; \`commands\` is metadata BB renders into help and
  // the generated plugin-commands skill without running plugin code.
  const usage = [
    "Usage:",
    "  bb ${id} list [--json]",
    "  bb ${id} add <title> [--json]",
    "  bb ${id} done <todo-id> [--json]",
    "  bb ${id} undo <todo-id> [--json]",
    "  bb ${id} remove <todo-id> [--json]",
  ].join("\\n");
  function formatTodo(todo: Todo): string {
    return \`[\${todo.done ? "x" : " "}] \${todo.id}  \${todo.title}\`;
  }
  bb.cli.register({
    name: "${id}",
    summary: "Manage the ${name} plugin's example todo list",
    commands: [
      { name: "list", summary: "List todos", usage: "bb ${id} list [--json]" },
      {
        name: "add",
        summary: "Add a todo",
        usage: "bb ${id} add <title> [--json]",
      },
      {
        name: "done",
        summary: "Mark a todo done",
        usage: "bb ${id} done <todo-id> [--json]",
      },
      {
        name: "undo",
        summary: "Mark a todo not done",
        usage: "bb ${id} undo <todo-id> [--json]",
      },
      {
        name: "remove",
        summary: "Remove a todo",
        usage: "bb ${id} remove <todo-id> [--json]",
      },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const [command, ...args] = argv.filter((arg) => arg !== "--json");
      const reply = (value: unknown, text: string) => ({
        exitCode: 0,
        stdout: json ? JSON.stringify(value) : text,
      });
      const notFound = (missingId: string) => ({
        exitCode: 1,
        stderr: \`No todo with id \${missingId}. Run "bb ${id} list" to see ids.\`,
      });
      const todoId = args[0];
      switch (command) {
        case undefined:
        case "help":
        case "--help":
          return { exitCode: 0, stdout: usage };
        case "list": {
          const todos = await listTodos();
          return reply(
            todos,
            todos.length === 0 ? "No todos." : todos.map(formatTodo).join("\\n"),
          );
        }
        case "add": {
          const title = args.join(" ").trim();
          if (title === "") break;
          const todo = await addTodo(title);
          return reply(todo, \`Added \${formatTodo(todo)}\`);
        }
        case "done":
        case "undo": {
          if (todoId === undefined || args.length !== 1) break;
          const todo = await setTodoDone(todoId, command === "done");
          if (todo === null) return notFound(todoId);
          return reply(todo, formatTodo(todo));
        }
        case "remove": {
          if (todoId === undefined || args.length !== 1) break;
          if (!(await removeTodo(todoId))) return notFound(todoId);
          return reply({ removed: true, id: todoId }, \`Removed \${todoId}\`);
        }
      }
      return { exitCode: 1, stderr: usage };
    },
  });

  // Cleanup on reload/disable/shutdown; hooks run LIFO. The sanctioned place
  // to clear timers and close connections.
  bb.onDispose(() => {
    bb.log.info("disposed");
  });

  // Long-lived background work: starts after load, gets an AbortSignal on
  // reload/disable/shutdown, and restarts with backoff if it crashes. Sleeps
  // must wake on abort — a plain setTimeout sleeps through the stop window
  // and the plugin reports "degraded (service did not stop)" on reload.
  // bb.background.service("worker", {
  //   async start(signal) {
  //     while (!signal.aborted) {
  //       await new Promise((resolve) => {
  //         const timer = setTimeout(resolve, 60_000);
  //         signal.addEventListener(
  //           "abort",
  //           () => { clearTimeout(timer); resolve(undefined); },
  //           { once: true },
  //         );
  //       });
  //     }
  //   },
  // });
}
`;
}

function appEntrySource(packageName: string): string {
  const id = derivePluginId(packageName);
  return `// ${packageName} — a BB plugin frontend entry.
//
// Compiled by \`bb plugin build\` into dist/app.js + dist/app.css. React and
// @get-bb/plugin-sdk/app are provided by the BB app at load time (never bundled),
// so this file must be loaded by BB, not imported directly.
//
// The components under components/ui/ are YOURS: vendored source (shadcn
// model), edit freely. Add more from the BB registry with
// \`npx shadcn add @bb/<name>\` (see components.json) — dropdowns, tables,
// the full shadcn set, version-matched to this BB install. Run
// \`npm install\` once before \`bb plugin build\`.
import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { definePluginApp, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract, Todo } from "./server";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** The todo list, kept current by the server's "todos-changed" signal. */
function useTodos() {
  const rpc = useRpc<typeof rpcContract>();
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const report = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);
  const refetch = useCallback(() => {
    rpc.call("todos_list").then((result) => {
      setTodos(result.todos);
      setError(null);
    }, report);
  }, [rpc, report]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  // server.ts publishes after every write — from this page, another window,
  // or \`bb ${id} add\` run by an agent — so the list never goes stale.
  useRealtime("todos-changed", refetch);
  return { rpc, todos, error, report, refetch };
}

function TodoRow({
  todo,
  onToggle,
  onRemove,
}: {
  todo: Todo;
  onToggle: (done: boolean) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-3 py-2.5 text-sm">
      <Checkbox
        checked={todo.done}
        onCheckedChange={(checked) => onToggle(checked === true)}
        aria-label={\`Mark "\${todo.title}" \${todo.done ? "not done" : "done"}\`}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          todo.done && "text-muted-foreground line-through",
        )}
      >
        {todo.title}
      </span>
      <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
        {todo.id}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground hover:text-foreground"
        aria-label={\`Remove "\${todo.title}"\`}
        onClick={onRemove}
      >
        <Icon name="Trash2" className="size-4" />
      </Button>
    </li>
  );
}

/** The dashed box BB's own list pages use for loading and empty states. */
function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
    >
      {children}
    </div>
  );
}

// Tailwind classes compile against the host theme's live CSS variables —
// derive colors from the theme tokens, never hardcoded grays. The frame
// (scrolling page, centered column) matches BB's own nav-panel pages.
function TodosPage() {
  const { rpc, todos, error, report, refetch } = useTodos();
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = title.trim();
    if (next === "" || pending) return;
    setPending(true);
    try {
      await rpc.call("todos_add", { title: next });
      setTitle("");
      refetch();
    } catch (cause) {
      report(cause);
    } finally {
      setPending(false);
    }
  };
  const doneCount = todos?.filter((todo) => todo.done).length ?? 0;
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-3xl px-4 pb-4 pt-3 md:px-5 md:pt-4">
        <p className="text-sm text-muted-foreground">
          Agents keep this list with <code>bb ${id}</code>; the skill in{" "}
          <code>skills/example-todos</code> tells them how.
        </p>
        <form onSubmit={add} className="mt-4 flex items-center gap-2">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What needs doing?"
            aria-label="New todo"
          />
          <Button type="submit" disabled={pending || title.trim() === ""}>
            <Icon name="Plus" className="size-4" />
            Add
          </Button>
        </form>
        {error === null ? null : (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-4">
          {todos === null ? (
            <EmptyState>Loading todos…</EmptyState>
          ) : todos.length === 0 ? (
            <EmptyState>
              Nothing to do. Add one above, or run{" "}
              <code>bb ${id} add "Ship it"</code>.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card px-4">
              {todos.map((todo) => (
                <TodoRow
                  key={todo.id}
                  todo={todo}
                  onToggle={(done) => {
                    rpc
                      .call("todos_set_done", { id: todo.id, done })
                      .then(refetch, report);
                  }}
                  onRemove={() => {
                    rpc
                      .call("todos_remove", { id: todo.id })
                      .then(refetch, report);
                  }}
                />
              ))}
            </ul>
          )}
        </div>
        {todos !== null && todos.length > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {doneCount} of {todos.length} done
          </p>
        ) : null}
      </div>
    </div>
  );
}

// The default export must be definePluginApp(...); BB interprets it after
// loading the bundle. navPanel adds a page to the left sidebar; register
// other UI under app.slots and composer actions, plus-menu rows, banners, or
// rich-text rules with app.composer.customize(...) (see the bb guide's
// plugins chapter).
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "example-todos",
    title: "Example todos",
    icon: "ListTodo",
    // Routed at /plugins/${id}/example-todos; the component receives the
    // remainder as \`subPath\` for deep links within the page.
    path: "example-todos",
    component: TodosPage,
  });
});
`;
}

/**
 * Typecheck-only tsconfig: server.ts compiles against the BbPluginApi contract
 * (type-only, erased at load time) and app.tsx plus the vendored components
 * against the frontend contract. `@get-bb/plugin-sdk` and
 * `@get-bb/plugin-sdk/app` resolve through plain node resolution to the
 * installed npm package (declared as an exact devDependency pin), whose
 * `bundled-types/*.d.ts` are the API surface — no path mapping for the SDK, so
 * editors, `tsc`, and the build all agree with what `npm install` put on
 * disk. Tests reach the testing subpaths of the same package.
 */
function tsconfigSource(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        strict: true,
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        lib: ["ES2022", "DOM"],
        // Only @types/node ambiently — stray ancestor node_modules/@types
        // (e.g. bun-types in a home directory) must not leak in.
        types: ["node"],
        // Vendored components import via "@/..." (shadcn convention);
        // esbuild reads this mapping too during `bb plugin build`.
        paths: { "@/*": ["./*"] },
        noEmit: true,
        skipLibCheck: false,
      },
      include: ["server.ts", "app.tsx", "components", "lib", "hooks"],
    },
    null,
    2,
  )}\n`;
}

/**
 * The plugin's skill: auto-imported into agent threads from `skills/` (the
 * manifest's default `bb.skills` root; the directory name is the skill name).
 * BB also generates a `plugin-commands` skill that lists every registered
 * `bb <id>` subcommand, so this one carries the procedure, not the syntax.
 */
function skillSource(packageName: string): string {
  const id = derivePluginId(packageName);
  const name = pluginNameOf(packageName);
  return `---
name: example-todos
description: Read and update the ${name} plugin's example todo list with the \`bb ${id}\` CLI. Use when the user asks to add, complete, reopen, remove, or review todos, or when the steps of a task should be tracked as todos.
---

# Example todos

The ${name} plugin keeps one todo list. The Example todos page in the BB sidebar and
the \`bb ${id}\` command read and write the same list, so a change from either
side shows in the other at once.

## Commands

| Command | Effect |
| --- | --- |
| \`bb ${id} list\` | Show every todo with its id. \`[x]\` marks a done todo. |
| \`bb ${id} add <title>\` | Add a todo. Quote a title that has spaces. |
| \`bb ${id} done <todo-id>\` | Mark a todo done. |
| \`bb ${id} undo <todo-id>\` | Mark a todo not done. |
| \`bb ${id} remove <todo-id>\` | Delete a todo. |

Add \`--json\` to any command when the output drives code.

## Procedure

1. Run \`bb ${id} list\` before you change the list. Use the ids it prints;
   never guess an id.
2. Add todos one at a time with a short title that starts with a verb:
   \`bb ${id} add "Write the release notes"\`.
3. When you finish a todo, mark it done: \`bb ${id} done <todo-id>\`. Do not
   remove a todo to mark it done.
4. Remove a todo only when the user asks for it or when it duplicates
   another todo.
5. End with a short summary of what you added, completed, or removed.

## Rules

- Change the list only through \`bb ${id}\`. Do not edit bb.db or the plugin's
  storage directly.
- A non-zero exit with "No todo with id" means the id is stale: run
  \`bb ${id} list\` again.
`;
}

function readmeSource(packageName: string): string {
  const id = derivePluginId(packageName);
  return `# ${packageName}

A BB plugin that keeps a todo list. It shows every surface a plugin can own:

- \`server.ts\` — the backend: a todo store in \`bb.storage.kv\`, RPC methods
  for the page, a \`bb ${id}\` CLI command, a setting, and a realtime signal
  that keeps every open page current.
- \`app.tsx\` — the frontend: an **Example todos** page in the left sidebar
  (\`app.slots.navPanel\`) built from the vendored components.
- \`skills/example-todos/SKILL.md\` — a skill that tells agents how to keep the list
  with \`bb ${id}\`. BB imports it into agent threads automatically.

Try it: install the plugin, open **Example todos** in the sidebar, then run
\`bb ${id} add "Ship it"\` in a terminal. The page updates at once.

## UI components

\`components/ui/\` is vendored source you own (the shadcn model): edit the
files freely — they never update out from under you. Add more from the BB
component registry (the full shadcn set, version-matched to your BB install
via the pinned ref in \`components.json\`):

\`\`\`
npx shadcn add @bb/select @bb/table
\`\`\`

Run \`npm install\` once before \`bb plugin build\` — the vendored components'
npm deps bundle into your dist. React, and BB-shimmed packages like the
radix portal primitives and \`sonner\` (\`import { toast } from "sonner"\`
reaches BB's own toaster), are provided by the BB app at runtime and never
bundled. Ship \`dist/\` (npm tarball or committed for git installs) so
people installing your plugin never need npm.

## Manifest

\`package.json\` is the plugin manifest. Notable fields:

- \`bb.server\` — backend entry (required).
- \`bb.app\` — frontend entry. Delete it, \`app.tsx\`, \`components/\`,
  \`hooks/\`, and \`lib/\` for a headless plugin.
- \`bb.skills\` — skill roots; omitted here, so BB reads \`skills/\`. Each
  directory with a \`SKILL.md\` is one skill, named after the directory.
- \`bb.name\` and \`bb.description\` — required human-facing identity.
- \`bb.branding\` — required; declare \`icon\` as a BB icon name or a
  plugin-relative compact SVG, or declare \`logo.light\` (with optional
  \`logo.dark\`). Logo assets must be relative \`.svg\`, \`.png\`, or
  \`.webp\` files.
- \`engines.bb\` — supported bb app version range.
- \`engines.bbPluginSdk\` — the lowest plugin SDK you need (scaffold:
  \`>=${PLUGIN_SDK_VERSION}\`). BB reads this as a floor, not a ceiling: a later
  SDK in the same major still loads your plugin.
- \`dependencies\` — every package your source imports that BB does not provide.
  \`bb plugin build\` inlines them into \`dist/\`, and git installs resolve this
  list alone, so a build-required package here rather than in
  \`devDependencies\` is what keeps your plugin installable. \`devDependencies\`
  is for types and tooling only (BB shims React, the portal primitives, and
  \`@get-bb/plugin-sdk\` at runtime — never bundle them).

Run \`bb plugin build\` before publishing git/npm installs. It writes
\`dist/server.js\` + \`server.meta.json\` and \`app.js\` / \`app.css\` /
\`app.meta.json\`. Each \`*.meta.json\` stamps SDK major/version,
\`artifactFormatVersion\`, \`pluginId\`, \`pluginVersion\`, and
\`builtWith\` so managed installs can verify the artifacts.

## Install

From this directory (\`bb plugin new\` already ran the install; a fresh clone
needs it):

\`\`\`
npm install
bb plugin install .
\`\`\`

After editing sources, reload:

\`\`\`
bb plugin reload ${id}
\`\`\`

Or let \`bb plugin dev\` rebuild and reload on every save.

## Configure

\`\`\`
bb plugin config ${id}
bb plugin config ${id} set showDone false
bb plugin reload ${id}
\`\`\`

## Types & API reference

The plugin API ships as the npm package \`@get-bb/plugin-sdk\`, pinned to an
exact version in \`devDependencies\` (\`${PLUGIN_SDK_VERSION}\` — the SDK of the BB
that scaffolded this plugin). After \`npm install\`, the full surface is on disk
at:

\`\`\`
node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts      # backend
node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk-app.d.ts  # frontend
\`\`\`

Your editor and \`tsc\` resolve \`@get-bb/plugin-sdk\` there through ordinary node
resolution — no path mapping. These are readable declarations: open them for an
exact signature.

The SDK surface grows with every BB release, so the pin has to track the BB you
actually run:

\`\`\`
bb plugin types          # sync this plugin's SDK surface to the running BB
bb plugin types --check  # CI: fail when it does not match
\`\`\`

Ask BB to write plugins for you: the \`bb-plugin-authoring\` skill documents
the whole surface with examples.

Confused by the API, or need something the types don't explain? Clone the BB
repo and read the source: <https://github.com/get-bb/bb>.
`;
}

/**
 * Write the plugin scaffold into `targetDir` (created; must not exist).
 * The generated server.ts loads cleanly against the live plugin API.
 */
export async function scaffoldPlugin(args: ScaffoldPluginArgs): Promise<void> {
  const { targetDir, packageName, bbVersion } = args;
  try {
    await mkdir(targetDir, { recursive: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`directory already exists: ${targetDir}`);
    }
    throw error;
  }
  await writeFile(
    join(targetDir, "package.json"),
    JSON.stringify(
      {
        name: packageName,
        version: "0.1.0",
        type: "module",
        engines: {
          bb: enginesRange(bbVersion),
          bbPluginSdk: `>=${PLUGIN_SDK_VERSION}`,
        },
        bb: {
          name: pluginNameOf(packageName),
          description: "A BB plugin with an example todo list.",
          branding: { icon: "ListTodo" },
          server: "./server.ts",
          app: "./app.tsx",
        },
        // A package belongs here when generated source imports it AND the
        // build neither externalizes nor shims it — those imports are inlined
        // into dist/ by esbuild, and load from node_modules for path: installs
        // (which run server.ts from source). They must survive an install that
        // omits dev deps: the packaged CLI runs with NODE_ENV=production, and
        // the server installs git: plugins with an explicit `--omit=dev`.
        // - zod: `server.ts` imports it and buildPluginServer externalizes only
        //   @get-bb/plugin-sdk and better-sqlite3, so it is bundled, not provided.
        // - starter deps: the vendored components' real runtime deps, bundled
        //   into dist/app.js (consumers get the prebuilt dist/ and need none).
        dependencies: {
          ...PLUGIN_STARTER_DEPENDENCIES,
          zod: "^4.3.6",
        },
        // Typecheck-only. @get-bb/plugin-sdk carries the BbPluginApi/SDK
        // declarations (node_modules/@get-bb/plugin-sdk/bundled-types/*.d.ts);
        // BB provides its runtime, so it is never bundled and belongs here
        // rather than in dependencies. The pin is exact, not a caret: the
        // declarations must describe the bb actually loading the plugin, and
        // `bb plugin types` keeps it matched to the bb you run. The rest supply
        // the real npm types those declarations reference (hono/better-sqlite3
        // and React) for packages generated source does not import: BB
        // provides them at runtime and the bundle never inlines them. An
        // author who imports one directly must promote it above.
        devDependencies: {
          "@get-bb/plugin-sdk": PLUGIN_SDK_VERSION,
          "@types/better-sqlite3": "^7.6.12",
          "@types/node": "^22.0.0",
          "@types/react": "^19.0.0",
          "@types/react-dom": "^19.0.0",
          "better-sqlite3": "^12.0.0",
          hono: "^4.11.9",
          typescript: "^5.7.0",
          // Runtime-shimmed by BB (never bundled) — types only.
          ...PLUGIN_STARTER_TYPE_DEPENDENCIES,
        },
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(join(targetDir, "server.ts"), serverEntrySource(packageName));
  await writeFile(join(targetDir, "app.tsx"), appEntrySource(packageName));
  await writeFile(join(targetDir, "tsconfig.json"), tsconfigSource());
  // No `types/` here: the declarations arrive with `npm install` from the
  // exact-pinned @get-bb/plugin-sdk devDependency above. Plugins scaffolded
  // before that switch still vendor `types/`, and syncPluginTypes keeps
  // refreshing those — see resolvePluginSdkLayout.
  //
  // Vendored starter components (shadcn model — the author owns and edits
  // them) + components.json so `npx shadcn add @bb/<name>` pulls more from
  // the BB registry at the version tag matching this install.
  for (const file of PLUGIN_STARTER_FILES) {
    const filePath = join(targetDir, file.target);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, file.content);
  }
  await writeFile(
    join(targetDir, "components.json"),
    componentsJsonSource(bbVersion),
  );
  const skillDir = join(targetDir, "skills", "example-todos");
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), skillSource(packageName));
  await writeFile(join(targetDir, ".gitignore"), "dist/\nnode_modules/\n");
  await writeFile(join(targetDir, "README.md"), readmeSource(packageName));
}
