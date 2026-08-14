// Regenerates src/runtime-export-manifest.ts from the repo's installed
// shared-runtime packages. `bb plugin build` shims the shared-runtime modules
// (react, the portaling radix families, sonner, vaul, ...) as ESM re-exports
// over globalThis.__bbPluginRuntime, and ESM needs static named-export lists —
// so we introspect the real modules once and check the result in. Rerun this
// script after upgrading react or any shimmed package:
//
//   node packages/plugin-build/scripts/generate-runtime-export-manifest.mjs
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// Node 20 does not expose the browser-compatible Navigator global added in
// later Node releases. Some shared browser runtimes (currently @pierre/diffs)
// read navigator.userAgent during module initialization, so give export
// introspection the same minimal environment on every supported Node version.
if (typeof globalThis.navigator === "undefined") {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "node" },
  });
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
// Resolve React exactly as the host app does — apps/app owns the runtime the
// shims will read at load time.
const appRequire = createRequire(
  path.join(scriptDir, "..", "..", "..", "apps", "app", "package.json"),
);

const RUNTIME_MODULE_IDS = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  // Portaling radix families (plugin design §5.5): shimmed so vendored
  // components share the host's dismissable-layer/focus/scroll-lock world.
  // Non-portal radix has no singleton semantics and bundles per plugin.
  "@radix-ui/react-alert-dialog",
  "@radix-ui/react-context-menu",
  "@radix-ui/react-dialog",
  "@radix-ui/react-dropdown-menu",
  "@radix-ui/react-hover-card",
  "@radix-ui/react-menubar",
  "@radix-ui/react-navigation-menu",
  "@radix-ui/react-popover",
  "@radix-ui/react-select",
  "@radix-ui/react-tooltip",
  // toast() must reach the host toaster; vaul mutates document.body styles.
  "sonner",
  "vaul",
  // Diff rendering: FileDiff reads the host's WorkerPoolContextProvider
  // (React context identity requires one module copy) and sharing keeps
  // shiki's grammars out of plugin bundles.
  "@pierre/diffs",
  "@pierre/diffs/react",
];

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Named exports the shim re-exports statically. Dunder keys (React's
 * internals like __CLIENT_INTERNALS_…) are host-runtime plumbing, not plugin
 * API — plugins get the same object via the default export anyway.
 */
async function loadRuntimeModule(moduleId) {
  try {
    return appRequire(moduleId);
  } catch {
    // ESM-only package (import-only exports map, e.g. @pierre/diffs):
    // resolve its export entry by hand through the app's node_modules and
    // dynamic-import it.
    const parts = moduleId.split("/");
    const pkgName = moduleId.startsWith("@")
      ? parts.slice(0, 2).join("/")
      : parts[0];
    const subpath = `.${moduleId.slice(pkgName.length)}`;
    const pkgDir = path.join(
      scriptDir,
      "..",
      "..",
      "..",
      "apps",
      "app",
      "node_modules",
      pkgName,
    );
    const pkg = JSON.parse(
      await readFile(path.join(pkgDir, "package.json"), "utf8"),
    );
    const entry = pkg.exports?.[subpath];
    const rel =
      typeof entry === "string" ? entry : (entry?.import ?? entry?.default);
    if (typeof rel !== "string") {
      throw new Error(`cannot resolve ${moduleId} from ${pkgDir}`);
    }
    return await import(pathToFileURL(path.join(pkgDir, rel)).href);
  }
}

async function namedExportsOf(moduleId) {
  const mod = await loadRuntimeModule(moduleId);
  return Object.keys(mod)
    .filter(
      (key) =>
        IDENTIFIER_RE.test(key) && key !== "default" && !key.startsWith("__"),
    )
    .sort();
}

async function pluginSdkAppExports() {
  const entryPoint = path.join(
    scriptDir,
    "..",
    "..",
    "plugin-sdk",
    "src",
    "app.ts",
  );
  const result = await build({
    entryPoints: [entryPoint],
    bundle: false,
    format: "esm",
    logLevel: "silent",
    metafile: true,
    platform: "neutral",
    write: false,
  });
  const entryOutput = Object.values(result.metafile.outputs).find(
    (output) => output.entryPoint !== undefined,
  );
  if (entryOutput === undefined) {
    throw new Error(`esbuild did not report exports for ${entryPoint}`);
  }
  return entryOutput.exports
    .filter((name) => IDENTIFIER_RE.test(name) && name !== "default")
    .sort();
}

const reactVersion = appRequire("react/package.json").version;
const entryChunks = [];
entryChunks.push(
  `  "@get-bb/plugin-sdk/app": [\n${(await pluginSdkAppExports())
    .map((name) => `    ${JSON.stringify(name)},`)
    .join("\n")}\n  ],`,
);
for (const id of RUNTIME_MODULE_IDS) {
  const names = await namedExportsOf(id);
  entryChunks.push(
    `  ${JSON.stringify(id)}: [\n${names
      .map((name) => `    ${JSON.stringify(name)},`)
      .join("\n")}\n  ],`,
  );
}
const entries = entryChunks.join("\n");

const output = `// GENERATED FILE — do not edit by hand.
// Named exports of the plugin SDK app facade and shared runtime modules
// (react@${reactVersion} + the shimmed radix/sonner/vaul packages), derived
// from SDK source/build metadata and the host app's installed copies.
// Consumed by
// \`bb plugin build\` to emit static ESM re-export shims over
// globalThis.__bbPluginRuntime. Regenerate after upgrading a shimmed package:
//   node packages/plugin-build/scripts/generate-runtime-export-manifest.mjs

export const RUNTIME_EXPORT_MANIFEST: Record<string, readonly string[]> = {
${entries}
};
`;

const outPath = path.join(scriptDir, "..", "src", "runtime-export-manifest.ts");
if (process.argv.includes("--check")) {
  const current = await readFile(outPath, "utf8").catch(() => "");
  if (current !== output) {
    throw new Error(
      `${outPath} is stale; run node packages/plugin-build/scripts/generate-runtime-export-manifest.mjs`,
    );
  }
  console.log(`checked ${outPath} (react@${reactVersion})`);
} else {
  const tempPath = `${outPath}.${process.pid}.tmp`;
  try {
    await writeFile(tempPath, output);
    await rename(tempPath, outPath);
  } finally {
    await rm(tempPath, { force: true });
  }
  console.log(`wrote ${outPath} (react@${reactVersion})`);
}
