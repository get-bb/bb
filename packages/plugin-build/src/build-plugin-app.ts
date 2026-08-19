import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { derivePluginId } from "@bb/domain";
import type { Metafile, Plugin } from "esbuild";
import {
  PLUGIN_THEME_CSS,
  TW_ANIMATE_CSS,
} from "./generated/plugin-theme.generated.js";
import { RUNTIME_EXPORT_MANIFEST } from "./generated/runtime-export-manifest.generated.js";
import { type PluginBuildToolchain } from "./toolchain.js";
import { createPluginArtifactMeta } from "./plugin-artifact-meta.js";
import { validatePluginBuildManifest } from "./plugin-manifest.js";
import {
  pluginScopeRoots,
  scopePluginUtilities,
} from "./scope-plugin-utilities.js";

/**
 * `bb plugin build` — compile a plugin's `bb.app` entry (app.tsx) into a
 * runtime-loadable frontend bundle:
 *
 * - `dist/app.js` — single ESM file, production jsx-runtime forced, minified
 *   unless the caller asks for readable output (`bb plugin dev`). The
 *   shared-runtime modules (react ×5, @get-bb/plugin-sdk/app, the portaling
 *   radix families, sonner, vaul — see RUNTIME_SLOT_BY_SPECIFIER) are never
 *   bundled; an esbuild plugin swaps them for shims that read
 *   `globalThis.__bbPluginRuntime` — the host app provides one React, so a
 *   second copy (and its "Invalid hook call" crashes) is impossible.
 * - `dist/app.css` — a plugin-scoped Tailwind v4 pass over the plugin's own
 *   sources (plus the bundled files of dependencies that opt in) followed by
 *   its imported CSS, run through Tailwind's lightningcss optimizer. Imported
 *   CSS stays unscoped so selectors can target editor decorations rendered
 *   outside the plugin mount.
 * - `dist/app.meta.json` — SDK compatibility plus authoritative plugin,
 *   artifact-format, and build-version metadata.
 */

/**
 * Runtime slot on `globalThis.__bbPluginRuntime` per shimmed specifier.
 * Shim policy (plugin design §5.5), two admission rules:
 *
 * 1. Singleton/global behavior — one React, the portaling radix families
 *    (shared dismissable-layer/focus/scroll-lock/aria-hidden world), sonner
 *    (`toast()` must reach the host toaster), vaul (mutates document.body
 *    styles), @pierre/diffs (its react FileDiff reads the host's
 *    WorkerPoolContextProvider — context identity requires one module copy —
 *    and sharing keeps shiki's grammars out of every plugin bundle) — plus
 *    the SDK surface itself.
 * 2. Host-resident libraries every plugin app would otherwise duplicate —
 *    tailwind-merge + clsx (the `cn()` pair every vendored component pulls
 *    in), class-variance-authority, and the shared-ui `Icon` (its hugeicons
 *    map is ~110 KB raw per copy). These have no singleton semantics; they
 *    are shimmed so a phone does not parse a dozen copies of the same code.
 *    A plugin gets the host's installed version, so its declared range must
 *    stay within the host's major (tailwind-merge ^3, clsx ^2, cva ^0.7).
 *    Rule 2 has a cost on the host side: exposing a namespace on the
 *    runtime object stops the app's bundler from tree-shaking that library
 *    out of the boot chunk, so it only admits libraries whose slot leaves
 *    the boot budget (apps/app/bundle-budget.json) intact. zod does not —
 *    the app uses a fraction of its exports and slotting the namespace
 *    added +193 KB raw / +33 KB brotli to the payload every phone downloads
 *    before first paint — so zod stays bundled per plugin.
 *
 * Everything else (non-portal radix, lucide-react, zod, form/calendar/chart
 * libs, hugeicons imported directly) bundles from the plugin's own
 * node_modules. Adding a slot here requires the matching host slot in
 * apps/app/src/lib/plugin-frontend.ts (installPluginRuntime) and an
 * export-manifest entry (scripts/generate-runtime-export-manifest.mjs).
 */
/** The SDK app subpath plugin sources import. */
const PLUGIN_SDK_APP_SPECIFIER = "@get-bb/plugin-sdk/app";

/**
 * Legacy alias for {@link PLUGIN_SDK_APP_SPECIFIER}, kept so pre-rename plugin
 * sources still build. It resolves to the same runtime slot and the same
 * export list; a later change removes it.
 */
const LEGACY_PLUGIN_SDK_APP_SPECIFIER = "@bb/plugin-sdk/app";

/**
 * The shared-ui icon module. Builtin plugins import it by package specifier;
 * shared-ui's own components import it relatively (`./icon`), and
 * {@link runtimeShimPlugin} routes both to the same host slot so no plugin
 * bundle carries a second hugeicons map.
 */
const SHARED_UI_ICON_SPECIFIER = "@bb/shared-ui/icon";

export const RUNTIME_SLOT_BY_SPECIFIER: Record<string, string> = {
  react: "react",
  "react-dom": "reactDom",
  "react-dom/client": "reactDomClient",
  "react/jsx-runtime": "jsxRuntime",
  "react/jsx-dev-runtime": "jsxDevRuntime",
  [PLUGIN_SDK_APP_SPECIFIER]: "pluginSdkApp",
  [LEGACY_PLUGIN_SDK_APP_SPECIFIER]: "pluginSdkApp",
  "@pierre/diffs": "pierreDiffs",
  "@pierre/diffs/react": "pierreDiffsReact",
  "@radix-ui/react-alert-dialog": "radixAlertDialog",
  "@radix-ui/react-context-menu": "radixContextMenu",
  "@radix-ui/react-dialog": "radixDialog",
  "@radix-ui/react-dropdown-menu": "radixDropdownMenu",
  "@radix-ui/react-hover-card": "radixHoverCard",
  "@radix-ui/react-menubar": "radixMenubar",
  "@radix-ui/react-navigation-menu": "radixNavigationMenu",
  "@radix-ui/react-popover": "radixPopover",
  "@radix-ui/react-select": "radixSelect",
  "@radix-ui/react-tooltip": "radixTooltip",
  sonner: "sonner",
  vaul: "vaul",
  clsx: "clsx",
  "tailwind-merge": "tailwindMerge",
  "class-variance-authority": "classVarianceAuthority",
  [SHARED_UI_ICON_SPECIFIER]: "sharedUiIcon",
};

/**
 * Real-path suffix of shared-ui's icon module (extension stripped). esbuild
 * resolves workspace symlinks, so an importer under
 * `node_modules/@bb/shared-ui/...` reports its `packages/shared-ui/src/...`
 * path; a plugin's own vendored `icon.tsx` (a registry copy, possibly
 * extended with the plugin's icons) never matches and bundles as before.
 */
const SHARED_UI_ICON_MODULE_SUFFIX = "/shared-ui/src/components/ui/icon";
const SHARED_UI_SOURCE_IMPORTER = /[\\/]shared-ui[\\/]src[\\/]/;

/**
 * Whether a relative import from inside shared-ui's source tree names the
 * icon module. Extension-agnostic: shared-ui imports `./icon`, and a `.js`
 * or `.tsx` suffix must resolve the same way.
 */
export function isSharedUiIconRelativeImport(
  importPath: string,
  importer: string,
): boolean {
  if (!SHARED_UI_SOURCE_IMPORTER.test(importer)) return false;
  const resolved = resolve(dirname(importer), importPath)
    .replace(/\\/g, "/")
    .replace(/\.(?:tsx?|jsx?)$/, "");
  return resolved.endsWith(SHARED_UI_ICON_MODULE_SUFFIX);
}

/**
 * Named exports of `@get-bb/plugin-sdk/app` are read from a fresh facade module on
 * every app build. The dev server stays alive while the SDK source changes, so
 * retaining the first module namespace here would make newly-added exports
 * unavailable to every subsequent plugin rebuild until the server restarted.
 * Packaged bundles cannot resolve the facade as a package, so they use the
 * export manifest generated directly from SDK source at bundle time. Other
 * shared-runtime lists in that manifest are introspected from the host app's
 * installed packages by scripts/generate-runtime-export-manifest.mjs.
 */
let freshFacadeImportSequence = 0;

async function freshModuleExports(moduleUrl: string): Promise<string[]> {
  const freshUrl = new URL(moduleUrl);
  freshUrl.searchParams.set(
    "bb-plugin-build",
    String(++freshFacadeImportSequence),
  );
  const moduleNamespace = await import(freshUrl.href);
  return Object.keys(moduleNamespace).sort();
}

async function shimExportsOf(
  requestedSpecifier: string,
  pluginSdkAppModuleUrl: string | undefined,
): Promise<readonly string[]> {
  // The legacy SDK alias shares the new specifier's exports and manifest entry.
  const specifier =
    requestedSpecifier === LEGACY_PLUGIN_SDK_APP_SPECIFIER
      ? PLUGIN_SDK_APP_SPECIFIER
      : requestedSpecifier;
  if (specifier === PLUGIN_SDK_APP_SPECIFIER) {
    if (pluginSdkAppModuleUrl !== undefined) {
      return freshModuleExports(pluginSdkAppModuleUrl);
    }
    let resolvedModuleUrl: string;
    try {
      resolvedModuleUrl = import.meta.resolve(PLUGIN_SDK_APP_SPECIFIER);
    } catch {
      // The built CLI bundles @bb/plugin-build but does not install
      // plugin-build's dependency as a directly resolvable package. Do not
      // derive this from a bundled namespace: esbuild can tree-shake that
      // namespace to the exports referenced elsewhere in the outer bundle.
      // The generated manifest is derived statically from SDK source before
      // CLI/packaged-daemon builds and cannot lose otherwise-unused exports.
      const names = RUNTIME_EXPORT_MANIFEST[specifier];
      if (!names) {
        throw new Error(`no runtime export manifest entry for "${specifier}"`);
      }
      return names;
    }
    return freshModuleExports(resolvedModuleUrl);
  }
  const names = RUNTIME_EXPORT_MANIFEST[specifier];
  if (!names) {
    throw new Error(`no runtime export manifest entry for "${specifier}"`);
  }
  return names;
}

/**
 * ESM shim re-exporting a `globalThis.__bbPluginRuntime` slot. Each slot
 * holds the host's `import * as` namespace, so a module with a real default
 * export (clsx's function, React's CJS `module.exports`) carries
 * it under `default`; the shim forwards that so `import clsx from "clsx"`
 * receives the callable, not the namespace. Modules without one (radix,
 * sonner, vaul, tailwind-merge) fall back to the namespace as before.
 */
async function shimModuleSource(
  specifier: string,
  slot: string,
  pluginSdkAppModuleUrl: string | undefined,
): Promise<string> {
  const names = await shimExportsOf(specifier, pluginSdkAppModuleUrl);
  return [
    `const runtime = globalThis.__bbPluginRuntime;`,
    `if (runtime == null || runtime.${slot} == null) {`,
    `  throw new Error(${JSON.stringify(
      `Cannot load "${specifier}": this bundle must be loaded by the BB app, which provides the shared plugin runtime (globalThis.__bbPluginRuntime).`,
    )});`,
    `}`,
    `const mod = runtime.${slot};`,
    `export default ("default" in mod ? mod.default : mod);`,
    `export const {`,
    ...names.map((name) => `  ${name},`),
    `} = mod;`,
    ``,
  ].join("\n");
}

const SHIM_NAMESPACE = "bb-plugin-runtime-shim";
// Derived from the slot map so the two can never drift; everything not
// matched here bundles normally from the plugin's node_modules.
const SHIM_FILTER = new RegExp(
  `^(${Object.keys(RUNTIME_SLOT_BY_SPECIFIER)
    .map((specifier) => specifier.replace(/[/@.-]/g, "\\$&"))
    .join("|")})$`,
);

/** Internal export for focused build tests; not re-exported by the package. */
export function runtimeShimPlugin(pluginSdkAppModuleUrl?: string): Plugin {
  return {
    name: "bb-plugin-runtime-shims",
    setup(build) {
      build.onResolve({ filter: SHIM_FILTER }, (args) => ({
        path: args.path,
        namespace: SHIM_NAMESPACE,
      }));
      // shared-ui components reach the icon module relatively; without this
      // arm a bundled `empty-state`/`resource-pagination` would drag the
      // whole hugeicons map in beside the shimmed package specifier.
      build.onResolve({ filter: /(^|\/)icon(\.[jt]sx?)?$/ }, (args) => {
        if (
          args.namespace !== "file" ||
          !args.path.startsWith(".") ||
          !isSharedUiIconRelativeImport(args.path, args.importer)
        ) {
          return undefined;
        }
        return { path: SHARED_UI_ICON_SPECIFIER, namespace: SHIM_NAMESPACE };
      });
      build.onLoad(
        { filter: /.*/, namespace: SHIM_NAMESPACE },
        async (args) => ({
          contents: await shimModuleSource(
            args.path,
            RUNTIME_SLOT_BY_SPECIFIER[args.path] ?? args.path,
            pluginSdkAppModuleUrl,
          ),
          loader: "js",
        }),
      );
    },
  };
}

interface PluginAppConfig {
  /** Absolute path of the `bb.app` entry file. */
  appEntry: string;
  packageName: string;
  pluginVersion: string;
}

type ScannerSource = {
  base: string;
  pattern: string;
  negated: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDependencyNames(pkg: Record<string, unknown>): string[] {
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies"] as const) {
    const dependencies = pkg[field];
    if (!isRecord(dependencies)) continue;
    for (const name of Object.keys(dependencies)) {
      names.add(name);
    }
  }
  return [...names].sort();
}

async function readPackageJson(
  filePath: string,
): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    throw new Error(`no readable package.json at ${filePath}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`package.json is not valid JSON at ${filePath}`);
  }
  if (!isRecord(json)) {
    throw new Error(`package.json must contain an object at ${filePath}`);
  }
  return json;
}

function readTailwindContentPatterns(
  pkg: Record<string, unknown>,
  packageJsonPath: string,
): string[] {
  const bb = pkg.bb;
  if (!isRecord(bb) || bb.pluginTailwindContent === undefined) {
    return [];
  }
  const patterns = bb.pluginTailwindContent;
  if (
    !Array.isArray(patterns) ||
    !patterns.every((pattern) => typeof pattern === "string")
  ) {
    throw new Error(
      `bb.pluginTailwindContent must be an array of strings in ${packageJsonPath}`,
    );
  }
  return patterns;
}

async function packageJsonPathForDirectDependency(
  rootDir: string,
  packageName: string,
): Promise<string | null> {
  const packageJsonPath = join(
    rootDir,
    "node_modules",
    packageName,
    "package.json",
  );
  try {
    await stat(packageJsonPath);
    return packageJsonPath;
  } catch {
    return null;
  }
}

async function readDependencyTailwindSources(
  rootDir: string,
): Promise<ScannerSource[]> {
  const rootPackageJsonPath = join(rootDir, "package.json");
  const rootPackageJson = await readPackageJson(rootPackageJsonPath);
  const sources: ScannerSource[] = [];

  for (const packageName of readDependencyNames(rootPackageJson)) {
    const packageJsonPath = await packageJsonPathForDirectDependency(
      rootDir,
      packageName,
    );
    if (packageJsonPath === null) continue;

    const packageJson = await readPackageJson(packageJsonPath);
    const patterns = readTailwindContentPatterns(packageJson, packageJsonPath);
    if (patterns.length === 0) continue;
    // esbuild reports bundled files by real path (workspace links resolve to
    // the package's checkout), so the scan base must be the real directory
    // too or the two never intersect.
    const base = await realpath(dirname(packageJsonPath));
    for (const rawPattern of patterns) {
      const negated = rawPattern.startsWith("!");
      const pattern = negated ? rawPattern.slice(1) : rawPattern;
      sources.push({ base, pattern, negated });
    }
  }

  return sources;
}

/** Read `<rootDir>/package.json` and resolve its `bb.app` entry, or throw. */
async function readPluginAppConfig(rootDir: string): Promise<PluginAppConfig> {
  const packageJsonPath = join(rootDir, "package.json");
  const pkg = await readPackageJson(packageJsonPath);
  const manifest = await validatePluginBuildManifest(
    pkg,
    rootDir,
    packageJsonPath,
  );
  const app = manifest.bb.app;
  if (app === undefined) {
    throw new Error(
      `no frontend entry: ${packageJsonPath} has no "bb": { "app": "./app.tsx" } field (only plugins with an app entry can be built)`,
    );
  }
  if (isAbsolute(app)) {
    throw new Error(`manifest bb.app must be relative, got "${app}"`);
  }
  const appEntry = resolve(rootDir, app);
  if (appEntry !== rootDir && !appEntry.startsWith(rootDir + "/")) {
    throw new Error(`manifest bb.app escapes the plugin directory: "${app}"`);
  }
  try {
    await stat(appEntry);
  } catch {
    throw new Error(`manifest bb.app points at a missing file: ${app}`);
  }
  return {
    appEntry,
    packageName: manifest.name,
    pluginVersion: manifest.version,
  };
}

/**
 * Tailwind v4 pass over the plugin's sources. Theme + utilities layers only;
 * the compiled classes resolve against the host's live CSS variables at
 * runtime. Tailwind itself comes from the CLI's own installation (plugins do
 * not need tailwindcss installed), via `customCssResolver`.
 *
 * Direct dependencies can opt their sources into the scan with
 * `bb.pluginTailwindContent` globs in their package.json. Builtin plugins use
 * this for workspace UI packages that ship raw TS/TSX source: esbuild bundles
 * the package fine, but Tailwind must also see its class strings or it will
 * purge their utilities from app.css. Only the matching files esbuild actually
 * bundled (`bundledInputs`, from its metafile) are scanned: scanning the whole
 * glob made every plugin carry the utilities of every shared component,
 * imported or not — ~110 KB / ~1200 rules per plugin sheet.
 *
 * The input embeds two generated constants (plugin-theme.generated.ts) so
 * plugin utilities compile against the same tokens the host uses:
 * - the host's `@theme` blocks — without the semantic-token bridge,
 *   `bg-background`/`text-muted-foreground`/`rounded-lg` don't compile at all
 *   (the default Tailwind theme has no such keys);
 * - the vendored tw-animate-css source — the host ships it, component idiom
 *   depends on it (`animate-in`/`fade-in-0`), and its style-only npm exports
 *   can't be require.resolve'd from the packaged CLI.
 *
 * The utilities are confined to THIS plugin's own mounts — the
 * `[data-bb-plugin="<id>"]` attribute every plugin mount root
 * (PluginSlotMount) and plugin-rendered portal (portal-scope) carries — so
 * plugin utility rules can never touch host elements OR another plugin's
 * pane. Without any scope, a plugin's plain `.flex-col` (same `utilities`
 * layer, later stylesheet) overrides the host's `sm:flex-row` everywhere: a
 * media query adds no specificity, so the later plain rule wins and host
 * layouts silently collapse. A generic `[data-bb-plugin-root]` scope shared
 * by all plugins has the same failure between plugins: every sheet matches
 * every pane and whichever plugin's sheet loads last overrides earlier
 * plugins' container-variant rules with its own base utilities (e.g. a later
 * `.grid` beating an earlier `@md:flex`).
 *
 * The confinement is a zero-specificity `:where()` selector rewrite
 * (scopePluginUtilities), NOT the `@scope` at-rule this used to emit: `@scope`
 * costs Safari ~300ms per style recalculation for a single plugin's utilities
 * layer. See scope-plugin-utilities.ts for the measurements and the exact
 * rewrite. Cascade order WITHIN the plugin's sheet is unchanged either way.
 * Theme variables and `@property` registrations stay top-level and unscoped:
 * `:root` vars must land on the document root and `@property` is invalid when
 * nested. The `:root` block carries only the non-inline tokens (Tailwind
 * defaults such as `--container-3xl`, the host's typography scale) that the
 * plugin's utilities reference by `var()` and the host emits only for the
 * ones it uses itself; the semantic bridge is `inline reference`
 * (plugin-theme.generated.ts) and emits nothing.
 */
async function buildTailwindCss(
  rootDir: string,
  pluginId: string,
  toolchain: PluginBuildToolchain,
  bundledInputs: ReadonlySet<string>,
): Promise<string> {
  // A dynamic specifier is opaque to TS, so restate the module types here.
  // The packages stay devDependencies: they are resolved at runtime from the
  // caller's toolchain, and are needed only for these types.
  const [{ compile }, { Scanner }] = await Promise.all([
    import(toolchain.tailwindNode) as Promise<
      typeof import("@tailwindcss/node")
    >,
    import(toolchain.tailwindOxide) as Promise<
      typeof import("@tailwindcss/oxide")
    >,
  ]);
  const input = [
    `@layer theme, utilities;`,
    `@import "tailwindcss/theme.css" layer(theme);`,
    // Same order as the host's theme.css: tw-animate first, then the host
    // @theme blocks (so host tokens win any overlapping keys).
    TW_ANIMATE_CSS,
    PLUGIN_THEME_CSS,
    `@layer utilities {`,
    `  @tailwind utilities;`,
    `}`,
    ``,
  ].join("\n");
  const compiler = await compile(input, {
    base: rootDir,
    onDependency: () => {},
    // Resolved against the toolchain rather than this module: a shipped
    // server bundles @bb/plugin-build but installs no tailwindcss, so
    // resolving relative to import.meta.url finds nothing there.
    customCssResolver: async (id) => {
      if (id !== "tailwindcss" && !id.startsWith("tailwindcss/")) {
        return undefined;
      }
      const subpath =
        id === "tailwindcss" ? "index.css" : id.slice("tailwindcss/".length);
      const candidate = join(toolchain.tailwindCssDir, subpath);
      return existsSync(candidate) ? candidate : undefined;
    },
  });
  const ownScanner = new Scanner({
    sources: [
      { base: rootDir, pattern: "**/*", negated: false },
      { base: join(rootDir, "dist"), pattern: "**/*", negated: true },
      { base: join(rootDir, "node_modules"), pattern: "**/*", negated: true },
    ],
  });
  const candidates = new Set(ownScanner.scan());

  const dependencySources = await readDependencyTailwindSources(rootDir);
  if (dependencySources.length > 0) {
    // `files` resolves the globs without reading anything; only the bundled
    // subset is read and scanned.
    const bundledDependencyFiles = new Scanner({
      sources: dependencySources,
    }).files.filter((file) => bundledInputs.has(file));
    const contents = await Promise.all(
      bundledDependencyFiles.map(async (file) => ({
        content: await readFile(file, "utf8"),
        extension: extname(file).slice(1),
      })),
    );
    for (const candidate of new Scanner({ sources: [] }).scanFiles(contents)) {
      candidates.add(candidate);
    }
  }
  return scopePluginUtilities(
    compiler.build([...candidates]),
    pluginScopeRoots(pluginId),
  );
}

/**
 * Absolute paths of every file esbuild bundled into app.js, from its
 * metafile. Runtime shims and disabled modules are virtual and skipped.
 */
function bundledInputPaths(
  metafile: Metafile,
  absWorkingDir: string,
): Set<string> {
  const paths = new Set<string>();
  for (const input of Object.keys(metafile.inputs)) {
    if (input.startsWith(`${SHIM_NAMESPACE}:`) || input.startsWith("(")) {
      continue;
    }
    paths.add(resolve(absWorkingDir, input));
  }
  return paths;
}

export interface PluginAppBuildResult {
  jsPath: string;
  cssPath: string;
  metaPath: string;
}

export interface PluginAppBuildOptions {
  /**
   * Minify app.js and app.css. On by default: the artifacts are what every
   * browser downloads and parses, so bytes are the product. `bb plugin dev`
   * turns it off so stack traces and the emitted CSS stay readable while
   * iterating; the plugin behaves the same either way.
   */
  minify: boolean;
}

/**
 * Build `<rootDir>`'s frontend bundle into `<rootDir>/dist/`. Throws with a
 * human-readable message on any problem (missing bb.app, compile errors).
 */
export async function buildPluginApp(
  rootDir: string,
  bbVersion: string,
  toolchain: PluginBuildToolchain,
  options: PluginAppBuildOptions = { minify: true },
): Promise<PluginAppBuildResult> {
  const { appEntry, packageName, pluginVersion } =
    await readPluginAppConfig(rootDir);
  const pluginId = derivePluginId(packageName);
  const distDir = join(rootDir, "dist");
  await mkdir(distDir, { recursive: true });
  const jsPath = join(distDir, "app.js");
  const cssPath = join(distDir, "app.css");
  const metaPath = join(distDir, "app.meta.json");

  // Build all three artifacts into a staging directory and only rename them
  // into place once every step has succeeded — a Tailwind or meta failure
  // after esbuild must not leave dist/ with a fresh app.js beside stale
  // css/meta (the server serves dist under the recorded hash with immutable
  // caching). The staging dir lives under dist/ so the Tailwind scanner's
  // negated dist/** source keeps it out of the CSS candidate scan.
  const stageDir = await mkdtemp(join(distDir, ".stage-"));
  try {
    const stagedJsPath = join(stageDir, "app.js");
    const stagedCssPath = join(stageDir, "app.css");
    const stagedMetaPath = join(stageDir, "app.meta.json");

    const esbuild = (await import(
      toolchain.esbuild
    )) as typeof import("esbuild");
    const bundle = await esbuild.build({
      entryPoints: [appEntry],
      outfile: stagedJsPath,
      absWorkingDir: rootDir,
      bundle: true,
      metafile: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      minify: options.minify,
      legalComments: "none",
      // Production jsx-runtime, always — the host only guarantees the dev
      // runtime for `bb plugin dev`, and dev-transformed output in a
      // production page is how subtle double-React bugs start. Deliberately
      // a single mode: `bb plugin dev` builds through here too, so the
      // reserved jsxDevRuntime shim slot is unreachable from our own output.
      // Enabling dev JSX would take a dev-mode build flag that flips jsxDev
      // and relies on that reserved slot.
      jsx: "automatic",
      jsxDev: false,
      define: {
        "process.env.NODE_ENV": '"production"',
        // Consumed by shared-ui's vendored portal-scope so plugin-rendered
        // portals (dialog, select, …) carry this plugin's own scope id and
        // match the per-plugin arm of app.css's scope selector.
        __BB_PLUGIN_ID__: JSON.stringify(pluginId),
      },
      logLevel: "error",
      plugins: [runtimeShimPlugin()],
    });

    // Esbuild writes imported styles beside app.js. Preserve them unscoped:
    // authored selectors may target ProseMirror decorations in the host
    // editor, outside PluginSlotMount. Tailwind utilities remain scoped by
    // buildTailwindCss so their generic class names cannot leak into the host.
    let authoredCss = "";
    try {
      authoredCss = await readFile(stagedCssPath, "utf8");
    } catch (error) {
      if (!isRecord(error) || error.code !== "ENOENT") throw error;
    }
    const tailwindCss = (
      await buildTailwindCss(
        rootDir,
        pluginId,
        toolchain,
        bundledInputPaths(bundle.metafile, rootDir),
      )
    ).trimEnd();
    // Tailwind's own optimizer (lightningcss, the same pass the host's Vite
    // build runs): merges and minifies rules, and lowers syntax for the same
    // browser targets in both modes so dev and production sheets differ only
    // in whitespace.
    const { optimize } = (await import(
      toolchain.tailwindNode
    )) as typeof import("@tailwindcss/node");
    const css = optimize(`${tailwindCss}\n${authoredCss}`, {
      minify: options.minify,
    }).code;
    await writeFile(stagedCssPath, css);
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
    await rename(stagedCssPath, cssPath);
    await rename(stagedMetaPath, metaPath);
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
  return { jsPath, cssPath, metaPath };
}
