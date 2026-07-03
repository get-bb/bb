// Regenerates src/runtime-export-manifest.ts from the repo's installed
// shared-runtime packages. `bb plugin build` shims the shared-runtime modules
// (react, the portaling radix families, sonner, vaul, ...) as ESM re-exports
// over globalThis.__bbPluginRuntime, and ESM needs static named-export lists —
// so we introspect the real modules once and check the result in. Rerun this
// script after upgrading react or any shimmed package:
//
//   node packages/plugin-build/scripts/generate-runtime-export-manifest.mjs
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
];

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Named exports the shim re-exports statically. Dunder keys (React's
 * internals like __CLIENT_INTERNALS_…) are host-runtime plumbing, not plugin
 * API — plugins get the same object via the default export anyway.
 */
function namedExportsOf(moduleId) {
  const mod = appRequire(moduleId);
  return Object.keys(mod)
    .filter(
      (key) =>
        IDENTIFIER_RE.test(key) && key !== "default" && !key.startsWith("__"),
    )
    .sort();
}

const reactVersion = appRequire("react/package.json").version;
const entries = RUNTIME_MODULE_IDS.map(
  (id) =>
    `  ${JSON.stringify(id)}: [\n${namedExportsOf(id)
      .map((name) => `    ${JSON.stringify(name)},`)
      .join("\n")}\n  ],`,
).join("\n");

const output = `// GENERATED FILE — do not edit by hand.
// Named exports of the shared runtime modules (react@${reactVersion} + the
// shimmed radix/sonner/vaul packages), introspected from the host app's
// installed copies. Consumed by
// \`bb plugin build\` to emit static ESM re-export shims over
// globalThis.__bbPluginRuntime. Regenerate after upgrading a shimmed package:
//   node packages/plugin-build/scripts/generate-runtime-export-manifest.mjs

export const RUNTIME_EXPORT_MANIFEST: Record<string, readonly string[]> = {
${entries}
};
`;

const outPath = path.join(scriptDir, "..", "src", "runtime-export-manifest.ts");
await writeFile(outPath, output);
console.log(`wrote ${outPath} (react@${reactVersion})`);
