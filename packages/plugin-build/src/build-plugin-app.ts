import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import type { Plugin } from "esbuild";
import { PLUGIN_SDK_MAJOR, PLUGIN_SDK_VERSION } from "@bb/domain";
import { PLUGIN_SDK_APP_EXPORT_NAMES } from "@bb/plugin-sdk";
import { RUNTIME_EXPORT_MANIFEST } from "./runtime-export-manifest.js";

/**
 * `bb plugin build` — compile a plugin's `bb.app` entry (app.tsx) into a
 * runtime-loadable frontend bundle:
 *
 * - `dist/app.js` — single ESM file, production jsx-runtime forced. The
 *   shared-runtime modules (react, react-dom, react-dom/client,
 *   react/jsx-runtime, react/jsx-dev-runtime, @bb/plugin-sdk/app) are never
 *   bundled; an esbuild plugin swaps them for shims that read
 *   `globalThis.__bbPluginRuntime` — the host app provides one React, so a
 *   second copy (and its "Invalid hook call" crashes) is impossible.
 * - `dist/app.css` — a plugin-scoped Tailwind v4 pass over the plugin's own
 *   sources. Host theme tokens are live CSS variables at runtime, so this
 *   pass only needs to emit the plugin's own utility classes (theme +
 *   utilities layers; no preflight — the host already loads it).
 * - `dist/app.meta.json` — `{ sdkMajor, sdkVersion }` sidecar the host checks
 *   before loading the bundle.
 */

/** Runtime slot on `globalThis.__bbPluginRuntime` per shimmed specifier. */
const RUNTIME_SLOT_BY_SPECIFIER: Record<string, string> = {
  react: "react",
  "react-dom": "reactDom",
  "react-dom/client": "reactDomClient",
  "react/jsx-runtime": "jsxRuntime",
  "react/jsx-dev-runtime": "jsxDevRuntime",
  "@bb/plugin-sdk/app": "pluginSdkApp",
};

/**
 * Named exports of `@bb/plugin-sdk/app`, sourced from the facade package's
 * PLUGIN_SDK_APP_EXPORT_NAMES so shim, facade, and the app implementation
 * cannot drift (the app asserts its implementation keys equal the same
 * list); the React lists next to it come from
 * scripts/generate-runtime-export-manifest.mjs instead.
 */
const PLUGIN_SDK_APP_EXPORTS: readonly string[] = PLUGIN_SDK_APP_EXPORT_NAMES;

function shimExportsOf(specifier: string): readonly string[] {
  if (specifier === "@bb/plugin-sdk/app") return PLUGIN_SDK_APP_EXPORTS;
  const names = RUNTIME_EXPORT_MANIFEST[specifier];
  if (!names) {
    throw new Error(`no runtime export manifest entry for "${specifier}"`);
  }
  return names;
}

/** ESM shim re-exporting a `globalThis.__bbPluginRuntime` slot. */
function shimModuleSource(specifier: string, slot: string): string {
  const names = shimExportsOf(specifier);
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
const SHIM_FILTER =
  /^(react|react-dom|react-dom\/client|react\/jsx-runtime|react\/jsx-dev-runtime|@bb\/plugin-sdk\/app)$/;

function runtimeShimPlugin(): Plugin {
  return {
    name: "bb-plugin-runtime-shims",
    setup(build) {
      build.onResolve({ filter: SHIM_FILTER }, (args) => ({
        path: args.path,
        namespace: SHIM_NAMESPACE,
      }));
      build.onLoad({ filter: /.*/, namespace: SHIM_NAMESPACE }, (args) => ({
        contents: shimModuleSource(
          args.path,
          RUNTIME_SLOT_BY_SPECIFIER[args.path] ?? args.path,
        ),
        loader: "js",
      }));
    },
  };
}

interface PluginAppConfig {
  /** Absolute path of the `bb.app` entry file. */
  appEntry: string;
  packageName: string;
}

/** Read `<rootDir>/package.json` and resolve its `bb.app` entry, or throw. */
async function readPluginAppConfig(rootDir: string): Promise<PluginAppConfig> {
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
  const pkg = json as { name?: unknown; bb?: { app?: unknown } };
  const app = pkg.bb?.app;
  if (typeof app !== "string" || app.length === 0) {
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
    packageName: typeof pkg.name === "string" ? pkg.name : rootDir,
  };
}

/**
 * Tailwind v4 pass over the plugin's sources. Theme + utilities layers only;
 * the compiled classes resolve against the host's live CSS variables at
 * runtime. Tailwind itself comes from the CLI's own installation (plugins do
 * not need tailwindcss installed), via `customCssResolver`.
 *
 * The utilities are emitted inside `@scope ([data-bb-plugin-root])` — the
 * attribute every plugin mount root carries (PluginSlotMount) — so plugin
 * utility rules can never touch host elements. Without the scope, a plugin's
 * plain `.flex-col` (same `utilities` layer, later stylesheet) overrides the
 * host's `sm:flex-row` everywhere: a media query adds no specificity, so the
 * later plain rule wins and host layouts silently collapse. `@scope` adds no
 * specificity of its own, so cascade order WITHIN the plugin's sheet is
 * unchanged. Theme variables and `@property` registrations stay top-level:
 * `:root` vars must land on the document root (status quo — the host defines
 * the same tokens) and `@property` is invalid when nested.
 */
async function buildTailwindCss(rootDir: string): Promise<string> {
  const [{ compile }, { Scanner }] = await Promise.all([
    import("@tailwindcss/node"),
    import("@tailwindcss/oxide"),
  ]);
  const cliRequire = createRequire(import.meta.url);
  const input = [
    `@layer theme, utilities;`,
    `@import "tailwindcss/theme.css" layer(theme);`,
    `@layer utilities {`,
    `  @scope ([data-bb-plugin-root]) {`,
    `    @tailwind utilities;`,
    `  }`,
    `}`,
    ``,
  ].join("\n");
  const compiler = await compile(input, {
    base: rootDir,
    onDependency: () => {},
    customCssResolver: async (id) => {
      if (id !== "tailwindcss" && !id.startsWith("tailwindcss/")) {
        return undefined;
      }
      try {
        return cliRequire.resolve(
          id === "tailwindcss" ? "tailwindcss/index.css" : id,
        );
      } catch {
        return undefined;
      }
    },
  });
  const scanner = new Scanner({
    sources: [
      { base: rootDir, pattern: "**/*", negated: false },
      { base: join(rootDir, "dist"), pattern: "**/*", negated: true },
      { base: join(rootDir, "node_modules"), pattern: "**/*", negated: true },
    ],
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
): Promise<PluginAppBuildResult> {
  const { appEntry } = await readPluginAppConfig(rootDir);
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

    const esbuild = await import("esbuild");
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
      define: { "process.env.NODE_ENV": '"production"' },
      logLevel: "error",
      plugins: [runtimeShimPlugin()],
    });

    // After esbuild so a stray CSS entry emitted by the bundle step can never
    // clobber the Tailwind output.
    await writeFile(stagedCssPath, await buildTailwindCss(rootDir));
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
    await rename(stagedCssPath, cssPath);
    await rename(stagedMetaPath, metaPath);
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
  return { jsPath, cssPath, metaPath };
}
