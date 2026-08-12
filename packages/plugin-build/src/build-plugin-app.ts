import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { derivePluginId } from "@bb/domain";
import type { Plugin } from "esbuild";
import {
  PLUGIN_THEME_CSS,
  TW_ANIMATE_CSS,
} from "./generated/plugin-theme.generated.js";
import { RUNTIME_EXPORT_MANIFEST } from "./runtime-export-manifest.js";
import { type PluginBuildToolchain } from "./toolchain.js";
import { createPluginArtifactMeta } from "./plugin-artifact-meta.js";
import { validatePluginBuildManifest } from "./plugin-manifest.js";

/**
 * `bb plugin build` — compile a plugin's `bb.app` entry (app.tsx) into a
 * runtime-loadable frontend bundle:
 *
 * - `dist/app.js` — single ESM file, production jsx-runtime forced. The
 *   shared-runtime modules (react ×5, @bb/plugin-sdk/app, the portaling
 *   radix families, sonner, vaul — see RUNTIME_SLOT_BY_SPECIFIER) are never
 *   bundled; an esbuild plugin swaps them for shims that read
 *   `globalThis.__bbPluginRuntime` — the host app provides one React, so a
 *   second copy (and its "Invalid hook call" crashes) is impossible.
 * - `dist/app.css` — a plugin-scoped Tailwind v4 pass over the plugin's own
 *   sources plus its imported CSS. Imported CSS stays unscoped so selectors
 *   can target editor decorations rendered outside the plugin mount.
 * - `dist/app.meta.json` — SDK compatibility plus authoritative plugin,
 *   artifact-format, and build-version metadata.
 */

/**
 * Runtime slot on `globalThis.__bbPluginRuntime` per shimmed specifier.
 * Shim policy (plugin design §5.5): ONLY packages with singleton/global
 * behavior — one React, the portaling radix families (shared
 * dismissable-layer/focus/scroll-lock/aria-hidden world), sonner (`toast()`
 * must reach the host toaster), vaul (mutates document.body styles),
 * @pierre/diffs (its react FileDiff reads the host's
 * WorkerPoolContextProvider — context identity requires one module copy —
 * and sharing keeps shiki's grammars out of every plugin bundle) — plus
 * the SDK surface itself. Everything else (non-portal radix, cva/clsx/
 * tailwind-merge, lucide-react, form/calendar/chart libs) bundles from the
 * plugin's own node_modules.
 */
export const RUNTIME_SLOT_BY_SPECIFIER: Record<string, string> = {
  react: "react",
  "react-dom": "reactDom",
  "react-dom/client": "reactDomClient",
  "react/jsx-runtime": "jsxRuntime",
  "react/jsx-dev-runtime": "jsxDevRuntime",
  "@bb/plugin-sdk/app": "pluginSdkApp",
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
};

/**
 * Named exports of `@bb/plugin-sdk/app` are read from a fresh facade module on
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
  specifier: string,
  pluginSdkAppModuleUrl: string | undefined,
): Promise<readonly string[]> {
  if (specifier === "@bb/plugin-sdk/app") {
    if (pluginSdkAppModuleUrl !== undefined) {
      return freshModuleExports(pluginSdkAppModuleUrl);
    }
    let resolvedModuleUrl: string;
    try {
      resolvedModuleUrl = import.meta.resolve("@bb/plugin-sdk/app");
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

/** ESM shim re-exporting a `globalThis.__bbPluginRuntime` slot. */
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
    `export default mod;`,
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
    for (const rawPattern of readTailwindContentPatterns(
      packageJson,
      packageJsonPath,
    )) {
      const negated = rawPattern.startsWith("!");
      const pattern = negated ? rawPattern.slice(1) : rawPattern;
      sources.push({
        base: dirname(packageJsonPath),
        pattern,
        negated,
      });
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
 * Direct dependencies can contribute additional scan roots with
 * `bb.pluginTailwindContent` in their package.json. Builtin plugins use this
 * for workspace UI packages that ship raw TS/TSX source: esbuild bundles the
 * package fine, but Tailwind must also see its class strings or it will purge
 * their utilities from app.css.
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
 * The utilities are emitted inside `@scope` limited to THIS plugin's own
 * mounts — `[data-bb-plugin="<id>"]`, the attribute every plugin mount root
 * (PluginSlotMount) and plugin-rendered portal (portal-scope) carries — so
 * plugin utility rules can never touch host elements OR another plugin's
 * pane. Without any scope, a plugin's plain `.flex-col` (same `utilities`
 * layer, later stylesheet) overrides the host's `sm:flex-row` everywhere: a
 * media query adds no specificity, so the later plain rule wins and host
 * layouts silently collapse. A generic `[data-bb-plugin-root]` scope shared
 * by all plugins has the same failure between plugins: every sheet matches
 * every pane, scope proximity ties, and whichever plugin's sheet loads last
 * overrides earlier plugins' container-variant rules with its own base
 * utilities (e.g. a later `.grid` beating an earlier `@md:flex`). The second
 * scope arm keeps portals styled on hosts whose portal-scope predates the
 * per-plugin id attribute. `@scope` adds no specificity of its own, so
 * cascade order WITHIN the plugin's sheet is unchanged. Theme variables and
 * `@property` registrations stay top-level: `:root` vars must land on the
 * document root (status quo — the host defines the same tokens) and
 * `@property` is invalid when nested.
 */
async function buildTailwindCss(
  rootDir: string,
  pluginId: string,
  toolchain: PluginBuildToolchain,
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
    `  @scope ([data-bb-plugin="${pluginId}"], [data-bb-plugin-root]:not([data-bb-plugin])) {`,
    `    @tailwind utilities;`,
    `  }`,
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
  const scannerSources: ScannerSource[] = [
    { base: rootDir, pattern: "**/*", negated: false },
    { base: join(rootDir, "dist"), pattern: "**/*", negated: true },
    { base: join(rootDir, "node_modules"), pattern: "**/*", negated: true },
    ...(await readDependencyTailwindSources(rootDir)),
  ];
  const scanner = new Scanner({
    sources: scannerSources,
  });
  return compiler.build(scanner.scan());
}

export interface PluginAppBuildResult {
  jsPath: string;
  cssPath: string;
  metaPath: string;
}

/**
 * Build `<rootDir>`'s frontend bundle into `<rootDir>/dist/`. Throws with a
 * human-readable message on any problem (missing bb.app, compile errors).
 */
export async function buildPluginApp(
  rootDir: string,
  bbVersion: string,
  toolchain: PluginBuildToolchain,
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
    await esbuild.build({
      entryPoints: [appEntry],
      outfile: stagedJsPath,
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
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
        // match the per-plugin `@scope` arm of app.css.
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
      await buildTailwindCss(rootDir, pluginId, toolchain)
    ).trimEnd();
    await writeFile(stagedCssPath, `${tailwindCss}\n${authoredCss}`);
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
