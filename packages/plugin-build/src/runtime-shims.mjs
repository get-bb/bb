// The one list of modules `bb plugin build` swaps for host-runtime shims.
//
// Plain ESM on purpose: the build engine (build-plugin-app.ts) imports it as
// a module, and two generator scripts that run under bare `node` before any
// TypeScript is compiled read it by file path —
// packages/plugin-build/scripts/generate-runtime-export-manifest.mjs (the
// shims' static export lists) and
// packages/templates/scripts/generate-plugin-scaffold.mjs (the scaffold's
// type-only devDependencies). Keeping all three on this module is what makes
// "shimmed at runtime" and "declared for types" impossible to drift apart
// (#2072). The sibling runtime-shims.d.mts declares its shape for tsc.

/** The SDK app subpath plugin sources import. */
export const PLUGIN_SDK_APP_SPECIFIER = "@get-bb/plugin-sdk/app";

/**
 * Legacy alias for {@link PLUGIN_SDK_APP_SPECIFIER}, kept so pre-rename plugin
 * sources still build. It resolves to the same runtime slot and the same
 * export list; a later change removes it.
 */
export const LEGACY_PLUGIN_SDK_APP_SPECIFIER = "@bb/plugin-sdk/app";

/**
 * The shared-ui icon module. Builtin plugins import it by package specifier;
 * shared-ui's own components import it relatively (`./icon`), and the build's
 * runtime shim plugin routes both to the same host slot so no plugin bundle
 * carries a second hugeicons map.
 */
export const SHARED_UI_ICON_SPECIFIER = "@bb/shared-ui/icon";

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
 * apps/app/src/lib/plugin-frontend.ts (installPluginRuntime); the export
 * manifest and the scaffold's type-only devDependencies follow automatically.
 */
export const RUNTIME_SLOT_BY_SPECIFIER = Object.freeze({
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
});

/** The npm package owning a specifier: `react/jsx-runtime` → `react`. */
function packageNameOf(specifier) {
  const segments = specifier.split("/");
  return specifier.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : segments[0];
}

/**
 * Shimmed modules that are not npm packages a plugin would install: the SDK
 * facade (pinned separately, as `@get-bb/plugin-sdk`) and the workspace-only
 * shared-ui icon module.
 */
const NON_NPM_SHIM_PACKAGES = new Set([
  packageNameOf(PLUGIN_SDK_APP_SPECIFIER),
  packageNameOf(LEGACY_PLUGIN_SDK_APP_SPECIFIER),
  packageNameOf(SHARED_UI_ICON_SPECIFIER),
]);

/**
 * Shimmed npm specifiers whose named exports the build introspects from the
 * host app's installed copies — every slot except the workspace source
 * modules (the SDK facade and the shared-ui icon), whose export lists come
 * from esbuild metadata instead.
 */
export const RUNTIME_SHIM_NPM_SPECIFIERS = Object.freeze(
  Object.keys(RUNTIME_SLOT_BY_SPECIFIER).filter(
    (specifier) => !NON_NPM_SHIM_PACKAGES.has(packageNameOf(specifier)),
  ),
);

/**
 * The npm packages a plugin must declare as type-only devDependencies (at the
 * host's version) for its shimmed imports to typecheck: every shimmed npm
 * package except React, whose declarations ship separately as `@types/react`
 * and `@types/react-dom` and which the scaffold pins on its own. `bb plugin
 * build` never bundles any of these, so none belongs in `dependencies`.
 */
export const SHIMMED_TYPE_PACKAGES = Object.freeze(
  [
    ...new Set(
      RUNTIME_SHIM_NPM_SPECIFIERS.map(packageNameOf).filter(
        (name) => name !== "react" && name !== "react-dom",
      ),
    ),
  ].sort(),
);
