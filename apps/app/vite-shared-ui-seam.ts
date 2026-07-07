import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const appDir = dirname(fileURLToPath(import.meta.url));

/**
 * The shared UI kit (@bb/shared-ui) ships the plugin/no-op flavor of two
 * environment leaves so its component source stays byte-identical across the
 * app, builtin plugins, and the shadcn registry (see packages/shared-ui and
 * packages/plugin-registry). Only the host app has real implementations:
 * `lib/portal-scope` reads the plugin-slot context so host overlays never
 * carry a plugin CSS scope (which would let plugin styles leak onto them),
 * and `hooks/useBrowserDimmingModal` dims the native browser WebContentsView
 * while a modal is open. This plugin redirects shared-ui's own relative
 * imports of those two leaves to the app flavors, so every Dialog the app
 * renders keeps its real behavior; plugin and registry builds resolve the
 * same imports to shared-ui's no-op leaves untouched.
 */
export function sharedUiEnvSeam(): Plugin {
  const portalScope = resolve(appDir, "./src/lib/portal-scope.ts");
  const browserDimming = resolve(appDir, "./src/hooks/useBrowserDimmingModal.ts");
  return {
    name: "bb:shared-ui-env-seam",
    enforce: "pre",
    resolveId(source, importer) {
      if (
        !importer ||
        !importer.replace(/\\/g, "/").includes("/packages/shared-ui/")
      ) {
        return null;
      }
      if (/(^|\/)lib\/portal-scope(\.js)?$/.test(source)) return portalScope;
      if (/(^|\/)hooks\/useBrowserDimmingModal(\.js)?$/.test(source)) {
        return browserDimming;
      }
      return null;
    },
  };
}
