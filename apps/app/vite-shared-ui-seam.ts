import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const appDir = dirname(fileURLToPath(import.meta.url));

export function sharedUiEnvSeam(): Plugin {
  const portalScope = resolve(appDir, "./src/lib/portal-scope.ts");
  const hostUi = resolve(appDir, "./src/lib/host-ui.ts");
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
      if (/(^|\/)lib\/host-ui(\.js)?$/.test(source)) return hostUi;
      return null;
    },
  };
}
